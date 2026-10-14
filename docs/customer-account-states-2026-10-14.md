# Estados de clientes: Activo / Inactivo

Publicado en producción el 14/10/2026 mediante la entrega conjunta `91d41e1`: 49 cuentas activas, cliente n.º 49 activo y cero estados antiguos. Ver [resultado de publicación, comprobaciones y recuperación](joint-checkout-account-release-2026-10-14.md).

## Registro histórico de preparación

Los apartados siguientes conservan las fases previas y sus pendientes de entonces; el estado actual es el informe enlazado arriba.

Implementación local del 14/10/2026. Sin commit, push, despliegue ni cambios de datos en producción. Se conserva el trabajo previo del checkout; este documento no lo publica ni cambia sus pruebas pendientes.

## Actualización: preparación con auditoría real y ensayo de recuperación

Comprobaciones del 14/10/2026, aproximadamente a las 04:30 Europe/Madrid. SSH existente como `deploy`; PostgreSQL consultado con `default_transaction_read_only=on` y transacción `REPEATABLE READ READ ONLY`. No se registró revisión ni se aplicó migración en producción. La versión publicada sigue en `aeb3e38a679a2d69236bd0c09e650beaa4c62140`.

| Caso real | Cantidad | Tratamiento preparado |
| --- | ---: | --- |
| `ACTIVE`, sin contradicción en la auditoría conservada | 48 | Conservar el estado actual |
| `PRE_REGISTERED`, cliente `FRIEND` | 1 | Revisión explícita resuelta por el titular como `ACTIVE` |
| `PENDING_PASSWORD` | 0 | Ninguno |
| Retirada administrativa identificada que deba conservarse como `INACTIVE` | 0 | Ninguna identificada; no prueba ausencia de bajas históricas |
| Estado desconocido | 0 | Ninguno |

Las 49 cuentas incluyen 46 clientes y 3 cuentas administrativas. No se usaron contraseñas, compras ni sesiones para decidir su habilitación. Conservar los 48 activos no equivale a afirmar que nunca estuvieron deshabilitados.

La única referencia a decidir era **cliente n.º 49**, rol `FRIEND`. La creación de su suscripción newsletter y de su cuenta están separadas por menos de un segundo. La única edición administrativa conservada cambió `USER → FRIEND`, dejando `PRE_REGISTERED → PRE_REGISTERED`; no documenta una retirada de acceso. El vínculo newsletter y la falta de una transición negativa no prueban por sí solos la intención administrativa. Hay 315 entradas de auditoría, 52 de edición de usuarios; la más antigua es del 14/09/2026. Retención/borrado impiden atribuir exhaustividad a esa evidencia.

El titular resolvió expresamente: **«Debe quedar Activo; era un alta automática»**. Se preparó `test-results/account-state-production-reviewed-plan.json` con UUID inmutable, estado/fecha esperados y razón, sin nombre, email, dirección, contraseña ni tokens. No se ha escrito esa decisión en producción. Se volverán a comprobar los valores esperados en mantenimiento; cualquier cambio bloquea el plan obsoleto. No queda otra decisión de clasificación pendiente en esta instantánea.

### Controles reforzados y probados

- La auditoría ejecuta la misma CTE de la migración como `SELECT` en una transacción **READ ONLY**, sin crear tabla temporal. No se confunde hacer `ROLLBACK` con imponer solo lectura.
- La migración exige `reviewed:true` booleano y razón no vacía, además de estado/fecha/UUID vigentes. El registrador tampoco acepta la cadena `"false"` como aprobación. Se comprobó que una marca no aprobada aborta sin cambios.
- El preflight exige enum exactamente `ACTIVE/INACTIVE`, estado no nulo del enum correcto y predeterminado `ACTIVE`, `registrationClaimable` booleano no nulo y predeterminado `false`, cero filas antiguas, y **una migración completada con checksum idéntico al SQL de la versión entrante**. Un `db push` o alterar columnas manualmente no basta.
- El runner aislado extrae guard y SQL de la misma revisión entrante, antes del merge. El script de publicación comprueba de nuevo antes de migrar/reiniciar. No se eliminó ni puenteó ningún bloqueo.
- Repetidas las verificaciones afectadas: 5 pruebas de preflight correctas y ensayo PostgreSQL de estados/registro/sesiones/edición, incluyendo ahora revisión no aprobada. Se reutilizan las 2.310 pruebas y compilaciones previas del código de aplicación, que no cambió en esta revisión. Exclusión de secretos/herramientas del checkout comprobada otra vez. CI remota no ejecutada: no hay commit/push.

El guard acredita compatibilidad e integridad de la migración; **no acredita por sí solo** mantenimiento, parada de procesos ni respaldo recuperable. Esas condiciones operativas siguen siendo obligatorias y se verifican separadamente.

### Respaldo y recuperación realmente ensayados

Se obtuvo por SSH un dump consistente nuevo de `public` usando `pg_dump` con instantánea de solo lectura. Se guardó únicamente en `test-results/account-state-recovery/`, excluido de Git, con ACL para el usuario local y SYSTEM. Incluye 100 tablas; excluye esquemas gestionados por Supabase, almacenamiento de objetos y configuración privada del servidor. No se copiaron credenciales de producción. Se archivó también el código exacto anterior `aeb3e38`.

Sobre una base PostgreSQL local nueva, sin iniciar aplicación, correo ni workers:

1. Dump restaurado; coinciden cantidades en 100 tablas y huella de todas las columnas de `User` con la instantánea original.
2. Guard bloqueado antes de migrar. Decisión del titular registrada **solo en la copia**; `prisma migrate deploy` ejecutado realmente contra ella.
3. Resultado: 49 activos, solo cambia el estado del n.º 49, conservando su elegibilidad técnica de registro. Todas las demás columnas anteriores de `User` son idénticas; recuentos preservados salvo los incrementos previstos en auditoría e historial de migraciones. Sin trabajos de correo nuevos.
4. Guard permite la copia migrada. Un checksum incorrecto introducido en esa copia vuelve a bloquearlo; el checksum correcto permite continuar.
5. Dump restaurado de nuevo sobre la copia: recuperadas las cantidades de 100 tablas, todas las columnas/valores originales de `User` y el enum antiguo `ACTIVE/PENDING_PASSWORD/PRE_REGISTERED`, compatible con el código archivado.
6. Base temporal eliminada. Respaldo, código e informe `verification.json` conservados localmente.

Es un ensayo real de datos/esquema, no un reinicio probado de la aplicación antigua ni una recuperación en producción. El respaldo precede al futuro mantenimiento: hace falta la instantánea definitiva con las escrituras detenidas. Restaurarlo ahora perdería actividad posterior y no está autorizado. Antes de reabrir, recuperar base + código + configuración operativa coherentes; después de reabrir, reconciliar las operaciones nuevas antes de cualquier restauración.

### Bloqueo operativo comprobado y orden de publicación

Preparación root posterior: [procedimiento exacto de inspección, parada y recuperación](customer-account-maintenance-root-2026-10-14.md). Se comprobó el guard Nginx existente `/var/lib/cronox/maintenance.flag`, sin activarlo. `pm2-root.service` está inactivo aunque el backend ejecuta bajo PM2 de root: no basta parar esa unidad. Además, el puerto 3000 respondió HTTP 200 directamente desde fuera, por lo que el mantenimiento de Nginx puede eludirse por esa entrada. Antes de fijar la ventana se necesitan inspección root de ambas listas PM2, crontab y cortafuegos efectivo, y una regla/inversa revisadas para el acceso directo. El documento separa comandos de lectura ejecutables ahora de los que interrumpen servicio; no se ha ejecutado ningún cambio.

El titular entregó después la inspección root: una sola aplicación `cronox`, una instancia fork, watch desactivado y sin cron de reinicio declarado; PM2 de deploy vacío y ninguna tarea CRONOX adicional identificada en cron/timers. UFW está inactivo; se descarta habilitarlo o usar la rama UFW histórica. La tabla nft temporal propuesta para bloquear 3000 fuera de loopback en IPv4/IPv6 ya pasó el chequeo root: nombre disponible, `checkPassed:true`, salida 0, `changesApplied:false`. La selección y validación previa de la rama de red están completas. No se aplicaron reglas ni se probó aún el bloqueo efectivo o la parada. El procedimiento incluye ahora aplicación futura e inversa exactas; no requiere otra inspección root para elegir la estrategia. Producción y sus datos continúan intactos.

El backend publicado ejecuta bajo PM2 de `root` y conserva referencias compiladas a estados antiguos en administración, autenticación, usuarios, newsletter, Pantalla Clave y pedidos invitados. Correo, waitlist y mailbox están habilitados; jobs generales usan el predeterminado habilitado. Bloquear solo la web no detiene necesariamente tareas o webhooks.

La lectura encuentra 7 trabajos newsletter, todos `WELCOME/SENT`, y cero reclamaciones de lanzamiento sin enviar; no se extrapola a todas las colas de mailbox/waitlist. No hay `pg_cron` instalado ni crontab de `deploy`; `/etc/cron.d` legible no menciona CRONOX. Crontab privado de `root` e inventario PM2 completo de root no accesibles: esa cobertura sigue pendiente.

`sudo -n -l` permite reiniciar `cronox` y guardar PM2, **no detener/iniciar el proceso ni configurar mantenimiento en Nginx**. Este acceso no permite garantizar la parada de todos los escritores. Se necesita un operador con esos permisos o acceso limitado preparado expresamente para la futura ventana autorizada. No se ha aprovechado el permiso de reinicio para ampliar privilegios.

Orden para esa ventana: paquete exacto y código de recuperación preparados; tráfico de escritura bloqueado y webhooks con respuesta reintentable; backend, workers y cron pertinentes detenidos; respaldo definitivo y auditoría repetida; revisión aún vigente registrada; migración aplicada desde el paquete exacto; ambos preflights correctos; publicación compatible de frontend/backend/Prisma; arranque con correo/jobs desactivados para verificar; reapertura y reactivación de jobs tras revisar colas. Proteger también el frontend estático mientras se publica. No basta `pm2 restart` ni un despliegue gradual con escritores antiguos.

**Listo:** implementación revisada, decisión del único caso conocido preparada, ensayo real de migración/restauración y guard reforzado. **Bloquea realmente publicar:** futura autorización de publicación y capacidad operativa para mantenimiento/parada completa. Producción mantiene el esquema antiguo y ninguna revisión aplicada; con escrituras abiertas aún puede cambiar el inventario.

Informes privados: `test-results/account-state-production-readonly.json`, `account-state-production-reviewed-plan.json`, `account-state-workers-readonly.json`, `account-state-recovery/verification.json`. Los apartados siguientes conservan el detalle de la fase inicial; sus referencias a no haber consultado producción y a no disponer de ensayo sobre respaldo real quedan actualizadas por esta revisión posterior.

## Causa y alcance comprobado

- `User.accountState` es persistido, con valor predeterminado `ACTIVE`. La migración histórica `20260910120000_add_key_screen` creó los valores `ACTIVE`, `PENDING_PASSWORD`, `PRE_REGISTERED` y clasificó como pendientes las filas sin contraseña.
- Newsletter (`linkNewsletterUser`) y Pantalla Clave (`preregister`) escribían `PRE_REGISTERED` explícitamente, anulando el valor predeterminado. La cuenta creada por un pedido invitado confirmado escribía `PENDING_PASSWORD`. El alta normal creaba `ACTIVE` por defecto.
- El registro sobre una cuenta prerregistrada, el enlace de lanzamiento y la recuperación de contraseña escribían `ACTIVE`. Se mezclaban habilitación y credenciales.
- El listado mostraba el valor persistido; no era un error exclusivamente visual. La ficha y exportación exponían valores internos. La edición masiva conservaba los estados antiguos.
- `dc22004` eliminó la exigencia de contraseña para activar desde edición masiva y endureció el login con contraseña vacía. No corrigió los escritores de newsletter, Pantalla Clave o pedido invitado. Por eso la corrección anterior no resolvía las altas automáticas.
- La búsqueda de escritores de producción encuentra cuatro altas de `User`: registro, newsletter, Pantalla Clave y pedido invitado. La administración modifica cuentas existentes; las semillas/importaciones que omiten estado usan el valor predeterminado de base de datos. Se actualizaron también los generadores de fixtures que usaban estados retirados.
- No se ha identificado a la persona del incidente: no hay un identificador inequívoco en la petición y no se ha supuesto que fuese la última fila. No se ha consultado ni modificado producción en este trabajo. La causa se ha demostrado en código y con flujos locales y datos ficticios; no se afirma que la cuenta publicada esté corregida.

## Modelo y flujos

El enum de Prisma y PostgreSQL queda limitado a `ACTIVE` e `INACTIVE`. La interfaz usa **Activo** e **Inactivo**. Ninguna contraseña, consentimiento, compra, verificación o fecha calcula el estado. `account-state.ts` centraliza las etiquetas del servidor, la validación y la elegibilidad técnica de registro; `account-state.js` centraliza las etiquetas de las tres vistas del administrador. Una prueba comprueba que ambos contratos coincidan. Un valor inesperado se denuncia como desconocido, nunca se presenta como activo.

Las cuatro altas crean una cuenta activa. Newsletter y Pantalla Clave continúan creando las cuentas que ya creaban; no se ha añadido una conversión de contactos ni una reparación general de suscripciones. Los registros `PreRegistration` permanecen como datos del flujo de lanzamiento, sin constituir un estado de cliente.

`registrationClaimable`, booleano privado con valor predeterminado `false`, conserva una distinción técnica necesaria: antes solo las cuentas `PRE_REGISTERED` sin contraseña podían completar el registro público. Newsletter/Pantalla Clave establecen esta elegibilidad al crear la cuenta. Las cuentas de pedido invitado, las altas directas y los administradores no adquieren esta capacidad por pasar a `ACTIVE`. La migración la deriva del valor histórico solo para `USER`/`FRIEND` sin contraseña. El registro exige además cuenta activa, rol de cliente y contraseña ausente; la comparación y escritura son atómicas. Establecer una contraseña consume la elegibilidad. Los DTO públicos rechazan tanto `accountState` como `registrationClaimable`.

Los enlaces de lanzamiento ya no activan cuentas y rechazan las inactivas. Restablecer contraseña con un token emitido anteriormente no modifica la habilitación. Cambiar contraseña requiere una cuenta activa. Newsletter, pedidos invitados y edición de perfil conservan el estado existente. El alta repetida de una cuenta inactiva se rechaza. Se mantienen la comprobación de estado en sesiones/refresh/login y la invalidación administrativa mediante `sessionVersion`.

La edición individual y masiva admite ambos estados, con o sin contraseña, a través de los permisos existentes. No se añade otro sistema de bajas. Se mantienen selección por UUID, límite de 100, revisión firmada, exclusión de SUPERADMIN/actor en bloque, protección del último administrador, transacciones, control de versión e idempotencia. Se incorporan filtro Activo/Inactivo y exportación coherente con el filtro; sin filtro siguen apareciendo todas las cuentas.

La programación del correo de bienvenida se separa de la nueva habilitación: un alta de newsletter no encola un correo de acceso adicional junto a la bienvenida pendiente. No se ejecutaron transportes reales.

## Reconciliación segura

Migración: `cronox-backend/prisma/migrations/20261015120000_customer_account_enablement/migration.sql`.

La aplicación anterior no tenía un estado `INACTIVE`: retirar acceso significaba pasar a uno de los estados no activos. `admin.user.update` conserva antes/después en `AuditLog`, también para operaciones masivas. Sin embargo, esa auditoría se puede borrar y se depura a los 30 días; la ausencia de una fila **no demuestra** que nunca existiera una deshabilitación.

Por ello la migración no activa automáticamente todos los valores antiguos:

| Caso | Resultado |
| --- | --- |
| `ACTIVE` sin contradicción administrativa | Conserva `ACTIVE` |
| `INACTIVE` | Conserva `INACTIVE`, incluso ante una revisión que intentase activarlo |
| Estado antiguo con última transición administrativa no activa | `INACTIVE` |
| ADMIN/SUPERADMIN con estado antiguo | `INACTIVE`; conserva la falta de acceso y el rol |
| Estado antiguo de cliente sin evidencia suficiente | Bloquea hasta revisión explícita |
| Activo con última transición administrativa no activa | Bloquea la contradicción hasta revisión |
| Estado desconocido | Bloquea; no se normaliza automáticamente |

La revisión utiliza `identityUid`, estado y `updatedAt` esperados, nunca solamente el ID numérico reutilizable. Especifica `ACTIVE` para las altas automáticas verificadas y `INACTIVE` para las retiradas de acceso. Si la evidencia fue eliminada y no se puede establecer la intención, el caso debe resolverse con administración antes de publicar; no se inventa una clasificación.

`audit-account-states.cjs` usa la misma consulta de planificación que la migración, informa únicamente de cantidades y por defecto termina con `ROLLBACK`. El plan opcional contiene UUID/ID/rol/estado/fecha, sin email, nombre, contraseña ni tokens. Sus filas salen con `reviewed:false` y `accountState:null`: no son una aprobación automática.

Comandos, desde `cronox-backend`, para la ejecución futura autorizada (rutas privadas fuera de Git):

```text
node scripts/audit-account-states.cjs --env-file=RUTA_PRIVADA_ENTORNO --write-plan=RUTA_PRIVADA_PLAN_NUEVO.json
```

Código de salida 2 significa que hay revisiones o anomalías. Revisar cada fila contra auditoría/evidencia, rellenar `accountState`, `reviewed:true` y una razón sin datos personales. No editar las identidades ni los valores esperados. Registrar la revisión durante mantenimiento:

```text
node scripts/audit-account-states.cjs --env-file=RUTA_PRIVADA_ENTORNO --record-reviewed-plan=RUTA_PRIVADA_PLAN_REVISADO.json
node scripts/audit-account-states.cjs --env-file=RUTA_PRIVADA_ENTORNO
```

`--record-reviewed-plan` es una escritura explícita de evidencia en `AuditLog`, todavía no modifica cuentas. Rechaza planes incompletos, obsoletos y la reactivación de un `INACTIVE`. Es repetible. Una revisión administrativa negativa vigente y los privilegios de administradores prevalecen sobre el plan.

La migración toma bloqueos de tablas y realiza la corrección, creación del campo técnico y sustitución del enum en una sola transacción. Conserva todas las columnas previas excepto `accountState`, incluidos `createdAt`, `updatedAt`, credenciales, roles, consentimientos, códigos e identificadores. No toca relaciones, sesiones, colas de correo o notificaciones. Registra cada cambio con una clave de auditoría única y antes/después. La reejecución no cambia filas ni duplica auditoría. Los literales retirados dejan de ser aceptados por PostgreSQL, incluso desde una versión antigua.

## Verificación local

- Auditoría de solo lectura del perfil `.env.local`: 1 cuenta activa, 0 cambios, 0 inactivas, 0 revisiones. No es un recuento de producción.
- `node scripts/test-account-states-db.cjs`: PostgreSQL real, base nueva con nombre aleatorio, sin importar datos. Migra 2 cuentas automáticas revisadas a activas y conserva 3 inactivas. Comprueba rechazo de desconocidos/ambiguos sin cambios, todas las columnas originales, relaciones de dirección/descuento/historial/suscripción, idempotencia y rechazo de escritores antiguos. Prueba las cuatro altas, registro público sobre newsletter frente a rechazo de invitado/administrador, contraseña, sesión real local, bloqueo de inactivos, edición individual y masiva, reintento idéntico y revisión concurrente obsoleta. Base eliminada al terminar.
- `node scripts/test-account-welcome-db.cjs`: PostgreSQL desechable y transporte en memoria. Conserva códigos, consentimiento, una bienvenida, concurrencia e idempotencia. Las entregas son simulaciones; no correos reales.
- Resultado final Jest: **2.310 pruebas, 231 suites, todas correctas**. TypeScript backend/administrador y compilaciones Nest/Vite correctas. Pruebas HTTP/Excel: 59 correctas; comprobación de artefactos y rutas compiladas correcta.
- `tests/admin-review/account-states-browser.cjs`: Chromium real con archivos locales y API **simulada**, a 1440 y 390 px. Listado, ficha, etiquetas, filtro tras recarga, edición/relectura, teclado y ausencia de errores JavaScript. Capturas en `output/playwright/account-states-{list,detail}-{desktop,mobile}.png`. La visualización no se presenta como prueba contra producción.
- Preflight: **11 pruebas correctas**, incluidos fallo antes de desplegar si no se ha completado la migración y propagación de ese fallo desde el preflight aislado de la revisión entrante. Comprobación de exclusión de credenciales/artefactos privados correcta. Navegador y servidor visual local cerrados al terminar.

Informes privados en `test-results/account-states-db.json`, `account-state-welcome-db.log`, `account-state-final.log`, `account-states-browser.log`. `.env` y artefactos privados siguen excluidos de Git. No se han cambiado ni mostrado claves.

## Publicación y recuperación pendientes

1. Revisar y seleccionar exclusivamente los archivos de esta tarea; conservar aparte el diff previo del checkout. Todavía no hay commit ni push.
2. Ejecutar auditoría de solo lectura sobre producción con acceso autorizado; identificar el incidente por referencia inequívoca y resolver el plan. Preparar una versión completa compatible con frontend, backend, Prisma y herramientas de revisión.
3. Programar mantenimiento: detener **todos** los procesos de la versión antigua y trabajos que puedan escribir cuentas; bloquear tráfico de escritura. Mantener también los emisores de correo detenidos durante la corrección. No usar un despliegue gradual con código antiguo y nuevo a la vez.
4. Obtener respaldo de la base y demostrar restauración en una base aislada. Ensayar allí la migración y sus cantidades sobre una copia protegida. Esto no se ha realizado sobre un respaldo nuevo de producción en esta tarea.
5. Con la escritura detenida, repetir auditoría; actualizar cualquier revisión obsoleta y registrar el plan. Exigir `reviewRequired=0` y `unknownStates=0`. Guardar informe previo y copia del plan fuera del repositorio. Revisar colas de correo existentes: esta migración no programa entregas retroactivas ni permite usar la corrección para enviar campañas.
6. Aplicar la migración revisada mediante `prisma migrate deploy` desde el paquete nuevo, con la conexión privada correcta. No usar `db push`. Ante el aborto preventivo, no saltar las comprobaciones: revisar y, solo si Prisma registró un intento fallido ya revertido, resolverlo como `--rolled-back` antes de reintentar.
7. Verificar esquema, cantidades, auditoría y una muestra acordada. Ejecutar `check-account-state-release.cjs --deployment-check` con la configuración del destino. El despliegue existente ahora comprueba esto **antes de mezclar archivos entrantes** y antes de migrar/reiniciar: un push prematuro se detiene.
8. Autorizar commit/push y completar CI/despliegue del código compatible manteniendo el mantenimiento hasta que frontend y backend coincidan. Reabrir y verificar listado/ficha/filtros/exportación, registro activo y bloqueo de una cuenta de pruebas inactiva, sin mensajes a clientes. Reactivar trabajos únicamente tras revisar sus colas.

Recuperación: un error dentro de la migración revierte enum, campo, datos y auditoría de esa transacción. Si se necesita volver al código anterior tras una migración correcta, **no basta con revertir archivos**: el enum antiguo ya no existe y el nuevo campo técnico cambia el contrato. Mientras siga el mantenimiento y no haya escrituras nuevas, restaurar el respaldo verificado y el paquete anterior como unidad. Si ya se admitieron operaciones nuevas, mantener la escritura detenida y preparar reconciliación/restauración que conserve esas operaciones; no sobrescribirlas con un respaldo antiguo. No reconstruir estados anteriores a partir de la contraseña ni borrar auditoría para sortear bloqueos.

Pendiente: identificar y corregir el caso real durante la publicación autorizada, revisar las cuentas ambiguas de producción, respaldo/restauración de esa base y verificaciones posteriores. El cliente publicado **no se considera corregido** con esta entrega local.
