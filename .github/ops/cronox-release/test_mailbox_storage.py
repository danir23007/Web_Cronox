import contextlib
import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import mailbox_storage as storage

UUID = '00000000-0000-4000-8000-000000000001'


@unittest.skipUnless(os.name == 'posix', 'Linux descriptors, owners and permission modes')
class StorageTests(unittest.TestCase):
    @contextlib.contextmanager
    def fixture(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
            root = Path(folder, 'mailboxes')
            root.mkdir(mode=0o700)
            for suffix in ('', '.meta'):
                file = root / (UUID + suffix)
                file.write_bytes(b'synthetic encrypted fixture; not a real message')
                file.chmod(0o600)
            snapshot = Path(folder, 'snapshot')
            user = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
            stack.enter_context(patch.object(storage, 'ROOT', root))
            stack.enter_context(patch.object(storage, 'SNAPSHOT', snapshot))
            stack.enter_context(patch.object(storage, 'trusted_parents'))
            stack.enter_context(patch.object(storage, 'quiesced'))
            stack.enter_context(patch.object(storage, 'deploy_user', return_value=user))
            probe = stack.enter_context(patch.object(storage, 'probe_as_deploy'))
            yield root, snapshot, user, probe

    def test_ownership_guard_rejects_wrong_uid_without_mutation(self):
        with self.fixture() as (root, _, user, probe):
            with self.assertRaisesRegex(storage.StorageRefused, 'OWNER'):
                with storage.opened_storage(user.pw_uid + 1, user.pw_gid):
                    pass
            self.assertEqual(root.stat().st_uid, user.pw_uid)
            probe.assert_not_called()

    def test_bad_config_rejected_before_storage_or_access_probe(self):
        with self.fixture() as (_, _, _, probe):
            with self.assertRaisesRegex(storage.StorageRefused, 'PRIVATE_DIR'):
                storage.check('/another/directory')
            probe.assert_not_called()

    def test_check_needs_actual_deploy_probe_success(self):
        with self.fixture() as (root, _, _, probe):
            probe.side_effect = storage.StorageRefused('DEPLOY_STORAGE_ACCESS_FAILED')
            with self.assertRaisesRegex(storage.StorageRefused, 'DEPLOY_STORAGE_ACCESS'):
                storage.check(str(root))

    def test_rejects_symlinks_hardlinks_directories_and_unknown_names(self):
        for kind in ('symlink', 'hardlink', 'directory', 'name'):
            with self.subTest(kind=kind), self.fixture() as (root, snapshot, user, _):
                bad = root / '00000000-0000-4000-8000-000000000002'
                if kind == 'symlink':
                    bad.symlink_to(root / UUID)
                elif kind == 'hardlink':
                    os.link(root / UUID, bad)
                elif kind == 'directory':
                    bad.mkdir(mode=0o700)
                else:
                    (root / 'unexpected-name').write_bytes(b'fixture')
                with self.assertRaises((storage.StorageRefused, OSError)):
                    storage.apply()
                self.assertFalse(snapshot.exists())

    def test_root_symlink_is_refused(self):
        with self.fixture() as (root, _, user, _):
            linked = root.with_name('linked')
            linked.symlink_to(root, target_is_directory=True)
            with patch.object(storage, 'ROOT', linked), self.assertRaises(OSError):
                with storage.opened_storage(user.pw_uid, user.pw_gid):
                    pass

    def test_nonprivate_modes_and_acls_need_separate_review(self):
        with self.fixture() as (root, snapshot, user, _):
            (root / UUID).chmod(0o666)
            with self.assertRaisesRegex(storage.StorageRefused, 'MODE'):
                storage.apply()
            self.assertFalse(snapshot.exists())
            (root / UUID).chmod(0o600)
            with patch.object(os, 'listxattr', return_value=['system.posix_acl_access']):
                with self.assertRaisesRegex(storage.StorageRefused, 'ACL'):
                    storage.apply()
            self.assertFalse(snapshot.exists())

    def test_metadata_repair_and_rollback_preserve_bytes_and_inode(self):
        with self.fixture() as (root, snapshot, user, probe):
            upload = root / 'uploads'
            upload.mkdir(mode=0o700)
            file = upload / (UUID + '.upload')
            file.write_bytes(b'synthetic upload')
            file.chmod(0o644)
            before = {str(p.relative_to(root)): (p.stat().st_ino, hashlib.sha256(p.read_bytes()).hexdigest())
                      for p in root.rglob('*') if p.is_file()}
            storage.apply()
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(snapshot.stat().st_mode & 0o777, 0o700)
            self.assertEqual((snapshot / 'metadata.json').stat().st_mode & 0o777, 0o600)
            probe.assert_called_once_with(user.pw_uid, user.pw_gid)
            with self.assertRaisesRegex(storage.StorageRefused, 'SNAPSHOT_ALREADY'):
                storage.apply()
            storage.rollback()
            self.assertEqual(file.stat().st_mode & 0o777, 0o644)
            after = {str(p.relative_to(root)): (p.stat().st_ino, hashlib.sha256(p.read_bytes()).hexdigest())
                     for p in root.rglob('*') if p.is_file()}
            self.assertEqual(before, after)

    def test_rollback_refuses_changed_inventory_or_replaced_inode(self):
        for change in ('new', 'replaced'):
            with self.subTest(change=change), self.fixture() as (root, _, _, _):
                storage.apply()
                if change == 'new':
                    file = root / '00000000-0000-4000-8000-000000000002'
                else:
                    file = root / UUID
                    file.rename(root.with_name('old-fixture'))
                file.write_bytes(b'new content must remain')
                file.chmod(0o600)
                with self.assertRaisesRegex(storage.StorageRefused, 'ROLLBACK_'):
                    storage.rollback()
                self.assertEqual(file.read_bytes(), b'new content must remain')

    def test_interruption_retains_snapshot_and_can_restore_partial_metadata(self):
        with self.fixture() as (root, snapshot, _, _):
            upload = root / 'uploads'
            upload.mkdir(mode=0o700)
            file = upload / (UUID + '.upload')
            file.write_bytes(b'fixture')
            file.chmod(0o644)
            chmod = os.fchmod
            calls = []
            def interrupted(fd, mode):
                calls.append(mode)
                if len(calls) == 2:
                    raise KeyboardInterrupt()
                chmod(fd, mode)
            with patch.object(os, 'fchmod', side_effect=interrupted):
                with self.assertRaises(KeyboardInterrupt):
                    storage.apply()
            self.assertTrue((snapshot / 'metadata.json').is_file())
            storage.rollback()
            self.assertEqual(file.stat().st_mode & 0o777, 0o644)

    def test_inode_replacement_between_inspection_and_change_cannot_be_chowned(self):
        with self.fixture() as (root, _, user, _):
            with storage.opened_storage(user.pw_uid, user.pw_gid, repair=True) as objects:
                file = root / UUID
                file.rename(root.with_name('old-fixture'))
                file.write_bytes(b'replacement')
                file.chmod(0o600)
                desired = {row['name']: dict(row) for row in objects}
                with self.assertRaisesRegex(storage.StorageRefused, 'CHANGED_DURING'):
                    storage.change(objects, desired)
                self.assertEqual(file.read_bytes(), b'replacement')

    def test_quiescence_uses_existing_deploy_daemon_and_rejects_writers(self):
        import socket
        for scenario in ('stopped', 'root-online', 'daemon-mismatch', 'app-online', 'listener', 'writer', 'watch', 'other-app'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
                base = Path(folder)
                pm, proc, flag = base / 'pm', base / 'proc', base / 'maintenance'
                pm.mkdir()
                (pm / 'pm2.pid').write_text('777')
                sock = stack.enter_context(socket.socket(socket.AF_UNIX))
                sock.bind(str(pm / 'rpc.sock'))
                (proc / '777/fd').mkdir(parents=True)
                (proc / '777/cmdline').write_bytes(b'PM2 God Daemon')
                (proc / '777/cwd').symlink_to('/')
                if scenario == 'writer':
                    (proc / '888/fd').mkdir(parents=True)
                    (proc / '888/cmdline').write_bytes(b'node main')
                    (proc / '888/cwd').symlink_to('/var/www/cronox/Web_Cronox/cronox-backend')
                flag.write_text('reviewed repair')
                user = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid(), pw_dir=str(base))
                def path(value):
                    text = str(value)
                    if text == '/var/lib/cronox-pm2':
                        return pm
                    if text == '/proc' or text.startswith('/proc/'):
                        return proc / text.removeprefix('/proc').lstrip('/')
                    return Path(value)
                app = {'name': 'cronox', 'pid': 0, 'pm2_env': {'status': 'stopped', 'watch': False,
                       'pm_exec_path': '/var/www/cronox/Web_Cronox/cronox-backend/dist/main.js',
                       'pm_cwd': '/var/www/cronox/Web_Cronox/cronox-backend'}}
                if scenario == 'app-online':
                    app.update(pid=88)
                    app['pm2_env']['status'] = 'online'
                if scenario == 'watch':
                    app['pm2_env']['watch'] = True
                def command(args, **kwargs):
                    self.assertNotIn('start', args)
                    self.assertNotIn('stop', args)
                    if 'pm2-root.service' in args:
                        out = b'active' if scenario == 'root-online' else b'inactive'
                    elif 'pm2-deploy.service' in args:
                        out = b'ActiveState=active\nMainPID=' + (b'999' if scenario == 'daemon-mismatch' else b'777')
                    elif 'jlist' in args:
                        out = json.dumps([app, app] if scenario == 'other-app' else [app]).encode()
                    else:
                        self.assertEqual(args[0], '/usr/bin/ss')
                        out = b'LISTEN 127.0.0.1:3000' if scenario == 'listener' else b''
                    return SimpleNamespace(returncode=0, stdout=out)
                stack.enter_context(patch.object(storage, 'Path', side_effect=path))
                stack.enter_context(patch.object(storage, 'FLAG', flag))
                stack.enter_context(patch.object(storage, 'trusted_parents'))
                stack.enter_context(patch.object(storage, 'deploy_user', return_value=user))
                stack.enter_context(patch.object(os, 'kill'))
                stack.enter_context(patch.object(storage.subprocess, 'run', side_effect=command))
                if scenario == 'stopped':
                    storage.quiesced()
                else:
                    with self.assertRaises(storage.StorageRefused):
                        storage.quiesced()


if __name__ == '__main__':
    unittest.main()
