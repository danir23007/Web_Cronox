#!/usr/bin/python3 -I
"""One fixed, reversible v5 public-check patch. No application or service changes."""
import ast
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

INSTALL = Path('/usr/local/lib/cronox-release/controller.py')
BASE = Path('/var/lib/cronox-release')
FLAG = Path('/var/lib/cronox/maintenance.flag')
BACKUP = Path('/root/cronox-public-check-update-20261018')
ROOT_UID = 0
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'HOME': '/root'}
BASE_SHA256 = 'aa4b6dd5f1975f165ca1de47e526aed77428c3b4e316fb5436446ee006983689'
PATCH_SHA256 = '5d750ba66bbe02aadb02bdeda2b0c29551ad9c3d94be1b3812400a3b93b83df9'
OLD_BLOCK = b"    def public_check(self):\n        for host in ('cronox.es', 'www.cronox.es'):\n            for route in ('/', '/api/health', '/api/ready'):\n                self.http('https://' + host + route, 200)\n\n"
NEW_BLOCK = b"    def public_check(self):\n        for host in ('cronox.es', 'www.cronox.es'):\n            for route in ('/', '/api/health', '/api/ready'):\n                url = 'https://' + host + route\n                if host != 'www.cronox.es' or route != '/':\n                    self.http(url, 200)\n                    continue\n                # The public www homepage has a canonical redirect. Never\n                # follow arbitrary redirects or relax health/maintenance checks.\n                response = self.command(['/usr/bin/curl', '--silent', '--show-error', '--max-time', '10',\n                                         '--output', '/dev/null', '--write-out',\n                                         '%{http_code}\\n%{redirect_url}', url]).decode()\n                code, separator, target = response.partition('\\n')\n                require(separator == '\\n' and ((code == '200' and not target)\n                        or (code == '308' and target == 'https://cronox.es/')),\n                        'PUBLIC_CANONICAL_REDIRECT_INVALID')\n                if code == '308':\n                    self.http('https://cronox.es/', 200)\n\n"
TERMINAL = {'success', 'failed_before_maintenance', 'recovered'}


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def protected(path, *, directory=False, mode=None):
    path = Path(path)
    value = path.lstat()
    for item in (path, *path.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == ROOT_UID
                and info.st_gid == 0 and not info.st_mode & 0o022,
                'UNTRUSTED_PATH')
        if item != path:
            require(stat.S_ISDIR(info.st_mode), 'UNTRUSTED_PARENT')
    require(stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode),
            'UNEXPECTED_FILE_TYPE')
    if not directory:
        require(value.st_nlink == 1, 'HARDLINK_REFUSED')
    if mode is not None:
        require(stat.S_IMODE(value.st_mode) == mode, 'UNEXPECTED_MODE')
    return value


def read_file(path, mode):
    before = protected(path, mode=mode)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        require(os.fstat(stream.fileno()) == before, 'FILE_CHANGED')
        data = stream.read(1024 * 1024 + 1)
    require(len(data) <= 1024 * 1024, 'FILE_TOO_LARGE')
    return data


def fsync_folder(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def transform(original):
    require(digest(original) == BASE_SHA256, 'INSTALLED_BASE_MISMATCH')
    require(original.count(OLD_BLOCK) == 1 and OLD_BLOCK and NEW_BLOCK,
            'EXPECTED_METHOD_NOT_UNIQUE')
    result = original.replace(OLD_BLOCK, NEW_BLOCK, 1)
    before, after = ast.parse(original), ast.parse(result)
    for tree in (before, after):
        runtime = [node for node in tree.body if isinstance(node, ast.ClassDef)
                   and node.name == 'Runtime']
        require(len(runtime) == 1, 'RUNTIME_CLASS_MISMATCH')
        methods = [node for node in runtime[0].body if isinstance(node, ast.FunctionDef)
                   and node.name == 'public_check']
        require(len(methods) == 1, 'PUBLIC_CHECK_MISMATCH')
        runtime[0].body.remove(methods[0])
    require(ast.dump(before) == ast.dump(after), 'PATCH_SCOPE_MISMATCH')
    require(digest(result) == PATCH_SHA256, 'PATCH_DIGEST_MISMATCH')
    return result


def command(args):
    result = subprocess.run(args, env=CLEAN, capture_output=True, timeout=20)
    require(result.returncode == 0, 'SYSTEMD_INSPECTION_FAILED')
    return result.stdout


def idle():
    protected(BASE, directory=True, mode=0o700)
    protected(FLAG.parent, directory=True)
    require(not os.path.lexists(FLAG), 'MAINTENANCE_ACTIVE')
    for folder in BASE.iterdir():
        require(not folder.is_symlink(), 'UNTRUSTED_RELEASE_ENTRY')
        if not folder.is_dir():
            continue
        journal = folder / 'status.json'
        if re.fullmatch('[0-9a-f]{40}', folder.name):
            require(journal.exists(), 'RELEASE_JOURNAL_MISSING')
        if journal.exists():
            state = json.loads(read_file(journal, 0o600))
            require(state.get('status') in TERMINAL, 'UNRESOLVED_RELEASE')
    units = command(['/usr/bin/systemctl', 'list-units', '--all', '--plain',
                     '--no-legend', '--no-pager',
                     '--state=active,activating,deactivating,reloading,maintenance',
                     'cronox-release@*.service'])
    require(not units.strip(), 'RELEASE_UNIT_ACTIVE')
    jobs = command(['/usr/bin/systemctl', 'list-jobs', '--no-legend', '--no-pager'])
    require(not re.search(rb'cronox-release@[^\s]*\.service', jobs), 'RELEASE_JOB_PENDING')


@contextlib.contextmanager
def controller_lock():
    import fcntl
    lockfile = BASE / 'controller.lock'
    before = protected(lockfile, mode=0o600)
    fd = os.open(lockfile, os.O_RDWR | os.O_NOFOLLOW)
    try:
        require(os.fstat(fd) == before, 'LOCK_CHANGED')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('RELEASE_BUSY') from None
        yield
    finally:
        os.close(fd)


def backup_contents():
    protected(BACKUP, directory=True, mode=0o700)
    require({p.name for p in BACKUP.iterdir()} == {'controller.before.py', 'metadata.json'},
            'BACKUP_INCOMPLETE_OR_UNEXPECTED')
    original = read_file(BACKUP / 'controller.before.py', 0o400)
    metadata = json.loads(read_file(BACKUP / 'metadata.json', 0o400))
    require(metadata == {'baseSha256': BASE_SHA256, 'patchedSha256': PATCH_SHA256,
                         'target': str(INSTALL), 'mode': 0o644}, 'BACKUP_METADATA_MISMATCH')
    transform(original)
    return original


def save_backup(original):
    require(not os.path.lexists(BACKUP), 'BACKUP_ALREADY_EXISTS')
    protected(BACKUP.parent, directory=True)
    BACKUP.mkdir(mode=0o700)
    metadata = {'baseSha256': BASE_SHA256, 'patchedSha256': PATCH_SHA256,
                'target': str(INSTALL), 'mode': 0o644}
    for name, data in (('controller.before.py', original),
                       ('metadata.json', json.dumps(metadata, sort_keys=True).encode())):
        fd = os.open(BACKUP / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    fsync_folder(BACKUP)
    fsync_folder(BACKUP.parent)
    require(backup_contents() == original, 'BACKUP_NOT_VERIFIED')


def replace(expected, replacement):
    require(read_file(INSTALL, 0o644) == expected, 'INSTALLED_FILE_CHANGED')
    ast.parse(replacement)
    fd, filename = tempfile.mkstemp(prefix='.controller-public-check.', dir=INSTALL.parent)
    pending = Path(filename)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o644)
            stream.write(replacement)
            stream.flush()
            os.fsync(stream.fileno())
        protected(pending, mode=0o644)
        require(read_file(INSTALL, 0o644) == expected, 'INSTALLED_FILE_CHANGED')
        os.replace(pending, INSTALL)
        fsync_folder(INSTALL.parent)
        require(read_file(INSTALL, 0o644) == replacement, 'REPLACEMENT_NOT_VERIFIED')
    finally:
        pending.unlink(missing_ok=True)


def execute(action):
    idle()
    original = read_file(INSTALL, 0o644)
    current = digest(original)
    require(current in (BASE_SHA256, PATCH_SHA256), 'UNKNOWN_INSTALLED_VERSION')
    if action == '--status':
        if os.path.lexists(BACKUP):
            backup_contents()
        print(json.dumps({'version': 'patched' if current == PATCH_SHA256 else 'original',
                          'sha256': current, 'backupVerified': os.path.lexists(BACKUP)}))
        return
    if action in ('--plan', '--apply'):
        patched = transform(original)
        require(not os.path.lexists(BACKUP), 'BACKUP_ALREADY_EXISTS')
        if action == '--plan':
            print('PUBLIC_CHECK_PLAN_OK: one fixed method; no service, configuration or permission changes')
            return
        save_backup(original)
        idle()
        replace(original, patched)
        print('PUBLIC_CHECK_PATCHED: exact target digest verified; services unchanged')
        return
    require(action == '--restore' and current == PATCH_SHA256, 'RESTORE_REQUIRES_PATCHED_VERSION')
    before = backup_contents()
    idle()
    replace(original, before)
    print('PUBLIC_CHECK_RESTORED: exact original digest verified; backup retained; services unchanged')


def main(args):
    require(args in (['--plan'], ['--apply'], ['--status'], ['--restore']), 'FIXED_ACTION_REQUIRED')
    require(os.getuid() == ROOT_UID, 'ROOT_REQUIRED')
    protected(Path(__file__))
    protected(INSTALL.parent, directory=True, mode=0o755)
    with controller_lock():
        execute(args[0])


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except BaseException as error:
        code = str(error) if isinstance(error, Refused) else 'INSPECTION_OR_WRITE_FAILED'
        print('PUBLIC_CHECK_UPDATE_REFUSED: ' + code)
        sys.exit(1)
