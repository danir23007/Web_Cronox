import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import install


class BootstrapTests(unittest.TestCase):
    def test_main_sudoers_preserves_all_unrelated_bytes(self):
        prefix = b'# admin policy\r\nDefaults env_reset\r\nroot ALL=(ALL:ALL) ALL\r\n'
        grant = b'deploy ALL=(root) NOPASSWD: /usr/bin/pm2 restart cronox, /usr/bin/pm2 save\r\n'
        suffix = b'@includedir /etc/sudoers.d\r\n# keep exact trailing bytes'
        after, count = install.remove_known_pm2_rules(prefix + grant + suffix, main_file=True)
        self.assertEqual(after, prefix + suffix)
        self.assertEqual(count, 1)

    def test_rejects_unknown_pm2_grants_and_continuations(self):
        grant = b'deploy ALL=(root) NOPASSWD: /usr/bin/pm2 save\n'
        for source in (grant.replace(b'save', b'save, /bin/sh'), b'alias \\\n' + grant):
            with self.assertRaises(RuntimeError):
                install.remove_known_pm2_rules(source, main_file=True)
        with self.assertRaises(RuntimeError):
            install.remove_known_pm2_rules(b'Defaults env_reset\n' + grant)

    @unittest.skipUnless(os.name == 'posix', 'Atomic Linux policy replacement')
    def test_visudo_failure_or_source_change_cannot_replace_policy(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, 'sudoers')
            path.write_bytes(b'before\n')
            plan = {'path': path, 'before': b'before\n', 'after': b'after\n'}
            with patch.object(install, 'root_owned'), patch.object(install, 'run', side_effect=RuntimeError('INVALID')):
                with self.assertRaises(RuntimeError):
                    install.replace_sudo_policy(plan)
            self.assertEqual(path.read_bytes(), b'before\n')
            def concurrently_changed(*args):
                path.write_bytes(b'operator change\n')
            with patch.object(install, 'root_owned'), patch.object(install, 'run', side_effect=concurrently_changed):
                with self.assertRaises(RuntimeError):
                    install.replace_sudo_policy(plan)
            self.assertEqual(path.read_bytes(), b'operator change\n')
            self.assertEqual(list(Path(d).iterdir()), [path])

    @unittest.skipUnless(os.name == 'posix', 'Atomic Linux policy replacement')
    def test_plan_validates_without_changing_policy_and_apply_preserves_mode(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, 'sudoers')
            path.write_bytes(b'before\n')
            path.chmod(0o440)
            plan = {'path': path, 'before': b'before\n', 'after': b'after\n'}
            with patch.object(install, 'root_owned'), patch.object(install, 'run') as command:
                install.replace_sudo_policy(plan, apply=False)
                self.assertEqual(path.read_bytes(), b'before\n')
                install.replace_sudo_policy(plan)
                self.assertEqual(path.read_bytes(), b'after\n')
                self.assertEqual(path.stat().st_mode & 0o777, 0o440)
                self.assertEqual(command.call_count, 2)

    def test_identity_rejects_code_or_migration_change(self):
        before = {'revision': 'a' * 40, 'compiled': {'main.js': 'digest'}, 'migrations': [['initial']]}
        install.assert_unchanged(before, dict(before))
        for key, value in [('revision', 'b' * 40), ('compiled', {}), ('migrations', [])]:
            with self.assertRaises(RuntimeError):
                install.assert_unchanged(before, dict(before, **{key: value}))

    @unittest.skipUnless(os.name == 'posix', 'Installer targets Linux')
    def test_restore_failure_does_not_start_maintenance(self):
        with tempfile.TemporaryDirectory() as d:
            flag, state = Path(d, 'flag'), Path(d, 'state')
            with patch.object(install, 'FLAG', flag), patch.object(install, 'STATE', state), \
                 patch.object(install, 'preflight', return_value=({}, [])), \
                 patch.object(install, 'identity', return_value={'revision': install.BOOTSTRAP_REVISION}), patch.object(install, 'health'), \
                 patch.object(install, 'run', side_effect=RuntimeError('RESTORE_FAILED')) as command:
                with self.assertRaises(RuntimeError):
                    install.install()
                self.assertFalse(flag.exists())
                self.assertFalse(state.exists())
                self.assertIn('selftest.py', command.call_args.args[0][2])

    @unittest.skipUnless(os.name == 'posix', 'Installer targets Linux')
    def test_transition_recovery_refuses_changed_code_without_starting(self):
        with tempfile.TemporaryDirectory() as d:
            state, flag = Path(d, 'state'), Path(d, 'flag')
            (state / 'bootstrap').mkdir(parents=True)
            (state / 'bootstrap/identity-before.json').write_text(json.dumps({'revision': 'a' * 40}))
            flag.write_text('cronox-bootstrap\n')
            with patch.object(install, 'STATE', state), patch.object(install, 'FLAG', flag), \
                 patch.object(os, 'getuid', return_value=0), patch.object(install, 'root_owned'), \
                 patch.object(install, 'identity', return_value={'revision': 'b' * 40}), \
                 patch.object(install, 'run') as command:
                with self.assertRaises(RuntimeError):
                    install.recover_transition()
                command.assert_not_called()
                self.assertTrue(flag.exists())


if __name__ == '__main__':
    unittest.main()
