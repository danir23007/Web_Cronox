# Procedimiento root para preparar el mantenimiento de estados de clientes

La ventana autorizada ya se ejecutó y cerró el 14/10/2026. Ver [informe de publicación conjunta](joint-checkout-account-release-2026-10-14.md). Los bloques de este documento son el registro del procedimiento preparado, no pasos pendientes para volver a ejecutarlos.

Preparación del 14/10/2026. **Ejecutar ahora únicamente la inspección de solo lectura.** Los bloques de interrupción y recuperación son para la futura ventana coordinada, todavía no autorizada. No se ha parado ningún servicio, cambiado cortafuegos, migrado, hecho commit/push ni desplegado. Se conserva el trabajo de checkout y estados.

## Acceso y hechos comprobados

### Inspección root recibida posteriormente (14/10/2026, 05:26 Europe/Madrid)

El titular ejecutó únicamente el bloque filtrado de lectura y entregó sus resultados:

- UID 0 en `srv1972361`, mismo commit `aeb3e38`, sin flag de mantenimiento.
- PM2 root: una sola aplicación `cronox`, ID 0, una instancia fork, online, cwd y script esperados, `watch:false`, `autorestart:true`; no aparece `cron_restart` definido. PID observado 383714: solo referencia histórica, no objetivo para un kill futuro.
- PM2 de deploy sin aplicaciones. `pm2-root.service` sigue inactive/dead; el daemon real y su aplicación sí están activos.
- UFW **inactive**. nft no devuelve cadenas ni candidatos de reglas 3000 en el informe filtrado. Por tanto, la rama UFW antes propuesta queda descartada; no habilitar UFW.
- Crontabs personales sin entradas enumeradas; cron global y directorios periódicos muestran tareas del sistema (certbot, discos, apt/monarx, logrotate, man-db). No aparece un escritor CRONOX separado. Los timers son del sistema. No hay que parar cron ni esos servicios por el mero hecho de existir.
- La lista de procesos contiene el backend, daemons PM2, Nginx, sesiones shell y el Node de la propia inspección; no muestra otro worker Node permanente. Esto no acredita ausencia de escritores externos a este VPS.

Verificación adicional de lectura como deploy: nftables v1.1.6; iptables e ip6tables v1.8.11 usan backend **nf_tables**, no legacy. Hay dirección IPv6 global en `eth0`, además de IPv4. El bloqueo temporal propuesto debe cubrir ambas familias. La sesión bash de deploy observada pertenece a una sesión SSH y no contiene `deploy.sh` ni `migrate deploy`; no es motivo para matarla.

Alternativa preparada: **crear durante la futura ventana una tabla nft temporal nueva**, `inet cronox_account_maintenance`, con cadena input de prioridad -10/política accept y una única regla `iifname != "lo" tcp dport 3000 counter drop`. Es un nombre propuesto para un recurso nuevo, no una tabla que se afirme existente. No cambia SSH, 80/443 ni las reglas anteriores; mantiene loopback y cubre IPv4/IPv6. La tabla solo se podrá eliminar como recuperación si se acredita que la creó esta ventana. No persistirla ni vaciar el ruleset global.

**Chequeo root recibido y aprobado:** `nameAvailable:true`, `checkPassed:true`, `exitCode:0`, `changesApplied:false`, para la tabla nueva `cronox_account_maintenance` y cadena `input_guard`. El kernel aceptó el chequeo `nft --check --file -`; no se ha creado tabla ni aplicado una regla. Queda cerrada la selección/validación previa de la rama nft, sin exigir repetir toda la inspección. Esto no valida todavía su efecto real sobre conexiones externas y loopback: se comprobará al aplicarla en la futura ventana autorizada. Las condiciones de paquete, recuperación y coordinación siguen siendo previas a cualquier interrupción.

En la cuenta autorizada de Hostinger: **hPanel → VPS → servidor con IP 69.62.109.75 → Browser terminal / Web Console**. Abrir la consola del VPS, no la del hosting web. [Instrucciones oficiales de Hostinger](https://www.hostinger.com/support/how-to-use-the-web-console-in-hostinger/). Autenticarse allí con el método autorizado; no compartir credenciales ni sustituir la autorización root por el sudo limitado de `deploy`.

En esa consola, ejecutar:

```bash
id -u
id -un
hostname
git -C /var/www/cronox/Web_Cronox rev-parse HEAD
```

Se necesita UID `0` y usuario `root`. Si no se obtiene, detenerse en esta inspección y comunicar únicamente UID/usuario; no ejecutar cambios ni intentar eludir permisos.

Comprobado por SSH de solo lectura como `deploy`:

- Código publicado `aeb3e38a679a2d69236bd0c09e650beaa4c62140` en `/var/www/cronox/Web_Cronox`.
- Backend `/var/www/cronox/Web_Cronox/cronox-backend/dist/main.js`, aplicación PM2 `cronox` de root; `/usr/bin/pm2` apunta a `/usr/lib/node_modules/pm2/bin/pm2`.
- Directorios de PM2 `/root/.pm2` y `/home/deploy/.pm2`; el primero no es legible por `deploy`. Confirmar sus daemons y registros desde root antes de operar.
- `pm2-root.service` existe y está **inactive/dead**, aunque el backend corre. `systemctl stop pm2-root.service` por sí solo no acredita su parada.
- Nginx activo, vhost `/etc/nginx/sites-available/cronox`, enlazado desde `/etc/nginx/sites-enabled/cronox`. Los dos servidores de `cronox.es`/`www.cronox.es` contienen `if (-f /var/lib/cronox/maintenance.flag) { return 503; }`.
- `/var/lib/cronox/maintenance.flag` no existe. Salud y disponibilidad locales HTTP 200. No hace falta volver a añadir ese guard al archivo de Nginx.
- **El backend escucha en 0.0.0.0:3000 y `http://69.62.109.75:3000/api/health` devolvió 200 desde este equipo.** El flag de Nginx no bloquea esta entrada directa. La interfaz de la ruta IPv4 predeterminada es `eth0`; UFW 0.36.2 y nft están instalados, pero su política efectiva requiere root.
- `cron.service` activo, sin crontab de `deploy`. `/etc/cron.d` legible: certbot, e2scrub_all y monarx-update, sin mención de CRONOX. No se afirma que estos sean escritores de cuentas.
- Timers enumerados: tareas del sistema apt, certbot, sysstat, logrotate, dpkg-db-backup, actualización, limpieza y discos; ninguno se llama CRONOX. Esto no sustituye revisar sus ejecutables, root cron y scripts externos.
- No hay `pg_cron` instalado en la base consultada. La base de aplicación es remota de Supabase: no hay que parar PostgreSQL ni el VPS completo.

## A. Inspección de solo lectura — ejecutable ahora

### A1. PM2, con salida limitada y sin secretos

Pegar este bloque completo en la consola root. No imprime el JSON completo de PM2, variables privadas, argumentos ni logs de clientes. Comprueba que el daemon exista antes de consultar cada instancia; no crea una instancia PM2 para suplir una ausente.

```bash
/usr/bin/node <<'NODE'
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
if (process.getuid() !== 0) throw Error('ROOT_REQUIRED');
for (const [owner, home] of [['root','/root/.pm2'],['deploy','/home/deploy/.pm2']]) {
  try {
    const daemon = Number(fs.readFileSync(home+'/pm2.pid','utf8').trim());
    if (!Number.isSafeInteger(daemon) || daemon < 1) throw Error('NO_DAEMON');
    process.kill(daemon,0);
    const command = fs.readFileSync('/proc/'+daemon+'/cmdline','utf8');
    if (!command.includes('PM2') || !fs.existsSync(home+'/rpc.sock')) throw Error('UNCONFIRMED_DAEMON');
    const args = owner === 'root'
      ? ['jlist']
      : ['-u','deploy','--','env','PM2_HOME='+home,'/usr/bin/pm2','jlist'];
    const r = spawnSync(owner === 'root' ? '/usr/bin/pm2' : '/usr/sbin/runuser',args,
      {encoding:'utf8',env:{...process.env,PM2_HOME:home},timeout:10000});
    if (r.status !== 0) throw Error('PM2_QUERY_FAILED');
    const apps = JSON.parse(r.stdout).map(p=>({owner,home,name:p.name,id:p.pm_id,pid:p.pid,
      status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path,
      mode:p.pm2_env.exec_mode,watch:p.pm2_env.watch,cronRestart:p.pm2_env.cron_restart,
      autorestart:p.pm2_env.autorestart,killTimeout:p.pm2_env.kill_timeout}));
    console.log(JSON.stringify({owner,daemon,apps},null,2));
  } catch (e) {console.log(JSON.stringify({owner,inspection:'unavailable',reason:e.code||e.message}));}
}
NODE
```

Resultado necesario: lista `apps` de ambas instancias, en particular `cronox` con su script/cwd, número de instancias, `watch`, `cronRestart` y `killTimeout`. Si aparece otro worker, se determina su función antes de parar nada. No compartir `pm2 jlist` sin filtrar, `pm2 env`, `/proc/*/environ` ni archivos `.env`.

### A2. Servicios, timers, conexiones y cortafuegos

```bash
/usr/bin/systemctl show pm2-root.service --property=User,MainPID,ActiveState,SubState,FragmentPath
/usr/bin/systemctl list-timers --all --no-pager
/usr/bin/ps -eo pid,ppid,user,comm --forest
/usr/bin/ss -ltnp '( sport = :3000 )'
/usr/sbin/ip -j route show default
/usr/sbin/ufw status verbose
/usr/sbin/ufw status numbered
/usr/sbin/nft list ruleset
/usr/sbin/nginx -t
```

Necesitamos saber si UFW está **active**, qué regla permite 3000, y si hay otro gestor/reglas con precedencia. No habilitar UFW, resetear reglas, recargar servicios o cambiar SSH para resolverlo. Revisar reglas privadamente y devolver estado UFW, reglas que afectan 3000 e interfaz; no hace falta publicar toda la política de red. El PID de 3000 debe corresponder a las instancias PM2 inventariadas.

### A3. Tareas cron y scripts relevantes, sin volcar argumentos privados

El siguiente bloque lee los crontabs y archivos globales e informa de fuente, línea, horario y primer ejecutable. No imprime asignaciones de entorno ni argumentos. `projectHint=false` **no demuestra** que la tarea no escriba: revisar privadamente todo script que conecte a la base o ejecute la aplicación.

```bash
/usr/bin/node <<'NODE'
const fs=require('node:fs');
if(process.getuid()!==0)throw Error('ROOT_REQUIRED');
const files=[];
for(const dir of ['/var/spool/cron/crontabs','/etc/cron.d']) {
  for(const name of fs.readdirSync(dir))if(!name.startsWith('.'))files.push({file:dir+'/'+name,system:dir==='/etc/cron.d'});
}
files.push({file:'/etc/crontab',system:true});
for(const {file,system}of files){
  fs.readFileSync(file,'utf8').split('\n').forEach((line,i)=>{
    const text=line.trim();
    if(!text||text.startsWith('#')||/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text))return;
    const t=text.split(/\s+/),count=text.startsWith('@')?1:5;
    const schedule=t.slice(0,count).join(' '),user=system?t[count]:file.split('/').pop();
    const executable=t[count+(system?1:0)]||'';
    console.log(JSON.stringify({source:file,line:i+1,schedule,user,
      executable:/^[/.A-Za-z0-9_-]+$/.test(executable)?executable:'REVIEW_PRIVATELY',
      projectHint:/cronox|Web_Cronox|accountState|newsletter|preregister/i.test(text)}));
  });
}
for(const dir of ['/etc/cron.hourly','/etc/cron.daily','/etc/cron.weekly','/etc/cron.monthly']){
  if(fs.existsSync(dir))console.log(JSON.stringify({directory:dir,scripts:fs.readdirSync(dir).filter(n=>!n.startsWith('.'))}));
}
NODE
```

Para cada timer/script que pudiera escribir, revisar en la consola su unidad y código, sin copiar secretos al chat. `systemctl show NOMBRE_REAL --property=FragmentPath,User,MainPID,ActiveState,SubState` permite identificar el servicio; `NOMBRE_REAL` se sustituye exclusivamente por el nombre obtenido en la lista, no por un nombre supuesto. Necesitamos fuente/línea o nombre de unidad, función y si está ejecutándose; no credenciales.

Revisar también GitHub → `danir23007/Web_Cronox` → Actions → **Deploy CRONOX**. La publicación futura no puede solaparse con otro workflow, ejecución de `/var/www/cronox/deploy.sh`, `migrate deploy`, build o intervención manual. No se comprobó aquí el estado actual de Actions; no se presume suspendido por una guía histórica. La CLI `gh` no está instalada en este equipo, por lo que no se exige usarla.

## B. Preparación previa a la futura interrupción

La inspección A no autoriza B/C. Antes de la ventana hay que tener: revisión exacta y artefactos compatibles preparados, plan revisado del n.º 49, conexión privada correcta, respaldo/restauración y recuperación listos, inventario cerrado de escritores y tareas, exclusión mutua con CI/despliegue y un operador root presente. No mezclar la guía antigua de renumeración con esta migración.

La inspección root posterior ya confirma las listas PM2/crontab indicadas arriba y el chequeo nft posterior aprobó la rama temporal de red sin aplicarla. El único nombre de aplicación confirmado es `cronox`; no se inventan servicios separados para newsletter, waitlist o mailbox. Los workers que corren dentro del mismo Nest se detienen con ese proceso. Repetir solo el inventario relevante al abrir la futura ventana para detectar cambios desde estas instantáneas.

Para la ventana, guardar privadamente el inventario PM2 y configuración efectiva, estado original de `watch`/cron, unidades/tareas que se pausarán, SHA, respaldo definitivo y configuración necesaria para recuperar. Los archivos con secretos deben ser privados y no se comparten ni se incorporan al repositorio. No hacer `pm2 save` con la lista parada, `pm2 delete`, `pm2 kill`, `pm2 stop all` ni detener `cron.service` globalmente sin justificarlo.

## C. Comandos que interrumpen servicio — NO ejecutar ahora

### C1. Cerrar el acceso directo a 3000

UFW inactivo: **no habilitarlo ni usar la rama UFW descartada**. Se utilizará la tabla temporal nft ya comprobada con `--check`. El siguiente bloque **sí aplica cambios y bloquea conexiones**, por lo que solo pertenece a la ventana futura, con recuperación y coordinación preparadas. Reconfirma que el nombre no exista: si existe, no reutilizarlo ni borrar nada para hacer pasar el control.

```bash
set -euo pipefail
test "$(id -u)" = 0
/usr/sbin/nft --json list ruleset | /usr/bin/node -e '
let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
  const entries=JSON.parse(input).nftables||[];
  if(entries.some(e=>e.table?.family==="inet"&&e.table.name==="cronox_account_maintenance")){
    console.error("NAME_COLLISION: no aplicar cambios");process.exitCode=1;
  }
});'
/usr/sbin/nft --file - <<'NFT'
add table inet cronox_account_maintenance
add chain inet cronox_account_maintenance input_guard { type filter hook input priority -10; policy accept; }
add rule inet cronox_account_maintenance input_guard iifname != "lo" tcp dport 3000 counter drop
NFT
```

La definición es la misma que pasó el chequeo root. Se aplica como lote; no modifica tablas anteriores, SSH, 80/443 ni configura persistencia. Registrar que esta ventana creó la tabla nueva y su contenido, para poder retirar únicamente ese recurso propio al cancelar. No ejecutar si hay otra intervención simultánea de red o cambios desde el chequeo que exijan revisión.

Verificar desde el equipo externo que `http://69.62.109.75:3000/api/health` ya no devuelve 200 y desde el VPS que `http://127.0.0.1:3000/api/health` sigue dando 200. Revisar además IPv6/otras interfaces públicas si la inspección muestra otras entradas. Un timeout aislado no sustituye inspeccionar las reglas. El bloqueo directo se mantiene hasta terminar las verificaciones/reapertura.

### C2. Mantenimiento de Nginx

Con la rama de red resuelta, en la ventana coordinada:

```bash
test "$(id -u)" = 0 || exit 1
test ! -e /var/lib/cronox/maintenance.flag || exit 1
touch /var/lib/cronox/maintenance.flag
curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://cronox.es/api/health
curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://www.cronox.es/api/health
curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}\n' https://cronox.es/checkout
curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}\n' --request POST https://cronox.es/api/webhooks/stripe
```

Todos deben devolver **503**, incluido el webhook: no usar un 200 ficticio que impida su reintento. El POST vacío solo se ejecuta después de confirmar el mantenimiento y no lleva una firma/evento Stripe. No es una prueba de pago. Si el flag no produce 503, no parar el backend todavía: revisar el vhost cargado. No hay que editar/reinstalar el guard existente ni recargar Nginx por el mero cambio de presencia del archivo.

### C3. Pausar iniciadores y parar el backend

Pausar primero únicamente las tareas/unidades identificadas como iniciadores de escritores. Para una unidad real verificada: `systemctl stop "$timer_real"` y, si su servicio ya está ejecutándose, detener también `"$service_real"`; los valores y su recuperación se fijan con A3. Esto no prescribe unidades desconocidas. Para cron se conserva una copia privada del crontab y se comenta solo la línea relevante mediante el operador; no se borra un crontab completo ni se edita sin inventario.

Si A1 confirma `cronox` en `/root/.pm2` con `watch` desactivado y sin `cronRestart` programado, el comando exacto es:

```bash
PM2_HOME=/root/.pm2 /usr/bin/pm2 stop cronox
```

Si `watch` está activo, la variante oficial es `pm2 stop cronox --watch`, con el mismo `PM2_HOME`, conservando su valor anterior para recuperación. Un simple stop con watch activo puede reiniciar al cambiar archivos. Si `cronRestart` está activo, resolver su pausa antes: no usar un restart para deshabilitarlo a mitad de la parada. [PM2: estrategias de reinicio](https://pm2.keymetrics.io/docs/usage/restart-strategies/).

Otros procesos PM2 se paran por su **ID/nombre y propietario comprobados**, con el `PM2_HOME` correspondiente; nunca `all`. Un proceso puntual fuera de PM2 se identifica por PID actual, ejecutable/directorio, padre y supervisor; no se entrega un `kill` con un PID histórico. Si no se conoce cómo detenerlo y recuperarlo, no iniciar la ventana. No parar Nginx ni la base remota.

### C4. Acreditar la parada antes de migrar

```bash
/usr/bin/ss -ltnp '( sport = :3000 )'
/usr/bin/pgrep -af '^/usr/bin/node /var/www/cronox/Web_Cronox/cronox-backend/dist/main.js$'
/usr/bin/ps -eo pid,ppid,user,comm --forest
curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3000/api/health
curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}\n' https://cronox.es/api/health
```

Puerto 3000 sin escucha; solicitud local falla con HTTP `000`; dominio público mantiene 503. Repetir A1: **todas** las instancias de `cronox` y otros escritores conocidos deben estar `stopped` y sus PIDs anteriores ausentes. La búsqueda pgrep es auxiliar y puede no coincidir con otro formato argv: no usar su resultado vacío como única prueba. Revisar timers/servicios pausados, crontab y procesos hijos; observar que no reaparecen, incluyendo el intervalo programado pertinente. Controlar las transacciones de la base desde una conexión autorizada de solo lectura y cualquier escritor externo conocido; no compartir SQL con datos personales ni conexiones privadas.

Solo después de esa comprobación: respaldo definitivo, auditoría con plan vigente, registro de decisión, migración revisada, guards y publicación compatible según [el procedimiento de estados](customer-account-states-2026-10-14.md). Los guards se conservan. Mantener red/mantenimiento mientras se verifica el backend nuevo. Los flags de correo/jobs y la reapertura se coordinan con la configuración efectiva obtenida, no suponiendo que editar `.env` anula el entorno heredado de PM2.

## D. Cancelación y recuperación — también interrumpe/cambia servicio

### Antes de migrar o cambiar código/configuración

Si solo se activó mantenimiento y se pararon procesos, pero código, configuración, datos y enum permanecen originales, recuperar la aplicación registrada (sin borrarla/recrearla):

```bash
PM2_HOME=/root/.pm2 /usr/bin/pm2 restart cronox
curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/health
curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/ready
```

Esperar ambos HTTP 200 y comprobar catálogo/estado de la aplicación antes de reabrir. Ese arranque reanuda también sus workers originales; se usa únicamente para cancelar la ventana sin cambios, no para probar código nuevo sin comunicaciones. Si se desactivó watch, restaurarlo conforme al inventario; no activar watch si antes estaba desactivado. Reanudar solo las tareas/unidades que estaban activas y fueron pausadas por esta ventana, sin lanzar manualmente trabajos de correo.

Cuando servicio y configuración originales estén verificados:

```bash
rm -- /var/lib/cronox/maintenance.flag
curl --fail --silent --max-time 10 https://cronox.es/api/health
curl --fail --silent --max-time 10 https://cronox.es/api/ready
```

Retirar solo el flag creado por esta operación, no uno que ya existiera. Para recuperar la política de red anterior, comprobar que la tabla temporal fue creada por esta ventana y no se modificó para otros usos:

```bash
/usr/sbin/nft --json list table inet cronox_account_maintenance
```

Con esa propiedad confirmada, la inversa exacta es:

```bash
/usr/sbin/nft delete table inet cronox_account_maintenance
```

No ejecutar una eliminación si la tabla ya existía antes de esta ventana o cambió para otro uso. No usar `flush ruleset` ni modificar UFW. Mantener permanentemente 3000 cerrado sería una decisión separada; esta preparación no la aplica. No guardar PM2 con un estado incorrecto o iniciar `pm2-root.service`/`resurrect` sin inventariar las demás aplicaciones.

### Después de iniciar la migración o cambiar archivos

No ejecutar el restart anterior automáticamente. Primero determinar si la transacción abortó y revirtió realmente el esquema, si Prisma dejó un intento fallido y si código/configuración siguen intactos. Si la migración completó, la aplicación antigua no es compatible: mantener mantenimiento y escritores detenidos; recuperar **base + código + configuración** como unidad conforme al respaldo definitivo de la ventana, o terminar la publicación compatible.

El ensayo local ya demostró restauración de 100 tablas y del enum anterior, con el código `aeb3e38` archivado. El respaldo definitivo, ubicación en el VPS, manifiesto y paquete nuevo aún no existen para esta ventana. Por ello no se da un `pg_restore` sobre producción con un destino supuesto. Preparar y verificar ese comando con el respaldo real antes de interrumpir; tampoco restaurar el respaldo preliminar perdiendo operaciones posteriores. Tras reapertura se requiere reconciliar cualquier operación nueva antes de restaurar.

## Resultado que falta para cerrar la coordinación

UID, PM2, UFW, cron y chequeo nft ya recibidos y documentados. No queda pendiente otra inspección root para seleccionar la rama de parada/red. El efecto real de las reglas, la parada y la recuperación del servicio no se han ejecutado ni se declaran probados. Antes de interrumpir quedan el paquete exacto compatible, recuperación con respaldo definitivo, coordinación con el operador y ausencia de despliegues concurrentes. No se necesitan contraseñas ni nuevas decisiones de clasificación de cuentas. **Hasta cerrar y autorizar la ventana, no aplicar estos bloques de cambio.**
