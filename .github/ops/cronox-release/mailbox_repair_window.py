#!/usr/bin/python3 -I
"""One approved, fixed-version mailbox ownership repair. Never deploys code.

Run as a root systemd oneshot so disconnecting the operator does not interrupt it.
All diagnostics/evidence are private; stdout contains only fixed result markers.
"""
import contextlib
import hashlib
import itertools
import json
import os
from pathlib import Path
import runpy
import signal
import stat
import subprocess
import sys
import time
import traceback
from types import SimpleNamespace

HERE = Path(__file__).absolute().parent
EXPECTED = '488a5185122826188986fd6cedd3e1046cfe42ba'
REPO = Path('/var/www/cronox/Web_Cronox')
BACKEND = REPO / 'cronox-backend'
PM = Path('/var/lib/cronox-pm2')
WINDOW = Path('/root/cronox-mailbox-repair-window-20261018')
FLAG = Path('/var/lib/cronox/maintenance.flag')
STATE = Path('/var/lib/cronox-release')
CONFIG = Path('/etc/cronox-release/runtime.json')
STORAGE = Path('/var/lib/cronox/mailboxes')
REPAIR_SNAPSHOT = Path('/root/cronox-mailbox-storage-repair-20261018')
FLAG_BYTES = b'cronox-mailbox-storage-repair-20261018\n'
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'HOME': '/root'}
CONTROLS = ('HOST', 'MAILBOX_PRIVATE_DIR', 'EMAIL_ENABLED', 'BACKGROUND_JOBS_ENABLED',
            'WAITLIST_EMAIL_WORKER_ENABLED', 'MAILBOX_WORKER_ENABLED',
            'MAILBOX_SEND_ENABLED', 'STRIPE_WEBHOOK_WORKER_ENABLED',
            'CRONOX_LOCAL_DEV', 'CRONOX_ROUTE_SMOKE_MODE')
# PM2 lifecycle fields observed in the captured process environment. They are
# bookkeeping, not application configuration, and change on legitimate restart.
PM2_METADATA = {'pm_uptime', 'restart_time', 'created_at', 'unstable_restarts',
                'status', 'pm_id', 'vizion_running', 'exit_code', 'prev_restart_delay'}
# Confirmed in installed PM2 7.0.4: God.handleExit assigns exit_code;
# God/Methods.resetState and Worker reset prev_restart_delay; Startup.dump
# removes prev_restart_delay. Neither represents application configuration.
POST_STOP_PM2_METADATA = ('exit_code', 'prev_restart_delay')
# The already-recorded fingerprint must always use exactly the original rule.
RECORDED_PM2_METADATA = frozenset({'pm_uptime', 'restart_time', 'created_at',
                                 'unstable_restarts', 'status', 'pm_id', 'vizion_running'})


class Refused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Refused(code)


def application_environment(env, saved_keys):
    return {key: env.get(key) for key in sorted((set(saved_keys) | set(CONTROLS)) - PM2_METADATA)}


def fork_environment(pm2_env, keys):
    # Confirmed against the installed PM2 7.0.4 ForkMode implementation: only
    # scalar, non-null top-level fields are passed to child_process.spawn.
    code = """const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const env=Object.create(null);
for(const key of input.keys){const value=input.env[key];
env[key]=value!==null&&value!==undefined&&typeof value!=='object'?String(value):null;}
// PM2 7.0.4 uses stdio ['pipe','pipe','pipe','ipc']; Node v22 appends
// both IPC fields to envPairs. Node then removes them from process.env,
// so they exist in /proc but may be absent from the PM2 record.
if(input.keys.includes('NODE_CHANNEL_FD'))env.NODE_CHANNEL_FD='3';
if(input.keys.includes('NODE_CHANNEL_SERIALIZATION_MODE'))env.NODE_CHANNEL_SERIALIZATION_MODE='json';
process.stdout.write(JSON.stringify(env));"""
    result = subprocess.run(['/usr/bin/node', '-e', code], env=CLEAN,
                            input=json.dumps({'env': pm2_env, 'keys': keys}).encode(),
                            capture_output=True, timeout=15)
    require(result.returncode == 0, 'FORK_ENVIRONMENT_RECONSTRUCTION_FAILED')
    # Match Path.read_text() in the historical /proc reader, including Python's
    # universal-newline conversion inside otherwise opaque scalar values.
    return {key: value.replace('\r\n', '\n').replace('\r', '\n') if isinstance(value, str) else value
            for key, value in json.loads(result.stdout).items()}


def reconstruct_original_environment(old, original_dump, saved_config, keys, fingerprint):
    # The original /proc environment was hashed before PM2's mutable record was
    # snapshotted. Try only original private sources and known lifecycle values.
    # The complete historical fingerprint, including both fields, MUST match.
    sources = [old, old.get('env', {}), saved_config, original_dump,
               original_dump.get('env', {})]
    candidates = [fork_environment(value, keys) for value in sources if isinstance(value, dict)]
    values = {key: {None, '0'} | {value.get(key) for value in candidates}
              for key in POST_STOP_PM2_METADATA}
    for pair in itertools.product(*(values[key] for key in POST_STOP_PM2_METADATA)):
        candidate = dict(candidates[0])
        candidate.update(dict(zip(POST_STOP_PM2_METADATA, pair)))
        candidates.append({key: candidate[key] for key in keys})
    matched = [value for value in candidates
               if hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest() == fingerprint]
    require(bool(matched), 'RECORDED_ENVIRONMENT_NOT_RECONSTRUCTED')
    require(all(value == matched[0] for value in matched), 'AMBIGUOUS_ORIGINAL_ENVIRONMENT')
    return matched[0]


def failure_evidence(error):
    # Do not serialize exception text/args: provider and filesystem errors may
    # carry private paths or values. Our own fixed refusal codes are safe.
    code = str(error) if isinstance(error, Refused) else ''
    if not code or len(code) > 100 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789' for c in code):
        code = 'PRIVATE_DIAGNOSTIC_REQUIRED'
    frames = traceback.extract_tb(error.__traceback__)
    known_types = {'Refused', 'StorageRefused', 'FileNotFoundError', 'PermissionError',
                   'TimeoutExpired', 'KeyError', 'ValueError', 'RuntimeError', 'KeyboardInterrupt'}
    evidence = {'failureCode': code,
                'errorType': type(error).__name__ if type(error).__name__ in known_types else 'OtherError'}
    if frames:
        frame = frames[-1]
        evidence['failureLocation'] = {'file': Path(frame.filename).name,
                                       'function': frame.name, 'line': frame.lineno}
    return evidence


def trusted(path, private=False):
    for part in (path, *path.parents):
        value = part.lstat()
        require(value.st_uid == 0 and not stat.S_ISLNK(value.st_mode)
                and not value.st_mode & 0o022, 'UNTRUSTED_PRIVILEGED_PATH')
    if private:
        require(not path.stat().st_mode & 0o077, 'PRIVATE_PATH_REQUIRED')


def validated_helper():
    require(os.getuid() == 0, 'ROOT_REQUIRED')
    manifest_path = HERE / 'manifest.json'
    trusted(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    names = {'mailbox_repair_window.py', 'mailbox_storage.py'}
    require(set(manifest) == names, 'REPAIR_MANIFEST_SCOPE_INVALID')
    for name in names:
        file = HERE / name
        trusted(file)
        require(hashlib.sha256(file.read_bytes()).hexdigest() == manifest[name],
                'REPAIR_MANIFEST_DIGEST_MISMATCH')
    # Only execute the root-owned helper AFTER validating its reviewed package hash.
    helper = SimpleNamespace(**runpy.run_path(str(HERE / 'mailbox_storage.py'),
                                             run_name='validated_storage_helper'))
    require(helper.ROOT == STORAGE and helper.FLAG == FLAG,
            'REPAIR_HELPER_SCOPE_MISMATCH')
    return helper


class Window:
    def __init__(self, runtime):
        self.runtime = runtime

    def execute(self):
        r = self.runtime
        before = r.preflight()
        r.prepare(before)
        phase = 'maintenance'
        try:
            for phase in ('maintenance', 'stop', 'repair', 'start', 'verify', 'reopen', 'external'):
                r.record(status='running', phase=phase)
                getattr(r, phase)()
            r.record(status='success', phase='complete', revision=EXPECTED,
                     codeUnchanged=True, controlsUnchanged=True, databaseSchemaModified=False)
        except BaseException as error:
            safe = False
            try:
                safe = r.hold() is True
            except BaseException:
                pass
            r.record(status='held', phase=phase, safeStateConfirmed=safe,
                     automaticRollback=False, **failure_evidence(error))
            raise Refused('REPAIR_WINDOW_HELD_INSPECT_PRIVATE_EVIDENCE') from None

    def resume(self):
        r = self.runtime
        r.resume_preflight()
        r.prepare_resume()
        phase = 'start'
        try:
            for phase in ('start', 'verify', 'reopen', 'external'):
                r.record(status='running', phase=phase, recovery='same-version-resume')
                getattr(r, phase)()
            r.record(status='success', phase='complete', revision=EXPECTED,
                     codeUnchanged=True, controlsUnchanged=True, databaseSchemaModified=False,
                     recovery='same-version-resume', repeatedStorageRepair=False)
        except BaseException as error:
            safe = False
            try:
                safe = r.hold() is True
            except BaseException:
                pass
            r.record(status='held', phase=phase, safeStateConfirmed=safe,
                     automaticRollback=False, recovery='same-version-resume',
                     **failure_evidence(error))
            raise Refused('REPAIR_RESUME_HELD_INSPECT_PRIVATE_EVIDENCE') from None


class Runtime:
    def __init__(self, helper):
        self.helper = helper
        self.user = helper.deploy_user()
        self.owned_flag = None
        self.ever_owned_flag = False
        self.daemon = None
        self.before = None
        self.read_only = False

    @staticmethod
    def sync_directory(path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def command(self, args, *, deploy=False, timeout=30):
        env = dict(CLEAN)
        demote = None
        if deploy:
            env.update(HOME=self.user.pw_dir, USER='deploy', LOGNAME='deploy', PM2_HOME=str(PM))
            def demote():
                os.initgroups('deploy', self.user.pw_gid)
                os.setgid(self.user.pw_gid)
                os.setuid(self.user.pw_uid)
        result = subprocess.run(args, env=env, capture_output=True, timeout=timeout,
                                preexec_fn=demote, cwd='/')
        if result.returncode:
            if not self.read_only and WINDOW.is_dir():
                fd = os.open(WINDOW / 'private.log', os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'ab') as log:
                    log.write(result.stdout + result.stderr)
            raise Refused('REPAIR_SUBPROCESS_FAILED')
        return result.stdout

    def daemon_check(self):
        daemon = int((PM / 'pm2.pid').read_text())
        require(daemon > 1 and (PM / 'rpc.sock').is_socket(), 'PM2_DAEMON_REQUIRED')
        data = self.command(['/usr/bin/systemctl', 'show', 'pm2-deploy.service',
                             '-p', 'ActiveState', '-p', 'MainPID']).decode()
        values = dict(row.split('=', 1) for row in data.splitlines() if '=' in row)
        require(values.get('ActiveState') == 'active' and values.get('MainPID') == str(daemon),
                'PM2_SERVICE_IDENTITY_MISMATCH')
        require(Path('/proc/%d' % daemon).stat().st_uid == self.user.pw_uid
                and b'PM2' in Path('/proc/%d/cmdline' % daemon).read_bytes(), 'PM2_DAEMON_IDENTITY_MISMATCH')
        require(self.daemon is None or self.daemon == daemon, 'PM2_DAEMON_REPLACED')
        self.daemon = daemon

    def pm2(self, args):
        self.daemon_check()
        return self.command(['/usr/bin/pm2', *args], deploy=True, timeout=45)

    def current_app(self, expected='online'):
        apps = json.loads(self.pm2(['jlist']))
        require(len(apps) == 1 and apps[0]['name'] == 'cronox', 'UNEXPECTED_PM2_APPS')
        app = apps[0]
        env = app['pm2_env']
        require(env['pm_exec_path'] == str(BACKEND / 'dist/main.js')
                and env['pm_cwd'] == str(BACKEND) and env['status'] == expected
                and not env.get('watch') and not env.get('cron_restart'), 'APPLICATION_IDENTITY_MISMATCH')
        if expected == 'online':
            pid = app['pid']
            require(pid > 1 and Path('/proc/%d' % pid).stat().st_uid == self.user.pw_uid
                    and Path('/proc/%d/cwd' % pid).readlink() == BACKEND,
                    'APPLICATION_PROCESS_IDENTITY_MISMATCH')
        else:
            require(app['pid'] == 0, 'APPLICATION_WRITER_REMAINS')
        return app

    def environment(self, app):
        return dict(row.split('=', 1) for row in Path('/proc/%d/environ' % app['pid'])
                    .read_text().split('\0') if '=' in row)

    def identity(self):
        revision = self.command(['/usr/bin/git', '-C', str(REPO), 'rev-parse', 'HEAD'], deploy=True).decode().strip()
        require(revision == EXPECTED, 'FUNCTIONAL_REVISION_CHANGED')
        dist = BACKEND / 'dist'
        files = {}
        for file in sorted(dist.rglob('*')):
            require(not file.is_symlink(), 'COMPILED_SYMLINK_REJECTED')
            if file.is_file():
                files[str(file.relative_to(dist))] = hashlib.sha256(file.read_bytes()).hexdigest()
        require('main.js' in files, 'COMPILED_APPLICATION_MISSING')
        return {'revision': revision, 'compiled': files}

    def http(self, url, expected, follow=False):
        args = ['/usr/bin/curl', '--silent', '--show-error', '--max-time', '10',
                '--output', '/dev/null', '--write-out', '%{http_code}']
        if follow:
            args.extend(['--location', '--max-redirs', '3', '--proto-redir', '=https'])
        actual = self.command([*args, url], timeout=15).strip()
        require(actual == str(expected).encode(), 'HTTP_READINESS_NOT_CONFIRMED')

    def loopback(self, stopped=False):
        rows = self.command(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).decode().splitlines()
        require(not rows if stopped else len(rows) == 1 and rows[0].split()[3] == '127.0.0.1:3000',
                'LISTENER_STATE_MISMATCH')

    def preflight(self):
        require(not FLAG.exists() and not FLAG.is_symlink(), 'MAINTENANCE_ALREADY_ACTIVE')
        require(not WINDOW.exists() and not WINDOW.is_symlink(), 'WINDOW_ALREADY_EXISTS')
        require(not self.helper.SNAPSHOT.exists() and not self.helper.SNAPSHOT.is_symlink(), 'REPAIR_ALREADY_STARTED')
        trusted(WINDOW.parent)
        trusted(FLAG.parent)
        require(WINDOW.parent.stat().st_dev == FLAG.parent.stat().st_dev,
                'WINDOW_AND_MAINTENANCE_MUST_SHARE_FILESYSTEM')
        trusted(CONFIG, private=True)
        saved = json.loads(CONFIG.read_text())
        require(isinstance(saved, dict) and all(isinstance(k, str) and isinstance(v, str)
                for k, v in saved.items()), 'RUNTIME_CONFIG_INVALID')
        require(saved.get('MAILBOX_PRIVATE_DIR') == str(STORAGE), 'STORAGE_CONFIGURATION_MISMATCH')
        trusted(STATE)
        for status_file in STATE.glob('*/status.json'):
            trusted(status_file, private=True)
            require(json.loads(status_file.read_text()).get('status') in
                    ('success', 'recovered', 'failed_before_maintenance'), 'UNRESOLVED_RELEASE')
        self.command(['/usr/sbin/nginx', '-t'])
        require(self.command(['/usr/bin/systemctl', 'show', 'pm2-root.service', '-p', 'ActiveState', '--value']).strip()
                in (b'inactive', b'failed'), 'ROOT_PM2_MUST_BE_INACTIVE')
        app = self.current_app()
        env = self.environment(app)
        require(env.get('HOST') == '127.0.0.1' and env.get('MAILBOX_PRIVATE_DIR') == str(STORAGE),
                'APPLICATION_CONFIGURATION_MISMATCH')
        self.env_before = application_environment(env, saved)
        self.env_keys = list(self.env_before)
        with self.helper.opened_storage(self.user.pw_uid, self.user.pw_gid, repair=True):
            pass
        self.loopback()
        for route in ('/api/health', '/api/ready'):
            self.http('http://127.0.0.1:3000' + route, 200)
        before = self.identity()
        before['daemon'] = self.daemon
        before['environmentFingerprint'] = hashlib.sha256(json.dumps(self.env_before, sort_keys=True).encode()).hexdigest()
        self.before = before
        return before

    def resume_preflight(self):
        trusted(WINDOW, private=True)
        for name in ('before.json', 'pm2-before.json', 'pm2-saved-before.json', 'status.json'):
            trusted(WINDOW / name, private=True)
        require(not (WINDOW / 'resume-previous-status.json').exists(), 'RESUME_ALREADY_ATTEMPTED')
        state = json.loads((WINDOW / 'status.json').read_text())
        require(state.get('status') == 'held' and state.get('phase') == 'verify'
                and state.get('safeStateConfirmed') is True, 'RESUME_REQUIRES_VERIFIED_HELD_PHASE')
        self.verify_flag()
        before = json.loads((WINDOW / 'before.json').read_text())
        require(before.get('revision') == EXPECTED and isinstance(before.get('daemon'), int),
                'RESUME_IDENTITY_INVALID')
        self.daemon = before['daemon']
        require(self.command(['/usr/bin/systemctl', 'show', 'pm2-root.service', '-p', 'ActiveState', '--value']).strip()
                in (b'inactive', b'failed'), 'ROOT_PM2_MUST_BE_INACTIVE')
        app = self.current_app('stopped')
        self.loopback(stopped=True)
        self.helper.quiesced()
        self.helper.check(str(STORAGE))
        self.verify_repair_snapshot()
        require(self.identity() == {key: before[key] for key in ('revision', 'compiled')},
                'CODE_IDENTITY_CHANGED')
        trusted(CONFIG, private=True)
        saved = json.loads(CONFIG.read_text())
        require(isinstance(saved, dict) and all(isinstance(key, str) and isinstance(value, str)
                for key, value in saved.items()) and saved.get('MAILBOX_PRIVATE_DIR') == str(STORAGE),
                'RUNTIME_CONFIG_INVALID')
        old = json.loads((WINDOW / 'pm2-before.json').read_text())
        require(len(old) == 1 and old[0]['name'] == 'cronox', 'SAVED_APPLICATION_INVALID')
        original_dump = json.loads((WINDOW / 'pm2-saved-before.json').read_text())
        require(len(original_dump) == 1 and original_dump[0]['name'] == 'cronox',
                'SAVED_APPLICATION_INVALID')
        keys = sorted((set(saved) | set(CONTROLS)) - RECORDED_PM2_METADATA)
        historical = reconstruct_original_environment(old[0]['pm2_env'], original_dump[0], saved,
                                                      keys, before['environmentFingerprint'])
        # Only AFTER proving every original field, ignore the two additional
        # confirmed PM2 lifecycle fields when comparing post-stop configuration.
        baseline = application_environment(historical, keys)
        keys = list(baseline)
        require(fork_environment(app['pm2_env'], keys) == baseline, 'APPLICATION_ENVIRONMENT_CHANGED')
        self.before, self.env_before, self.env_keys = before, baseline, keys
        self.ever_owned_flag = True

    def verify_repair_snapshot(self):
        snapshot = self.helper.SNAPSHOT
        require(snapshot == REPAIR_SNAPSHOT,
                'REPAIR_SNAPSHOT_SCOPE_INVALID')
        for path in (snapshot, snapshot / 'metadata.json', snapshot / 'metadata.sha256'):
            trusted(path, private=True)
        payload = (snapshot / 'metadata.json').read_bytes()
        require(hashlib.sha256(payload).hexdigest() == (snapshot / 'metadata.sha256').read_text(),
                'REPAIR_SNAPSHOT_DIGEST_MISMATCH')
        saved = json.loads(payload)
        require(saved.get('version') == 1 and saved.get('path') == str(STORAGE)
                and isinstance(saved.get('objects'), list) and len(saved['objects']) > 0,
                'REPAIR_SNAPSHOT_SCOPE_INVALID')
        names = [row['name'] for row in saved['objects']]
        require(len(names) == len(set(names)) and '.' in names, 'REPAIR_SNAPSHOT_INVENTORY_INVALID')
        # The briefly-started application may have created normal cache files.
        # Do not demand equality with today's inventory and never restore here.

    def prepare_resume(self):
        # Preserve the original held summary before writing any new phase/status.
        # In particular, never replace the original snapshot or metadata backup.
        previous = (WINDOW / 'status.json').read_bytes()
        fd = os.open(WINDOW / 'resume-previous-status.json',
                     os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(previous)
            stream.flush()
            os.fsync(stream.fileno())
        self.sync_directory(WINDOW)

    def prepare(self, before):
        WINDOW.mkdir(mode=0o700)
        for name, content in (('before.json', json.dumps(before).encode()),
                              ('pm2-before.json', self.pm2(['jlist'])),
                              ('pm2-saved-before.json', (PM / 'dump.pm2').read_bytes())):
            fd = os.open(WINDOW / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        # Persist a unique inode/token BEFORE linking it into maintenance.flag.
        # ExecStopPost can prove ownership even after SIGKILL between link and log.
        fd = os.open(WINDOW / 'maintenance.token', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(FLAG_BYTES + os.urandom(16).hex().encode() + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        self.sync_directory(WINDOW)
        self.sync_directory(WINDOW.parent)

    def record(self, **value):
        value['recordedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        temporary = WINDOW / 'status.tmp'
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, WINDOW / 'status.json')
        self.sync_directory(WINDOW)

    def flag_identity(self):
        source = WINDOW / 'maintenance.token'
        trusted(source, private=True)
        value = source.lstat()
        require(stat.S_ISREG(value.st_mode) and source.read_bytes().startswith(FLAG_BYTES),
                'WINDOW_FLAG_TOKEN_INVALID')
        return value.st_dev, value.st_ino

    def flag_matches(self):
        if not FLAG.exists() and not FLAG.is_symlink():
            return False
        value = FLAG.lstat()
        return (not FLAG.is_symlink() and value.st_uid == 0
                and (value.st_dev, value.st_ino) == self.flag_identity())

    def ensure_owned_flag(self):
        if not FLAG.exists() and not FLAG.is_symlink():
            os.link(WINDOW / 'maintenance.token', FLAG, follow_symlinks=False)
            self.sync_directory(FLAG.parent)
        require(self.flag_matches(), 'MAINTENANCE_FLAG_OWNERSHIP_LOST')
        self.owned_flag = self.flag_identity()
        self.ever_owned_flag = True
        self.verify_flag()

    def verify_flag(self):
        require(self.flag_matches(), 'MAINTENANCE_FLAG_OWNERSHIP_LOST')

    def maintenance(self):
        self.ensure_owned_flag()
        for host in ('cronox.es', 'www.cronox.es'):
            self.http('https://' + host + '/api/health', 503)

    def stop(self):
        self.verify_flag()
        self.pm2(['stop', 'cronox'])
        self.pm2(['save'])
        self.current_app('stopped')
        self.loopback(stopped=True)

    def repair(self):
        self.verify_flag()
        # Global flock is already held by this process: do not call helper.main().
        self.helper.apply()

    def start(self):
        self.verify_flag()
        require(self.identity() == {k: self.before[k] for k in ('revision', 'compiled')}, 'CODE_IDENTITY_CHANGED')
        self.current_app('stopped')
        self.pm2(['restart', 'cronox'])  # no --update-env: preserve PM2's existing app environment

    def verify(self):
        for attempt in range(45):
            try:
                app = self.current_app()
                for route in ('/api/health', '/api/ready'):
                    self.http('http://127.0.0.1:3000' + route, 200)
                break
            except Refused:
                if attempt == 44:
                    raise
                time.sleep(1)
        self.loopback()
        self.helper.check(str(STORAGE))
        require(self.identity() == {k: self.before[k] for k in ('revision', 'compiled')}, 'CODE_IDENTITY_CHANGED')
        actual_environment = self.environment(app)
        require(application_environment(actual_environment, self.env_keys) == self.env_before,
                'APPLICATION_ENVIRONMENT_CHANGED')
        self.pm2(['save'])
        saved = json.loads((PM / 'dump.pm2').read_text())
        require(len(saved) == 1 and saved[0]['name'] == 'cronox'
                and saved[0]['status'] == 'online'
                and saved[0]['pm_exec_path'] == str(BACKEND / 'dist/main.js')
                and all(saved[0].get(key) == self.env_before[key] for key in CONTROLS),
                'PM2_PERSISTENCE_NOT_CONFIRMED')

    def reopen(self):
        self.verify_flag()
        FLAG.unlink()
        self.owned_flag = None
        self.sync_directory(FLAG.parent)

    def external(self):
        for host in ('cronox.es', 'www.cronox.es'):
            for route in ('/', '/api/health', '/api/ready'):
                self.http('https://' + host + route, 200, follow=True)

    def hold(self):
        # Never remove another operator's maintenance flag or stop an unowned window.
        exists = FLAG.exists() or FLAG.is_symlink()
        if exists and not self.flag_matches():
            return False
        if not self.ever_owned_flag and not (exists and self.flag_matches()):
            return False
        self.ensure_owned_flag()
        self.pm2(['stop', 'cronox'])
        self.pm2(['save'])
        self.current_app('stopped')
        self.loopback(stopped=True)
        return True

    def fail_safe(self):
        if not WINDOW.exists():
            return
        trusted(WINDOW, private=True)
        status_file = WINDOW / 'status.json'
        if not status_file.exists():
            return  # Snapshot preparation never activates maintenance.
        trusted(status_file, private=True)
        state = json.loads(status_file.read_text())
        if state.get('status') == 'success':
            return
        require(state.get('phase') in ('maintenance', 'stop', 'repair', 'start', 'verify', 'reopen', 'external'),
                'FAIL_SAFE_PHASE_UNKNOWN')
        trusted(WINDOW / 'before.json', private=True)
        before = json.loads((WINDOW / 'before.json').read_text())
        require(before.get('revision') == EXPECTED and isinstance(before.get('daemon'), int),
                'FAIL_SAFE_IDENTITY_INVALID')
        self.daemon = before['daemon']
        self.flag_identity()
        # Advancing beyond maintenance durably proves the owned flag was installed.
        self.ever_owned_flag = state['phase'] != 'maintenance'
        safe = self.hold()
        self.record(status='held', phase=state['phase'], safeStateConfirmed=safe,
                    automaticRollback=False, failSafe='ExecStopPost',
                    **{key: state[key] for key in ('failureCode', 'errorType', 'failureLocation') if key in state})
        require(safe, 'FAIL_SAFE_OWNERSHIP_NOT_CONFIRMED')


def interrupted(_signum, _frame):
    raise Refused('REPAIR_WINDOW_INTERRUPTED')


def main(args):
    require(args in (['--plan'], ['--apply'], ['--fail-safe'], ['--resume'], ['--resume-plan']), 'FIXED_ACTION_REQUIRED')
    helper = validated_helper()
    runtime = Runtime(helper)
    if args == ['--resume-plan']:
        runtime.read_only = True
        runtime.resume_preflight()
        print('MAILBOX_RESUME_PLAN_OK: exact original environment verified; same code; repaired storage verified; no changes made')
        return
    if args == ['--plan']:
        runtime.preflight()
        print('MAILBOX_REPAIR_PLAN_OK: same functional version; metadata repair; brief maintenance; no deployment or database writes')
        return
    import fcntl
    trusted(STATE)
    fd = os.open(STATE / 'controller.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1
                and not value.st_mode & 0o077, 'UNTRUSTED_RELEASE_LOCK')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args == ['--fail-safe']:
            runtime.fail_safe()
            print('MAILBOX_REPAIR_FAIL_SAFE_CHECKED')
        else:
            signal.signal(signal.SIGTERM, interrupted)
            signal.signal(signal.SIGINT, interrupted)
            if args == ['--resume']:
                Window(runtime).resume()
            else:
                Window(runtime).execute()
            print('MAILBOX_REPAIR_WINDOW_OK: deploy storage access verified; same code and runtime controls; web reopened')
    finally:
        os.close(fd)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main(sys.argv[1:])
    except BaseException as error:
        evidence = failure_evidence(error)
        print('MAILBOX_REPAIR_WINDOW_REFUSED: ' + evidence['failureCode'], file=sys.stderr)
        print(json.dumps(evidence, sort_keys=True), file=sys.stderr)
        sys.exit(1)
