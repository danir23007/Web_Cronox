import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import contextlib
import io
from unittest.mock import patch

from controller import Engine, PHASES, Refused, revision, atomic_json, Runtime, lock
import controller
from backup import compatible_roles, insert_graphql, verification_sql

SHA = 'a' * 40


class FakeRuntime:
    def __init__(self, folder, fail=None, interrupt=None):
        self.folder, self.fail, self.interrupt = Path(folder), fail, interrupt
        self.calls = []
        self.maintenance_active = False
        self.writers_active = True

    def __getattr__(self, phase):
        def step():
            self.calls.append(phase)
            if phase in PHASES:
                state = json.loads((self.folder / 'status.json').read_text())
                assert state['phase'] == phase and not state['phaseComplete']
            if phase == 'maintenance':
                self.maintenance_active = True
            if phase == 'stop':
                self.writers_active = False
            if phase in ('start_paused', 'activate'):
                self.writers_active = True
            if phase == 'open':
                self.maintenance_active = False
            if phase == 'hold':
                self.maintenance_active, self.writers_active = True, False
            if phase == self.interrupt:
                raise KeyboardInterrupt()
            if phase == self.fail:
                raise RuntimeError('secret-database-url-must-not-appear')
        return step


class ReleaseTests(unittest.TestCase):
    def simulate_ssh_driver(self, terminal):
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            fake = folder / 'ssh'
            fake.write_text('''#!%s
import sys,os,json,pathlib
args=sys.argv[1:]
assert 'StrictHostKeyChecking=yes' in args
folder=pathlib.Path(os.environ['RUNNER_TEMP'])
command=args[-1]
if 'cronox-release request ' in command:
 p=folder/'requests'; p.write_text(str(int(p.read_text())+1) if p.exists() else '1')
 sys.exit(255) # server accepted request; response lost
if 'cronox-release status ' in command:
 p=folder/'polls'; n=int(p.read_text())+1 if p.exists() else 1; p.write_text(str(n))
 print(json.dumps({'revision':os.environ['GITHUB_SHA'],'status':'running' if n==1 else %r}))
''' % (sys.executable, terminal))
            fake.chmod(0o755)
            (folder/'sleep').write_text('#!/bin/sh\nexit 0\n')
            (folder/'sleep').chmod(0o755)
            driver = Path(__file__).parent/'deploy-production.sh'
            if not driver.exists():
                driver = Path(__file__).resolve().parents[2]/'scripts/deploy-production.sh'
            env = dict(os.environ, PATH=d+os.pathsep+os.environ['PATH'], RUNNER_TEMP=d,
                       GITHUB_WORKSPACE=d, SSH_HOST='fixture.invalid', SSH_PORT='22', SSH_USER='deploy',
                       SSH_KEY='synthetic-fixture-key', GITHUB_SHA=SHA)
            result = subprocess.run(['/usr/bin/bash', str(driver)], env=env, capture_output=True, timeout=20)
            self.assertEqual((folder/'requests').read_text(), '1')
            self.assertEqual((folder/'polls').read_text(), '2')
            self.assertNotIn(b'synthetic-fixture-key', result.stdout+result.stderr)
            self.assertFalse((folder/'cronox-deploy-key').exists())
            return result

    @unittest.skipUnless(os.name == 'posix', 'Linux shell integration')
    def test_driver_reconciles_lost_ssh_response_without_second_request(self):
        result = self.simulate_ssh_driver('success')
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'DEPLOYED_COMMIT=', result.stdout)

    @unittest.skipUnless(os.name == 'posix', 'Linux shell integration')
    def test_driver_reports_held_not_success_after_connection_loss(self):
        result = self.simulate_ssh_driver('held')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b'DEPLOYED_COMMIT=', result.stdout)

    def test_worker_waits_for_initial_scan_then_requires_progress(self):
        with tempfile.TemporaryDirectory() as d, patch.object(time, 'sleep'):
            rt = object.__new__(Runtime)
            rt.folder = Path(d)
            samples = iter([
                {'pid':1,'enabled':True,'lastScanError':None,'lastScanCompletedAt':None},
                {'pid':1,'enabled':True,'lastScanError':None,'lastScanCompletedAt':'2026-10-18T00:00:00Z'},
                {'pid':1,'enabled':True,'lastScanError':None,'lastScanCompletedAt':'2026-10-18T00:00:05Z'}])
            rt.telemetry = lambda: next(samples)
            rt.loopback = lambda: None
            rt.check_active()
            self.assertTrue(Path(d, 'worker.json').exists())

    def test_request_is_idempotent_after_lost_response(self):
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(controller, 'BASE', Path(d)))
            stack.enter_context(patch.object(controller, 'FLAG', Path(d, 'maintenance')))
            stack.enter_context(patch.object(controller, 'secure_path'))
            stack.enter_context(patch.object(os, 'getuid', return_value=0, create=True))
            stack.enter_context(patch.object(controller, 'lock', return_value=contextlib.nullcontext()))
            run = stack.enter_context(patch.object(subprocess, 'run'))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            controller.main(['request', SHA])
            controller.main(['request', SHA])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ['/usr/bin/systemctl', 'start', '--no-block', 'cronox-release@'+SHA+'.service'])
            with self.assertRaises(Refused):
                controller.main(['request', 'b'*40])

    def test_dispatch_rejects_extra_arguments_and_internal_worker_via_sudo(self):
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(controller, 'BASE', Path(d)))
            stack.enter_context(patch.object(controller, 'secure_path'))
            stack.enter_context(patch.object(os, 'getuid', return_value=0, create=True))
            stack.enter_context(patch.object(controller, 'lock', return_value=contextlib.nullcontext()))
            stack.enter_context(patch.dict(os.environ, {'SUDO_USER': 'deploy'}))
            for args in (['request', SHA, 'extra'], ['shell', SHA], ['worker', SHA], ['fail-safe', SHA]):
                with self.subTest(args=args), self.assertRaises(Refused):
                    controller.main(args)

    def test_recovery_refuses_to_roll_back_after_install_or_migration(self):
        for phase in ('install', 'migrate', 'activate', 'open'):
            with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(controller, 'BASE', Path(d)))
                stack.enter_context(patch.object(controller, 'secure_path'))
                stack.enter_context(patch.object(os, 'getuid', return_value=0, create=True))
                stack.enter_context(patch.object(controller, 'lock', return_value=contextlib.nullcontext()))
                folder = Path(d, SHA)
                folder.mkdir()
                atomic_json(folder/'status.json', {'revision': SHA, 'status':'held', 'phase':phase})
                with self.assertRaises(Refused):
                    controller.main(['recover', SHA])

    def test_exact_revision_only(self):
        for bad in ('main', '../etc/passwd', SHA + ' --help', 'a' * 39, 'A' * 40, SHA + '\n', 'x' * 40):
            with self.subTest(bad=bad), self.assertRaises(Refused):
                revision(bad)
        self.assertEqual(revision(SHA), SHA)

    def test_happy_path_order_and_durable_intent(self):
        with tempfile.TemporaryDirectory() as d:
            rt = FakeRuntime(d)
            Engine(d, SHA, rt).execute()
            self.assertEqual(rt.calls, list(PHASES))
            state = json.loads(Path(d, 'status.json').read_text())
            self.assertEqual(state['status'], 'success')
            self.assertFalse(rt.maintenance_active)
            self.assertTrue(rt.writers_active)
            self.assertLess(rt.calls.index('backup'), rt.calls.index('migrate'))
            self.assertLess(rt.calls.index('check_active'), rt.calls.index('open'))

    def test_each_failure_stops_at_phase_without_replaying(self):
        for failed in PHASES:
            with self.subTest(phase=failed), tempfile.TemporaryDirectory() as d:
                rt = FakeRuntime(d, fail=failed)
                with self.assertRaises(Refused):
                    Engine(d, SHA, rt).execute()
                state = json.loads(Path(d, 'status.json').read_text())
                self.assertEqual(state['phase'], failed)
                self.assertNotIn('secret', json.dumps(state))
                self.assertFalse(state['automaticRollback'])
                if failed == 'preflight':
                    self.assertEqual(state['status'], 'failed_before_maintenance')
                    self.assertNotIn('hold', rt.calls)
                else:
                    self.assertEqual(state['status'], 'held')
                    self.assertTrue(rt.maintenance_active)
                    self.assertFalse(rt.writers_active)
                self.assertEqual(rt.calls.count('migrate'), int(PHASES.index(failed) >= PHASES.index('migrate')))

    def test_termination_during_migration_does_not_retry_or_reopen(self):
        with tempfile.TemporaryDirectory() as d:
            rt = FakeRuntime(d, interrupt='migrate')
            with self.assertRaises(Refused):
                Engine(d, SHA, rt).execute()
            self.assertEqual(rt.calls.count('migrate'), 1)
            self.assertNotIn('open', rt.calls)
            self.assertEqual(rt.calls[-1], 'hold')

    def test_fail_safe_failure_is_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            rt = FakeRuntime(d, interrupt='backup', fail='hold')
            with self.assertRaises(Refused):
                Engine(d, SHA, rt).execute()
            self.assertFalse(json.loads(Path(d, 'status.json').read_text())['safeStateConfirmed'])

    def test_process_kill_preserves_intent_without_false_success(self):
        with tempfile.TemporaryDirectory() as d:
            code = """
import sys,time
from pathlib import Path
from controller import Engine
class R:
 def __getattr__(self,name):
  def f():
   if name=='migrate':
    Path(sys.argv[1],'entered').write_text('1')
    time.sleep(60)
  return f
Engine(sys.argv[1], 'a'*40, R()).execute()
"""
            child = subprocess.Popen([sys.executable, '-c', code, d], cwd=Path(__file__).parent,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 10
                while not Path(d, 'entered').exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(Path(d, 'entered').exists())
                child.kill()
                child.wait(timeout=5)
                state = json.loads(Path(d, 'status.json').read_text())
                self.assertEqual(state['phase'], 'migrate')
                self.assertFalse(state['phaseComplete'])
                self.assertNotEqual(state['status'], 'success')
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait()

    @unittest.skipUnless(os.name == 'posix', 'Linux advisory lock test')
    def test_concurrent_process_cannot_take_lock(self):
        with tempfile.TemporaryDirectory() as d, lock(Path(d, 'lock')):
            code = "from controller import lock; import sys;\nwith lock(sys.argv[1]): print('BAD')"
            p = subprocess.run([sys.executable, '-c', code, str(Path(d, 'lock'))],
                               cwd=Path(__file__).parent, capture_output=True)
            self.assertNotEqual(p.returncode, 0)
            self.assertNotIn(b'BAD', p.stdout)

    def test_telemetry_rejects_old_pid_or_stale_timestamp(self):
        import controller
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, 'status.json')
            path.write_text(json.dumps({'pid': 99, 'writtenAt': time.time()*1000}))
            rt = object.__new__(Runtime)
            rt.pm2 = lambda args: b'[{"pid":100}]'
            with patch.object(controller, 'Path', return_value=path), patch.object(os, 'O_NOFOLLOW', 0, create=True):
                with self.assertRaises(Refused):
                    rt.telemetry()
                path.write_text(json.dumps({'pid': 100, 'writtenAt': 0}))
                with self.assertRaises(Refused):
                    rt.telemetry()

    def test_graphql_supplement_has_terminator_once(self):
        base = 'CREATE SCHEMA graphql_public;\nCREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;'
        function = 'CREATE OR REPLACE FUNCTION graphql_public.graphql() RETURNS int LANGUAGE sql AS $function$ SELECT 1 $function$'
        result = insert_graphql(base, function)
        self.assertIn('$function$;\nALTER FUNCTION', result)
        self.assertEqual(result.count('ALTER EXTENSION pg_graphql ADD FUNCTION'), 1)
        with self.assertRaises(Refused):
            insert_graphql(base + '\n' + base, function)

    def test_role_restore_handles_existing_roles_only(self):
        result = compatible_roles('CREATE ROLE postgres;\nALTER ROLE postgres WITH LOGIN;')
        self.assertIn('WHEN duplicate_object THEN NULL', result)
        self.assertNotIn('WHEN OTHERS', result)
        self.assertIn('ALTER ROLE postgres WITH LOGIN;', result)
        with self.assertRaises(Refused):
            compatible_roles('CREATE ROLE unexpected syntax;')

    def test_verification_quotes_identifiers_and_normalizes_acls(self):
        query = verification_sql([{'schema': 'public', 'name': 'odd"name', 'kind': 'r'}])
        self.assertIn('"public"."odd""name"', query)
        self.assertIn('acldefault', query)
        self.assertIn('pg_policies', query)


if __name__ == '__main__':
    unittest.main()
