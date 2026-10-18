#!/usr/bin/python3 -I
"""One administrator intervention. --plan is read-only; --apply needs explicit approval.
Revocation removes delegated commands; it never restores execution of writable code as root.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import configparser
import signal
import re
import tempfile
import traceback
from urllib.parse import urlparse, unquote

HERE = Path(__file__).resolve().parent
FILES = ('controller.py', 'backup.py', 'boot_guard.py', 'selftest.py', 'build.sh', 'preflight.cjs', 'cronox-release',
         'cronox-release@.service', 'pm2-deploy.service', 'sudoers')
LIB = Path('/usr/local/lib/cronox-release')
CFG = Path('/etc/cronox-release')
STATE = Path('/var/lib/cronox-release')
PM = Path('/var/lib/cronox-pm2')
REPO = Path('/var/www/cronox/Web_Cronox')
OLD = Path('/root/cronox-release-20261017')
FLAG = Path('/var/lib/cronox/maintenance.flag')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'PM2_HOME': '/root/.pm2', 'LANG': 'C.UTF-8'}
BOOTSTRAP_REVISION = '488a5185122826188986fd6cedd3e1046cfe42ba'


def require(value):
    if not value:
        raise RuntimeError('INSTALLATION_PRECONDITION_FAILED')


def run(args, **kwargs):
    # No raw child logs/PM2 JSON/credentials are returned to the console.
    result = subprocess.run(args, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=kwargs.pop('timeout', 120), **kwargs)
    if result.returncode:
        # Root-private diagnostics, never raw configuration or child output in journal/chat.
        with open(HERE / 'bootstrap-private.log', 'ab') as log:
            os.chmod(HERE / 'bootstrap-private.log', 0o600)
            log.write(result.stdout + result.stderr)
        raise RuntimeError('BOOTSTRAP_COMMAND_FAILED')
    return result.stdout


def identity():
    head = run(['/usr/sbin/runuser', '-u', 'deploy', '--', '/usr/bin/git', '-C', str(REPO),
                'rev-parse', 'HEAD']).decode().strip()
    require(len(head) == 40 and all(c in '0123456789abcdef' for c in head))
    dist = REPO / 'cronox-backend/dist'
    files = sorted(p for p in dist.rglob('*') if p.is_file())
    require(files and (dist / 'main.js').is_file())
    compiled = {str(p.relative_to(dist)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    pg = dict(ENV, PGSERVICEFILE=str(OLD / 'pg_service.conf'), PGPASSFILE=str(OLD / 'pgpass'),
              PGSERVICE='cronox-release')
    query = "BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; SELECT coalesce(json_agg(json_build_array(migration_name,checksum,finished_at,rolled_back_at) ORDER BY migration_name),'[]') FROM public._prisma_migrations; COMMIT;"
    r = subprocess.run(['/usr/bin/psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query],
                       env=pg, capture_output=True, timeout=30)
    require(r.returncode == 0)
    return {'revision': head, 'compiled': compiled, 'migrations': json.loads(r.stdout)}


def assert_unchanged(before, after):
    require(before == after)


def health():
    for attempt in range(45):
        try:
            statuses = [run(['/usr/bin/curl', '-s', '--max-time', '3', '-o', '/dev/null', '-w', '%{http_code}',
                            'http://127.0.0.1:3000' + route]).strip() for route in ('/api/health', '/api/ready')]
        except RuntimeError:
            statuses = []
        if statuses == [b'200', b'200']:
            break
        time.sleep(1)
    require(statuses == [b'200', b'200'])
    rows = run(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).decode().splitlines()
    require(len(rows) == 1 and rows[0].split()[3] == '127.0.0.1:3000')


def root_owned(p):
    p = Path(p)
    for part in (p, *p.parents):
        st = part.lstat()
        require(st.st_uid == 0 and not st.st_mode & 0o022 and not part.is_symlink())


def sudo_policy_files():
    # Use the files actually parsed by sudo, including /etc/sudoers itself.
    output = run(['/usr/sbin/visudo', '-c']).decode()
    files = [Path(p) for p in re.findall(r'^(/.+): parsed OK$', output, re.M)]
    require(files and Path('/etc/sudoers') in files)
    for path in files:
        root_owned(path)
    return files


def remove_known_pm2_rules(original, main_file=False):
    lines = original.decode('utf8').splitlines(keepends=True)
    allowed = {
                'deploy ALL=(root) NOPASSWD: /usr/bin/pm2 restart cronox, /usr/bin/pm2 save',
                'deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2 restart cronox, /usr/bin/pm2 save',
                'deploy ALL=(root) NOPASSWD: /usr/bin/pm2 restart cronox',
                'deploy ALL=(root) NOPASSWD: /usr/bin/pm2 save',
                'deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2 restart cronox',
                'deploy ALL=(ALL) NOPASSWD: /usr/bin/pm2 save',
    }
    remove = []
    for index, line in enumerate(lines):
        text = line.strip()
        if not text or text.startswith('#'):
            continue
        if 'pm2' in text and 'deploy' in text:
            require(text in allowed)
            require(index == 0 or not lines[index - 1].rstrip().endswith('\\'))
            remove.append(index)
        elif not main_file and any('pm2' in s and 'deploy' in s and not s.lstrip().startswith('#') for s in lines):
            # Keep the original conservative policy for dedicated included files.
            raise RuntimeError('MIXED_SUDO_POLICY')
    return ''.join(line for index, line in enumerate(lines) if index not in remove).encode('utf8'), len(remove)


def old_sudo_files():
    plans = []
    policies = sudo_policy_files()
    require(any(line.strip() in ('@includedir /etc/sudoers.d', '#includedir /etc/sudoers.d')
                for path in policies for line in path.read_text().splitlines()))
    for path in policies:
        original = path.read_bytes()
        remaining, count = remove_known_pm2_rules(original, main_file=path == Path('/etc/sudoers'))
        if count:
            plans.append({'path': path, 'before': original, 'after': remaining})
    require(plans)
    return plans


def replace_sudo_policy(plan, apply=True):
    path = plan['path']
    root_owned(path)
    require(path.read_bytes() == plan['before'])
    stat = path.stat()
    fd, name = tempfile.mkstemp(prefix='.cronox-sudoers-', dir=path.parent)
    candidate = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), stat.st_mode & 0o777)
            os.fchown(stream.fileno(), stat.st_uid, stat.st_gid)
            stream.write(plan['after'])
            stream.flush()
            os.fsync(stream.fileno())
        run(['/usr/sbin/visudo', '-cf', str(candidate)])
        require(path.read_bytes() == plan['before'])
        if not apply:
            return
        os.replace(candidate, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        candidate.unlink(missing_ok=True)


def preflight():
    require(os.getuid() == 0 and not FLAG.exists())
    root_owned(HERE)
    root_owned(FLAG.parent)
    root_owned(HERE / 'manifest.json')
    manifest = json.loads((HERE / 'manifest.json').read_text())
    require(set(manifest) == set(FILES) | {'install.py'})
    for file, checksum in manifest.items():
        root_owned(HERE / file)
        require(hashlib.sha256((HERE / file).read_bytes()).hexdigest() == checksum)
    for file in ('pg_service.conf', 'pgpass'):
        root_owned(OLD / file)
        require((OLD / file).stat().st_mode & 0o077 == 0)
    require('[cronox-release]' in (OLD / 'pg_service.conf').read_text())
    require(shutil.disk_usage('/var/lib').free >= 8 * 1024**3)
    for path in (LIB, CFG, STATE, PM, Path('/usr/local/sbin/cronox-release'),
                 Path('/etc/sudoers.d/cronox-release'), Path('/etc/systemd/system/pm2-deploy.service')):
        require(not path.exists() and not path.is_symlink())
    run(['/usr/sbin/nginx', '-t'])
    run(['/usr/bin/docker', 'image', 'inspect',
         'supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'])
    for path in ('/usr/bin/node', '/usr/bin/python3', '/usr/bin/pm2'):
        root_owned(Path(path).resolve())
    daemon = int(Path('/root/.pm2/pm2.pid').read_text())
    os.kill(daemon, 0)
    require(b'PM2' in Path('/proc/%d/cmdline' % daemon).read_bytes())
    apps = json.loads(run(['/usr/bin/pm2', 'jlist']))
    require(len(apps) == 1 and apps[0]['name'] == 'cronox' and apps[0]['pm2_env']['status'] == 'online')
    app = apps[0]
    require(app['pm2_env']['pm_exec_path'] == str(REPO / 'cronox-backend/dist/main.js'))
    require(not app['pm2_env'].get('watch') and not app['pm2_env'].get('cron_restart'))
    effective = dict(item.split('=', 1) for item in Path('/proc/%d/environ' % app['pid']).read_text().split('\0') if '=' in item)
    db = urlparse(effective.get('DATABASE_URL', ''))
    profile = configparser.ConfigParser(interpolation=None)
    profile.read(OLD / 'pg_service.conf')
    service = profile['cronox-release']
    require(db.scheme in ('postgres', 'postgresql') and db.port == 5432
            and db.hostname == service['host'] and str(db.port) == service['port']
            and unquote(db.username or '') == service['user']
            and unquote(db.path.lstrip('/')) == service['dbname'])
    sudo_files = old_sudo_files()
    for plan in sudo_files:
        replace_sudo_policy(plan, apply=False)
    run(['/usr/sbin/visudo', '-cf', str(HERE / 'sudoers')])
    require(run(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).decode().split()[3] == '127.0.0.1:3000')
    return app, sudo_files


def install():
    import pwd
    app, sudo_files = preflight()
    before = identity()
    require(before['revision'] == BOOTSTRAP_REVISION)
    health()
    print('PREFLIGHT_OK: current revision captured; no maintenance yet', flush=True)
    run(['/usr/bin/python3', '-I', str(HERE / 'selftest.py')], timeout=900)
    print('ISOLATED_BACKUP_RESTORE_VERIFIED: synthetic data; no production restore', flush=True)
    user = pwd.getpwnam('deploy')
    environment = dict(item.split('=', 1) for item in Path('/proc/%d/environ' % app['pid']).read_text().split('\0') if '=' in item)
    # Environment stays private; PM2_HOME and privileged interpreter controls are not inherited.
    for key in ('PM2_HOME', 'HOME', 'USER', 'LOGNAME', 'SUDO_USER', 'SUDO_UID', 'SUDO_GID',
                'LD_PRELOAD', 'LD_LIBRARY_PATH', 'PYTHONPATH', 'PYTHONHOME', 'NODE_OPTIONS'):
        environment.pop(key, None)
    environment.update(HOST='127.0.0.1', CRONOX_LOCAL_DEV='false', CRONOX_ROUTE_SMOKE_MODE='false')
    for path in (LIB, CFG, STATE):
        path.mkdir(mode=0o700 if path != LIB else 0o755)
    (STATE / 'bootstrap').mkdir(mode=0o700)
    backup = STATE / 'bootstrap'
    (backup / 'identity-before.json').write_text(json.dumps(before))
    (backup / 'root-pm2.json').write_bytes(run(['/usr/bin/pm2', 'jlist']))
    shutil.copy2('/root/.pm2/dump.pm2', backup / 'root-pm2-dump.json')
    for index, plan in enumerate(sudo_files):
        (backup / ('sudo-policy-%02d.before' % index)).write_bytes(plan['before'])
        (backup / ('sudo-policy-%02d.after' % index)).write_bytes(plan['after'])
    (backup / 'sudo-policy-paths.json').write_text(json.dumps([str(p['path']) for p in sudo_files]))
    for file in FILES:
        shutil.copyfile(HERE / file, LIB / file)
        (LIB / file).chmod(0o644)
    for file in ('pg_service.conf', 'pgpass'):
        shutil.copyfile(OLD / file, CFG / file)
        (CFG / file).chmod(0o600)
    (CFG / 'runtime.json').write_text(json.dumps(environment))
    (CFG / 'runtime.json').chmod(0o600)
    PM.mkdir(mode=0o700)
    os.chown(PM, user.pw_uid, user.pw_gid)
    for unit in ('cronox-release@.service', 'pm2-deploy.service'):
        shutil.copyfile(LIB / unit, '/etc/systemd/system/' + unit)
        Path('/etc/systemd/system/' + unit).chmod(0o644)
    shutil.copyfile(LIB / 'cronox-release', '/usr/local/sbin/cronox-release')
    Path('/usr/local/sbin/cronox-release').chmod(0o755)
    run(['/usr/bin/systemctl', 'daemon-reload'])
    assert_unchanged(before, identity())
    FLAG.write_text('cronox-bootstrap\n')
    FLAG.chmod(0o644)
    try:
        for host in ('cronox.es', 'www.cronox.es'):
            require(run(['/usr/bin/curl', '-s', '--max-time', '10', '-o', '/dev/null', '-w', '%{http_code}',
                         'https://' + host + '/api/health']).strip() == b'503')
        run(['/usr/bin/pm2', 'stop', 'cronox'])
        run(['/usr/bin/pm2', 'save'])
        require(not run(['/usr/bin/ss', '-H', '-ltn', 'sport = :3000']).strip())
        # Permanently stop root's daemon before granting the new restricted commands.
        run(['/usr/bin/systemctl', 'disable', '--now', 'pm2-root.service'])
        for plan in sudo_files:
            replace_sudo_policy(plan)
        run(['/usr/sbin/visudo', '-c'])

        def demote():
            os.initgroups('deploy', user.pw_gid)
            os.setgid(user.pw_gid)
            os.setuid(user.pw_uid)
        appenv = dict(environment, HOME=user.pw_dir, USER='deploy', LOGNAME='deploy',
                      PATH='/usr/bin:/bin', PM2_HOME=str(PM))
        # Fixed script, no application rebuild or migration during installation.
        for args in (['start', str(REPO / 'cronox-backend/dist/main.js'), '--name', 'cronox',
                      '--cwd', str(REPO / 'cronox-backend')], ['save'], ['kill']):
            subprocess.run(['/usr/bin/pm2', *args], env=appenv, preexec_fn=demote,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, check=True)
        Path('/run/cronox-release-bootstrap-permit').write_text('initial installer handoff\n')
        Path('/run/cronox-release-bootstrap-permit').chmod(0o600)
        run(['/usr/bin/systemctl', 'enable', '--now', 'pm2-deploy.service'])
        health()
        assert_unchanged(before, identity())
        shutil.copyfile(LIB / 'sudoers', '/etc/sudoers.d/cronox-release')
        Path('/etc/sudoers.d/cronox-release').chmod(0o440)
        run(['/usr/sbin/visudo', '-c'])
        FLAG.unlink()
        (backup / 'transition-result.json').write_text(json.dumps({'status': 'success', 'revision': before['revision'],
            'compiledUnchanged': True, 'migrationHistoryUnchanged': True, 'isolatedRestore': 'synthetic verified'}))
        print('BOOTSTRAP_OK: unprivileged runtime; bounded release commands installed')
    except BaseException:
        Path('/run/cronox-release-bootstrap-permit').unlink(missing_ok=True)
        try:
            run(['/usr/bin/systemctl', 'stop', 'pm2-deploy.service'])
            if (PM / 'pm2.pid').exists():
                for args in (['stop', 'cronox'], ['save']):
                    subprocess.run(['/usr/bin/pm2', *args], env=appenv, preexec_fn=demote,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
        except BaseException:
            pass  # maintenance remains regardless; never print private process output
        # Do not put deploy-writable code back under root, even on installation failure.
        print('BOOTSTRAP_HELD: maintenance remains; private bootstrap evidence retained')
        raise


def recover_transition():
    """Administrator-only, same compiled code/schema, never revert to a root runtime."""
    require(os.getuid() == 0 and FLAG.read_text().strip() == 'cronox-bootstrap')
    for path in (HERE, LIB, CFG, STATE, STATE / 'bootstrap/identity-before.json'):
        root_owned(path)
    before = json.loads((STATE / 'bootstrap/identity-before.json').read_text())
    assert_unchanged(before, identity())
    require(run(['/usr/bin/systemctl', 'show', '-p', 'ActiveState', '--value', 'pm2-root.service']).strip() == b'inactive')
    require(not old_pm2_grants_present())
    require((PM / 'dump.pm2').is_file())
    # Resume the already prepared deploy dump; never execute caller-supplied code/SQL.
    Path('/run/cronox-release-bootstrap-permit').write_text('reviewed same-version recovery\n')
    Path('/run/cronox-release-bootstrap-permit').chmod(0o600)
    try:
        run(['/usr/bin/systemctl', 'reset-failed', 'pm2-deploy.service'])
        run(['/usr/bin/systemctl', 'enable', '--now', 'pm2-deploy.service'])
        health()
        assert_unchanged(before, identity())
        shutil.copyfile(LIB / 'sudoers', '/etc/sudoers.d/cronox-release')
        Path('/etc/sudoers.d/cronox-release').chmod(0o440)
        run(['/usr/sbin/visudo', '-c'])
        FLAG.unlink()
        print('BOOTSTRAP_RECOVERED: same code/schema; runtime deploy; web reopened')
    except BaseException:
        Path('/run/cronox-release-bootstrap-permit').unlink(missing_ok=True)
        run(['/usr/bin/systemctl', 'stop', 'pm2-deploy.service'])
        raise


def old_pm2_grants_present():
    return any('pm2' in line and 'deploy' in line and not line.lstrip().startswith('#')
               for path in sudo_policy_files() for line in path.read_text().splitlines())


def revoke():
    require(os.getuid() == 0)
    root_owned(LIB)
    require(run(['/usr/bin/systemctl', 'list-units', '--state=running,activating', '--no-legend', 'cronox-release@*.service']).strip() == b'')
    path = Path('/etc/sudoers.d/cronox-release')
    root_owned(path)
    require(path.read_bytes() == (LIB / 'sudoers').read_bytes())
    path.unlink()
    run(['/usr/sbin/visudo', '-c'])
    print('DELEGATION_REVOKED: application and private backups preserved; no root runtime restored')


if __name__ == '__main__':
    os.umask(0o077)
    def terminated(signum, frame):
        raise RuntimeError('BOOTSTRAP_INTERRUPTED')
    signal.signal(signal.SIGTERM, terminated)
    try:
        require(len(sys.argv) == 2)
        if sys.argv[1] == '--plan':
            preflight()
            print('PLAN_OK: install root-owned controller; migrate existing PM2 to deploy; replace two PM2 sudo grants; brief maintenance; no code deployment or migrations')
        elif sys.argv[1] == '--apply':
            install()
        elif sys.argv[1] == '--revoke':
            revoke()
        elif sys.argv[1] == '--recover-transition':
            recover_transition()
        else:
            raise RuntimeError()
    except BaseException as error:
        frames = [frame for frame in traceback.extract_tb(error.__traceback__)
                  if frame.filename == __file__ and frame.name != 'require']
        if frames:
            frame = frames[-1]
            print(json.dumps({'failedFunction': frame.name, 'line': frame.lineno}), file=sys.stderr)
        print('BOOTSTRAP_NOT_COMPLETED: inspect privately; do not rerun blindly', file=sys.stderr)
        sys.exit(1)
