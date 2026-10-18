#!/usr/bin/python3 -I
"""Reversibly archive one unused root-only configuration backup. No service changes."""
import contextlib
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

SOURCE = Path('/var/www/cronox/Web_Cronox/cronox-backend/.env.backup-20260912-storage')
ARCHIVE = Path('/root/cronox-private-config-archive-20261018')
BASE = Path('/var/lib/cronox-release')
FLAG = Path('/var/lib/cronox/maintenance.flag')
CONFIG = Path('/etc/cronox-release/runtime.json')
PROC = Path('/proc')
ROOT_UID = 0
ROOT_GID = 0
EXPECTED_SIZE = 2614


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


@contextlib.contextmanager
def directory(path, private=False):
    """Walk using directory descriptors, never following a symlink component."""
    path = Path(path)
    require(path.is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        info = os.fstat(fd)
        require(info.st_ino == path.lstat().st_ino and info.st_dev == path.lstat().st_dev,
                'DIRECTORY_CHANGED')
        if private:
            require(info.st_uid == ROOT_UID and info.st_gid == ROOT_GID
                    and stat.S_IMODE(info.st_mode) == 0o700, 'PRIVATE_DIRECTORY_REQUIRED')
        yield fd
    finally:
        os.close(fd)


def inspect(fd, name, *, size=None):
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        before = os.fstat(handle)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and before.st_uid == ROOT_UID and before.st_gid == ROOT_GID
                and stat.S_IMODE(before.st_mode) == 0o600, 'PRIVATE_REGULAR_FILE_REQUIRED')
        require(before.st_size <= 65536 and (size is None or before.st_size == size),
                'UNEXPECTED_FILE_SIZE')
        data = os.read(handle, 65537)
        stable = lambda s: tuple(getattr(s, k) for k in ('st_dev', 'st_ino', 'st_uid',
            'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))
        require(stable(os.fstat(handle)) == stable(before)
                and len(data) == before.st_size, 'FILE_CHANGED')
        require(stable(os.stat(name, dir_fd=fd, follow_symlinks=False)) == stable(before), 'FILE_REPLACED')
        return data, {k: getattr(before, k) for k in
                      ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns')}
    finally:
        os.close(handle)


def exists(fd, name):
    try:
        os.stat(name, dir_fd=fd, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False


def idle():
    require(not os.path.lexists(FLAG), 'MAINTENANCE_ACTIVE')
    terminal = {'success', 'failed_before_maintenance', 'recovered'}
    with directory(BASE, private=True) as fd:
        for name in os.listdir(fd):
            if len(name) == 40 and all(c in '0123456789abcdef' for c in name):
                with directory(BASE / name, private=True) as release_fd:
                    state = json.loads(inspect(release_fd, 'status.json')[0])
                    require(state.get('status') in terminal, 'UNRESOLVED_RELEASE')
    with directory(CONFIG.parent, private=True) as fd:
        config = json.loads(inspect(fd, CONFIG.name)[0])
    allowed = (None, '', '.env', str(SOURCE.parent / '.env'))
    require(config.get('CRONOX_ENV_FILE') in allowed, 'CUSTOM_ENV_FILE_IN_USE')
    with directory(SOURCE.parent) as source_fd:
        active = os.stat('.env', dir_fd=source_fd, follow_symlinks=False)
        require(stat.S_ISREG(active.st_mode), 'ACTIVE_ENV_MUST_NOT_BE_SYMLINK')
        if exists(source_fd, SOURCE.name):
            old = os.stat(SOURCE.name, dir_fd=source_fd, follow_symlinks=False)
            require((old.st_dev, old.st_ino) != (active.st_dev, active.st_ino),
                    'BACKUP_IS_ACTIVE_ENV')
    # Check running application processes too, without invoking PM2 as root.
    for entry in PROC.iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if (entry / 'cwd').resolve(strict=True) != SOURCE.parent:
                continue
            values = dict(line.split(b'=', 1) for line in
                          (entry / 'environ').read_bytes().split(b'\0') if b'=' in line)
            require(values.get(b'CRONOX_ENV_FILE', b'').decode() in allowed,
                    'RUNNING_CUSTOM_ENV_FILE_IN_USE')
        except (FileNotFoundError, ProcessLookupError):
            continue


def rename_without_replacing(source_fd, source_name, target_fd, target_name):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(source_fd, os.fsencode(source_name), target_fd, os.fsencode(target_name), 1):
        code = ctypes.get_errno()
        raise Refused('DESTINATION_EXISTS' if code == errno.EEXIST else 'ATOMIC_MOVE_FAILED')
    os.fsync(source_fd)
    os.fsync(target_fd)


def journal(data, identity):
    return {'source': str(SOURCE), 'archive': str(ARCHIVE / SOURCE.name),
            'identity': identity, 'sha256': hashlib.sha256(data).hexdigest()}


def execute(action):
    idle()
    with directory(SOURCE.parent) as source_fd:
        if action == '--plan':
            require(not os.path.lexists(ARCHIVE), 'ARCHIVE_ALREADY_EXISTS_USE_STATUS')
            inspect(source_fd, SOURCE.name, size=EXPECTED_SIZE)
            with directory(ARCHIVE.parent, private=True) as parent_fd:
                require(os.fstat(parent_fd).st_dev == os.fstat(source_fd).st_dev,
                        'SAME_FILESYSTEM_REQUIRED')
            require(hasattr(ctypes.CDLL(None), 'renameat2'), 'ATOMIC_MOVE_UNAVAILABLE')
            print('LEGACY_ENV_ARCHIVE_PLAN_OK: one unused backup; preserve root:root 600; no service changes')
            return
        require(action in ('--apply', '--status', '--restore'), 'FIXED_ACTION_REQUIRED')
        if not os.path.lexists(ARCHIVE):
            require(action == '--apply', 'ARCHIVE_MISSING')
            data, identity = inspect(source_fd, SOURCE.name, size=EXPECTED_SIZE)
            ARCHIVE.mkdir(mode=0o700)
            with directory(ARCHIVE, private=True) as archive_fd:
                handle = os.open('metadata.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=archive_fd)
                with os.fdopen(handle, 'w') as stream:
                    json.dump(journal(data, identity), stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.fsync(archive_fd)
            with directory(ARCHIVE.parent, private=True) as parent_fd:
                os.fsync(parent_fd)
        with directory(ARCHIVE, private=True) as archive_fd:
            require(set(os.listdir(archive_fd)) <= {'metadata.json', SOURCE.name}, 'UNEXPECTED_ARCHIVE_FILE')
            record = json.loads(inspect(archive_fd, 'metadata.json')[0])
            at_source, at_archive = exists(source_fd, SOURCE.name), exists(archive_fd, SOURCE.name)
            require(at_source != at_archive, 'FILE_LOCATION_AMBIGUOUS')
            data, identity = inspect(source_fd if at_source else archive_fd, SOURCE.name,
                                     size=EXPECTED_SIZE)
            require(journal(data, identity) == record, 'ARCHIVE_IDENTITY_OR_CONTENT_CHANGED')
            if action == '--status':
                print(json.dumps({'location': 'archive' if at_archive else 'application',
                                  'contentVerified': True, 'owner': 'root:root', 'mode': '600'}))
                return
            idle()
            # Recheck identity immediately before moving the single fixed entry.
            require(inspect(source_fd if at_source else archive_fd, SOURCE.name,
                            size=EXPECTED_SIZE) == (data, identity), 'FILE_CHANGED')
            if action == '--apply' and at_source:
                rename_without_replacing(source_fd, SOURCE.name, archive_fd, SOURCE.name)
                require(inspect(archive_fd, SOURCE.name, size=EXPECTED_SIZE) == (data, identity), 'MOVE_NOT_VERIFIED')
            elif action == '--restore' and at_archive:
                rename_without_replacing(archive_fd, SOURCE.name, source_fd, SOURCE.name)
                require(inspect(source_fd, SOURCE.name, size=EXPECTED_SIZE) == (data, identity), 'RESTORE_NOT_VERIFIED')
            print('LEGACY_ENV_ARCHIVED_AND_VERIFIED' if action == '--apply' else 'LEGACY_ENV_RESTORED_AND_VERIFIED')


def main(args):
    require(os.getuid() == ROOT_UID, 'ROOT_REQUIRED')
    require(args in (['--plan'], ['--apply'], ['--status'], ['--restore']), 'FIXED_ACTION_REQUIRED')
    script = Path(__file__)
    with directory(script.parent, private=True) as fd:
        inspect(fd, script.name)
    with directory(BASE, private=True) as fd:
        inspect(fd, 'controller.lock')
        handle = os.open('controller.lock', os.O_RDWR | os.O_NOFOLLOW, dir_fd=fd)
        try:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Refused('RELEASE_BUSY') from None
            execute(args[0])
        finally:
            os.close(handle)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except BaseException as error:
        print('LEGACY_ENV_ARCHIVE_REFUSED: ' +
              (str(error) if isinstance(error, Refused) else 'INSPECTION_OR_MOVE_FAILED'))
        sys.exit(1)
