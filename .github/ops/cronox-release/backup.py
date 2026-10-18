"""Logical backup + actual restore into the pinned, disconnected Supabase image."""
import hashlib
import json
from pathlib import Path
import re
import secrets
import time
from controller import Refused, require, atomic_json, REPO


def wait_for_final_postgres(rt, container, timeout=120):
    """Do not accept the temporary postmaster started by docker-entrypoint initdb.

    The pinned image execs the final postgres as PID 1 after stopping that server.
    Only readiness probes are retried; no DDL, restore or migration is replayed.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            rt.command(['/usr/bin/docker', 'exec', container, 'pg_isready',
                        '-h', '/var/run/postgresql', '-U', 'supabase_admin', '-d', 'postgres'], timeout=5)
            # Read the postmaster PID of the server serving this authenticated connection.
            # Supabase wraps the executable, so /proc/1/comm is not necessarily "postgres".
            ready = rt.command(['/usr/bin/docker', 'exec', container, 'psql', '-X', '-w', '-qAt',
                '-h', '/var/run/postgresql', '-U', 'supabase_admin', '-d', 'postgres',
                '-v', 'ON_ERROR_STOP=1', '-c',
                "BEGIN READ ONLY; SELECT split_part(pg_read_file('postmaster.pid'), chr(10), 1); COMMIT;"], timeout=5)
            if ready.strip() == b'1':
                return
        except Refused:
            pass
        time.sleep(1)
    raise Refused('FINAL_POSTGRES_START_TIMEOUT')


def compatible_roles(sql):
    pattern = r'^CREATE ROLE ((?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z_0-9]*));$'
    def wrap(m):
        return ('DO $cronox_role$ BEGIN CREATE ROLE ' + m[1] +
                '; EXCEPTION WHEN duplicate_object THEN NULL; END $cronox_role$;')
    result, count = re.subn(pattern, wrap, sql, flags=re.M)
    require(count > 0 and not re.search(r'^CREATE ROLE ', result, re.M), 'ROLE_EXPORT_FORMAT_CHANGED')
    return result


def insert_graphql(sql, function):
    anchor = 'CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;'
    if not function:
        require(anchor not in sql, 'GRAPHQL_PLATFORM_WRAPPER_MISSING')
        return sql
    require(sql.count(anchor) == 1 and sql.find('CREATE SCHEMA graphql_public;') >= 0
            and sql.find('CREATE SCHEMA graphql_public;') < sql.find(anchor), 'GRAPHQL_ANCHOR_CHANGED')
    require(function.startswith('CREATE OR REPLACE FUNCTION graphql_public.graphql('), 'GRAPHQL_FUNCTION_CHANGED')
    supplement = function.rstrip().rstrip(';') + ';\n'
    supplement += 'ALTER FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) OWNER TO supabase_admin;\n'
    supplement += 'ALTER EXTENSION pg_graphql ADD FUNCTION graphql_public.graphql(text,text,jsonb,jsonb);\n'
    return sql.replace(anchor, anchor + '\n' + supplement, 1)


CATALOG = """
SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind)
 ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p','S') AND n.nspname NOT IN ('pg_catalog','information_schema')
 AND n.nspname NOT LIKE 'pg_toast%';
"""
PERMISSIONS = """
SELECT json_build_object('kind','permissions','schema',n.nspname,'name',c.relname,
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',(SELECT json_agg(json_build_array(pg_get_userbyid(a.grantor),
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
 a.privilege_type,a.is_grantable) ORDER BY a.grantor::regrole::text,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
 a.privilege_type,a.is_grantable)
 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a))
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname;
SELECT json_build_object('kind','policy','definition',to_jsonb(p))
FROM pg_policies p WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT json_build_object('kind','extension','name',extname,'version',extversion)
FROM pg_extension ORDER BY extname;
"""


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def verification_sql(catalog):
    sql = "SET LOCAL TIME ZONE 'UTC';\n"
    for row in catalog:
        name = ident(row['schema']) + '.' + ident(row['name'])
        label = literal(row['schema'] + '.' + row['name'])
        if row['kind'] == 'S':
            sql += f"SELECT json_build_object('kind','sequence','name',{label},'value',last_value,'called',is_called) FROM {name};\n"
        else:
            sql += f"SELECT json_build_object('kind','table','name',{label},'rows',count(*),'digest',md5(coalesce(string_agg(h,'' ORDER BY h),''))) FROM (SELECT md5(row_to_json(t)::text) h FROM {name} t) q;\n"
    return sql + PERMISSIONS


def rows(data):
    return [json.loads(line) for line in data.decode().splitlines() if line.strip()]


def backup_and_verify(rt):
    folder = rt.folder
    container = 'cronox-verify-' + rt.sha[:16]
    env = rt.pg_env()
    # The private root directory never becomes a bind mount inside the container.
    rt.command(['/usr/bin/pg_dump', '-w', '--format=custom', '--lock-wait-timeout=15000'], env=env, timeout=600, output=folder / 'database.dump')
    roles = rt.command(['/usr/bin/pg_dumpall', '-w', '--roles-only', '--no-role-passwords'], env=env, timeout=120)
    (folder / 'roles.sql').write_bytes(roles)
    require((folder / 'database.dump').stat().st_size > 0 and len(roles) > 0, 'EMPTY_BACKUP')
    # Archive stdout is opened by root; tar itself reads the app only as deploy.
    rt.command(['/usr/bin/tar', '-czf', '-', '--exclude=.git', '--exclude=output',
                '-C', str(REPO), '.'], user=True, timeout=600, output=folder / 'application.tar.gz')
    rt.command(['/usr/bin/tar', '-tzf', str(folder / 'application.tar.gz')])
    rendered = rt.command(['/usr/bin/pg_restore', '--exit-on-error', '--file=-', str(folder / 'database.dump')], timeout=120).decode()
    function = rt.pg("SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='graphql_public' AND p.proname='graphql' AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_graphql');").decode().strip()
    (folder / 'graphql-function.sql').write_text(function, encoding='utf8')
    compatible = insert_graphql(rendered, function)
    (folder / 'restore.sql').write_text(compatible, encoding='utf8')
    (folder / 'roles.restore.sql').write_text(compatible_roles(roles.decode()), encoding='utf8')
    catalog = json.loads(rt.pg(CATALOG))
    check = verification_sql(catalog)
    (folder / 'verification.sql').write_text(check, encoding='utf8')
    source = rows(rt.pg(check))
    atomic_json(folder / 'source-verification.json', source)
    # Server major and extension versions are compared to this exact image.
    require(rt.pg("SELECT current_setting('server_version_num')::int / 10000;").strip() == b'17', 'RESTORE_IMAGE_MAJOR_MISMATCH')
    secret_file = folder / 'restore.env'
    secret_file.write_text('POSTGRES_PASSWORD=' + secrets.token_hex(32) + '\nPOSTGRES_DB=postgres\n')
    created = False
    def target(sql, database='cronox_restore_verify'):
        return rt.command(['/usr/bin/docker', 'exec', '-i', container, 'psql', '-X', '-w', '-qAt',
                           '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'],
                          input=sql.encode(), timeout=600)
    try:
        rt.command(['/usr/bin/docker', 'run', '--pull', 'never', '-d', '--name', container, '--network', 'none',
                    '--restart', 'no', '--memory', '1g', '--memory-swap', '1g', '--cpus', '1',
                    '--env-file', str(secret_file), rt.image(),
                    'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf'], timeout=120)
        created = True
        wait_for_final_postgres(rt, container)
        target('CREATE ROLE cronox_restore_operator LOGIN SUPERUSER;\nCREATE DATABASE cronox_restore_verify TEMPLATE template0 OWNER postgres;', 'postgres')
        target('BEGIN; SET LOCAL ROLE cronox_restore_operator;\n' + compatible_roles(roles.decode()) + '\nCOMMIT;')
        target('BEGIN; SET LOCAL ROLE cronox_restore_operator;\n' + compatible + '\nCOMMIT;')
        # pg_graphql's extension sequence is excluded from pg_dump configuration data.
        seq = [r for r in source if r.get('kind') == 'sequence' and r['name'] == 'graphql.seq_schema_version']
        if seq:
            require(len(seq) == 1 and type(seq[0]['value']) is int and type(seq[0]['called']) is bool, 'INVALID_GRAPHQL_SEQUENCE')
            seq_sql = "SELECT setval('graphql.seq_schema_version',%d,%s);" % (seq[0]['value'], str(seq[0]['called']).lower())
            (folder / 'graphql-sequence.sql').write_text(seq_sql)
            target(seq_sql)
        restored_catalog = json.loads(target('BEGIN READ ONLY;\n' + CATALOG + '\nCOMMIT;'))
        require(catalog == restored_catalog, 'RESTORE_OBJECT_SET_DIFFERS')
        restored = rows(target('BEGIN READ ONLY;\n' + check + '\nCOMMIT;'))
        atomic_json(folder / 'restore-verification.json', restored)
        require(source == restored, 'RESTORE_COMPARISON_FAILED')
        def digest(path):
            with path.open('rb') as stream:
                return hashlib.file_digest(stream, 'sha256').hexdigest()
        checksums = {p.name: digest(p) for p in folder.iterdir()
                     if p.name in ('database.dump','roles.sql','application.tar.gz','restore.sql',
                                   'graphql-function.sql','graphql-sequence.sql','roles.restore.sql','verification.sql')}
        atomic_json(folder / 'backup-sha256.json', checksums)
        atomic_json(folder / 'backup-verified.json', {'restoreCompared': True,
                    'tables': sum(r.get('kind') == 'table' for r in source),
                    'sequences': sum(r.get('kind') == 'sequence' for r in source),
                    'image': rt.image(), 'scope': 'logical database and application; not provider storage or encryption keys'})
    finally:
        # Never delete another container or named volume; failed restore evidence stays private.
        if created:
            rt.command(['/usr/bin/docker', 'rm', '-f', '-v', container], timeout=30)
