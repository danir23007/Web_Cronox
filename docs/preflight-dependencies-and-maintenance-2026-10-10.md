# Preflight aislado y mantenimiento pendiente de CRONOX

## Resultado comprobado el 10/10/2026

La corrección está revisada y autorizada para commit/push por el propietario. El workflow `Deploy CRONOX` se ha suspendido (`disabled_manually`) antes del push para no intentar un despliegue con mantenimiento pendiente. El bootstrap obtiene los archivos del SHA exacto entrante, instala el paquete dedicado `.github/preflight` mediante `npm ci --ignore-scripts --no-audit --no-fund` en un directorio temporal 0700, ejecuta el guard con el archivo de entorno de la aplicación y elimina el directorio temporal. No instala nada dentro de la aplicación activa ni cambia `package.json`/lockfile del backend. El `pg` del backend ya estaba fijado correctamente a 8.23.1; faltaba hacerlo disponible antes del preflight. El paquete dedicado fija también `dotenv` a 16.6.1, igual que el lockfile del backend.

Pruebas: `node --test .github/scripts/run-release-preflight.spec.cjs cronox-backend/scripts/check-user-numbering-release.spec.cjs`: cinco aprobadas. Incluyen una instalación npm real aislada, carga de las versiones exactas, lectura del entorno externo, propagación de fallo de readiness, fallo de instalación antes del guard y orden antes de merge/migrate/restart. Sintaxis Bash verificada.

En el VPS se comprobó la misma corrección con una instantánea Git privada de los archivos revisados, fuera del checkout activo (no es un commit de la rama de CRONOX):

```text
added 15 packages
PREFLIGHT_DEPENDENCIES_READY pg=8.23.1 dotenv=16.6.1
Controlled user numbering is not complete. Stop deployment and follow docs/user-numbering-2026-10-08.md...
PREFLIGHT_EXIT=1
APPLICATION_MANIFESTS_UNCHANGED
APPLICATION_PG_STILL_ABSENT
UNRELATED_FILE_PRESERVED
```

Por tanto, el error de dependencias queda resuelto; el requisito real de mantenimiento permanece. Consultas `BEGIN READ ONLY` confirmaron que no existen `UserNumberingState`, `User.identityUid` ni `cronox_user_number_plan()`. Hay cero migraciones fallidas y exactamente estas cinco pendientes:

- `20261008190000_consecutive_user_numbers`
- `20261009010000_user_numbering_base_tables`
- `20261009011000_daily_visitor_user_update_cascade`
- `20261009020000_retired_user_references`
- `20261009023000_deleted_account_order_history`

El usuario `deploy` tiene exclusivamente estos permisos sudo:

```text
(root) NOPASSWD: /usr/bin/pm2 restart cronox, /usr/bin/pm2 save
```

Faltan privilegios del propietario para editar `/etc/nginx/sites-available/cronox`, recargar Nginx, inspeccionar/parar el PM2 de root (`pm2 list`, `pm2 stop cronox`) y detener cualquier otro escritor identificado. No se pide ampliar sudo ni compartir credenciales en el chat. Tampoco hay `DIRECT_URL` o `USER_NUMBERING_DATABASE_URL` configuradas; el propietario debe seleccionar privadamente una conexión PostgreSQL directa/de sesión autorizada a la misma base, apropiada para exportar/restaurar snapshots y migrar.

## Alcance de las cinco migraciones pendientes

| Migración | Qué modifica | Mantenimiento |
| --- | --- | --- |
| `20261008190000_consecutive_user_numbers` | Añade UUID estable a usuarios, registro de identidades/tokens, estado y auditoría de numeración; adapta relaciones y autoría de notas; crea funciones y triggers de asignación, bloqueo y compactación. | Sí: cambia el protocolo de escritura y deja `ready=false` hasta la operación controlada. |
| `20261009010000_user_numbering_base_tables` | Sustituye la función de compactación para trabajar con tablas base, evitando remapear vistas dos veces. | Misma ventana; no ejecuta por sí sola la compactación. |
| `20261009011000_daily_visitor_user_update_cascade` | Cambia la FK de `DailyVisitor.userId` a `ON UPDATE CASCADE`, conservando `ON DELETE SET NULL`. | Misma ventana; prepara la conservación del historial al renumerar. |
| `20261009020000_retired_user_references` | Crea el archivo privado de referencias retiradas, funciones y trigger; actualiza la compactación para archivar referencias huérfanas y evitar atribuirlas a otra cuenta. | Misma ventana; modifica reglas de borrado y compactación. |
| `20261009023000_deleted_account_order_history` | Conserva pedidos y snapshots al borrar una cuenta (`SET NULL` y `UPDATE CASCADE`); archiva atribuciones, desactiva promociones de cuentas retiradas y bloquea borrar cuentas con checkout sin resolver. | Misma ventana; modifica integridad y reglas de borrado. |

Se aplicarán juntas, con escritores detenidos y respaldo recuperable comprobado. `migrate deploy` prepara el esquema; no renumera las cuentas existentes. La renumeración se realiza después mediante el operador documentado, con un segundo respaldo y mapa revisado; revoca sesiones y actualiza referencias. El cambio de precio editable no necesita una migración propia: estas cinco pertenecen al trabajo previo de numeración.

## Comprobación inicial de la terminal del propietario

En hPanel, abrir VPS, seleccionar el servidor de CRONOX y abrir Terminal/Browser terminal. Ejecutar solamente:

```bash
whoami
id
if [ "$(id -u)" -ne 0 ]; then
  sudo -n -l
fi
```

Compartir el resultado sin contraseñas, claves ni archivos de entorno. Si UID no es 0, revisar los permisos exactos antes de proponer cualquier paso administrativo. Estos comandos son de inspección y no cambian servicios ni datos. La guía interactiva se detiene aquí hasta recibir el resultado.

## Secuencia exacta para el propietario

Este procedimiento completa el ya documentado en `docs/user-numbering-2026-10-08.md`. No ejecutar la fase de cambios hasta que mantenimiento y parada de **todos** los escritores estén comprobados. El respaldo preliminar del 9 de octubre no sustituye los dos respaldos nuevos de esta ventana. No resetear datos, borrar cuentas, modificar stock ni crear pedidos.

### 1. Suspender el despliegue automático

En la terminal del propietario con GitHub CLI ya autenticado, o mediante Disable workflow en GitHub Actions:

```bash
gh workflow disable deploy.yml --repo danir23007/Web_Cronox
gh run list --workflow deploy.yml --repo danir23007/Web_Cronox
```

Si hay un despliegue en curso, esperar a que termine o cancelarlo **antes** de la ventana. No iniciar en paralelo una migración manual y un workflow.

### 2. Mantenimiento y parada, en una sesión administrativa del VPS

El vhost comprobado es `/etc/nginx/sites-available/cronox`, enlazado desde `sites-enabled/cronox`; contiene dos declaraciones `server_name cronox.es www.cronox.es;`. Estos comandos se ejecutan como propietario/root, no mediante el sudo limitado de `deploy`:

```bash
set -euo pipefail
umask 077
maintenance_backup=$(mktemp -d /root/cronox-maintenance.XXXXXXXX)
cp -a /etc/nginx/sites-available/cronox "$maintenance_backup/nginx.conf.before"
install -d -m 755 /var/lib/cronox
touch /var/lib/cronox/maintenance.flag
python3 - <<'PY'
from pathlib import Path
p = Path('/etc/nginx/sites-available/cronox')
s = p.read_text()
needle = 'server_name cronox.es www.cronox.es;'
guard = 'if (-f /var/lib/cronox/maintenance.flag) { return 503; }'
if guard not in s:
    if s.count(needle) != 2:
        raise SystemExit('El vhost ha cambiado: revisar antes de editar')
    p.write_text(s.replace(needle, needle + '\n    ' + guard))
PY
if ! nginx -t; then
  cp -a "$maintenance_backup/nginx.conf.before" /etc/nginx/sites-available/cronox
  nginx -t
  exit 1
fi
systemctl reload nginx
test "$(curl --silent --output /dev/null --write-out '%{http_code}' https://cronox.es/api/health)" = 503
pm2 list
pm2 stop cronox
pm2 list
systemctl list-timers --all
crontab -l || true
crontab -u deploy -l || true
```

El 503 permite reintentos de webhooks y bloquea nuevos accesos públicos. Revisar las listas privadamente: si existen otros procesos, cron/timers, jobs de base o integraciones externas capaces de escribir, el propietario debe detenerlos y comprobar su parada. Sus nombres y permisos no se pueden inventar desde el acceso actual. **No continuar si no puede garantizarse ese bloqueo.** No volver a arrancar el código antiguo con el esquema renumerado.

### 3. Preparar una copia privada de la revisión aprobada, como deploy

La revisión base publicada que contiene la numeración y el precio editable es `17e4552d6c3df2d5e83424520cdf59c484a44d1f`. La copia siguiente no cambia el checkout activo ni sus dependencias o archivos ajenos:

```bash
set -euo pipefail
umask 077
repo=/var/www/cronox/Web_Cronox
release=17e4552d6c3df2d5e83424520cdf59c484a44d1f
git -C "$repo" fetch origin main
stage=$(mktemp -d /home/deploy/cronox-maintenance-source.XXXXXXXX)
git -C "$repo" archive "$release" -- .github cronox-backend cronox-front package.json package-lock.json vite.admin.config.ts tsconfig.admin.json | tar -xf - -C "$stage"
cd "$stage"
npm ci
cd cronox-backend
npm ci
export DOTENV_CONFIG_PATH="$repo/cronox-backend/.env"
read -r -s -p 'Conexión PostgreSQL directa/sesión autorizada, solo en este VPS: ' DIRECT_URL
printf '\n'
export DIRECT_URL
export USER_NUMBERING_DATABASE_URL="$DIRECT_URL"
export DATABASE_URL="$DIRECT_URL"
pg_bin="$stage/pg-tools"
mkdir -m 700 "$pg_bin"
for tool in initdb pg_ctl; do
  ln -s "/tmp/cronox-session-pg/unpacked/usr/lib/postgresql/18/bin/$tool" "$pg_bin/$tool"
done
for tool in pg_dump pg_restore psql; do
  ln -s "/usr/bin/$tool" "$pg_bin/$tool"
done
"$pg_bin/initdb" --version
"$pg_bin/pg_dump" --version
set +e
npx prisma migrate status
migration_status=$?
set -e
printf 'migrate status exit=%s\n' "$migration_status"
```

Se comprobó PostgreSQL 18.6 y la presencia de `initdb`/`pg_ctl` en esa instalación aislada. Los clientes existen en `/usr/bin`, pero faltan dentro del binario descomprimido; el directorio privado de enlaces evita ese fallo en el operador de respaldo. La restauración real posterior debe aprobar, no basta con las versiones. Revisar privadamente que la conexión sea la misma base autorizada. El estado pendiente puede devolver 1; este paso solo inspecciona y no autoriza continuar ante errores de conexión u otro fallo. `migrate status` debe mostrar únicamente las cinco migraciones enumeradas; si muestra otras, parar y revisarlas.

### 4. Primer respaldo y restauración, antes del esquema

Mantener escritores detenidos y mantenimiento activo. En la misma sesión deploy y directorio `"$stage/cronox-backend"`:

```bash
backup_parent=$(mktemp -d /home/deploy/cronox-numbering-window.XXXXXXXX)
backup_before="$backup_parent/before-schema"
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --prepare --directory="$backup_before" --pg-bin="$pg_bin"
node scripts/verify-user-numbering-backup.cjs --directory="$backup_before" --pg-bin="$pg_bin"
```

Revisar `plan.json` privadamente: mapa completo, total real y hash. Exigir restauración aprobada. Conservar este respaldo fuera del webroot; no enviarlo al chat ni a Git.

### 5. Preparar esquema y construir, sin arrancar aplicación

```bash
npx prisma generate
npx prisma migrate deploy
npm run build:compiled
cd "$stage"
npm run admin:build
cd cronox-backend
```

No usar reset ni db push en producción. Si falla alguna migración o compilación, detenerse con mantenimiento activo.

### 6. Segundo respaldo/restauración y aplicación controlada

```bash
backup_apply="$backup_parent/before-numbering"
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --prepare --directory="$backup_apply" --pg-bin="$pg_bin"
node scripts/verify-user-numbering-backup.cjs --directory="$backup_apply" --pg-bin="$pg_bin"
expected_users=$(node -p 'require(process.argv[1]).total' "$backup_apply/plan.json")
```

Revisar nuevamente todo el mapa/titularidad y el total real. No fijar 42 sin comprobarlo, no reutilizar el primer plan, no modificar `restoreVerified`. Solo con todas las verificaciones aprobadas y los escritores todavía detenidos:

```bash
node -r dotenv/config scripts/user-numbering.cjs --connection-env=DIRECT_URL --production-maintenance --apply --directory="$backup_apply" --expect-users="$expected_users"
node -r dotenv/config scripts/check-user-numbering-release.cjs --deployment-check
```

El resultado requerido es `USER_NUMBERING_RELEASE_READY`. Comunicar ese resultado y que mantenimiento/parada siguen activos, sin revelar conexión ni respaldos. Si falla, no arrancar el código antiguo ni omitir el guard. La recuperación se realiza primero sobre una base vacía aislada, conservando los respaldos y revisando titularidad; no restaurar a ciegas encima de nuevas escrituras.

### 7. Publicar la corrección y desplegar la revisión compatible

La corrección del preflight se publica en Git antes del mantenimiento, con el workflow deshabilitado. Una vez cumplida la fase anterior y obtenido `USER_NUMBERING_RELEASE_READY`, reactivar y despachar el workflow para el SHA aprobado:

```bash
gh workflow enable deploy.yml --repo danir23007/Web_Cronox
gh workflow run deploy.yml --ref main --repo danir23007/Web_Cronox
gh run list --workflow deploy.yml --repo danir23007/Web_Cronox
```

No despachar dos despliegues del mismo SHA. Supervisar `verify-release` y `deploy`; exigir `DEPLOYED_COMMIT` igual al SHA aprobado. El flujo normal conserva archivos ajenos mediante `git merge --ff-only`, instala dependencias de la nueva revisión cuando el guard ya ha aprobado, comprueba de nuevo readiness, ejecuta `migrate deploy` y reinicia PM2. Ese reinicio ya arrancará código compatible, no la revisión antigua.

### 8. Verificación y reapertura, como propietario

Antes de retirar mantenimiento, comprobar el SHA instalado y los recursos internos:

```bash
git -C /var/www/cronox/Web_Cronox rev-parse HEAD
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
curl --fail --silent http://127.0.0.1:3000/api/products >/dev/null
curl --fail --silent http://127.0.0.1:3000/admin-user.html | grep 'assets/admin-user.js?v=6'
curl --fail --silent 'http://127.0.0.1:3000/assets/admin-user.js?v=6' | grep 'data-manual-price' >/dev/null
```

Verificar además numeración/titularidad frente al manifiesto privado y revocación de sesiones antiguas según el procedimiento principal. Si todo aprueba, en la sesión root:

```bash
rm /var/lib/cronox/maintenance.flag
curl --fail https://cronox.es/api/health
curl --fail https://cronox.es/api/ready
curl --fail --silent https://cronox.es/api/products >/dev/null
curl --fail --silent https://cronox.es/admin-user.html | grep 'assets/admin-user.js?v=6'
curl --fail --silent 'https://cronox.es/assets/admin-user.js?v=6' | grep 'data-manual-price' >/dev/null
pm2 save
```

Solo entonces reanudar cualquier otro escritor detenido por el propietario. El guard Nginx puede permanecer instalado sin su marcador; no se desactiva ninguna protección de despliegue. No probar creando pedidos ni cambiando stock.

## Estado de publicación

Los requisitos de mantenimiento siguen sin cumplirse con el acceso disponible. El propietario ha autorizado commit/push de la corrección antes del mantenimiento. El workflow está suspendido y no se lanza otro despliegue destinado a fallar por el requisito real. La revisión instalada conocida sigue siendo `b5a2b66bebc40e95661e5f486d45271bad21bc3f`; no se declara publicado el precio editable. El chequeo TypeScript global mantiene los cinco errores preexistentes documentados y no se declara aprobado.


Comprobación final de producción (2026-10-10, 01:31 Europe/Madrid): health y ready devuelven HTTP 200 con `{"ok":true}`; catálogo, HTML y asset devuelven 200. El HTML no referencia v6 y el JavaScript servido no contiene `data-manual-price`. El SHA instalado sigue siendo `b5a2b66bebc40e95661e5f486d45271bad21bc3f`. El workflow `38003020828` permanece terminado con fallo; no se ha lanzado otro despliegue ni se ha modificado pedido/stock alguno.
