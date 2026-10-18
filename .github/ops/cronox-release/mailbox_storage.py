#!/usr/bin/python3 -I
"""Fixed-path storage guard and administrator-only metadata repair.

No mail contents, keys, database changes, service restarts or delegated sudo grants.
Repair requires maintenance and stopped writers; rollback requires the same inodes.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ROOT = Path('/var/lib/cronox/mailboxes')
SNAPSHOT = Path('/root/cronox-mailbox-storage-repair-20261018')
FLAG = Path('/var/lib/cronox/maintenance.flag')
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'HOME': '/root'}
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
FILE = re.compile(UUID + r'(?:\.meta)?\Z')
UPLOAD = re.compile(UUID + r'\.upload\Z')


class StorageRefused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise StorageRefused(code)


def deploy_user():
    import pwd
    user = pwd.getpwnam('deploy')
    require(user.pw_uid > 0 and user.pw_gid > 0, 'DEPLOY_MUST_BE_UNPRIVILEGED')
    return user


def trusted_parents(path):
    for part in (path, *path.parents):
        st = part.lstat()
        require(not stat.S_ISLNK(st.st_mode) and st.st_uid == 0
                and not st.st_mode & 0o022, 'UNTRUSTED_STORAGE_PARENT')


def no_acl(fd):
    # Extended/default ACLs need a separately reviewed plan; chmod must not mask them.
    require(not any(name in ('system.posix_acl_access', 'system.posix_acl_default')
                    for name in os.listxattr(fd)), 'STORAGE_ACL_REQUIRES_REVIEW')


def metadata(fd, name):
    st = os.fstat(fd)
    no_acl(fd)
    directory = stat.S_ISDIR(st.st_mode)
    require(directory or stat.S_ISREG(st.st_mode), 'UNEXPECTED_STORAGE_TYPE')
    require(directory or st.st_nlink == 1, 'STORAGE_HARDLINK_REJECTED')
    require(not st.st_mode & 0o7000, 'STORAGE_SPECIAL_MODE_REJECTED')
    return {'name': name, 'kind': 'directory' if directory else 'file',
            'device': st.st_dev, 'inode': st.st_ino, 'uid': st.st_uid,
            'gid': st.st_gid, 'mode': stat.S_IMODE(st.st_mode)}


class Inventory(list):
    def __init__(self, rootfd):
        super().__init__()
        self.rootfd, self.uploadfd = rootfd, None

    @contextlib.contextmanager
    def opened(self, row):
        name = row['name']
        if name in ('.', 'uploads'):
            yield self.rootfd if name == '.' else self.uploadfd
            return
        parent = self.uploadfd if name.startswith('uploads/') else self.rootfd
        fd = os.open(name.split('/')[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=parent)
        try:
            yield fd
        finally:
            os.close(fd)


@contextlib.contextmanager
def opened_storage(uid, gid, *, repair=False):
    """Anchor parent descriptors, reject links, and compare inode before mutations."""
    trusted_parents(ROOT.parent)
    with contextlib.ExitStack() as stack:
        def open_at(name, parent=None, directory=False):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if directory:
                flags |= os.O_DIRECTORY
            fd = os.open(name, flags, dir_fd=parent)
            stack.callback(os.close, fd)
            return fd
        rootfd = open_at(ROOT, directory=True)
        objects = Inventory(rootfd)
        objects.append(metadata(rootfd, '.'))
        rootdev = objects[0]['device']
        names = sorted(os.listdir(rootfd))
        require(len(names) <= 100000, 'STORAGE_INVENTORY_LIMIT')
        for name in names:
            require(name == 'uploads' or FILE.fullmatch(name), 'UNEXPECTED_STORAGE_NAME')
            if name == 'uploads':
                fd = open_at(name, rootfd, directory=True)
                objects.uploadfd = fd
                row = metadata(fd, name)
            else:
                with objects.opened({'name': name}) as fd:
                    row = metadata(fd, name)
            require((row['kind'] == 'directory') == (name == 'uploads'), 'UNEXPECTED_STORAGE_TYPE')
            objects.append(row)
            if name == 'uploads':
                uploads = sorted(os.listdir(fd))
                require(len(uploads) <= 10000, 'STORAGE_INVENTORY_LIMIT')
                for upload in uploads:
                    require(UPLOAD.fullmatch(upload), 'UNEXPECTED_STORAGE_NAME')
                    with objects.opened({'name': 'uploads/' + upload}) as child:
                        row = metadata(child, 'uploads/' + upload)
                    require(row['kind'] == 'file', 'UNEXPECTED_STORAGE_TYPE')
                    objects.append(row)
        for row in objects:
            require(row['device'] == rootdev, 'STORAGE_MOUNT_REJECTED')
            allowed = {(0, 0), (uid, gid)} if repair else {(uid, gid)}
            require((row['uid'], row['gid']) in allowed, 'STORAGE_OWNER_MISMATCH')
            # uploads may be created by multer under a private 0700 directory;
            # existing 0644 uploads remain inaccessible to other accounts.
            modes = (0o700,) if row['kind'] == 'directory' else ((0o600, 0o644)
                    if row['name'].startswith('uploads/') else (0o600,))
            require(row['mode'] in modes, 'STORAGE_MODE_REQUIRES_REVIEW')
        yield objects


def probe_as_deploy(uid, gid):
    """Read-only OS access check, after dropping root, without reading mail bytes."""
    code = '''import os,sys
from pathlib import Path
p=Path('/var/lib/cronox/mailboxes')
assert os.access(p,os.R_OK|os.W_OK|os.X_OK)
for child in p.iterdir():
 if child.is_dir():
  assert child.name=='uploads' and os.access(child,os.R_OK|os.W_OK|os.X_OK)
  for item in child.iterdir(): assert os.access(item,os.R_OK|os.W_OK)
 else: assert os.access(child,os.R_OK|os.W_OK)
'''
    def demote():
        os.initgroups('deploy', gid)
        os.setgid(gid)
        os.setuid(uid)
    result = subprocess.run(['/usr/bin/python3', '-I', '-c', code], env=CLEAN,
                            capture_output=True, timeout=30, preexec_fn=demote)
    require(result.returncode == 0, 'DEPLOY_STORAGE_ACCESS_FAILED')


def check(configured):
    require(configured == str(ROOT), 'MAILBOX_PRIVATE_DIR_REQUIRES_REVIEW')
    user = deploy_user()
    with opened_storage(user.pw_uid, user.pw_gid) as objects:
        count = len(objects)
        probe_as_deploy(user.pw_uid, user.pw_gid)
    return count


def assert_stopped_apps(apps):
    require(len(apps) == 1 and apps[0]['name'] == 'cronox' and apps[0]['pid'] == 0
            and apps[0]['pm2_env']['status'] == 'stopped'
            and apps[0]['pm2_env'].get('pm_exec_path') == '/var/www/cronox/Web_Cronox/cronox-backend/dist/main.js'
            and apps[0]['pm2_env'].get('pm_cwd') == '/var/www/cronox/Web_Cronox/cronox-backend'
            and not apps[0]['pm2_env'].get('watch')
            and not apps[0]['pm2_env'].get('cron_restart'), 'APPLICATION_MUST_BE_STOPPED')


def quiesced():
    require(FLAG.is_file() and not FLAG.is_symlink(), 'MAINTENANCE_REQUIRED')
    trusted_parents(FLAG)
    # Keep deploy's existing daemon online. Stopping the app preserves the usual
    # boot guard, without creating a bootstrap bypass permit to restart systemd.
    result = subprocess.run(['/usr/bin/systemctl', 'show', 'pm2-root.service',
                             '-p', 'ActiveState', '--value'], env=CLEAN,
                            capture_output=True, timeout=10)
    require(result.returncode == 0 and result.stdout.strip() in (b'inactive', b'failed'),
            'ROOT_PM2_MUST_BE_INACTIVE')
    user = deploy_user()
    pm = Path('/var/lib/cronox-pm2')
    daemon = int((pm / 'pm2.pid').read_text())
    require(daemon > 1 and (pm / 'rpc.sock').is_socket(), 'DEPLOY_PM2_DAEMON_REQUIRED')
    result = subprocess.run(['/usr/bin/systemctl', 'show', 'pm2-deploy.service',
                             '-p', 'ActiveState', '-p', 'MainPID'], env=CLEAN,
                            capture_output=True, timeout=10)
    service = dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)
    require(result.returncode == 0 and service.get('ActiveState') == 'active'
            and service.get('MainPID') == str(daemon), 'DEPLOY_PM2_SERVICE_MISMATCH')
    os.kill(daemon, 0)
    require(Path('/proc/%d' % daemon).stat().st_uid == user.pw_uid
            and b'PM2' in Path('/proc/%d/cmdline' % daemon).read_bytes(),
            'DEPLOY_PM2_IDENTITY_MISMATCH')
    result = subprocess.run(['/usr/sbin/runuser', '-u', 'deploy', '--', '/usr/bin/pm2', 'jlist'],
                            env=dict(CLEAN, HOME=user.pw_dir, PM2_HOME=str(pm)),
                            capture_output=True, timeout=15)
    require(result.returncode == 0, 'DEPLOY_PM2_STATE_UNAVAILABLE')
    apps = json.loads(result.stdout)
    assert_stopped_apps(apps)
    result = subprocess.run(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000'], env=CLEAN,
                            capture_output=True, timeout=10)
    require(result.returncode == 0 and not result.stdout.strip(), 'APPLICATION_LISTENER_REMAINS')
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            cwd = (proc / 'cwd').readlink()
            command = (proc / 'cmdline').read_bytes()
        except (FileNotFoundError, ProcessLookupError):
            continue
        require(cwd != Path('/var/www/cronox/Web_Cronox/cronox-backend')
                and b'/var/www/cronox/Web_Cronox/cronox-backend/dist/main.js' not in command,
                'APPLICATION_WRITER_REMAINS')
        try:
            for fd in (proc / 'fd').iterdir():
                try:
                    require(not str(fd.readlink()).startswith(str(ROOT) + '/'),
                            'STORAGE_FILE_STILL_OPEN')
                except FileNotFoundError:
                    continue
        except (FileNotFoundError, ProcessLookupError):
            continue


def save_snapshot(rows):
    trusted_parents(SNAPSHOT.parent)
    require(not SNAPSHOT.exists() and not SNAPSHOT.is_symlink(), 'SNAPSHOT_ALREADY_EXISTS')
    SNAPSHOT.mkdir(mode=0o700)
    payload = json.dumps({'path': str(ROOT), 'version': 1, 'objects': rows}, sort_keys=True).encode()
    for name, data in (('metadata.json', payload),
                       ('metadata.sha256', hashlib.sha256(payload).hexdigest().encode())):
        fd = os.open(SNAPSHOT / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    for directory in (SNAPSHOT, SNAPSHOT.parent):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def change(objects, desired):
    # Root directory last: no application access before every child is ready.
    for current in reversed(objects):
        target = desired[current['name']]
        with objects.opened(current) as fd:
            fresh = metadata(fd, current['name'])
            require(fresh == current, 'STORAGE_CHANGED_DURING_REPAIR')
            os.fchown(fd, target['uid'], target['gid'])
            os.fchmod(fd, target['mode'])
            after = metadata(fd, current['name'])
            require(after == dict(current, uid=target['uid'], gid=target['gid'], mode=target['mode']),
                    'STORAGE_METADATA_CHANGE_FAILED')


def apply():
    quiesced()
    user = deploy_user()
    with opened_storage(user.pw_uid, user.pw_gid, repair=True) as objects:
        rows = list(objects)
        save_snapshot(rows)
        desired = {row['name']: dict(row, uid=user.pw_uid, gid=user.pw_gid,
                   mode=0o700 if row['kind'] == 'directory' else 0o600) for row in rows}
        change(objects, desired)
    check(str(ROOT))
    print('MAILBOX_STORAGE_REPAIRED: deploy access verified; keep maintenance until operational checks')


def rollback():
    quiesced()
    for path in (SNAPSHOT, SNAPSHOT / 'metadata.json', SNAPSHOT / 'metadata.sha256'):
        trusted_parents(path)
        require(not path.stat().st_mode & 0o077, 'SNAPSHOT_NOT_PRIVATE')
    payload = (SNAPSHOT / 'metadata.json').read_bytes()
    require(hashlib.sha256(payload).hexdigest() == (SNAPSHOT / 'metadata.sha256').read_text(),
            'SNAPSHOT_DIGEST_MISMATCH')
    saved = json.loads(payload)
    require(saved['version'] == 1 and saved['path'] == str(ROOT), 'SNAPSHOT_SCOPE_MISMATCH')
    desired = {row['name']: row for row in saved['objects']}
    require(len(desired) == len(saved['objects']), 'SNAPSHOT_DUPLICATE_OBJECT')
    user = deploy_user()
    with opened_storage(user.pw_uid, user.pw_gid, repair=True) as objects:
        require(set(desired) == {row['name'] for row in objects}, 'ROLLBACK_INVENTORY_CHANGED')
        for row in objects:
            require(all(row[key] == desired[row['name']][key]
                        for key in ('name', 'kind', 'device', 'inode')), 'ROLLBACK_OBJECT_REPLACED')
            old = desired[row['name']]
            require((old['uid'], old['gid']) in ((0, 0), (user.pw_uid, user.pw_gid))
                    and old['mode'] in (0o700, 0o600, 0o644), 'ROLLBACK_INVALID_METADATA')
        change(objects, desired)
    print('MAILBOX_STORAGE_METADATA_RESTORED: keep maintenance; previous access failure may return')


def main(args):
    require(os.getuid() == 0, 'ROOT_REQUIRED')
    trusted_parents(Path(__file__).absolute())
    require(len(args) == 1, 'ONE_FIXED_ACTION_REQUIRED')
    if args[0] == '--check':
        count = check(os.environ.get('MAILBOX_PRIVATE_DIR'))
        print('MAILBOX_STORAGE_ACCESS_OK objects=' + str(count))
    elif args[0] == '--plan':
        user = deploy_user()
        with opened_storage(user.pw_uid, user.pw_gid, repair=True) as objects:
            print(json.dumps({'path': str(ROOT), 'objects': len(objects),
                  'targetOwner': 'deploy', 'directoryMode': '700', 'fileMode': '600',
                  'snapshot': str(SNAPSHOT), 'requiresMaintenanceAndStoppedWriters': True,
                  'modifiesContentOrKeys': False}))
    elif args[0] in ('--apply', '--rollback'):
        # Share the existing deployment lock; this is not another release mechanism.
        import fcntl
        state = Path('/var/lib/cronox-release')
        trusted_parents(state)
        config = Path('/etc/cronox-release/runtime.json')
        trusted_parents(config)
        require(not config.stat().st_mode & 0o077, 'RUNTIME_CONFIG_NOT_PRIVATE')
        require(json.loads(config.read_text()).get('MAILBOX_PRIVATE_DIR') == str(ROOT),
                'MAILBOX_PRIVATE_DIR_REQUIRES_REVIEW')
        fd = os.open(state / 'controller.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            st = os.fstat(fd)
            require(stat.S_ISREG(st.st_mode) and st.st_uid == 0 and st.st_nlink == 1
                    and not st.st_mode & 0o077, 'UNTRUSTED_RELEASE_LOCK')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            (apply if args[0] == '--apply' else rollback)()
        finally:
            os.close(fd)
    else:
        raise StorageRefused('UNKNOWN_ACTION')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except BaseException as error:
        code = str(error) if isinstance(error, StorageRefused) else 'PRIVATE_DIAGNOSTIC_REQUIRED'
        print('MAILBOX_STORAGE_REFUSED: ' + code, file=sys.stderr)
        sys.exit(1)
