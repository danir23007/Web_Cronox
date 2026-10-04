# CRONOX: estado publicado y preparación pendiente

Comprobación del 4/10/2026, aproximadamente 20:03–20:16 Europe/Madrid. Se leyeron las guías del administrador, estabilidad, revisión conjunta, retención y seguimiento y el procedimiento de despliegue. No se encontraron instrucciones `AGENTS.md` adicionales. Se conserva todo el trabajo anterior.

## Publicación y base de datos

- Local, `origin/main` y VPS `69.62.109.75`, checkout `/var/www/cronox/Web_Cronox`: `5400f31d6d65322c799da8cbb959ed950e89cecb`. Incluye `bc46575`, `096dc11` y `707fe87`; mantiene el menú vertical de `5400f31`.
- [Deploy CRONOX 37220480714](https://github.com/danir23007/Web_Cronox/actions/runs/37220480714): `success`, mismo SHA; iniciado 19:25 y terminado 19:29 Europe/Madrid. Ya estaba desplegado antes de esta intervención. No se lanzó otra ejecución.
- Salud local y pública: HTTP 200, `{"ok":true}`.
- 73 migraciones terminadas, ninguna pendiente ni ejecución incompleta. `20261004150000_mailbox_sent_policy_tracking` aplicada a las 16:29 Europe/Madrid; también están aplicadas las de finalidades No-reply y nombre interno. Consultas SQL en transacciones `READ ONLY`; no se repitieron migraciones.
- Los recursos públicos `admin-shell.js`, `admin-inbox.js`, `admin-inbox.css`, `admin-gallery.js` y `campaign-arrival.js` coinciden con los locales normalizando finales de línea. La petición anónima de `admin.html` recibe el acceso restringido, no el administrador autenticado.

No se hizo push porque activa un nuevo despliegue de `main` y el destino todavía no cuenta con un backup completo y recuperable verificado. Este documento y el ayudante de operaciones quedan en un commit local; no representan otra versión publicada de la aplicación.

## Recepción, colas y simulación

Los cuatro buzones activos muestran `CONNECTED`, sin error y con `lastSyncAt` avanzando entre comprobaciones separadas. Se autentica IMAP/TLS y se seleccionan carpetas con `readOnly:true` (EXAMINE). Solo se consultan UID y banderas; no se descargan cuerpos ni se modifican mensajes o estados de lectura.

| Buzón | Entrada proveedor / panel | Enviados proveedor / panel | UID faltantes o sobrantes | UIDPLUS |
| --- | ---: | ---: | ---: | --- |
| Info | 2 / 2 | 1 / 1 | 0 | Sí |
| Orders | 4 / 4 | 2 / 2 | 0 | Sí |
| No-reply | 1 / 1 | 1 / 1 | 0 | Sí |
| Support | 3 / 3 | 2 / 2 | 0 | Sí |

Todos esos mensajes tienen las mismas banderas de lectura y UIDVALIDITY entre proveedor y caché. No se observó una llegada natural nueva: se verifica la sincronización de mensajes existentes y, en pruebas locales, la incorporación de nuevas llegadas. No se atribuye a esta comprobación una entrega entrante real que no ocurrió.

Estado final leído: 5 envíos manuales `SMTP_ACCEPTED`, 0 pendientes/procesando/inciertos; 0 campañas y 0 entregas de campañas; 2 trabajos newsletter `SENT`; 1 solicitud de reposición `WAITING`. El historial automático tiene 5 aceptados de Info y 1 de No-reply. No se modificó ninguna fila. Puede haber un lease breve de sincronización normal; debe revisarse otra vez justo antes de intervenir, no considerarse abandonado por existir.

Se ejecutó el servicio de retención en **simulación**, con un adaptador que sustituye únicamente la adquisición de leases por una llamada sin escrituras y fuerza `READ ONLY` en sus transacciones. No se arrancó Nest ni ningún trabajador. Es un inventario, no una autorización para limpiar sin repetir la comprobación coordinada después del backup.

| Buzón | Candidatos locales | Candidatos remotos | Borradores aceptados con contenido | Exclusiones |
| --- | ---: | ---: | ---: | --- |
| Orders | 2 | 2 | 0 | 0 |
| No-reply | 1 | 1 | 0 | 0 |
| Info | 0 | 0 | 0 | Un mensaje sin asociación fiable a campaña; se conserva tanto local como remoto |
| Support | 0 | 0 | 0 | Sus dos enviados no cumplen el corte de 30 días |

**Eliminados realmente: 0 locales y 0 remotos.** Todos los lotes simulados caben en una pasada. No se pudo acreditar desde IMAP si las copias existentes las añadió el proveedor, CRONOX o webmail; tener UIDPLUS o desactivar APPEND no demuestra que Hostinger deje de guardar copias. No se envió correo para averiguarlo ni se cambió hPanel.

## Configuración y carencias del control de cuota

La clave disponible es `cronox_deploy`. No hay otro archivo de clave SSH, configuración de host adicional ni agente SSH activo. Root rechaza la conexión; `sudo -n -l` permite exclusivamente `/usr/bin/pm2 restart cronox` y `/usr/bin/pm2 save`. No se ejecutaron. Leer `/root/.pm2/dump.pm2` y acceder al almacenamiento privado devuelve `EACCES`. No se amplían permisos ni se utiliza un reinicio autorizado como vía para ejecutar comandos privilegiados adicionales.

El archivo `.env` contiene `MAILBOX_WORKER_ENABLED=true` y `MAILBOX_SEND_ENABLED=true`. En él están sin definir las opciones de seguimiento, limpieza remota, campaña verificada y límites explícitos. **El entorno efectivo de PM2 sigue sin comprobarse**; un valor ausente del archivo puede existir en PM2. Por ello no se afirma que seguimiento/limpieza estén activados ni que estén desactivados efectivamente.

El contrato aportado por el usuario se acepta como confirmado: cuatro cuotas independientes de 1000 envíos en 24 horas móviles, 100 destinatarios sumando Para/CC/CCO, 35 MB por mensaje, 25 MB de adjuntos, 10 GB y 100000 mensajes por buzón. No se consultan condiciones externas para sustituirlo por otro plan ni se inventa cuota horaria.

La implementación actual necesita trabajo antes de declarar ese control operativo:

- `MailTransportFactory` limita atómicamente solo los envíos automáticos de No-reply (`EmailDelivery`), con default de 100/h y 1000/24h. No incluye los manuales de esa cuenta. `SMTP_NOREPLY_HOURLY_LIMIT=0` actualmente provoca error de configuración; no es un modo válido para desactivar la restricción horaria.
- El remitente manual no reserva la cuota común al reclamar `MailboxSend`.
- Las campañas de Info cuentan varios flujos, pero su bloqueo no es el mismo que el del transporte automático. Su política exige además una cuota horaria positiva. El recuento manual usa destinatarios del borrador, que puede quedar vaciado por retención; debe preservarse la unidad técnica antes de borrarlo.
- Los nombres `SMTP_INFO_DAILY_LIMIT`, `SMTP_ORDERS_DAILY_LIMIT` y `SMTP_SUPPORT_DAILY_LIMIT` no son controles implementados actualmente. Escribirlos en `.env` no hace cumplir una cuota. No se presentan como configurados o efectivos.
- `MAILBOX_MAX_MESSAGE_BYTES`, `MAILBOX_MAX_ATTACHMENT_BYTES` y `MAILBOX_MAX_RECIPIENTS` sí existen. Los defaults no son los contratados y debe verificarse también el total de adjuntos, no solo cada archivo. Los límites de almacenamiento del proveedor no tienen variables equivalentes implementadas en CRONOX.

Hace falta un presupuesto duradero único por cuenta y ventana móvil, compartido por automáticos, manuales y campañas, con reserva transaccional común y unidades conservadas tras la retención. Los trabajos agotados deben permanecer esperando mediante sus colas; los resultados inciertos nunca vuelven a pendientes. La cuota local no conoce envíos realizados en webmail. **Esta carencia de código no se corrige con una activación de flags; permanece pendiente en esta entrega.** No se activaron campañas ni se configuraron valores que fingieran cumplirla.

## Comprobaciones locales realizadas en esta intervención

- `review-mailbox.cjs --serve`: 62 comprobaciones sobre PostgreSQL efímero, IMAP simulado y SMTP/TLS exclusivamente loopback. Incluye cuotas existentes, idempotencia e incertidumbre, RLS, migración, filtros, conteo/Excel, contenido compartido, consentimiento, limpieza UIDPLUS y Support a 30 días. Que estas pruebas pasen no acredita la nueva cuota unificada todavía ausente.
- Playwright CLI: `sidebar-inline.browser.js`, cuatro variantes claro/oscuro y escritorio/móvil; movimiento real lento/rápido del ratón, límites de columna, desplazamiento vertical, ausencia de oscilación bajo puntero inmóvil, fijación/restauración/desfijación, Galería, teclado, táctil, ARIA y scroll.
- `mailbox-stability.browser.js`: cuatro variantes, cinco ciclos sin novedades, identidad de nodos/foco/scroll, incorporación única según filtros, respuestas antiguas, lectura y edición estables, regreso al apartado y ausencia de intervalos acumulados.
- `mailbox-sent-policy.browser.js`: papelera sobre fixtures desechables e historial por versión/destinatario, resultados y efectividad, en las cuatro variantes.
- `campaign-arrival.browser.js`: consentimiento, interacción, fallo/reintento de métrica, deduplicación, conservación del destino y ausencia de cookies nuevas, siempre interceptando peticiones. No produjo métricas en producción.
- Sintaxis del ayudante nuevo correcta y rechazo comprobado fuera del terminal Linux/root. **Sus operaciones privilegiadas de backup/restore no se han ejecutado ni certificado** por falta de acceso. Deben pasar en el VPS antes de limpiar.

La web real solo se comprobó sin autenticación. Perfil/contraseña y las acciones internas del administrador publicado quedan pendientes de una pestaña autenticada; no se cambian contraseñas para verificarlos.

## Comandos para el operador en el terminal root del VPS

El ayudante [verify-production-mail-access.cjs](../cronox-backend/scripts/verify-production-mail-access.cjs) ya está copiado en `/tmp/cronox-mail-access.cjs`. Es código revisable, sin secretos. Copiarlo primero a un archivo de root y comprobar su hash evita ejecutarlo directamente desde un archivo modificable por `deploy`.

```bash
set -euo pipefail
umask 077
install -o root -g root -m 700 /tmp/cronox-mail-access.cjs /root/cronox-mail-access.cjs
printf '%s\n' 'fa99d06ca593112998359cc58078d7efd969055f3b76c358ebe32173cc5dd918  /root/cronox-mail-access.cjs' | sha256sum --check -
node /root/cronox-mail-access.cjs inspect
node /root/cronox-mail-access.cjs backup
```

`inspect` consulta el PM2 de root, valida aplicación/directorio/entrada, muestra solo flags permitidos y permisos privados. Combina el entorno heredado y el archivo de entorno sin imprimir secretos; señala si `.env` cambió después de iniciar el proceso. `backup` se niega si ese cambio impide determinar qué configuración se cargó. No se reinicia para resolverlo automáticamente.

`backup` genera un `pg_dump` completo consistente, un archivo del almacenamiento privado, configuraciones/claves de recuperación y hashes en `/root/cronox-backups/mail-*`, directorio 0700 y archivos 0600. La contraseña de PostgreSQL se pasa en el entorno del subproceso, no en argumentos ni salida. **Crear el archivo no certifica su recuperación**: ejecutar la siguiente fase.

El VPS tiene herramientas cliente PostgreSQL 18.6, pero no `initdb`, `pg_ctl`, usuario OS postgres ni Docker/Podman. Para la restauración se pueden extraer binarios del paquete oficial ya configurado en APT, sin instalar servicios, crear usuarios ni ampliar sudo:

```bash
task_pg_tools=$(mktemp -d /var/tmp/cronox-pg-tools.XXXXXX)
chmod 755 "$task_pg_tools"
cd "$task_pg_tools"
apt-get download postgresql-18
dpkg-deb --extract ./postgresql-18_*.deb ./unpacked
CRONOX_RESTORE_PG_BIN="$task_pg_tools/unpacked/usr/lib/postgresql/18/bin" \
CRONOX_RESTORE_PG_SHARE="$task_pg_tools/unpacked/usr/share/postgresql/18" \
node /root/cronox-mail-access.cjs verify latest
```

Si faltan dependencias del servidor, detenerse y revisar el log privado indicado; no sustituir esta prueba por `pg_restore --list` ni afirmar recuperación exitosa. El ayudante no instala dependencias por su cuenta.

La prueba arranca PostgreSQL bajo el usuario existente `deploy` en un directorio aislado 0700 y socket Unix privado, **sin TCP, Nest, SMTP ni trabajadores**. Restaura todo el esquema `public` de CRONOX, consume y autentica AES-GCM de todos sus archivos privados referenciados y verifica recuperación de credenciales de los buzones sin conectar al proveedor. Detiene el clúster al terminar. Un archivo perdido o una clave incorrecta impide certificar el backup. Se conservan el clúster detenido y los archivos privados para revisión; no entran en Git.

El dump contiene también los esquemas gestionados por el proveedor, pero esta prueba solo restaura el esquema de aplicación. Sus roles/extensiones propios necesitan el procedimiento de restauración de Supabase: el informe muestra expresamente `providerManagedSchemasRestored:false`. No equivale a haber reconstruido toda la plataforma Supabase en un PostgreSQL genérico.

Compartir únicamente el JSON de `inspect`, la ruta del backup y el resultado final de recuperación. No compartir `*.private*`, el dump, el tar, las claves ni los logs privados sin revisarlos.

## Continuación y recuperación

Después de comprobar acceso y backup: corregir el presupuesto compartido y las restricciones horarias opcionales con pruebas concurrentes locales; repetir la lectura de colas; pausar específicamente envíos manuales/campañas, newsletter, reposición y, si hace falta para limpiar, sincronización/caché de correo. No poner `BACKGROUND_JOBS_ENABLED=false`, no tocar pagos/pedidos, no reencolar UNKNOWN ni convertir WAITING a listo.

Solo entonces publicar por el flujo existente, aplicar únicamente las nuevas migraciones pendientes mediante `migrate deploy`, comprobar PM2/flags/salud, repetir simulación con leases reales y efectuar la limpieza selectiva autorizada. Activar `MAILBOX_CAMPAIGN_TRACKING_ENABLED=true` y `MAILBOX_SENT_RETENTION_ENABLED=true` después de la preparación, confirmando sus valores cargados, no solo su archivo. Support usa el corte fijo de 30 días del proyecto.

La recuperación de aplicación debe utilizar artefactos compatibles con el esquema migrado; no hacer reset de la base de datos ni restauración completa sobre producción automáticamente. Una recuperación de base de datos debe hacerse primero aislada y reconciliar pedidos/pagos y resultados SMTP posteriores al snapshot para evitar pérdida de negocio o reenvíos. No hay limpieza real ni recuperación sobre producción autorizada mediante este ayudante.

Para revisar la UI real después: Configuración → Computer Use → habilitar la extensión del navegador; iniciar sesión en CRONOX en ese perfil y mencionar la pestaña con `@`. [OpenAI Docs](https://learn.chatgpt.com/docs/chrome-extension). No enviar contraseñas o tokens por el chat.
