#!/usr/bin/python3 -I
"""One fixed, reversible status diagnostics patch. No application or service changes."""
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
BACKUP = Path('/root/cronox-backup-diagnostics-update-20261018')
ROOT_UID = 0
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'HOME': '/root'}
BASE_SHA256 = '5d750ba66bbe02aadb02bdeda2b0c29551ad9c3d94be1b3812400a3b93b83df9'
PATCH_SHA256 = '707332baea6cb70bcffb0ce945554f13e779904aaf80b30136dc28507e8fc2f2'
OLD_BLOCK = "        print(json.dumps(state))\n        return\n".encode('utf8')
NEW_BLOCK = "        state['backupDiagnostics'] = backup_diagnostics(folder)\n        print(json.dumps(state))\n        return\n".encode('utf8')
HELPER_SOURCE = "def backup_diagnostics(folder):\n    import json\n    import os\n    from pathlib import Path\n    import re\n    import stat\n\n    try:\n        folder = Path(folder)\n        info = folder.lstat()\n        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:\n            return {'available': False}\n        names = ('database.dump', 'roles.sql', 'application.tar.gz', 'restore.sql',\n                 'graphql-function.sql', 'roles.restore.sql', 'verification.sql',\n                 'source-verification.json', 'restore-verification.json',\n                 'graphql-sequence.sql', 'backup-verified.json', 'backup-sha256.json')\n\n        def entry(name):\n            path = folder / name\n            try:\n                value = path.lstat()\n            except FileNotFoundError:\n                return None\n            if not stat.S_ISREG(value.st_mode) or value.st_uid != os.geteuid() \\\n                    or value.st_nlink != 1 or value.st_mode & 0o077:\n                raise ValueError('UNTRUSTED_DIAGNOSTIC_FILE')\n            return value\n\n        def read(name, limit, tail=False):\n            before = entry(name)\n            if before is None:\n                return None\n            handle = os.open(folder / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)\n            try:\n                current = os.fstat(handle)\n                if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino):\n                    raise ValueError('DIAGNOSTIC_FILE_CHANGED')\n                if before.st_size > limit:\n                    if not tail:\n                        raise ValueError('DIAGNOSTIC_FILE_TOO_LARGE')\n                    os.lseek(handle, -limit, os.SEEK_END)\n                return os.read(handle, limit).decode('utf8', errors='replace')\n            finally:\n                os.close(handle)\n\n        artifacts = []\n        for name in names:\n            value = entry(name)\n            artifacts.append({'name': name, 'present': value is not None,\n                              'bytes': value.st_size if value else None})\n        text = read('private.log', 65536, tail=True) or ''\n        patterns = {\n            'TAR_PERMISSION_DENIED': r'tar:.*(?:Permission denied|Cannot open)',\n            'TAR_SOURCE_CHANGED': r'tar:.*(?:file changed as we read|File removed before we read)',\n            'TAR_FAILED': r'tar:.*(?:failure status|Error is not recoverable)',\n            'PG_DUMP_FAILED': r'pg_dump(?:all)?: error:',\n            'PG_RESTORE_FAILED': r'pg_restore: error:',\n            'SQL_PERMISSION_DENIED': r'(?:ERROR|FATAL):.*(?:permission denied|must be owner|must be superuser)',\n            'SQL_SYNTAX_ERROR': r'ERROR:.*(?:syntax error|invalid command)',\n            'SQL_MISSING_FUNCTION': r'ERROR:.*function .* does not exist',\n            'SQL_MISSING_ROLE': r'(?:ERROR|FATAL):.*role .* does not exist',\n            'SQL_EXTENSION_ERROR': r'ERROR:.*extension',\n            'SQL_AUTH_FAILED': r'FATAL:.*(?:authentication failed|no pg_hba.conf entry)',\n            'POSTGRES_SHUTTING_DOWN': r'FATAL:.*database system is shutting down',\n            'NO_SPACE_LEFT': r'No space left on device',\n        }\n        result = {'available': True, 'artifacts': artifacts,\n                  'errorClasses': [code for code, pattern in patterns.items()\n                                   if re.search(pattern, text, re.I)],\n                  'postgresErrorPresent': bool(re.search(r'\\b(?:ERROR|FATAL|PANIC):', text)),\n                  'logTailLimited': entry('private.log') is not None\n                      and entry('private.log').st_size > 65536}\n        a, b = read('source-verification.json', 4 * 1024**2), read('restore-verification.json', 4 * 1024**2)\n        if a is not None and b is not None:\n            def mapping(raw):\n                rows = json.loads(raw)\n                if not isinstance(rows, list) or len(rows) > 5000:\n                    raise ValueError('INVALID_COMPARISON')\n                output = {}\n                for row in rows:\n                    policy = row.get('definition', {})\n                    key = (row.get('kind'), row.get('schema'), row.get('name'),\n                           policy.get('schemaname'), policy.get('tablename'), policy.get('policyname'))\n                    if key in output:\n                        raise ValueError('DUPLICATE_COMPARISON')\n                    output[key] = row\n                return output\n            source, restored = mapping(a), mapping(b)\n            kinds, fields, count = {}, {}, 0\n            allowed_kinds = {'table', 'sequence', 'permissions', 'policy', 'extension'}\n            allowed_fields = {'rows', 'digest', 'value', 'called', 'owner', 'rls', 'forceRls',\n                              'acl', 'definition', 'version', 'kind', 'schema', 'name'}\n            for key in source.keys() | restored.keys():\n                left, right = source.get(key, {}), restored.get(key, {})\n                if left == right:\n                    continue\n                count += 1\n                kind = key[0] if key[0] in allowed_kinds else 'other'\n                kinds[kind] = kinds.get(kind, 0) + 1\n                for field in left.keys() | right.keys():\n                    if left.get(field) != right.get(field):\n                        label = field if field in allowed_fields else 'other'\n                        fields[label] = fields.get(label, 0) + 1\n            result['comparison'] = {'sourceObjects': len(source), 'restoredObjects': len(restored),\n                                    'differenceCount': count, 'differencesByKind': kinds,\n                                    'differencesByField': fields}\n        return result\n    except Exception:\n        return {'available': False}".encode('utf8')
MAIN_ANCHOR = b'def main(args):'
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
    require(original.count(OLD_BLOCK) == 1 and original.count(MAIN_ANCHOR) == 1,
            'EXPECTED_STATUS_NOT_UNIQUE')
    result = original.replace(OLD_BLOCK, NEW_BLOCK, 1).replace(
        MAIN_ANCHOR, HELPER_SOURCE + b'\n\n\n' + MAIN_ANCHOR, 1)
    before, after = ast.parse(original), ast.parse(result)
    helpers = [node for node in after.body if isinstance(node, ast.FunctionDef)
               and node.name == 'backup_diagnostics']
    require(len(helpers) == 1, 'DIAGNOSTIC_FUNCTION_MISMATCH')
    require(ast.dump(helpers[0]) == ast.dump(ast.parse(HELPER_SOURCE).body[0]),
            'DIAGNOSTIC_FUNCTION_CHANGED')
    after.body.remove(helpers[0])
    added = ast.parse("state['backupDiagnostics'] = backup_diagnostics(folder)").body[0]
    removed = 0
    for parent in ast.walk(after):
        for field, values in ast.iter_fields(parent):
            if isinstance(values, list):
                for node in list(values):
                    if isinstance(node, ast.Assign) and ast.dump(node) == ast.dump(added):
                        values.remove(node)
                        removed += 1
    require(removed == 1 and ast.dump(before) == ast.dump(after), 'PATCH_SCOPE_MISMATCH')
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
    fd, filename = tempfile.mkstemp(prefix='.controller-backup-diagnostics.', dir=INSTALL.parent)
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
            print('BACKUP_DIAGNOSTICS_PLAN_OK: status read-only signals; no service, configuration or sudo changes')
            return
        save_backup(original)
        idle()
        replace(original, patched)
        print('BACKUP_DIAGNOSTICS_PATCHED: exact target digest verified; services unchanged')
        return
    require(action == '--restore' and current == PATCH_SHA256, 'RESTORE_REQUIRES_PATCHED_VERSION')
    before = backup_contents()
    idle()
    replace(original, before)
    print('BACKUP_DIAGNOSTICS_RESTORED: exact original digest verified; backup retained; services unchanged')


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
        print('BACKUP_DIAGNOSTICS_UPDATE_REFUSED: ' + code)
        sys.exit(1)
