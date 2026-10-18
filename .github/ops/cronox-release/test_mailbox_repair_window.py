import json
import hashlib
from contextlib import ExitStack
import os
import shutil
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import mailbox_repair_window as repair


class FakeRuntime:
    def __init__(self, fail=None, interrupted=False):
        self.fail, self.interrupted = fail, interrupted
        self.calls, self.records = [], []
        self.flag, self.running, self.repaired = False, True, False

    def hit(self, name):
        self.calls.append(name)
        if self.fail == name:
            if self.interrupted:
                raise KeyboardInterrupt()
            raise RuntimeError('synthetic failure')

    def preflight(self):
        self.hit('preflight')
        return {'revision': repair.EXPECTED}

    def prepare(self, before):
        self.hit('prepare')

    def resume_preflight(self):
        self.hit('resume_preflight')

    def prepare_resume(self):
        self.hit('prepare_resume')

    def record(self, **value):
        self.records.append(value)

    def maintenance(self):
        self.flag = True
        self.hit('maintenance')

    def stop(self):
        self.running = False
        self.hit('stop')

    def repair(self):
        self.hit('repair')
        self.repaired = True

    def start(self):
        self.running = True
        self.hit('start')

    def verify(self):
        self.hit('verify')

    def reopen(self):
        self.flag = False
        self.hit('reopen')

    def external(self):
        self.hit('external')

    def hold(self):
        self.flag, self.running = True, False
        self.hit('hold')
        return True


class RepairWindowTests(unittest.TestCase):
    def test_resume_never_repeats_repair_or_creates_a_new_baseline(self):
        r = FakeRuntime()
        r.flag, r.running = True, False
        repair.Window(r).resume()
        self.assertEqual(r.calls, ['resume_preflight', 'prepare_resume', 'start', 'verify', 'reopen', 'external'])
        self.assertFalse(r.repaired or r.flag)
        self.assertTrue(r.running)
        self.assertFalse(r.records[-1]['repeatedStorageRepair'])

    def test_resume_precheck_refusal_does_not_start_or_mutate(self):
        for phase in ('resume_preflight', 'prepare_resume'):
            with self.subTest(phase=phase):
                r = FakeRuntime(phase)
                r.flag, r.running = True, False
                with self.assertRaises(RuntimeError):
                    repair.Window(r).resume()
                self.assertFalse(r.running or r.repaired)
                self.assertTrue(r.flag)
                self.assertNotIn('hold', r.calls)
                self.assertEqual(r.records, [])

    def test_resume_interruption_and_failure_hold_every_mutating_phase(self):
        for phase in ('start', 'verify', 'reopen', 'external'):
            for interrupted in (False, True):
                with self.subTest(phase=phase, interrupted=interrupted):
                    r = FakeRuntime(phase, interrupted)
                    r.flag, r.running = True, False
                    with self.assertRaisesRegex(repair.Refused, 'RESUME_HELD'):
                        repair.Window(r).resume()
                    self.assertTrue(r.flag)
                    self.assertFalse(r.running or r.repaired)
                    self.assertEqual(r.records[-1]['phase'], phase)
                    self.assertTrue(r.records[-1]['safeStateConfirmed'])

    def test_resume_requires_original_baseline_owned_window_and_unchanged_current_state(self):
        cases = (None, 'wrong_phase', 'unsafe', 'foreign_flag', 'changed_code', 'wrong_fingerprint',
                 'changed_current_environment', 'root_running', 'storage_denied', 'quiescence_failed',
                 'previous_resume', 'daemon_mismatch')
        for failure in cases:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder, ExitStack() as stack:
                window = Path(folder)
                config = window / 'runtime.json'
                env = {'HOST': '127.0.0.1', 'MAILBOX_PRIVATE_DIR': str(repair.STORAGE),
                       'JWT_ACCESS_SECRET': 'synthetic-private', 'PWD': '/same'}
                config.write_text(json.dumps(env))
                baseline = {key: env.get(key) for key in sorted((set(env) | set(repair.CONTROLS)) - repair.RECORDED_PM2_METADATA)}
                before = {'revision': repair.EXPECTED, 'compiled': {'main.js': 'same'}, 'daemon': 123,
                          'environmentFingerprint': hashlib.sha256(json.dumps(baseline, sort_keys=True).encode()).hexdigest()}
                if failure == 'wrong_fingerprint':
                    before['environmentFingerprint'] = '0' * 64
                (window / 'before.json').write_text(json.dumps(before))
                (window / 'pm2-before.json').write_text(json.dumps([{'name': 'cronox', 'pm2_env': env}]))
                (window / 'pm2-saved-before.json').write_text(json.dumps([{'name': 'cronox', **env}]))
                state = {'status': 'held', 'phase': 'repair' if failure == 'wrong_phase' else 'verify',
                         'safeStateConfirmed': failure != 'unsafe'}
                (window / 'status.json').write_text(json.dumps(state))
                if failure == 'previous_resume':
                    (window / 'resume-previous-status.json').write_text('{}')
                helper = SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000),
                                         check=lambda path: None, quiesced=lambda: None)
                r = repair.Runtime(helper)
                stack.enter_context(patch.object(repair, 'WINDOW', window))
                stack.enter_context(patch.object(repair, 'CONFIG', config))
                stack.enter_context(patch.object(repair, 'trusted'))
                stack.enter_context(patch.object(repair, 'fork_environment',
                                                side_effect=lambda values, keys: {key: values.get(key) for key in keys}))
                flag = stack.enter_context(patch.object(r, 'verify_flag'))
                stack.enter_context(patch.object(r, 'command', return_value=b'active' if failure == 'root_running' else b'inactive'))
                current = dict(env)
                if failure == 'changed_current_environment': current['JWT_ACCESS_SECRET'] = 'different-synthetic'
                app = stack.enter_context(patch.object(r, 'current_app', return_value={'pm2_env': current}))
                stack.enter_context(patch.object(r, 'loopback'))
                stack.enter_context(patch.object(r, 'verify_repair_snapshot'))
                identity = {key: before[key] for key in ('revision', 'compiled')}
                if failure == 'changed_code': identity['compiled'] = {'main.js': 'changed'}
                stack.enter_context(patch.object(r, 'identity', return_value=identity))
                start = stack.enter_context(patch.object(r, 'start'))
                if failure == 'foreign_flag': flag.side_effect = repair.Refused('MAINTENANCE_FLAG_OWNERSHIP_LOST')
                if failure == 'daemon_mismatch': app.side_effect = repair.Refused('PM2_DAEMON_CHANGED')
                if failure == 'storage_denied': helper.check = lambda path: (_ for _ in ()).throw(repair.Refused('STORAGE_DENIED'))
                if failure == 'quiescence_failed': helper.quiesced = lambda: (_ for _ in ()).throw(repair.Refused('STILL_WRITING'))
                if failure:
                    with self.assertRaises(repair.Refused):
                        r.resume_preflight()
                else:
                    r.resume_preflight()
                    self.assertEqual(r.env_before, baseline)
                    self.assertEqual(r.daemon, 123)
                    self.assertTrue(r.ever_owned_flag)
                start.assert_not_called()
                self.assertEqual(json.loads((window / 'status.json').read_text()), state)

    def test_resume_plan_runs_readonly_checks_without_record_or_start(self):
        with patch.object(repair, 'validated_helper', return_value=object()), \
             patch.object(repair, 'Runtime') as constructor:
            runtime = constructor.return_value
            repair.main(['--resume-plan'])
            self.assertTrue(runtime.read_only)
            runtime.resume_preflight.assert_called_once_with()
            runtime.prepare_resume.assert_not_called()
            runtime.start.assert_not_called()
            runtime.record.assert_not_called()

    def test_readonly_command_failure_never_appends_private_log(self):
        with tempfile.TemporaryDirectory() as folder:
            window = Path(folder)
            r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
            r.read_only = True
            with patch.object(repair, 'WINDOW', window), \
                 patch.object(repair.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=b'synthetic', stderr=b'error')):
                with self.assertRaises(repair.Refused):
                    r.command(['/synthetic/read-only-command'])
            self.assertEqual(list(window.iterdir()), [])

    def test_repair_snapshot_checks_private_metadata_integrity_without_replaying_it(self):
        for failure in (None, 'digest', 'version', 'path'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                snapshot = Path(folder)
                data = {'version': 2 if failure == 'version' else 1,
                        'path': '/foreign' if failure == 'path' else str(repair.STORAGE),
                        'objects': [{'name': '.'}]}
                payload = json.dumps(data).encode()
                (snapshot / 'metadata.json').write_bytes(payload)
                (snapshot / 'metadata.sha256').write_text('0' * 64 if failure == 'digest'
                                                        else hashlib.sha256(payload).hexdigest())
                helper = SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000),
                                         SNAPSHOT=snapshot)
                r = repair.Runtime(helper)
                with patch.object(repair, 'REPAIR_SNAPSHOT', snapshot), patch.object(repair, 'trusted'):
                    if failure:
                        with self.assertRaises(repair.Refused): r.verify_repair_snapshot()
                    else:
                        r.verify_repair_snapshot()
                self.assertEqual((snapshot / 'metadata.json').read_bytes(), payload)

    @unittest.skipUnless(shutil.which('node'), 'requires Node for exact JavaScript coercion')
    def test_fork_model_keeps_node_injected_ipc_fields_in_exact_environment(self):
        original_run = repair.subprocess.run
        def run(args, **kwargs):
            if os.name == 'nt':
                kwargs['env'] = dict(kwargs['env'], SystemRoot=os.environ['SystemRoot'])
            return original_run([shutil.which('node'), *args[1:]], **kwargs)
        with patch.object(repair.subprocess, 'run', side_effect=run):
            result = repair.fork_environment({'boolean': True, 'number': 7, 'object': {},
                'NODE_CHANNEL_FD': '99', 'NODE_CHANNEL_SERIALIZATION_MODE': 'advanced'},
                ['boolean', 'number', 'object', 'missing', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'])
            self.assertEqual(result, {'boolean': 'true', 'number': '7', 'object': None, 'missing': None,
                                     'NODE_CHANNEL_FD': '3', 'NODE_CHANNEL_SERIALIZATION_MODE': 'json'})
            self.assertEqual(repair.fork_environment({}, ['missing']), {'missing': None})

    def test_reconstructed_scalars_match_historical_universal_newline_reader(self):
        values = {'CRLF': 'first\r\nsecond', 'CR': 'first\rsecond', 'LF': 'first\nsecond',
                  'mixed': 'a\r\nb\rc\n', 'empty': '', 'missing': None,
                  'NODE_CHANNEL_FD': '3', 'NODE_CHANNEL_SERIALIZATION_MODE': 'json'}
        with patch.object(repair.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(values).encode())):
            actual = repair.fork_environment({}, list(values))
        self.assertEqual(actual, {'CRLF': 'first\nsecond', 'CR': 'first\nsecond', 'LF': 'first\nsecond',
                                 'mixed': 'a\nb\nc\n', 'empty': '', 'missing': None,
                                 'NODE_CHANNEL_FD': '3', 'NODE_CHANNEL_SERIALIZATION_MODE': 'json'})

    def test_reconstruction_requires_exact_historical_hash_before_ignoring_pm2_fields(self):
        historical = {'SECRET_CONFIG': 'synthetic-secret', 'HOST': '127.0.0.1',
                      'exit_code': None, 'prev_restart_delay': '250'}
        keys = list(historical)
        fingerprint = hashlib.sha256(json.dumps(historical, sort_keys=True).encode()).hexdigest()
        old_record = dict(historical, exit_code='0', prev_restart_delay='0')
        config = dict(historical, prev_restart_delay='250')
        coerce = lambda values, selected: {key: values.get(key) for key in selected}
        with patch.object(repair, 'fork_environment', side_effect=coerce):
            restored = repair.reconstruct_original_environment(old_record, {}, config, keys, fingerprint)
            self.assertEqual(restored, historical)
            # A different application value cannot be legitimized by selecting
            # lifecycle candidates or dropping lifecycle fields from the hash.
            changed = dict(historical, SECRET_CONFIG='changed-secret')
            with self.assertRaisesRegex(repair.Refused, 'NOT_RECONSTRUCTED'):
                repair.reconstruct_original_environment(
                    dict(old_record, SECRET_CONFIG='changed-secret'), changed, changed, keys, fingerprint)
            stripped = repair.application_environment(historical, keys)
            wrong = hashlib.sha256(json.dumps(stripped, sort_keys=True).encode()).hexdigest()
            with self.assertRaisesRegex(repair.Refused, 'NOT_RECONSTRUCTED'):
                repair.reconstruct_original_environment(old_record, {}, config, keys, wrong)

    @unittest.skipUnless(os.name == 'posix', 'private durable evidence on Linux')
    def test_resume_preserves_original_failure_summary_exclusively(self):
        with tempfile.TemporaryDirectory() as folder:
            window = Path(folder)
            original = b'{"status":"held","phase":"verify","safeStateConfirmed":true}'
            (window / 'status.json').write_bytes(original)
            r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())))
            with patch.object(repair, 'WINDOW', window):
                r.prepare_resume()
                self.assertEqual((window / 'resume-previous-status.json').read_bytes(), original)
                self.assertEqual((window / 'status.json').read_bytes(), original)
                self.assertEqual((window / 'resume-previous-status.json').stat().st_mode & 0o777, 0o600)
                with self.assertRaises(FileExistsError):
                    r.prepare_resume()

    def test_success_is_one_fixed_repair_with_service_available_after_checks(self):
        r = FakeRuntime()
        repair.Window(r).execute()
        self.assertEqual(r.calls, ['preflight', 'prepare', 'maintenance', 'stop',
                                  'repair', 'start', 'verify', 'reopen', 'external'])
        self.assertTrue(r.repaired and r.running)
        self.assertFalse(r.flag)
        self.assertEqual(r.records[-1]['status'], 'success')
        self.assertFalse(r.records[-1]['databaseSchemaModified'])

    def test_preflight_or_private_snapshot_failure_does_not_stop_service(self):
        for phase in ('preflight', 'prepare'):
            with self.subTest(phase=phase):
                r = FakeRuntime(phase)
                with self.assertRaises(RuntimeError):
                    repair.Window(r).execute()
                self.assertFalse(r.flag or r.repaired)
                self.assertTrue(r.running)
                self.assertNotIn('hold', r.calls)

    def test_every_interrupted_phase_holds_without_automatic_metadata_or_code_rollback(self):
        for phase in ('maintenance', 'stop', 'repair', 'start', 'verify', 'reopen', 'external'):
            for interrupted in (False, True):
                with self.subTest(phase=phase, interrupted=interrupted):
                    r = FakeRuntime(phase, interrupted)
                    with self.assertRaisesRegex(repair.Refused, 'HELD'):
                        repair.Window(r).execute()
                    self.assertTrue(r.flag)
                    self.assertFalse(r.running)
                    self.assertEqual(r.calls[-1], 'hold')
                    self.assertEqual(r.records[-1]['phase'], phase)
                    self.assertTrue(r.records[-1]['safeStateConfirmed'])
                    self.assertFalse(r.records[-1]['automaticRollback'])

    def test_fail_safe_failure_is_not_reported_as_safe(self):
        r = FakeRuntime('repair')
        r.hold = lambda: (_ for _ in ()).throw(RuntimeError('synthetic stop failure'))
        with self.assertRaises(repair.Refused):
            repair.Window(r).execute()
        self.assertFalse(r.records[-1]['safeStateConfirmed'])

    def test_start_reuses_same_app_without_environment_update_or_daemon_restart(self):
        r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
        r.before = {'revision': repair.EXPECTED, 'compiled': {'main.js': 'test'}}
        with patch.object(r, 'verify_flag'), patch.object(r, 'identity', return_value=dict(r.before)), \
             patch.object(r, 'current_app'), patch.object(r, 'pm2') as pm2:
            r.start()
            pm2.assert_called_once_with(['restart', 'cronox'])

    def test_code_change_blocks_restart(self):
        r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
        r.before = {'revision': repair.EXPECTED, 'compiled': {'main.js': 'before'}}
        with patch.object(r, 'verify_flag'), \
             patch.object(r, 'identity', return_value={'revision': repair.EXPECTED, 'compiled': {'main.js': 'after'}}), \
             patch.object(r, 'pm2') as pm2:
            with self.assertRaisesRegex(repair.Refused, 'CODE_IDENTITY'):
                r.start()
            pm2.assert_not_called()

    def test_helper_digest_mismatch_prevents_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ('mailbox_repair_window.py', 'mailbox_storage.py'):
                (root / name).write_text('synthetic code must not run')
            (root / 'manifest.json').write_text(json.dumps({
                'mailbox_repair_window.py': '0' * 64, 'mailbox_storage.py': '0' * 64}))
            with patch.object(repair, 'HERE', root), patch.object(repair.os, 'getuid', return_value=0, create=True), \
                 patch.object(repair, 'trusted'), patch.object(repair.runpy, 'run_path') as execute:
                with self.assertRaisesRegex(repair.Refused, 'DIGEST_MISMATCH'):
                    repair.validated_helper()
                execute.assert_not_called()

    def test_untrusted_helper_never_imported(self):
        with patch.object(repair.os, 'getuid', return_value=0, create=True), \
             patch.object(repair, 'trusted', side_effect=repair.Refused('untrusted')), \
             patch.object(repair.runpy, 'run_path') as execute:
            with self.assertRaises(repair.Refused):
                repair.validated_helper()
            execute.assert_not_called()

    def test_hold_does_not_stop_a_foreign_maintenance_window(self):
        r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
        r.ever_owned_flag = True
        with tempfile.TemporaryDirectory() as folder:
            flag = Path(folder, 'flag')
            flag.write_bytes(b'another operation')
            with patch.object(repair, 'FLAG', flag), patch.object(r, 'flag_matches', return_value=False), \
                 patch.object(r, 'pm2') as pm2:
                self.assertFalse(r.hold())
                pm2.assert_not_called()
                self.assertEqual(flag.read_bytes(), b'another operation')

    def test_unowned_failure_does_not_touch_another_operator_service(self):
        r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(repair, 'FLAG', Path(folder, 'absent-flag')), \
                 patch.object(repair, 'WINDOW', Path(folder, 'absent-window')), \
                 patch.object(r, 'pm2') as pm2, patch.object(r, 'ensure_owned_flag') as flag:
                self.assertFalse(r.hold())
                pm2.assert_not_called()
                flag.assert_not_called()

    def test_sigterm_uses_normal_fail_closed_exception(self):
        with self.assertRaisesRegex(repair.Refused, 'INTERRUPTED'):
            repair.interrupted(None, None)

    def test_unowned_hold_cannot_be_reported_as_confirmed_safe(self):
        r = FakeRuntime('maintenance')
        r.hold = lambda: False
        with self.assertRaises(repair.Refused):
            repair.Window(r).execute()
        self.assertFalse(r.records[-1]['safeStateConfirmed'])

    def test_failed_phase_preserves_safe_refusal_code_without_secret_exception_values(self):
        r = FakeRuntime()
        r.verify = lambda: (_ for _ in ()).throw(repair.Refused('APPLICATION_ENVIRONMENT_CHANGED'))
        with self.assertRaises(repair.Refused):
            repair.Window(r).execute()
        self.assertEqual(r.records[-1]['failureCode'], 'APPLICATION_ENVIRONMENT_CHANGED')
        self.assertEqual(r.records[-1]['errorType'], 'Refused')
        self.assertEqual(r.records[-1]['phase'], 'verify')
        self.assertIn('line', r.records[-1]['failureLocation'])
        private = 'synthetic-secret-value-never-display'
        for error in (RuntimeError(private), repair.Refused(private), KeyError(private)):
            self.assertNotIn(private, json.dumps(repair.failure_evidence(error)))

    def test_exec_stop_post_keeps_the_original_safe_failure_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence = {'failureCode': 'APPLICATION_ENVIRONMENT_CHANGED', 'errorType': 'Refused',
                        'failureLocation': {'file': 'repair.py', 'function': 'verify', 'line': 7}}
            (root / 'status.json').write_text(json.dumps({'status': 'held', 'phase': 'verify', **evidence}))
            (root / 'before.json').write_text(json.dumps({'revision': repair.EXPECTED, 'daemon': 1234}))
            r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
            with patch.object(repair, 'WINDOW', root), patch.object(repair, 'trusted'), \
                 patch.object(r, 'flag_identity'), patch.object(r, 'hold', return_value=True), patch.object(r, 'record') as record:
                r.fail_safe()
                for key, value in evidence.items():
                    self.assertEqual(record.call_args.kwargs[key], value)

    @unittest.skipUnless(os.name == 'posix', 'durable Linux inode and fsync evidence')
    def test_exec_stop_post_after_kill_uses_durable_token_not_lost_memory(self):
        for phase in ('maintenance', 'repair', 'reopen', 'external'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as folder:
                window, flag = Path(folder, 'window'), Path(folder, 'flag')
                window.mkdir(mode=0o700)
                token = window / 'maintenance.token'
                token.write_bytes(repair.FLAG_BYTES + b'synthetic-token\n')
                token.chmod(0o600)
                (window / 'before.json').write_text(json.dumps({'revision': repair.EXPECTED, 'daemon': 1234}))
                (window / 'status.json').write_text(json.dumps({'status': 'running', 'phase': phase}))
                if phase != 'external':
                    os.link(token, flag)
                r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())))
                with patch.object(repair, 'WINDOW', window), patch.object(repair, 'FLAG', flag), \
                     patch.object(repair, 'trusted'), patch.object(r, 'pm2') as pm2, \
                     patch.object(r, 'current_app'), patch.object(r, 'loopback'):
                    # The root identity check is mocked; file/inode/link/fsync are real.
                    original_matches = r.flag_matches
                    def matches():
                        if not flag.exists(): return False
                        return not flag.is_symlink() and flag.stat().st_ino == token.stat().st_ino
                    with patch.object(r, 'flag_matches', side_effect=matches):
                        r.fail_safe()
                    self.assertTrue(flag.exists())
                    self.assertEqual(flag.stat().st_ino, token.stat().st_ino)
                    self.assertEqual([call.args[0] for call in pm2.call_args_list], [['stop', 'cronox'], ['save']])
                    self.assertTrue(json.loads((window / 'status.json').read_text())['safeStateConfirmed'])

    def test_exec_stop_post_after_success_never_stops_reopened_service(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'status.json').write_text(json.dumps({'status': 'success'}))
            r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000)))
            with patch.object(repair, 'WINDOW', root), patch.object(repair, 'trusted'), patch.object(r, 'hold') as hold:
                r.fail_safe()
                hold.assert_not_called()

    def test_pm2_lifecycle_changes_are_allowed_but_application_controls_and_secrets_are_not(self):
        before = {'HOST': '127.0.0.1', 'MAILBOX_PRIVATE_DIR': str(repair.STORAGE),
                  'MAILBOX_WORKER_ENABLED': 'true', 'JWT_ACCESS_SECRET': 'synthetic-private-value',
                  'PWD': '/synthetic/cwd', 'OLDPWD': '/synthetic/previous',
                  **{name: 'before' for name in repair.PM2_METADATA}}
        for key in (None, 'JWT_ACCESS_SECRET', 'MAILBOX_WORKER_ENABLED', 'PWD', 'OLDPWD'):
            with self.subTest(changed_application_key=key), tempfile.TemporaryDirectory() as folder:
                after = dict(before, **{name: 'after' for name in repair.PM2_METADATA})
                if key:
                    after[key] = 'unexpected'
                r = repair.Runtime(SimpleNamespace(deploy_user=lambda: SimpleNamespace(pw_uid=1000, pw_gid=1000),
                                                   check=lambda configured: 1))
                r.env_keys = list(before)
                r.env_before = repair.application_environment(before, before)
                r.before = {'revision': repair.EXPECTED, 'compiled': {'main.js': 'same'}}
                pm = Path(folder)
                (pm / 'dump.pm2').write_text(json.dumps([{
                    'name': 'cronox', 'status': 'online', 'pm_exec_path': str(repair.BACKEND / 'dist/main.js'),
                    **{name: before.get(name) for name in repair.CONTROLS}}]))
                with patch.object(repair, 'PM', pm), patch.object(r, 'current_app', return_value={}), \
                     patch.object(r, 'environment', return_value=after), patch.object(r, 'http'), \
                     patch.object(r, 'loopback'), patch.object(r, 'identity', return_value=dict(r.before)), \
                     patch.object(r, 'pm2') as command:
                    if key:
                        with self.assertRaisesRegex(repair.Refused, 'APPLICATION_ENVIRONMENT_CHANGED'):
                            r.verify()
                        command.assert_not_called()
                    else:
                        r.verify()
                        command.assert_called_once_with(['save'])


if __name__ == '__main__':
    unittest.main()
