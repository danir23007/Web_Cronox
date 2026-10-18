# Reparación acotada del almacenamiento privado de correo

Reparación y recuperación administrativa completadas el 18-10-2026; **web reabierta, lectura autenticada de los cuatro buzones y ciclos del worker comprobados**. El proceso publicado ejecuta como `deploy`, pero antes de la reparación la raíz de correo `/var/lib/cronox/mailboxes` pertenecía a `root` con modo `700`: `deploy` no podía recorrerla ni leer/escribir su caché cifrada. La salud HTTP no comprobaba ese acceso. No se cambia IMAP, SMTP, claves, preferencias, suscripciones, mensajes ni tablas para resolver este permiso. El código correctivo está en `2a89eb4`, con CI satisfactorio; quedan pendientes su despliegue y una notificación visible en el móvil. El [informe de correo](mailbox-recovery-2026-10-18.md#publicación-preparada-y-bloqueo-previo) recoge el bloqueo previo de la comprobación de la redirección www.

Los componentes revisables son [mailbox_storage.py](../.github/ops/cronox-release/mailbox_storage.py) y [mailbox_repair_window.py](../.github/ops/cronox-release/mailbox_repair_window.py). Se ejecutan exclusivamente por el administrador desde una copia de propiedad `root`, fuera del repositorio de despliegue. No añaden órdenes sudo ni modifican el controlador v5 ya instalado. El segundo coordina únicamente esta reparación, fijada al HEAD funcional `488a5185122826188986fd6cedd3e1046cfe42ba`; no es otra vía de publicación.

## Alcance y condiciones

- Sólo la ruta fija `/var/lib/cronox/mailboxes`. Ancestros de propiedad `root` sin escritura para otros; ninguna ruta simbólica. Inventario plano UUID v4 y UUID.meta, más el subdirectorio opcional `uploads` con UUID.upload. Rechaza objetos especiales, hardlinks, montajes bajo la raíz, ACL ampliadas, propietarios desconocidos y modos inesperados.
- `--plan` es de lectura: presenta número de objetos y permisos de destino, sin nombres de archivos, contenido o credenciales.
- `--apply` requiere mantenimiento ya establecido, `pm2-root` inactivo y el daemon `pm2-deploy` activo con su UID y MainPID verificados. Sólo puede existir la aplicación esperada `cronox`, detenida, sin watch ni cron de reinicio; no puede quedar listener 3000 ni otro proceso de aplicación o descriptor abierto sobre el almacenamiento.
- Adquiere el mismo `controller.lock` que las publicaciones; un orquestador que ya lo tenga puede invocar `apply()` directamente tras verificar el componente y la configuración privada. Nunca se crea un permiso de bootstrap ni se elude `boot_guard.py`.
- Guarda antes de modificar un inventario de UID, GID, modo, dispositivo e inode en `/root/cronox-mailbox-storage-repair-20261018`, directorio `700` y archivos `600`, con digest SHA-256 y sincronización a disco. Rechaza repetir una aplicación si existe ese respaldo.
- Modifica únicamente propietario/grupo a `deploy`, directorios a `700` y archivos a `600`, usando descriptores y comprobando identidad inmediatamente antes de cada cambio. La raíz se cambia al final. No abre contenidos ni cambia cifrado, claves, nombres o bytes.
- Comprueba por un proceso realmente degradado a `deploy` que los directorios son accesibles y los archivos legibles/escribibles. Esta comprobación no prueba por sí sola IMAP, MIME ni la lectura autenticada del panel.

Los uploads existentes `644` dentro de la raíz `700` se admiten en la inspección; la reparación los reduce a `600`. Un objeto o permiso fuera de este alcance requiere revisar un nuevo plan: no se amplía automáticamente la reparación.

## Ventana administrativa

Antes de aplicarla se presentan paquete, SHA-256 y efecto al propietario. La aprobación de una ventana anterior no se usa como autorización para detener nuevamente la web.

Paquete v1 ejecutado por el administrador: `/home/deploy/cronox-mailbox-repair-20261018-v1.tar.gz`. SHA-256 local y remoto: `b357b7e7e6423dd1cc23355e3c92b45401b74026297b9063627f062ab845dfaa`. Contiene exclusivamente los dos scripts revisados y un manifiesto que comprueba ambos antes de importar el helper. No contiene configuración, secretos ni datos de correo. El propietario autorizó expresamente el 18/10/2026 «reparación y publicación de las correcciones», incluida esta intervención y después commit, push y publicación mediante el procedimiento existente. La reparación de metadatos terminó; la ventana no terminó satisfactoriamente.

Tras la aprobación, el administrador copió el paquete a una carpeta nueva root `700`, verificó el digest y extrajo los archivos `600`. El plan terminó correctamente y se inició `--apply` mediante la unidad `cronox-mailbox-repair-20261018.service` de systemd, con `Type=oneshot`, `RemainAfterExit=yes`, `UMask=0077` y `ExecStopPost` del mismo script con `--fail-safe`. No ejecutar el script modificable por deploy directamente como root ni repetir una ejecución fallida a ciegas.

Bloque histórico aprobado y ejecutado por el operador. **No repetir: la ventana quedó detenida en `verify` y después se recuperó con v2 desde esa fase, sin repetir la reparación.**

```bash
(
  set -euo pipefail
  umask 077
  test "$(id -u)" = 0
  test ! -e /root/cronox-mailbox-repair-20261018-v1
  install -d -m 700 /root/cronox-mailbox-repair-20261018-v1
  install -o root -g root -m 600 \
    /home/deploy/cronox-mailbox-repair-20261018-v1.tar.gz \
    /root/cronox-mailbox-repair-20261018-v1/package.tar.gz
  cd /root/cronox-mailbox-repair-20261018-v1
  printf '%s  package.tar.gz\n' \
    b357b7e7e6423dd1cc23355e3c92b45401b74026297b9063627f062ab845dfaa \
    | sha256sum --check -
  tar --extract --gzip --file=package.tar.gz \
    --strip-components=1 --no-same-owner --no-same-permissions
  /usr/bin/python3 -I \
    /root/cronox-mailbox-repair-20261018-v1/mailbox_repair_window.py --plan
  systemd-run --no-block \
    --unit=cronox-mailbox-repair-20261018 \
    --property=Type=oneshot --property=RemainAfterExit=yes \
    --property=UMask=0077 --property=TimeoutStartSec=10min \
    --property=TimeoutStopSec=2min \
    --property='ExecStopPost=/usr/bin/python3 -I /root/cronox-mailbox-repair-20261018-v1/mailbox_repair_window.py --fail-safe' \
    /usr/bin/python3 -I \
    /root/cronox-mailbox-repair-20261018-v1/mailbox_repair_window.py --apply
)
```

La unidad comenzó a las 03:18:24 UTC y a las 03:18:29 UTC quedó `held`, fase `verify`, con `safeStateConfirmed=true` y ExecStopPost correcto. La salida acreditó `MAILBOX_STORAGE_REPAIRED`; SSH confirmó raíz deploy:deploy `700` accesible, mismo HEAD, daemon deploy activo, aplicación detenida y HTTP público 503. Ese fue el estado anterior a la recuperación v2 y a la lectura autenticada satisfactorias descritas más abajo. Los respaldos y la evidencia del fallo se conservan; no se repite este bloque.

El orquestador administrativo debe verificar y conservar la identidad de HEAD y `dist`, el estado y entorno actuales de PM2 y el SHA-256 de los componentes; activar una bandera propia de mantenimiento, comprobar 503, detener y guardar **la aplicación** mediante el daemon existente de `deploy`, ejecutar la reparación y arrancar la misma aplicación con su entorno guardado, sin `--update-env`. Después verifica identidad, usuario, listener loopback, health/ready, PM2 guardado y disponibilidad externa antes de declarar éxito. No se detiene el daemon, no se usa el permiso de bootstrap, no se compila, migra, publica ni envía una comunicación de prueba.

Si falla la reparación o cualquier comprobación posterior, se conservan mantenimiento, aplicación detenida y evidencia privada. No se reabre por tener únicamente un HTTP 200. Se ejecuta como una unidad temporal de systemd independiente de la consola, con `ExecStopPost` limitado al mismo paquete y `--fail-safe`. Un token de mantenimiento persistente y su inode acreditan qué bandera pertenece a esta intervención; nunca se retira una bandera ajena. El estado se guarda atómicamente en `/root/cronox-mailbox-repair-window-20261018/status.json`. Si no puede comprobar la parada segura, registra `safeStateConfirmed=false` en vez de declarar una recuperación satisfactoria.

La desconexión de SSH no termina la unidad. SIGTERM y las excepciones mantienen el servicio cerrado; ante SIGKILL, ExecStopPost utiliza la evidencia persistida. No se ha probado un apagado físico del VPS. Si ocurre después de retirar la bandera y antes de registrar el éxito final, hay que reconciliar el estado y repetir las comprobaciones externas: el guard instalado no examina el directorio privado de esta reparación puntual. No se amplían sus permisos ni se promete recuperación automática de esa situación.

## Recuperación completada desde `verify`

El wrapper v1 no conservó el motivo concreto del primer rechazo en `verify`. No se atribuye ese fallo a IPC, finales de línea ni a una variable concreta. La versión revisada conserva código seguro de rechazo y ubicación, sin valores privados, incluso cuando interviene ExecStopPost.

El diagnóstico administrativo de lectura posterior probó nueve candidatos y devolvió `baselineExactHashMatched=false`, sin fuentes coincidentes. Entre los registros PM2 anterior y actual sólo cambiaban los nombres `exit_code` y `prev_restart_delay`; se confirmó en la fuente instalada que son metadatos del ciclo de PM2. Los arrays vacíos de diferencias reconstruidas no prueban igualdad: no se había obtenido una referencia cuya huella coincidiera. El código compilado y el almacenamiento pasaron sus verificaciones, y no se encontraron diferencias en los controles inspeccionados.

Una reproducción aislada con PM2 7.0.4 real, un daemon exclusivo de `deploy` y un proceso sintético sin puertos ni proveedores confirmó que Node añade `NODE_CHANNEL_FD` y `NODE_CHANNEL_SERIALIZATION_MODE` al entorno inicial visible en `/proc`, aunque no figuren en el registro PM2. Los valores modelados coincidieron antes y después de reiniciar el proceso sintético; su daemon se detuvo al terminar. Esta evidencia explica por qué la reconstrucción anterior estaba incompleta; no identifica por sí sola el rechazo original de la ventana.

La reconstrucción revisada reproduce la conversión de escalares de ForkMode, esos campos IPC y la normalización de finales de línea que hacía el lector histórico `Path.read_text()`. La normalización CRLF/CR reproduce al lector; no se ha demostrado que existieran esos caracteres en el entorno productivo. Los campos IPC siguen incluidos en la huella. Sólo tras reproducir **exactamente el SHA-256 original**, con las reglas históricas, se comparan el entorno y los controles actuales excluyendo los nueve metadatos de ciclo PM2 demostrados. No se reemplaza la referencia original por el estado actual.

Paquete v2 ejecutado por el administrador: `/home/deploy/cronox-mailbox-repair-20261018-v2.tar.gz`. SHA-256 local/remoto verificado: `9f7d6c272db33cb466b28c3b6941bb4c4c30f69217e1dcba186aaaf42aa36c45`. Conserva el helper de almacenamiento original y actualiza sólo el orquestador. Se utilizó una copia protegida de root, verificada antes de extraerla.

`mailbox_repair_window.py --resume-plan` sólo lee: exige la fase retenida, la bandera propia, daemon e identidad originales, aplicación detenida, acceso al almacenamiento reparado y digest del inventario de recuperación. También debe acreditar la huella histórica exacta y que la configuración actual coincide. Si rechaza, no inicia servicios ni altera el diario; se conserva el mantenimiento. El plan real del VPS terminó correctamente y acreditó el SHA-256 exacto del entorno histórico; esta evidencia productiva es independiente del test sintético anterior.

Después de `MAILBOX_RESUME_PLAN_OK`, la unidad nueva `cronox-mailbox-repair-resume-20261018.service` ejecutó `--resume` con las mismas protecciones systemd y `--fail-safe`. Repitió los controles bajo el bloqueo global, conservó el estado anterior en un archivo exclusivo y arrancó/verificó/reabrió la misma versión. No repitió `helper.apply()`, no creó otra referencia de entorno ni reemplazó el respaldo de metadatos. No debe repetirse una reanudación ya completada.

Resultado real: unidad `active/exited`, `Result=success`, `ExecMainStatus=0`; daemon PM2 de `deploy` activo con PID 275393, almacenamiento deploy:deploy `700`, mantenimiento inactivo y listener únicamente en `127.0.0.1:3000`. HEAD funcional conservado: `488a5185122826188986fd6cedd3e1046cfe42ba`. La aplicación reiniciada tiene PID 394628, con inicio PM2 `2026-10-18T04:00:27.448Z`. Las seis consultas externas a `/`, `/api/health` y `/api/ready`, en `cronox.es` y `www.cronox.es`, terminaron en HTTP 200 siguiendo la redirección canónica de la portada www (308 a `https://cronox.es/`).

Después de reabrir, una sesión SUPERADMIN legítima abrió mensajes previamente leídos en los cuatro buzones: HTTP 200, texto renderizado presente, sandbox conservado y sin mensaje de reintento. Se registraron sólo estados/booleanos, sin contenido de correo. El inventario READ ONLY de las 04:02 UTC mostró los cuatro `CONNECTED`, cero fallos, errores nulos y caché privada `READABLE`. En no-reply, el cuerpo antes FAILED se recuperó mediante la apertura normal; sus tres cuerpos estaban LOADED, sin reparación directa de registros.

La consulta autenticada del worker produjo dos muestras de la misma instancia (`startedAt=2026-10-18T04:00:29.886Z`): `lastScanCompletedAt` avanzó de `04:02:25.279Z` a `04:02:40.593Z`, sin error. Se mantuvieron un evento histórico REVIEW y cero efectos; no se forzó reprocesamiento. Esta evidencia real cierra la comprobación operativa posterior a la reparación. Las descargas de adjuntos disponen de cobertura aislada; no se afirma una descarga productiva no realizada. La entrega visible de push al móvil y la publicación de las correcciones de código siguen pendientes.

## Recuperación de metadatos

`--rollback`, sólo bajo las mismas condiciones de mantenimiento y escritores detenidos, verifica el digest del inventario privado y que todos los objetos conservan dispositivo e inode y no hay archivos nuevos, retirados o sustituidos. Restaura exclusivamente UID/GID/modo anteriores; una aplicación parcialmente interrumpida también se puede revertir. Si el inventario cambió, se detiene para revisión y no toca el nuevo contenido.

Esta reversión puede restablecer la inaccesibilidad original del correo. No modifica datos ni revierte la aplicación a ejecución como root; se mantiene el mantenimiento hasta decidir una recuperación compatible. No equivale a una restauración del contenido del correo: el respaldo guarda sólo los metadatos que modifica esta operación.

## Prevención de recurrencia

En local se han añadido controles al instalador antes de mantenimiento y después de arranque, y al controlador antes de mantenimiento y en la comprobación con trabajos pausados. Esos componentes protegidos requieren instalación administrativa separada: no se sustituyen automáticamente por un push.

Además, el preflight entrante que v5 ya ejecuta como `deploy` verifica la raíz y un inventario acotado de cuerpos, metadatos y uploads. Rechaza rutas, nombres, propietarios, modos, tipos o dispositivos inesperados, enlaces y archivos inaccesibles, sin leer su contenido. Detecta también una raíz reparada cuyos archivos interiores siguen siendo de root. Entrará en una próxima publicación expresamente autorizada que incluya este cambio; no está activo por el mero hecho de editarlo en local.

## Verificación realizada

39 pruebas de controlador/instalador/almacenamiento en Linux, ejecutadas como `deploy` en directorios temporales con datos sintéticos, y 6 pruebas de preflight Node: satisfactorias. Las 11 pruebas nuevas cubren enlaces simbólicos y duros, objetos/modos/ACL inesperados, identidad/inventario cambiantes, acceso denegado, snapshot privado, conservación de bytes e inodes, reversión e interrupción parcial. El preflight incluye 13 escenarios negativos. Se simulan systemd, PM2, `/proc` y la identidad privilegiada: no se detuvo la aplicación real ni se efectuó un `chown` root→deploy de producción para obtener estos resultados.

El orquestador v1 pasó 15 pruebas focales en Linux aislado. La versión revisada para recuperación pasó 28/28, también como `deploy` en directorios temporales: orden, rechazo previo sin parada, fallo/interrupción por fase, token/inode y persistencia real con archivos sintéticos, mantenimiento ajeno, manifiesto alterado, conservación del código y rechazo de cambios de configuración. Incluyen la exigencia de huella histórica exacta, modelo IPC, normalización del lector, plan sin escritura, conservación del diario y del inventario, y reanudación sin repetir la reparación. Se admiten exclusivamente los metadatos PM2 demostrados; cambios en secretos, controles de correo, PWD y OLDPWD siguen rechazándose. Los servicios se simulan en esta suite. El ensayo separado de PM2 sí utilizó un daemon real exclusivo y datos sintéticos. La recuperación real posterior se acredita por la unidad y las comprobaciones del VPS descritas arriba; no se repitió la batería de pruebas para actualizar este cierre.
