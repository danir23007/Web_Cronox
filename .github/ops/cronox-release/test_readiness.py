import unittest
from unittest.mock import patch
from backup import wait_for_final_postgres
from controller import Refused


class ReadinessTests(unittest.TestCase):
    def test_temporary_server_is_never_queried_even_if_it_would_accept_connections(self):
        class Runtime:
            def __init__(self):
                self.polls = 0
                self.sql = 0
            def command(self, args, **kwargs):
                if 'cat' in args:
                    self.polls += 1
                    return b'bash\n' if self.polls < 3 else b'postgres\n'
                assert self.polls == 3
                if 'psql' in args:
                    self.sql += 1
                    return b'1\n'
                return b'accepting connections\n'
        rt = Runtime()
        with patch('backup.time.sleep'):
            wait_for_final_postgres(rt, 'synthetic')
        self.assertEqual(rt.polls, 3)
        self.assertEqual(rt.sql, 1)

    def test_final_server_must_also_pass_authenticated_query(self):
        class Runtime:
            attempts = 0
            def command(self, args, **kwargs):
                if 'cat' in args:
                    return b'postgres\n'
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

    def test_unknown_pid_one_times_out_without_running_sql(self):
        class Runtime:
            def command(self, args, **kwargs):
                assert 'cat' in args
                return b'unknown-wrapper\n'
        with patch('backup.time.monotonic', side_effect=[0, 0, 121]), patch('backup.time.sleep'):
            with self.assertRaisesRegex(Refused, 'FINAL_POSTGRES_START_TIMEOUT'):
                wait_for_final_postgres(Runtime(), 'synthetic')
