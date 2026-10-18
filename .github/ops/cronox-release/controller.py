#!/usr/bin/python3 -I
"""Root-owned, bounded deployment controller. Never execute repository code as root."""
import contextlib
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import tempfile

BASE = Path('/var/lib/cronox-release')
CONFIG = Path('/etc/cronox-release')
INSTALL = Path('/usr/local/lib/cronox-release')
REPO = Path('/var/www/cronox/Web_Cronox')
FLAG = Path('/var/lib/cronox/maintenance.flag')
SHA = re.compile(r'[0-9a-f]{40}\Z')
FLAGS = ('EMAIL_ENABLED', 'BACKGROUND_JOBS_ENABLED', 'WAITLIST_EMAIL_WORKER_ENABLED',
         'MAILBOX_WORKER_ENABLED', 'MAILBOX_SEND_ENABLED', 'STRIPE_WEBHOOK_WORKER_ENABLED')
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/root'}
PHASES = ('preflight', 'maintenance', 'stop', 'backup', 'install', 'migrate',
          'start_paused', 'check_paused', 'activate', 'check_active', 'save', 'open', 'public_check')


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def revision(value):
    require(bool(SHA.fullmatch(value)), 'INVALID_REVISION')
    return value


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic_json(path, data):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as f:
            os.chmod(temp, 0o600)
            json.dump(data, f, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    if os.name == 'posix':
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def secure_path(path, private=False):
    p = Path(path)
    for item in [p, *p.parents]:
        s = item.lstat()
        require(not item.is_symlink() and s.st_uid == 0 and not s.st_mode & 0o022,
                'UNTRUSTED_INSTALLATION_PATH')
    if private:
        require(not p.stat().st_mode & 0o077, 'PRIVATE_FILE_PERMISSIONS')


@contextlib.contextmanager
def lock(path, wait=False):
    import fcntl
    with open(path, 'a') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError:
            raise Refused('RELEASE_BUSY')
        yield


class Engine:
    """Journal intent BEFORE each operation; unknown completion is never retried."""
    def __init__(self, folder, sha, runtime):
        self.folder, self.sha, self.runtime = Path(folder), revision(sha), runtime
        self.state = {'revision': sha, 'status': 'running', 'phase': 'preflight', 'createdAt': stamp()}

    def record(self, **changes):
        self.state.update(changes, updatedAt=stamp())
        atomic_json(self.folder / 'status.json', self.state)

    def execute(self):
        touched = False
        try:
            for phase in PHASES:
                self.record(phase=phase, phaseComplete=False)
                if phase == 'maintenance':
                    touched = True
                getattr(self.runtime, phase)()
                self.record(phaseComplete=True)
            self.record(status='success')
        except BaseException:
            # Do not print exception text, child output, configuration or query results.
            safe = True
            if touched:
                try:
                    self.runtime.hold()
                except BaseException:
                    safe = False
            self.record(status='held' if touched else 'failed_before_maintenance',
                        safeStateConfirmed=safe, failureCode='PHASE_FAILED',
                        automaticRollback=False)
            raise Refused('RELEASE_FAILED_SEE_STATUS') from None


class Runtime:
    def __init__(self, sha, folder):
        import pwd
        self.sha, self.folder = revision(sha), Path(folder)
        self.user = pwd.getpwnam('deploy')
        secure_path(CONFIG / 'runtime.json', private=True)
        self.saved_env = json.loads((CONFIG / 'runtime.json').read_text())
        require(isinstance(self.saved_env, dict) and all(isinstance(k, str) and isinstance(v, str)
                for k, v in self.saved_env.items()), 'INVALID_RUNTIME_ENV')

    def command(self, args, *, user=False, env=None, input=None, timeout=120, cwd=None, output=None):
        actual_env = dict(CLEAN)
        demote = None
        if user:
            actual_env.update(HOME=self.user.pw_dir, USER='deploy', LOGNAME='deploy',
                              PM2_HOME='/var/lib/cronox-pm2')
            if env:
                actual_env.update(env)
            def demote():
                os.initgroups('deploy', self.user.pw_gid)
                os.setgid(self.user.pw_gid)
                os.setuid(self.user.pw_uid)
        elif env:
            actual_env.update(env)
        with open(self.folder / 'private.log', 'ab') as log, contextlib.ExitStack() as stack:
            stdout = stack.enter_context(open(output, 'xb')) if output else subprocess.PIPE
            result = subprocess.run(args, input=input, stdout=stdout, stderr=log,
                                    env=actual_env, cwd=cwd, timeout=timeout, preexec_fn=demote)
            if result.returncode:
                log.write(result.stdout or b'')
                raise Refused('SUBPROCESS_FAILED')
            return result.stdout or b''

    def app_env(self, paused=False):
        env = dict(self.saved_env)
        env.update(HOST='127.0.0.1', PM2_HOME='/var/lib/cronox-pm2',
                   CRONOX_LOCAL_DEV='false', CRONOX_ROUTE_SMOKE_MODE='false',
                   CRONOX_RECOVERY_STATUS_FILE='/var/lib/cronox-pm2/recovery-status.json')
        if paused:
            env.update({key: 'false' for key in FLAGS})
        else:
            env['STRIPE_WEBHOOK_WORKER_ENABLED'] = 'true'
        return env

    def pm2(self, args, paused=False):
        return self.command(['/usr/bin/pm2', *args], user=True, env=self.app_env(paused))

    def pg(self, sql):
        secure_path(CONFIG / 'pgpass', private=True)
        secure_path(CONFIG / 'pg_service.conf', private=True)
        return self.command(['/usr/bin/psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            input=('BEGIN READ ONLY; SET LOCAL statement_timeout=\'30s\';\n' + sql + '\nCOMMIT;').encode(),
                            env=self.pg_env())

    def pg_env(self):
        return dict(PGSERVICEFILE=str(CONFIG / 'pg_service.conf'),
                    PGPASSFILE=str(CONFIG / 'pgpass'), PGSERVICE='cronox-release')

    def git(self, *args):
        return self.command(['/usr/bin/git', '-C', str(REPO), *args], user=True).decode().strip()

    def preflight(self):
        import shutil
        require(not FLAG.exists(), 'MAINTENANCE_ALREADY_ACTIVE')
        self.mailbox_storage_check()
        require(shutil.disk_usage(BASE).free >= 8 * 1024**3, 'INSUFFICIENT_DISK')
        # The current full-row restore verifier is deliberately bounded, not an unbounded
        # in-memory service for arbitrarily large future databases.
        require(int(self.pg('SELECT pg_database_size(current_database());')) < 512 * 1024**2,
                'DATABASE_EXCEEDS_VERIFIED_RESTORE_ENVELOPE')
        self.command(['/usr/sbin/nginx', '-t'])
        require(self.command(['/usr/bin/systemctl', 'is-enabled', 'pm2-deploy.service']).strip() == b'enabled', 'PM2_BOOT_DISABLED')
        require(self.git('ls-remote', 'origin', 'refs/heads/main').split()[0] == self.sha, 'STALE_REVISION')
        self.git('fetch', 'origin', 'main')
        self.git('cat-file', '-e', self.sha + ':cronox-backend/src/payments/recovery-operational-status.ts')
        self.git('merge-base', '--is-ancestor', 'HEAD', self.sha)
        before = self.git('rev-parse', 'HEAD')
        revision(before)
        atomic_json(self.folder / 'before.json', {'revision': before})
        # Preserve all other working files; refuse overlap, never reset/clean/stash them.
        changes = set(self.git('diff', '--name-only', before, self.sha).splitlines())
        dirty = set(self.git('diff', '--name-only').splitlines()) | set(self.git('diff', '--cached', '--name-only').splitlines())
        require(not changes & dirty, 'OVERLAPPING_LOCAL_WORK')
        migrations = self.migrations()
        (self.folder / 'migrations-before.json').write_bytes(json.dumps(migrations).encode())
        for row in migrations:
            require(row['finished'] and not row['rolledBack'], 'UNRESOLVED_MIGRATION')
            content = self.command(['/usr/bin/git', '-C', str(REPO), 'show',
                self.sha + ':cronox-backend/prisma/migrations/' + row['name'] + '/migration.sql'], user=True)
            lf = content.replace(b'\r\n', b'\n')
            require(row['checksum'] in {hashlib.sha256(content).hexdigest(), hashlib.sha256(lf.replace(b'\n', b'\r\n')).hexdigest()},
                    'APPLIED_MIGRATION_CHANGED')
        self.command(['/usr/bin/docker', 'image', 'inspect', self.image()])
        self.loopback()
        self.health()
        require(all(self.saved_env.get(key) in ('true', 'false') for key in FLAGS[:-1]),
                'EXPLICIT_COMMUNICATION_POLICY_REQUIRED')
        self.command(['/usr/bin/node', str(INSTALL / 'preflight.cjs'), self.sha], user=True, timeout=240)

    def mailbox_storage_check(self):
        secure_path(INSTALL / 'mailbox_storage.py')
        self.command(['/usr/bin/python3', '-I', str(INSTALL / 'mailbox_storage.py'), '--check'],
                     env={'MAILBOX_PRIVATE_DIR': self.saved_env.get('MAILBOX_PRIVATE_DIR', '')}, timeout=60)

    @staticmethod
    def image():
        return 'supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'

    def migrations(self):
        raw = self.pg('SELECT coalesce(json_agg(json_build_object(\'name\',migration_name,\'checksum\',checksum,\'finished\',finished_at IS NOT NULL,\'rolledBack\',rolled_back_at IS NOT NULL) ORDER BY migration_name),\'[]\') FROM public._prisma_migrations;')
        return json.loads(raw)

    def maintenance(self):
        fd = os.open(FLAG, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, 'w') as f:
            f.write(self.sha + '\n')
            f.flush()
            os.fsync(f.fileno())
        for host in ('cronox.es', 'www.cronox.es'):
            self.http('https://' + host + '/api/health', 503)

    def stop(self):
        self.pm2(['stop', 'cronox'])
        self.pm2(['save'])  # stopped dump prevents writers returning after a host reboot
        apps = json.loads(self.pm2(['jlist']))
        require(len(apps) == 1 and apps[0]['name'] == 'cronox' and apps[0]['pid'] == 0,
                'OTHER_PM2_WRITERS')
        require(not self.command(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).strip(), 'LISTENER_REMAINS')
        require(self.pg("SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database();").strip() == b'0', 'PREPARED_TRANSACTIONS')
        # Unknown/active client writers require operator review, not terminating provider sessions.
        require(self.pg("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' AND (state IS NULL OR state<>'idle' OR xact_start IS NOT NULL);").strip() == b'0', 'OTHER_DATABASE_CLIENTS_ACTIVE')

    def backup(self):
        from backup import backup_and_verify
        backup_and_verify(self)

    def install(self):
        require(self.git('ls-remote', 'origin', 'refs/heads/main').split()[0] == self.sha, 'MAIN_MOVED')
        self.git('merge', '--ff-only', self.sha)
        require(self.git('rev-parse', 'HEAD') == self.sha, 'REVISION_MISMATCH')
        self.command(['/usr/bin/bash', str(INSTALL / 'build.sh')], user=True, env=self.app_env(True), timeout=900, cwd=REPO)

    def migrate(self):
        self.command(['/usr/bin/node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
                     user=True, env=self.app_env(True), cwd=REPO / 'cronox-backend', timeout=900)
        rows = self.migrations()
        require(all(r['finished'] and not r['rolledBack'] for r in rows), 'MIGRATION_NOT_COMPLETE')
        names = set()
        for row in rows:
            names.add(row['name'])
        expected = {p.name for p in (REPO / 'cronox-backend/prisma/migrations').iterdir() if p.is_dir()}
        require(names == expected, 'MIGRATIONS_NOT_MATCHING')
        atomic_json(self.folder / 'migrations-after.json', rows)

    def start_paused(self):
        self.pm2(['restart', 'cronox', '--update-env'], paused=True)
        self.health()

    def check_paused(self):
        self.loopback()
        self.mailbox_storage_check()
        for path in ('/tienda', '/cesta', '/checkout', '/api/shipping-methods?itemsTotal=6990&country=ES'):
            self.http('http://127.0.0.1:3000' + path, 200)
        self.http('http://127.0.0.1:3000/api/admin/payments/recovery', 401)
        status = self.telemetry()
        require(status['disabledReason'] == 'EXPLICITLY_DISABLED' and not status['enabled'], 'WORKER_NOT_PAUSED')
        # Capture counts, not identifiers/payloads. No historical retries or repairs.
        data = self.pg('SELECT json_build_object(\'review\',(SELECT count(*) FROM "StripeWebhookEvent" WHERE status=\'REVIEW\'),\'effects\',(SELECT count(*) FROM "CheckoutEffect" WHERE status<>\'COMPLETED\'));')
        (self.folder / 'queue-before.json').write_bytes(data)

    def activate(self):
        self.pm2(['restart', 'cronox', '--update-env'])
        self.health()

    def check_active(self):
        deadline, first = time.monotonic() + 90, None
        while time.monotonic() < deadline:
            second = self.telemetry()
            require(second['enabled'] and second['lastScanError'] is None, 'WORKER_FAILED')
            if first and first['pid'] == second['pid'] and second['lastScanCompletedAt'] \
                    and second['lastScanCompletedAt'] > first['lastScanCompletedAt']:
                atomic_json(self.folder / 'worker.json', {'first': first, 'second': second})
                self.loopback()
                return
            if second['lastScanCompletedAt']:
                first = second
            time.sleep(5)
        raise Refused('WORKER_NOT_ADVANCING')

    def telemetry(self):
        # App may write this file, but it is never interpreted as code or printed wholesale.
        path = Path('/var/lib/cronox-pm2/recovery-status.json')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as f:
            text = f.read(8193)
        require(len(text) <= 8192, 'INVALID_TELEMETRY')
        data = json.loads(text)
        app = json.loads(self.pm2(['jlist']))[0]
        require(data.get('pid') == app['pid'] and time.time() * 1000 - data.get('writtenAt', 0) < 30000,
                'STALE_TELEMETRY')
        return {key: data[key] for key in ('pid', 'enabled', 'disabledReason', 'lastScanCompletedAt', 'lastScanError')}

    def save(self):
        self.pm2(['save'])

    def open(self):
        require(FLAG.read_text().strip() == self.sha, 'FOREIGN_MAINTENANCE')
        FLAG.unlink()

    def public_check(self):
        for host in ('cronox.es', 'www.cronox.es'):
            for route in ('/', '/api/health', '/api/ready'):
                self.http('https://' + host + route, 200)

    def hold(self):
        if not FLAG.exists():
            FLAG.write_text(self.sha + '\n')
            FLAG.chmod(0o644)
        require(FLAG.read_text().strip() == self.sha, 'FOREIGN_MAINTENANCE')
        self.pm2(['stop', 'cronox'])
        self.pm2(['save'])

    def loopback(self):
        rows = self.command(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).decode().splitlines()
        require(len(rows) == 1 and rows[0].split()[3] == '127.0.0.1:3000', 'BACKEND_NOT_LOOPBACK')

    def http(self, url, expected):
        code = self.command(['/usr/bin/curl', '--silent', '--show-error', '--max-time', '10',
                             '--output', '/dev/null', '--write-out', '%{http_code}', url]).decode()
        require(code == str(expected), 'HTTP_CHECK_FAILED')

    def health(self):
        for _ in range(45):
            try:
                for route in ('/api/health', '/api/ready'):
                    self.http('http://127.0.0.1:3000' + route, 200)
                return
            except Refused:
                time.sleep(1)
        raise Refused('BACKEND_NOT_READY')


def main(args):
    require(os.getuid() == 0, 'ROOT_WRAPPER_REQUIRED')
    for path in (INSTALL, CONFIG, BASE, FLAG.parent):
        secure_path(path)
    require(len(args) == 2 and args[0] in ('request', 'status', 'worker', 'recover', 'fail-safe'), 'INVALID_COMMAND')
    action, sha = args[0], revision(args[1])
    folder = BASE / sha
    if action == 'status':
        require(folder.is_dir(), 'UNKNOWN_RELEASE')
        state = json.loads((folder / 'status.json').read_text())
        # A killed worker can leave RUNNING on disk; report interruption, never success.
        active = subprocess.run(['/usr/bin/systemctl', 'show', '-p', 'ActiveState', '--value',
                                 'cronox-release@' + sha + '.service'], env=CLEAN,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.strip() in (b'active', b'activating', b'deactivating')
        if state['status'] in ('queued', 'running', 'recovery_queued', 'recovering') and not active:
            state.update(status='interrupted', recovery='inspect-before-retry')
        print(json.dumps(state))
        return
    with lock(BASE / 'controller.lock', wait=action in ('worker', 'fail-safe')):
        if action == 'fail-safe':
            require(os.environ.get('SUDO_USER') is None, 'SYSTEMD_ONLY')
            state = json.loads((folder / 'status.json').read_text())
            if state['status'] not in ('success', 'recovered') and state['phase'] not in ('queued', 'preflight'):
                Runtime(sha, folder).hold()
                state.update(status='held', safeStateConfirmed=True, updatedAt=stamp())
                atomic_json(folder / 'status.json', state)
        elif action == 'request':
            if folder.exists():
                print(json.dumps({'revision': sha, 'existing': True}))
                return
            require(not FLAG.exists(), 'MAINTENANCE_ALREADY_ACTIVE')
            for other in BASE.glob('*/status.json'):
                require(json.loads(other.read_text())['status'] in ('success', 'failed_before_maintenance', 'recovered'), 'UNRESOLVED_RELEASE')
            folder.mkdir(mode=0o700)
            atomic_json(folder / 'status.json', {'revision': sha, 'status': 'queued', 'phase': 'queued', 'createdAt': stamp()})
            subprocess.run(['/usr/bin/systemctl', 'start', '--no-block', 'cronox-release@' + sha + '.service'], env=CLEAN, check=True)
            print(json.dumps({'revision': sha, 'status': 'queued'}))
        elif action == 'worker':
            require(os.environ.get('SUDO_USER') is None, 'WORKER_SYSTEMD_ONLY')
            require(folder.is_dir(), 'NO_QUEUED_RELEASE')
            state = json.loads((folder / 'status.json').read_text())
            require(state['status'] in ('queued', 'recovery_queued'), 'NO_QUEUED_RELEASE')
            def interrupted(signum, frame):
                raise Refused('INTERRUPTED')
            signal.signal(signal.SIGTERM, interrupted)
            if state['status'] == 'queued':
                Engine(folder, sha, Runtime(sha, folder)).execute()
            else:
                recover_existing(folder, sha, state)
        else:
            state = json.loads((folder / 'status.json').read_text())
            require(state['status'] != 'success' and state['phase'] in ('maintenance', 'stop', 'backup'), 'RECOVERY_REQUIRES_FORWARD_FIX')
            state.update(status='recovery_queued', updatedAt=stamp())
            atomic_json(folder / 'status.json', state)
            subprocess.run(['/usr/bin/systemctl', 'start', '--no-block', 'cronox-release@' + sha + '.service'], env=CLEAN, check=True)
            print(json.dumps({'revision': sha, 'status': 'recovery_queued'}))


def recover_existing(folder, sha, state):
    rt = Runtime(sha, folder)
    before = json.loads((folder / 'before.json').read_text())
    require(rt.git('rev-parse', 'HEAD') == before['revision'], 'CODE_CHANGED_NO_AUTOMATIC_ROLLBACK')
    require(rt.migrations() == json.loads((folder / 'migrations-before.json').read_text()), 'SCHEMA_HISTORY_CHANGED')
    state.update(status='recovering', updatedAt=stamp())
    atomic_json(folder / 'status.json', state)
    try:
        rt.activate()
        rt.loopback()
        rt.save()
        rt.open()
        rt.public_check()
        state.update(status='recovered', updatedAt=stamp())
        atomic_json(folder / 'status.json', state)
    except BaseException:
        rt.hold()
        raise Refused('RECOVERY_HELD') from None


if __name__ == '__main__':
    os.umask(0o077)
    # -I omits cwd and user PYTHONPATH. Only add the root-owned installation directory.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        main(sys.argv[1:])
    except BaseException:
        print('CRONOX_RELEASE_REFUSED_OR_FAILED: inspect status; private details withheld', file=sys.stderr)
        sys.exit(1)
