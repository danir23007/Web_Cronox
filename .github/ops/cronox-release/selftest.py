#!/usr/bin/python3 -I
"""Administrator-only integration test. Two networkless containers, synthetic data only.
No production configuration is opened. Invoked BEFORE the bootstrap maintenance phase.
"""
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from controller import Runtime, REPO, Refused
from backup import backup_and_verify


class Fixture:
    image = staticmethod(Runtime.image)

    def __init__(self, folder):
        self.folder = Path(folder)
        self.sha = secrets.token_hex(20)
        self.source = 'cronox-fixture-' + self.sha[:16]
        self.app = self.folder / 'synthetic-application'
        self.app.mkdir()
        (self.app / 'fixture.txt').write_text('Synthetic application backup fixture\n')

    def command(self, args, *, input=None, timeout=120, output=None, **unused):
        args = list(args)
        if args[0] in ('/usr/bin/pg_dump', '/usr/bin/pg_dumpall'):
            args = ['/usr/bin/docker', 'exec', self.source, Path(args[0]).name,
                    '-U', 'supabase_admin', *args[1:]]
            if 'pg_dump' in args:
                args += ['-d', 'fixture']
        if args[0] == '/usr/bin/tar' and '-C' in args:
            assert args[args.index('-C') + 1] == str(REPO)
            args[args.index('-C') + 1] = str(self.app)
        with open(self.folder / 'selftest-private.log', 'ab') as log:
            if output:
                with open(output, 'xb') as stream:
                    p = subprocess.run(args, input=input, stdout=stream, stderr=log, timeout=timeout,
                                       env={'PATH': '/usr/bin:/bin', 'HOME': '/root'})
            else:
                p = subprocess.run(args, input=input, stdout=subprocess.PIPE, stderr=log, timeout=timeout,
                                   env={'PATH': '/usr/bin:/bin', 'HOME': '/root'})
            if p.returncode:
                raise Refused('ISOLATED_FIXTURE_COMMAND_FAILED')
            return p.stdout or b''

    def pg_env(self):
        return {}  # No production service profile, credentials or environment.

    def target(self, sql, database='fixture'):
        return self.command(['/usr/bin/docker', 'exec', '-i', self.source, 'psql', '-X', '-w', '-qAt',
                            '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=sql.encode())

    def pg(self, sql):
        return self.target('BEGIN READ ONLY;\n' + sql + '\nCOMMIT;')

    def run(self):
        credential = self.folder / 'fixture.env'
        credential.write_text('POSTGRES_PASSWORD=' + secrets.token_hex(32) + '\nPOSTGRES_DB=postgres\n')
        self.command(['/usr/bin/docker', 'run', '--pull', 'never', '-d', '--name', self.source, '--network', 'none',
                      '--restart', 'no', '--memory', '1g', '--cpus', '1', '--env-file', str(credential),
                      self.image(), 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'])
        try:
            for attempt in range(45):
                try:
                    self.command(['/usr/bin/docker', 'exec', self.source, 'pg_isready', '-U', 'postgres'])
                    break
                except Refused:
                    if attempt == 44:
                        raise
                    time.sleep(1)
            self.target('CREATE DATABASE fixture TEMPLATE template0 OWNER postgres;', 'postgres')
            self.target('''
CREATE SCHEMA graphql;
CREATE SCHEMA graphql_public;
CREATE EXTENSION pg_graphql WITH SCHEMA graphql;
CREATE OR REPLACE FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb)
RETURNS jsonb LANGUAGE sql AS $function$ SELECT '{}'::jsonb $function$;
ALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO supabase_admin;
ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);
CREATE TABLE public.release_fixture(id serial PRIMARY KEY, label text NOT NULL);
INSERT INTO public.release_fixture(label) VALUES ('synthetic one'), ('synthetic two');
ALTER TABLE public.release_fixture ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_policy ON public.release_fixture FOR SELECT TO postgres USING (id>0);
GRANT SELECT ON public.release_fixture TO postgres;
''')
            backup_and_verify(self)
            assert (self.folder / 'backup-verified.json').exists()
        finally:
            self.command(['/usr/bin/docker', 'rm', '-f', '-v', self.source])


if __name__ == '__main__':
    os.umask(0o077)
    if os.getuid() != 0:
        sys.exit('ADMINISTRATOR_REQUIRED_FOR_ISOLATED_DOCKER_TEST')
    # Preserve private diagnostics on failure, never dump raw SQL or fixture credentials.
    folder = tempfile.mkdtemp(prefix='cronox-isolated-selftest-', dir='/root')
    try:
        Fixture(folder).run()
        print('ISOLATED_BACKUP_RESTORE_VERIFIED')
    except BaseException:
        print('ISOLATED_SELFTEST_FAILED: no production changes; private diagnostics in ' + folder)
        sys.exit(1)
