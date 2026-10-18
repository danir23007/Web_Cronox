import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import archive_legacy_env as archive

REAL_IDLE = archive.idle


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.folder.chmod(0o700)
        self.application = self.folder / 'application'
        self.application.mkdir(mode=0o755)
        self.source = self.application / '.env.backup-20260912-storage'
        self.source.write_bytes(b'synthetic-unused-private-config\n')
        self.source.chmod(0o600)
        (self.application / '.env').write_bytes(b'synthetic-active-config\n')
        self.destination = self.folder / 'archive'
        self.original = self.source.stat()
        self.content = self.source.read_bytes()
        patches = {'SOURCE': self.source, 'ARCHIVE': self.destination,
                   'ROOT_UID': os.getuid(), 'ROOT_GID': os.getgid(),
                   'EXPECTED_SIZE': len(self.content)}
        self.addCleanup(mock.patch.stopall)
        for name, value in patches.items():
            mock.patch.object(archive, name, value).start()
        mock.patch.object(archive, 'idle').start()

    def run_action(self, action):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            archive.execute(action)
        return output.getvalue()

    def test_plan_does_not_change_paths(self):
        self.assertIn('PLAN_OK', self.run_action('--plan'))
        self.assertTrue(self.source.exists())
        self.assertFalse(self.destination.exists())

    def test_move_status_and_restore_preserve_content_inode_owner_mode(self):
        self.run_action('--apply')
        moved = self.destination / self.source.name
        self.assertFalse(self.source.exists())
        self.assertEqual(moved.read_bytes(), self.content)
        self.assertEqual(moved.stat().st_ino, self.original.st_ino)
        self.assertEqual(moved.stat().st_uid, self.original.st_uid)
        self.assertEqual(moved.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.destination.stat().st_mode & 0o777, 0o700)
        self.assertTrue(json.loads(self.run_action('--status'))['contentVerified'])
        self.run_action('--apply')  # Reconciliation is a verified no-op.
        self.run_action('--restore')
        self.assertEqual(self.source.read_bytes(), self.content)
        self.assertEqual(self.source.stat().st_ino, self.original.st_ino)

    def test_symlink_is_rejected_without_reading_target(self):
        self.source.unlink()
        target = self.folder / 'other-private-file'
        target.write_bytes(self.content)
        self.source.symlink_to(target)
        with self.assertRaises(OSError):
            self.run_action('--apply')
        self.assertFalse(self.destination.exists())

    def test_hardlink_and_incorrect_permissions_are_rejected(self):
        link = self.folder / 'hardlink'
        os.link(self.source, link)
        with self.assertRaisesRegex(archive.Refused, 'PRIVATE_REGULAR'):
            self.run_action('--apply')
        link.unlink()
        self.source.chmod(0o644)
        with self.assertRaisesRegex(archive.Refused, 'PRIVATE_REGULAR'):
            self.run_action('--apply')
        self.assertFalse(self.destination.exists())

    def test_existing_archive_without_manifest_is_rejected(self):
        self.destination.mkdir(mode=0o700)
        with self.assertRaises(FileNotFoundError):
            self.run_action('--apply')
        self.assertTrue(self.source.exists())

    def test_private_archive_symlink_is_rejected(self):
        other = self.folder / 'other'
        other.mkdir(mode=0o700)
        self.destination.symlink_to(other)
        with self.assertRaises(OSError):
            self.run_action('--apply')
        self.assertTrue(self.source.exists())

    def idle_fixture(self):
        base = self.folder / 'releases'
        base.mkdir(mode=0o700)
        config_dir = self.folder / 'config'
        config_dir.mkdir(mode=0o700)
        config = config_dir / 'runtime.json'
        config.write_text('{}')
        config.chmod(0o600)
        proc = self.folder / 'proc'
        proc.mkdir()
        flag = self.folder / 'maintenance.flag'
        for name, value in {'BASE':base, 'CONFIG':config, 'PROC':proc, 'FLAG':flag}.items():
            mock.patch.object(archive, name, value).start()
        return base, config, proc, flag

    def test_idle_rejects_maintenance_and_unresolved_release(self):
        base, config, proc, flag = self.idle_fixture()
        REAL_IDLE()
        flag.touch()
        with self.assertRaisesRegex(archive.Refused, 'MAINTENANCE_ACTIVE'):
            REAL_IDLE()
        flag.unlink()
        release = base / ('a' * 40)
        release.mkdir(mode=0o700)
        state = release / 'status.json'
        state.write_text('{"status":"held"}')
        state.chmod(0o600)
        with self.assertRaisesRegex(archive.Refused, 'UNRESOLVED_RELEASE'):
            REAL_IDLE()
        state.write_text('{"status":"recovered"}')
        REAL_IDLE()

    def test_idle_rejects_custom_config_or_process_env_file(self):
        base, config, proc, flag = self.idle_fixture()
        config.write_text(json.dumps({'CRONOX_ENV_FILE':str(self.source)}))
        with self.assertRaisesRegex(archive.Refused, 'CUSTOM_ENV_FILE_IN_USE'):
            REAL_IDLE()
        config.write_text('{}')
        process = proc / '123'
        process.mkdir()
        (process / 'cwd').symlink_to(self.application)
        (process / 'environ').write_bytes(b'CRONOX_ENV_FILE=' + os.fsencode(self.source) + b'\0')
        with self.assertRaisesRegex(archive.Refused, 'RUNNING_CUSTOM_ENV_FILE_IN_USE'):
            REAL_IDLE()

    def test_idle_rejects_active_env_symlink_to_backup(self):
        self.idle_fixture()
        (self.application / '.env').unlink()
        (self.application / '.env').symlink_to(self.source)
        with self.assertRaisesRegex(archive.Refused, 'ACTIVE_ENV_MUST_NOT_BE_SYMLINK'):
            REAL_IDLE()

    def test_changed_archived_content_prevents_restore(self):
        self.run_action('--apply')
        moved = self.destination / self.source.name
        moved.write_bytes(b'X' * len(self.content))
        with self.assertRaisesRegex(archive.Refused, 'CONTENT_CHANGED'):
            self.run_action('--restore')
        self.assertFalse(self.source.exists())

    def test_restore_refuses_to_overwrite_application_file(self):
        self.run_action('--apply')
        self.source.write_bytes(b'unrelated-current-file')
        with self.assertRaisesRegex(archive.Refused, 'LOCATION_AMBIGUOUS'):
            self.run_action('--restore')
        self.assertEqual(self.source.read_bytes(), b'unrelated-current-file')

    def test_interruption_before_move_keeps_original_and_reconciles(self):
        with mock.patch.object(archive, 'rename_without_replacing', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_action('--apply')
        self.assertTrue(self.source.exists())
        self.assertEqual(json.loads(self.run_action('--status'))['location'], 'application')
        self.run_action('--apply')
        self.assertEqual(json.loads(self.run_action('--status'))['location'], 'archive')

    def test_interruption_after_move_is_detected_by_status_without_replay(self):
        real_move = archive.rename_without_replacing
        def interrupted(*args):
            real_move(*args)
            raise KeyboardInterrupt()
        with mock.patch.object(archive, 'rename_without_replacing', side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.run_action('--apply')
        self.assertFalse(self.source.exists())
        self.assertEqual(json.loads(self.run_action('--status'))['location'], 'archive')
        self.run_action('--restore')

    def test_atomic_move_does_not_replace_destination(self):
        self.destination.mkdir(mode=0o700)
        existing = self.destination / self.source.name
        existing.write_bytes(b'unrelated')
        with archive.directory(self.application) as source_fd, archive.directory(self.destination) as target_fd:
            with self.assertRaisesRegex(archive.Refused, 'DESTINATION_EXISTS'):
                archive.rename_without_replacing(source_fd, self.source.name, target_fd, existing.name)
        self.assertTrue(self.source.exists())
        self.assertEqual(existing.read_bytes(), b'unrelated')


if __name__ == '__main__':
    unittest.main()
