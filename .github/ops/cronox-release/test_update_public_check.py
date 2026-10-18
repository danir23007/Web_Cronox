import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

import update_public_check as update


def sample():
    return b'class Runtime:\n' + update.OLD_BLOCK + b'    def untouched(self):\n        return 42\n'


@contextlib.contextmanager
def version(data):
    result = data.replace(update.OLD_BLOCK, update.NEW_BLOCK, 1)
    with mock.patch.object(update, 'BASE_SHA256', update.digest(data)), \
            mock.patch.object(update, 'PATCH_SHA256', update.digest(result)):
        yield result


class TransformTests(unittest.TestCase):
    def test_patch_changes_only_public_check_and_preserves_all_other_bytes(self):
        source = sample()
        with version(source) as expected:
            self.assertEqual(update.transform(source), expected)
            self.assertEqual(expected.replace(update.NEW_BLOCK, update.OLD_BLOCK), source)

    def test_unknown_base_and_unexpected_target_digest_are_rejected(self):
        with version(sample()):
            with self.assertRaisesRegex(update.Refused, 'INSTALLED_BASE_MISMATCH'):
                update.transform(sample() + b'# unrelated change\n')
            with mock.patch.object(update, 'PATCH_SHA256', '0' * 64):
                with self.assertRaisesRegex(update.Refused, 'PATCH_DIGEST_MISMATCH'):
                    update.transform(sample())

    def test_patch_scope_and_python_syntax_are_checked_without_execution(self):
        source = sample()
        with mock.patch.object(update, 'NEW_BLOCK', update.NEW_BLOCK + b'    accidental = True\n'), \
                version(source):
            with self.assertRaisesRegex(update.Refused, 'PATCH_SCOPE_MISMATCH'):
                update.transform(source)
        with mock.patch.object(update, 'NEW_BLOCK', b'    invalid syntax: ?\n'), version(source):
            with self.assertRaises(SyntaxError):
                update.transform(source)

    def test_cli_accepts_only_four_fixed_actions_and_root(self):
        for args in ([], ['--apply', '/other'], ['--run'], ['--restore', '--force']):
            with self.assertRaisesRegex(update.Refused, 'FIXED_ACTION_REQUIRED'):
                update.main(args)
        with mock.patch.object(update.os, 'getuid', return_value=1000, create=True):
            with self.assertRaisesRegex(update.Refused, 'ROOT_REQUIRED'):
                update.main(['--apply'])


@unittest.skipUnless(os.name == 'posix', 'requires Linux ownership, permissions and fsync')
class FilesystemTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.folder = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='public-check-test-')))
        self.install_dir = self.folder / 'install'
        self.install_dir.mkdir(mode=0o755)
        self.install = self.install_dir / 'controller.py'
        self.install.write_bytes(sample())
        self.install.chmod(0o644)
        self.base = self.folder / 'release'
        self.base.mkdir(mode=0o700)
        (self.base / 'controller.lock').write_bytes(b'')
        (self.base / 'controller.lock').chmod(0o600)
        self.flag_dir = self.folder / 'flag'
        self.flag_dir.mkdir(mode=0o755)
        self.backup = self.folder / 'backup'
        for name, value in (('INSTALL', self.install), ('BASE', self.base),
                            ('FLAG', self.flag_dir / 'maintenance.flag'), ('BACKUP', self.backup)):
            self.stack.enter_context(mock.patch.object(update, name, value))
        self.expected = self.stack.enter_context(version(sample()))
        self.stack.enter_context(mock.patch.object(update, 'command', return_value=b''))
        # Synthetic privileged identity only. Object types, inode/link counts,
        # modes, writes, hardlinks, flock, replace and fsync remain real Linux.
        self.stack.enter_context(mock.patch.object(update, 'protected', side_effect=self.protected))

    def protected(self, path, *, directory=False, mode=None):
        path = Path(path)
        self.assertTrue(path.is_relative_to(self.folder))
        value = path.lstat()
        update.require(not stat.S_ISLNK(value.st_mode), 'UNTRUSTED_PATH')
        update.require(stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode),
                       'UNEXPECTED_FILE_TYPE')
        if not directory:
            update.require(value.st_nlink == 1, 'HARDLINK_REFUSED')
        if mode is not None:
            update.require(stat.S_IMODE(value.st_mode) == mode, 'UNEXPECTED_MODE')
        return value

    def run_action(self, action):
        with update.controller_lock(), contextlib.redirect_stdout(io.StringIO()) as output:
            update.execute(action)
        return output.getvalue()

    def test_plan_and_status_are_readonly(self):
        inode = self.install.stat().st_ino
        self.assertIn('PUBLIC_CHECK_PLAN_OK', self.run_action('--plan'))
        self.assertEqual(json.loads(self.run_action('--status'))['version'], 'original')
        self.assertFalse(self.backup.exists())
        self.assertEqual(self.install.read_bytes(), sample())
        self.assertEqual(self.install.stat().st_ino, inode)

    def test_apply_and_restore_preserve_private_backup_and_exact_version(self):
        self.assertIn('PUBLIC_CHECK_PATCHED', self.run_action('--apply'))
        self.assertEqual(self.install.read_bytes(), self.expected)
        self.assertEqual(stat.S_IMODE(self.install.stat().st_mode), 0o644)
        before = self.backup / 'controller.before.py'
        self.assertEqual(before.read_bytes(), sample())
        self.assertEqual(stat.S_IMODE(before.stat().st_mode), 0o400)
        self.assertEqual(stat.S_IMODE(self.backup.stat().st_mode), 0o700)
        inode = before.stat().st_ino
        self.assertEqual(json.loads(self.run_action('--status'))['version'], 'patched')
        self.assertIn('PUBLIC_CHECK_RESTORED', self.run_action('--restore'))
        self.assertEqual(self.install.read_bytes(), sample())
        self.assertEqual(before.stat().st_ino, inode)
        with self.assertRaisesRegex(update.Refused, 'BACKUP_ALREADY_EXISTS'):
            self.run_action('--apply')

    def test_maintenance_unresolved_active_or_queued_releases_block_before_writes(self):
        update.FLAG.write_text('foreign window')
        with self.assertRaisesRegex(update.Refused, 'MAINTENANCE_ACTIVE'):
            self.run_action('--apply')
        update.FLAG.unlink()
        release = self.base / ('a' * 40)
        release.mkdir(mode=0o700)
        with self.assertRaisesRegex(update.Refused, 'RELEASE_JOURNAL_MISSING'):
            self.run_action('--plan')
        journal = release / 'status.json'
        journal.write_text(json.dumps({'status': 'held'}))
        journal.chmod(0o600)
        with self.assertRaisesRegex(update.Refused, 'UNRESOLVED_RELEASE'):
            self.run_action('--apply')
        journal.write_text(json.dumps({'status': 'success'}))
        with mock.patch.object(update, 'command', side_effect=[b'cronox-release@a.service active\n']):
            with self.assertRaisesRegex(update.Refused, 'RELEASE_UNIT_ACTIVE'):
                self.run_action('--apply')
        with mock.patch.object(update, 'command', side_effect=[b'', b'1 cronox-release@a.service start waiting\n']):
            with self.assertRaisesRegex(update.Refused, 'RELEASE_JOB_PENDING'):
                self.run_action('--apply')
        self.assertFalse(self.backup.exists())
        self.assertEqual(self.install.read_bytes(), sample())

    def test_real_global_lock_excludes_concurrent_update(self):
        with update.controller_lock():
            with self.assertRaisesRegex(update.Refused, 'RELEASE_BUSY'):
                self.run_action('--apply')
        self.assertFalse(self.backup.exists())

    def test_unknown_version_or_tampered_backup_cannot_restore(self):
        self.run_action('--apply')
        self.install.write_bytes(self.expected + b'# extra\n')
        with self.assertRaisesRegex(update.Refused, 'UNKNOWN_INSTALLED_VERSION'):
            self.run_action('--restore')
        self.install.write_bytes(self.expected)
        before = self.backup / 'controller.before.py'
        before.chmod(0o600)
        before.write_bytes(b'tampered')
        before.chmod(0o400)
        with self.assertRaisesRegex(update.Refused, 'INSTALLED_BASE_MISMATCH'):
            self.run_action('--restore')
        self.assertEqual(self.install.read_bytes(), self.expected)

    def test_links_and_mode_changes_are_rejected(self):
        linked = self.folder / 'linked'
        os.link(self.install, linked)
        with self.assertRaisesRegex(update.Refused, 'HARDLINK_REFUSED'):
            self.run_action('--apply')
        linked.unlink()
        self.install.chmod(0o666)
        with self.assertRaisesRegex(update.Refused, 'UNEXPECTED_MODE'):
            self.run_action('--apply')
        self.install.chmod(0o644)
        self.install.unlink()
        self.install.symlink_to(self.folder / 'missing')
        with self.assertRaisesRegex(update.Refused, 'UNTRUSTED_PATH'):
            self.run_action('--apply')
        self.assertFalse(self.backup.exists())

    def test_interruption_before_atomic_replace_keeps_original_and_backup(self):
        with mock.patch.object(update.os, 'replace', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_action('--apply')
        self.assertEqual(self.install.read_bytes(), sample())
        self.assertEqual(update.backup_contents(), sample())
        self.assertFalse(list(self.install_dir.glob('.controller-public-check.*')))

    def test_interruption_after_replace_leaves_complete_patch_with_valid_restore(self):
        real_sync = update.fsync_folder
        def interrupt(path):
            if path == self.install_dir:
                raise KeyboardInterrupt
            real_sync(path)
        with mock.patch.object(update, 'fsync_folder', side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_action('--apply')
        self.assertEqual(self.install.read_bytes(), self.expected)
        self.assertEqual(update.backup_contents(), sample())
        self.run_action('--restore')
        self.assertEqual(self.install.read_bytes(), sample())


if __name__ == '__main__':
    unittest.main()
