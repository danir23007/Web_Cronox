import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import install


class BootstrapTests(unittest.TestCase):
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
