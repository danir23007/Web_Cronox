#!/usr/bin/python3 -I
"""Second reviewed forward completion: strip inherited PM2 IPC, preserve all release checks."""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile

SHA = '5d06609b1c6692477a57dd9b32de5c5937b0b6fd'
BEFORE = '488a5185122826188986fd6cedd3e1046cfe42ba'
LIB = Path('/usr/local/lib/cronox-release')
FOLDER = Path('/var/lib/cronox-release') / SHA
BACKUP = FOLDER / 'install-forward-ipc-20261018'
OLD_BUILD = 'c8fcc9b1f215d4f261ca52050a9377c20d3fa92d7d1a5e8fa46cac6f20a583f0'
NEW_BUILD = 'c8fcc9b1f215d4f261ca52050a9377c20d3fa92d7d1a5e8fa46cac6f20a583f0'
CONTROLLER = '6067b94dc628942a543449090b7a35602adfe3cca7cfa68be47c406744d3047a'
PATCH_CONTROLLER = '98f2e45282bfce99688dfbb3db9f0b183b001069ece612a3e299458099bc98e3'
ANCHOR = b"        with open(self.folder / 'private.log', 'ab') as log, contextlib.ExitStack() as stack:\n"
EXTRA = b"        # PM2 IPC descriptors belong to the original child, never to a new CLI.\n        for key in ('NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE', 'NODE_UNIQUE_ID'):\n            actual_env.pop(key, None)\n"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def transform(data):
    if digest(data) != CONTROLLER or data.count(ANCHOR) != 1:
        raise ValueError('CONTROLLER_BASE_MISMATCH')
    result = data.replace(ANCHOR, EXTRA + ANCHOR, 1)
    if digest(result) != PATCH_CONTROLLER:
        raise ValueError('CONTROLLER_TARGET_MISMATCH')
    return result


def load_controller():
    if os.getuid() != 0:
        raise ValueError('ROOT_REQUIRED')
    for path in (LIB, FOLDER, Path('/etc/cronox-release')):
        for item in (path, *path.parents):
            info = item.lstat()
            if item.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('UNTRUSTED_PATH')
    p = LIB / 'controller.py'
    if p.is_symlink() or p.stat().st_uid != 0 or p.stat().st_mode & 0o022 or digest(p.read_bytes()) not in (CONTROLLER, PATCH_CONTROLLER):
        raise ValueError('CONTROLLER_VERSION_MISMATCH')
    sys.path.insert(0, str(LIB))
    import controller
    return controller


def validate(c, rt):
    c.require(not BACKUP.exists(), 'ALREADY_ATTEMPTED_INSPECT_STATUS')
    state = json.loads((FOLDER / 'status.json').read_text())
    c.require(state['revision'] == SHA and state['status'] == 'held'
              and state['phase'] == 'install' and state['phaseComplete'] is False
              and state['safeStateConfirmed'] is True, 'UNEXPECTED_RELEASE_STATE')
    c.require(json.loads((FOLDER / 'before.json').read_text())['revision'] == BEFORE, 'BEFORE_MISMATCH')
    c.require(c.FLAG.read_text().strip() == SHA, 'FOREIGN_MAINTENANCE')
    rt.http('https://cronox.es/api/health', 503)
    rt.http('https://www.cronox.es/api/health', 503)
    c.require(rt.git('rev-parse', 'HEAD') == SHA
              and rt.git('ls-remote', 'origin', 'refs/heads/main').split()[0] == SHA, 'CODE_MOVED')
    c.require(rt.migrations() == json.loads((FOLDER / 'migrations-before.json').read_text()), 'HISTORY_CHANGED')
    # No migration was reached and this mail revision has no pending migrations.
    expected = {p.name for p in (c.REPO / 'cronox-backend/prisma/migrations').iterdir() if p.is_dir()}
    c.require(expected == {r['name'] for r in rt.migrations()}, 'PENDING_MIGRATION_REQUIRES_SEPARATE_REVIEW')
    apps = json.loads(rt.pm2(['jlist']))
    c.require(len(apps) == 1 and apps[0]['name'] == 'cronox' and apps[0]['pid'] == 0
              and apps[0]['pm2_env']['status'] == 'stopped', 'WRITERS_NOT_STOPPED')
    c.require(not rt.command(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).strip(), 'LISTENER_PRESENT')
    c.require(rt.pg("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND (state IS NULL OR state<>'idle' OR xact_start IS NOT NULL);").strip() == b'0', 'ACTIVE_DATABASE_CLIENT')
    verified = json.loads((FOLDER / 'backup-verified.json').read_text())
    c.require(verified.get('restoreCompared') is True, 'RESTORE_NOT_VERIFIED')
    c.require(json.loads((FOLDER / 'source-verification.json').read_text())
              == json.loads((FOLDER / 'restore-verification.json').read_text()), 'RESTORE_DIFFERS')
    hashes = json.loads((FOLDER / 'backup-sha256.json').read_text())
    c.require({'database.dump', 'roles.sql', 'application.tar.gz', 'restore.sql'} <= set(hashes), 'BACKUP_INCOMPLETE')
    for name, expected_hash in hashes.items():
        c.require('/' not in name and name not in ('.', '..'), 'UNSAFE_BACKUP_NAME')
        path = FOLDER / name
        c.require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode)
                  and path.stat().st_uid == 0 and not path.stat().st_mode & 0o077, 'UNSAFE_BACKUP')
        with path.open('rb') as stream:
            c.require(hashlib.file_digest(stream, 'sha256').hexdigest() == expected_hash, 'BACKUP_CHANGED')
    build = LIB / 'build.sh'
    c.secure_path(build)
    c.require(stat.S_IMODE(build.stat().st_mode) == 0o644, 'BUILD_MODE_MISMATCH')
    c.require(digest(build.read_bytes()) == NEW_BUILD, 'BUILD_CONFIG_MISMATCH')
    c.require((FOLDER / 'install-forward-20261018/original-status.json').is_file(), 'FIRST_ATTEMPT_NOT_PRESERVED')
    transform((LIB / 'controller.py').read_bytes())
    c.require('sh: 1: vite: not found' in (FOLDER / 'private.log').read_text(errors='replace'), 'FAILURE_NOT_CONFIRMED')
    return state


def patch_build(c):
    path = LIB / 'controller.py'
    before = path.read_bytes()
    after = transform(before)
    (BACKUP / 'controller.py.before').write_bytes(before)
    fd, name = tempfile.mkstemp(prefix='controller.ipc.', dir=LIB)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(after)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o644)
        os.replace(name, path)
        fd = os.open(LIB, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        Path(name).unlink(missing_ok=True)
    c.atomic_json(BACKUP / 'patch.json', {'before': digest(before), 'after': digest(after)})


def continue_release(c, rt, state):
    engine = c.Engine(FOLDER, SHA, rt)
    engine.state = dict(state)
    engine.state.pop('failureCode', None)
    engine.record(status='running', forwardCompletion='reviewed-pm2-ipc-environment-20261018')
    try:
        for phase in c.PHASES[c.PHASES.index('install'):]:
            engine.record(phase=phase, phaseComplete=False)
            getattr(rt, phase)()
            engine.record(phaseComplete=True)
        engine.record(status='success')
    except BaseException:
        safe = False
        try:
            rt.hold()
            safe = True
        finally:
            engine.record(status='held', safeStateConfirmed=safe, failureCode='FORWARD_PHASE_FAILED', automaticRollback=False)
        raise


def main(args):
    c = load_controller()
    c.require(len(args) == 1 and args[0] in ('--plan', '--resume', '--fail-safe'), 'INVALID_ACTION')
    with c.lock(c.BASE / 'controller.lock', wait=args[0] == '--fail-safe'):
        rt = c.Runtime(SHA, FOLDER)
        if args[0] == '--fail-safe':
            state = json.loads((FOLDER / 'status.json').read_text())
            if BACKUP.exists() and state['status'] != 'success':
                rt.hold()
                state.update(status='held', safeStateConfirmed=True, updatedAt=c.stamp())
                c.atomic_json(FOLDER / 'status.json', state)
            return
        state = validate(c, rt)
        if args[0] == '--plan':
            print('INSTALL_FORWARD_PLAN_OK: same SHA; verified backup; unchanged migration history; build tools configured; strip inherited IPC; no rollback')
            return
        def interrupted(signum, frame):
            raise c.Refused('INTERRUPTED')
        signal.signal(signal.SIGTERM, interrupted)
        BACKUP.mkdir(mode=0o700)
        c.atomic_json(BACKUP / 'original-status.json', state)
        try:
            patch_build(c)
            import importlib
            c = importlib.reload(c)
            rt = c.Runtime(SHA, FOLDER)
            continue_release(c, rt, state)
        except BaseException:
            rt.hold()
            raise
        print('INSTALL_FORWARD_COMPLETED: inspect status and operational evidence')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except BaseException:
        print('INSTALL_FORWARD_REFUSED_OR_HELD: inspect private evidence; do not rerun', file=sys.stderr)
        sys.exit(1)
