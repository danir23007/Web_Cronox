import ast
import inspect
import json
import os
from pathlib import Path
import tempfile
import unittest

from controller import backup_diagnostics
import update_backup_diagnostics as update


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.folder.chmod(0o700)

    def write(self, name, text):
        file = self.folder / name
        file.write_text(text)
        file.chmod(0o600)
        return file

    def test_no_artifacts_is_a_valid_read_only_summary(self):
        result = backup_diagnostics(self.folder)
        self.assertTrue(result['available'])
        self.assertFalse(any(row['present'] for row in result['artifacts']))
        self.assertEqual(result['errorClasses'], [])
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_tar_error_classification_never_returns_path_or_log_content(self):
        secret = 'synthetic-private-value-0123456789'
        self.write('private.log', '/usr/bin/tar: ./private-' + secret + ': Cannot open: Permission denied\n/usr/bin/tar: Exiting with failure status due to previous errors\n')
        result = backup_diagnostics(self.folder)
        self.assertIn('TAR_PERMISSION_DENIED', result['errorClasses'])
        self.assertIn('TAR_FAILED', result['errorClasses'])
        self.assertNotIn(secret, json.dumps(result))

    def test_changed_source_is_distinguished_from_permissions(self):
        self.write('private.log', '/usr/bin/tar: .: file changed as we read it\n')
        self.assertEqual(backup_diagnostics(self.folder)['errorClasses'], ['TAR_SOURCE_CHANGED'])

    def test_sql_errors_return_fixed_codes_only(self):
        self.write('private.log', 'psql:<stdin>:7: ERROR: function "private-object" does not exist\npsql: ERROR: syntax error at or near "private-token"\n')
        result = backup_diagnostics(self.folder)
        self.assertTrue(result['postgresErrorPresent'])
        self.assertIn('SQL_MISSING_FUNCTION', result['errorClasses'])
        self.assertIn('SQL_SYNTAX_ERROR', result['errorClasses'])
        self.assertNotIn('private-', json.dumps(result))

    def test_comparison_reports_fields_without_object_names_or_digests(self):
        row = {'kind':'table', 'name':'private-table-name', 'rows':1, 'digest':'private-digest'}
        self.write('source-verification.json', json.dumps([row]))
        self.write('restore-verification.json', json.dumps([{**row, 'rows':2, 'digest':'another-private-digest'}]))
        result = backup_diagnostics(self.folder)
        self.assertEqual(result['comparison']['differenceCount'], 1)
        self.assertEqual(result['comparison']['differencesByKind'], {'table':1})
        self.assertEqual(result['comparison']['differencesByField'], {'rows':1, 'digest':1})
        self.assertNotIn('private-', json.dumps(result))

    def test_matching_comparison_and_unknown_labels_are_safe(self):
        row = {'kind':'private-kind', 'name':'private-name', 'private-field':'private-content'}
        self.write('source-verification.json', json.dumps([row]))
        self.write('restore-verification.json', json.dumps([row]))
        self.assertEqual(backup_diagnostics(self.folder)['comparison']['differenceCount'], 0)
        self.write('restore-verification.json', '[]')
        result = backup_diagnostics(self.folder)
        self.assertEqual(result['comparison']['differencesByKind'], {'other':1})
        self.assertNotIn('private-', json.dumps(result))

    def test_symlink_and_hardlink_are_refused(self):
        target = self.write('outside', 'private-data')
        (self.folder / 'private.log').symlink_to(target)
        self.assertEqual(backup_diagnostics(self.folder), {'available':False})
        (self.folder / 'private.log').unlink()
        os.link(target, self.folder / 'private.log')
        self.assertEqual(backup_diagnostics(self.folder), {'available':False})

    def test_public_mode_and_invalid_comparison_are_refused(self):
        file = self.write('private.log', 'private-content')
        file.chmod(0o644)
        self.assertEqual(backup_diagnostics(self.folder), {'available':False})
        file.chmod(0o600)
        self.write('source-verification.json', 'invalid-json-private-content')
        self.write('restore-verification.json', '[]')
        self.assertEqual(backup_diagnostics(self.folder), {'available':False})

    def test_log_read_is_bounded(self):
        self.write('private.log', 'x' * 100000 + '\n/usr/bin/tar: .: file changed as we read it\n')
        result = backup_diagnostics(self.folder)
        self.assertTrue(result['logTailLimited'])
        self.assertEqual(result['errorClasses'], ['TAR_SOURCE_CHANGED'])
        self.assertLess(len(json.dumps(result)), 2500)

    def test_installer_embeds_exact_tested_function(self):
        self.assertEqual(ast.dump(ast.parse(inspect.getsource(backup_diagnostics))),
                         ast.dump(ast.parse(update.HELPER_SOURCE)))


if __name__ == '__main__':
    unittest.main()
