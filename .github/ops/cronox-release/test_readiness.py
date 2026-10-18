import unittest
from unittest.mock import patch
from backup import wait_for_final_postgres
from controller import Refused


class ReadinessTests(unittest.TestCase):
    def test_temporary_server_accepting_connections_does_not_pass_readiness(self):
        class Runtime:
            def __init__(self):
                self.polls = 0
            def command(self, args, **kwargs):
                if 'psql' in args:
                    assert 'BEGIN READ ONLY' in args[-1]
                    assert "pg_read_file('postmaster.pid')" in args[-1]
                    self.polls += 1
                    return b'52\n' if self.polls < 3 else b'1\n'
                return b'accepting connections\n'
        rt = Runtime()
        with patch('backup.time.sleep'):
            wait_for_final_postgres(rt, 'synthetic')
        self.assertEqual(rt.polls, 3)

    def test_final_server_must_also_pass_authenticated_query(self):
        class Runtime:
            attempts = 0
            def command(self, args, **kwargs):
                if 'psql' in args:
                    self.attempts += 1
                    if self.attempts == 1:
                        raise Refused('STARTING')
                    return b'1\n'
                return b''
        rt = Runtime()
        with patch('backup.time.sleep'):
            wait_for_final_postgres(rt, 'synthetic')
        self.assertEqual(rt.attempts, 2)

    def test_missing_or_nonfinal_postmaster_pid_times_out(self):
        class Runtime:
            def command(self, args, **kwargs):
                return b'52\n' if 'psql' in args else b''
        with patch('backup.time.monotonic', side_effect=[0, 0, 121]), patch('backup.time.sleep'):
            with self.assertRaisesRegex(Refused, 'FINAL_POSTGRES_START_TIMEOUT'):
                wait_for_final_postgres(Runtime(), 'synthetic')
