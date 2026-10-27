# Eliminación de usuarios e identidades permanentes — 27/10/2026

Implementación local. No se han eliminado usuarios reales ni aplicado migraciones en la base habitual. Sin commit, push ni despliegue.

## Comportamiento

El detalle del usuario ofrece **Eliminar usuario** a los Super Admin. El botón y la confirmación tienen un estilo destructivo y el diálogo respeta el tema claro/oscuro del administrador. Muestra nombre (o «Sin nombre»), email e ID CRX. Cancelar no envía ninguna eliminación; «Eliminar definitivamente» envía una confirmación explícita con la versión de la cuenta leída. Durante la petición se bloquean la confirmación, la cancelación y Escape para evitar envíos duplicados o aparentar que se cancela una operación ya iniciada.

Tras la respuesta de éxito se vuelve al listado conservando búsqueda, filtros, página y orden. El listado se consulta de nuevo, ajusta una última página que haya quedado vacía y muestra el aviso de éxito después de cargar los datos. Un fallo permanece en el diálogo con el mensaje recibido; no se retira la cuenta de la interfaz. Una respuesta perdida puede reintentarse con la misma identidad sin repetir el borrado.

El backend expone `DELETE /api/admin/users/:id`, con sesión administrativa, guard de Super Admin, cabecera `X-Cronox-User-Identity`, `confirmed: true` y `expectedUpdatedAt`. Además de los guards HTTP, la transacción vuelve a comprobar que quien actúa sigue siendo un Super Admin activo. Impide eliminar la propia cuenta. Una cuenta ADMIN/SUPERADMIN ajena solo puede eliminarla un Super Admin autorizado y pasa las mismas restricciones de historial; se conserva la protección del último Super Admin activo.

## Borrado real y relaciones

Se usa una transacción serializable con reintentos de conflictos, bloqueo de la cuenta y coordinación de eliminaciones concurrentes. El servidor y un trigger SQL comprueban las relaciones antes de borrar. Las nuevas relaciones no revisadas con FK a `User` bloquean el borrado, incluso si se definieron con `ON DELETE CASCADE`.

Bloquean, entre otras:

- Cualquier pedido, incluidos los cancelados, y su historial de pagos, facturas y reembolsos. Se comprueba propietario, registro/anulación administrativa y coincidencia de email.
- Checkouts y reservas de stock, también los históricos. Esta acción no cancela pagos ni libera reservas para hacer posible un borrado.
- Movimientos de stock, promociones usadas, canjes y contadores de compras/devoluciones.
- Participación/registro/creación de eventos QR y solicitudes de círculo.
- Autoría administrativa con trazabilidad: auditorías, notas, movimientos de puntos de venta, registros de correo y otras referencias operativas.

El error `USER_DELETE_BLOCKED` devuelve motivos y cantidades por relación; el diálogo explica los motivos. Es una política deliberadamente conservadora: una cuenta sin compras puede seguir bloqueada si tiene registros de checkout, eventos o autoría administrativa. No se simula su eliminación desactivándola ni se borra ese historial.

Para una cuenta sin esos impedimentos se elimina la fila `User`. Se limpian las relaciones personales descartables: sesiones, restablecimientos de contraseña, cambios de email, direcciones, favoritos, cesta, presencia de checkout, waitlist, pre-registro, colas personales y actividad analítica vinculada. Se retiran permisos y dispositivos push del buzón y su presencia operativa.

La suscripción newsletter se elimina; los enlaces de acceso pendientes o enviados pierden sus tokens y las entregas pendientes se cancelan. Los registros de correo ya enviado se conservan sin vínculo de acceso. Los códigos personales sin uso se mantienen reservados, desactivados y sin propietario numérico huérfano. Los códigos utilizados impiden eliminar la cuenta. Un correo que el transporte ya hubiera aceptado no puede retirarse de su bandeja, pero sus enlaces y credenciales dejan de ser válidos.

La verificación real de sesiones y de QR consulta la cuenta/sesión existente: al desaparecer, los JWT de acceso, refresh y acreditaciones antiguas dejan de funcionar. Los tokens QR y UUID emitidos siguen reservados para impedir su reutilización.

## Auditoría e idempotencia

El borrado crea en la misma transacción un evento `admin.user.delete` en `AuditLog`, con administrador, identidad UUID, ID CRX, nombre/email, cuenta objetivo y contexto de petición. Conserva la política de retención de la auditoría existente.

La nueva tabla privada `AdminUserDeletion` conserva un recibo mínimo: ID interno, UUID, código CRX, ID de quien borró y fecha. No depende de que siga existiendo la cuenta ni de la retención de los logs. Una repetición autenticada con el mismo ID y UUID obtiene `alreadyDeleted: true`, sin una segunda auditoría. Una identidad distinta no puede aprovechar ese recibo. Cualquier error revierte tanto el recibo y la auditoría como la limpieza de accesos y el borrado.

## N.º e identificadores

`registrationNumber` sigue siendo el nombre del campo de presentación que consume el listado, pero ahora se calcula con `row_number() OVER (ORDER BY "createdAt", id)` sobre **todos los usuarios que siguen existiendo**, activos e inactivos. El ranking se calcula antes de filtrar por búsqueda, rol, estado, página u orden por métricas. No se guarda ni se usa como clave de relaciones.

Los IDs numéricos, UUID, códigos CRX y tokens QR de las cuentas restantes no cambian. El cursor de asignación continúa aumentando y tiene en cuenta números/códigos ya reservados, aunque la cuenta ya no exista. Por tanto, pueden quedar huecos en los IDs permanentes y nunca se rellenan por borrar una cuenta. Si quedan 99 cuentas y el último CRX asignado fue 100, la próxima puede mostrar N.º 100 y CRX-000101.

Se encontró y deshabilitó la lógica antigua que compactaba todos los IDs después de `DELETE`. La migración retira su trigger, hace inmutables las identidades y bloquea las funciones antiguas de compactación. El operador `scripts/user-numbering.cjs --apply` queda deshabilitado. El control de preparación de numeración ahora acepta huecos y verifica el cursor creciente; no exige que el máximo ID coincida con el número de usuarios. Los documentos antiguos que describían compactación quedan superados por este cambio.

## Migración necesaria

`cronox-backend/prisma/migrations/20261027210000_safe_user_deletion_permanent_ids/migration.sql`:

- Crea el recibo privado `AdminUserDeletion` y el índice de fecha de creación/ID.
- Conserva todas las identidades emitidas y ajusta el cursor solo hacia delante cuando existan reservas históricas mayores.
- Sustituye el trigger de numeración por asignación permanente y elimina la compactación posterior al borrado.
- Instala la comprobación de relaciones y el trigger de borrado confirmado.

Se ejecutó la migración SQL real sobre una base desechable. **No se ha aplicado en la base habitual**. Antes de activar la versión hay que aplicar las migraciones pendientes, regenerar el cliente Prisma y reiniciar/reconstruir el backend de la forma habitual. El nuevo control de preparación exige esta migración; no se debe recuperar el operador antiguo para cumplirlo. Una instalación vacía se inicializa sin compactación, respetando sus números retirados si los hubiera. Una base no vacía cuya numeración siga sin inicializar requiere resolver esa inicialización expresamente, sin renumerar cuentas emitidas.

## Pruebas ejecutadas

- TypeScript backend y administrador: correctos. Compilación de los bundles de `api.ts` y `admin-user.ts`: correcta. Esquema Prisma validado.
- **73 pruebas en 6 suites**: permisos HTTP, DTO, actualizaciones de usuario, paginación, identidad estable e interfaz relacionada.
- **4 pruebas del control de numeración**: huecos permitidos, números retirados reservados, cursor/reglas inválidas rechazados y operador antiguo bloqueado.
- **10 grupos de pruebas con PostgreSQL real aislado**, usando los servicios existentes y la migración real: cuenta errónea sin historial, confirmación y versión, permisos, borrado propio, peticiones concurrentes/repetidas, auditoría única, JWT/refresh/reset/cambio de email/QR invalidados, favoritos/cesta/waitlist/newsletter limpiados, conservación de identidad, alta posterior sin reutilización, pedidos/stock/QR/checkout bloqueantes, FK nueva en cascada bloqueada, rollback ante fallo y ordinales con fechas empatadas, búsquedas, filtros, inactivos y paginación. La base se elimina al terminar.
- **5 escenarios en navegador Chromium** con el administrador compilado y API aislada: cuenta intermedia con fallo/reintento, última página vacía a 390 px, tema oscuro, cuenta propia y rol ADMIN. Cancelar no envía DELETE; el doble clic no duplica la petición; se comprobó identificación, estilo destructivo, diálogo dentro de pantalla, error sin navegación, aviso de éxito y vuelta a páginas `[2, 1]` al vaciar la última.
- Hashes de **93 archivos del trabajo pendiente**: ninguno perdido; solo se amplía `prisma/schema.prisma` para esta funcionalidad. Checkout, footer y compatibilidad móvil se mantienen. `git diff --check`: correcto.

El navegador usa una API simulada y no elimina datos guardados; las eliminaciones reales de prueba se ejecutaron en PostgreSQL desechable. No se ha probado sobre usuarios reales ni activado la migración en el entorno habitual.

Evidencias en `output/admin-user-deletion/`: `database-results.json`, `browser-results.json`, logs de pruebas y `preservation-result.json`. Capturas en `output/playwright/admin-user-delete-*.png`.

## Archivos principales

- Backend: `src/admin/users/admin-user-deletion.ts`, DTO de eliminación, controlador y servicio de usuarios; guard de identidad; modelo Prisma y migración.
- Numeración: `scripts/user-numbering.cjs`, `scripts/check-user-numbering-release.cjs` y sus pruebas.
- Interfaz: `cronox-front/admin-user.html`, `admin.html`, `src/admin/admin-user.ts`, `src/admin/api.ts`, tipos globales y bundles compilados; listado en `assets/admin.js`.
- Verificación: specs HTTP/paginación/servicio, nuevo `scripts/test-admin-user-deletion-db.cjs` y `tests/admin-user-deletion/browser.cli.js`.

Para repetir PostgreSQL: `node scripts/test-admin-user-deletion-db.cjs` desde `cronox-backend`. La prueba rechaza bases que no sean locales y solo borra la base desechable que ella misma crea. El script de navegador se ejecuta con Playwright CLI contra el servidor de fixtures `127.0.0.1:4173`; intercepta las API y bloquea destinos externos.


## Verificaci?n de la activaci?n habitual ? 27/10/2026

### Destino, respaldo y arranque

La configuraci?n protegida .env.local y una consulta SQL independiente confirmaron **NODE_ENV=development**, servidor **127.0.0.1**, puerto **5433**, base **cronox_dev**, con el mismo destino de aplicaci?n y migraci?n. Correo y trabajos generales permanecen desactivados; se conserva la activaci?n de checkout Stripe test anterior.

Se cre? un respaldo nuevo **antes de modificar datos de prueba**, usando pg_dump custom, y se valid? su cat?logo con pg_restore. Archivo privado: output/user-deletion-local-activation/cronox_dev-before.dump, **589021 bytes**, SHA-256 **787ea57dad10ca964ed6d3a8e6019e5291c4d3a3788c21e255caccdeb636776f**. El respaldo y las cookies/estados de prueba est?n excluidos de Git. La base ten?a inicialmente dos usuarios, dos pedidos y catorce productos; los datos ya existentes se conservaron.

Las dos migraciones ya estaban registradas desde la activaci?n del checkout:

| Migraci?n | Finalizaci?n UTC | Estado |
|---|---|---|
| 20261027190000_checkout_presence_and_payment_window | 2026-10-27 14:19:42.507Z | Aplicada, checksum correcto |
| 20261027210000_safe_user_deletion_permanent_ids | 2026-10-27 14:19:42.524Z | Aplicada, checksum correcto |

El orden es compatible: primero se crean los campos y la presencia del checkout; despu?s se instala el borrado conservador que conoce esas relaciones. migrate status devuelve **Database schema is up to date**. No hab?a ninguna migraci?n adicional pendiente; no se aplic? ninguna nueva ni se us? reset/db push sobre cronox_dev.

Al regenerar Prisma reapareci? EPERM: un hijo del backend, PID **51576**, conservaba cargada query_engine-windows.dll.node tras cerrar el observador anterior (PID 33208). Se identific? el m?dulo y su ruta del proyecto, se detuvo ?nicamente ese proceso y se regener? correctamente **Prisma 6.19.3** en la carpeta habitual. Nest compil?, se reinici? en modo watch y confirm? conexi?n con la base; los dos trabajadores de checkout siguieron activos. PostgreSQL, la escucha Stripe test, el servidor de fixtures y los procesos ajenos se conservaron.

### Incompatibilidad reproducida y corregida

El primer borrado HTTP de una cuenta ficticia con newsletter recibi? un 500: la restricci?n SQL NewsletterMailJob_status_check solo admite QUEUED, PROCESSING, SENT, FAILED y UNCERTAIN. La implementaci?n intentaba guardar CANCELLED, que Prisma db push no hab?a reproducido en la base desechable inicial.

Se verific? el rollback real: la cuenta y el token segu?an presentes, sin recibo ni auditor?a de borrado. La correcci?n usa el estado terminal existente **FAILED / ACCOUNT_DELETED** para las entregas pendientes, limpia sus claims y tokens y mantiene SENT/UNCERTAIN como evidencia sin acceso v?lido. El trabajador solo adquiere QUEUED, de modo que estas entregas no se reintentan. No se ampli? la restricci?n ni se modific? una migraci?n ya aplicada.

La prueba PostgreSQL ahora instala la restricci?n original le?da de su migraci?n SQL, adem?s del esquema Prisma. Pasan el borrado y los controles de limpieza bajo esa misma restricci?n. Las pruebas focales del trabajador de newsletter tambi?n pasan. EmailDelivery conserva su mecanismo de cancelaci?n existente; no tiene la restricci?n que origin? este fallo.

### Pruebas reales contra localhost

Ejecutable: cronox-backend/scripts/verify-user-deletion-local-activation.cjs. Exige cronox_dev en 127.0.0.1:5433, entorno de desarrollo y evidencia del respaldo. Todas las cuentas llevan un UUID exclusivo de ejecuci?n y email ficticio @example.test; cada DELETE comprueba que el objetivo pertenece a esas cuentas.

- HTTP: an?nimo devuelve 401; USER y ADMIN devuelven 403. ADMIN tampoco puede borrar ADMIN/SUPERADMIN. SUPERADMIN puede eliminar cuentas administrativas ficticias ajenas sin historial. Borrado propio, falta de confirmaci?n, versi?n antigua y UUID incorrecto se rechazan conservando la cuenta.
- Borrado real de la cuenta intermedia **444 / CRX-000444** y repetici?n HTTP: una sola auditor?a y un recibo durable. La cuenta desaparece; login, acceso y refresh dejan de funcionar; QR antes v?lido pasa a inv?lido. Se comprueban sesiones, reset, cambio de email, favoritos, waitlist, cesta y newsletter sin credenciales o relaciones hu?rfanas.
- El siguiente usuario existente **445 / CRX-000445**, inactivo, pasa de **N.? 24 a N.? 23**, manteniendo toda su fila, UUID, ID CRX y QR. Paginaci?n global, b?squeda, filtro de inactivos y ordenaci?n por ingresos conservan el ordinal calculado por creaci?n/ID.
- Alta mediante el endpoint normal de registro: **451 / CRX-000451**, asignado desde UserNumberingState.nextId. CRX-000444 y su n?mero interno siguen reservados.
- Un pedido ficticio cancelado bloquea el borrado con USER_DELETE_BLOCKED y motivos Order; el pedido no cambia. Un checkout real abierto bloquea el borrado con motivos CheckoutSnapshot y conserva la unidad reservada. La salida expl?cita del checkout restaura esa unidad y mantiene el historial y la cuenta.
- Se eliminan las cuentas administrativas ficticias sin historial **448 y 449** mediante el SUPERADMIN de prueba. No se eliminan los administradores preexistentes.
- Navegador Chromium contra la API real: di?logo de la cuenta **450 / CRX-000450** con nombre, email y CRX; cancelar produce cero DELETE; confirmar produce una petici?n, con bot?n deshabilitado mientras se procesa. Vuelve al listado con b?squeda/orden conservados y aviso de ?xito; el detalle eliminado devuelve 409 por identidad retirada. Se comprueban despu?s recibo y auditor?a ?nicos.
- Resultado: los cuatro objetivos ficticios 444, 448, 449 y 450 est?n realmente eliminados. Los productos, variantes, pedidos, usuarios, checkouts y movimientos de stock anteriores a la ejecuci?n completa permanecen iguales, comparados por contenido.

Quedan como evidencia cuentas ficticias inactivas y sin sesiones, un producto ficticio inactivo, un pedido cancelado de prueba y un checkout terminado. Durante la preparaci?n hubo siete cuentas incompletas por un email con may?sculas rechazado por la restricci?n can?nica y diez cuentas de la reproducci?n del fallo newsletter; sus credenciales se invalidaron y quedaron inactivas. Estas cuentas no se presentan como eliminadas. No se borraron datos reales ni se alter? historial para facilitar los tests.

### Comprobaciones focales y estado final

- **89 pruebas Jest en ocho suites** de usuarios, identidad, ordinales, presencia de checkout, caducidad y recuperaci?n de webhooks; **cuatro pruebas adicionales** del trabajador newsletter.
- **Cuatro pruebas Node** del control de numeraci?n permanente.
- **Diez grupos PostgreSQL** de eliminaci?n, ampliados con la restricci?n real de newsletter: concurrencia/idempotencia, rollback, relaciones nuevas, historial, sesiones, QR y ordinales. Base desechable eliminada al finalizar.
- **Diecis?is grupos PostgreSQL** de checkout tras regenerar el cliente: presencia/salida, 360 segundos inmutables, conciliaci?n, stock y combinaci?n de cestas. Proveedor controlado; no se repiti? la prueba Stripe de seis minutos ni se iniciaron pagos en esta tarea.
- Navegador real y API normal local aprobados. Compilaci?n Nest y typecheck correctos.

La activaci?n est? operativa localmente. No hace falta otra migraci?n para la correcci?n de newsletter. Las comprobaciones f?sicas de tarjeta/wallets/3DS y el bloqueo hCaptcha documentados en el informe de checkout siguen pendientes y no se dan por resueltos mediante estas pruebas de usuarios.

Evidencias nuevas: output/user-deletion-local-activation/preflight.json, generate.log, migrate-status.log, installation-results.json, installation-final.log, constraint-rollback.json, database-results.json, checkout-db-results.json, browser-results.txt y logs focales. Capturas output/playwright/user-deletion-local-confirm.png y user-deletion-local-success.png. No publicar los archivos privados ni el respaldo.

Archivos adicionales/modificados para esta activaci?n: admin-user-deletion.ts (estado terminal de newsletter), scripts/test-admin-user-deletion-db.cjs (restricci?n SQL real), nuevo scripts/verify-user-deletion-local-activation.cjs, exclusiones privadas en .gitignore y este informe. Se conservan los trabajos pendientes de checkout, footer y compatibilidad m?vil.

Cierre de verificaci?n: 129 archivos con trabajo pendiente comprobados por SHA-256, ninguno ausente. Las ?nicas diferencias sobre ellos son el ajuste de estado newsletter, su prueba PostgreSQL y los dos informes actualizados. Estado SQL final: cuatro recibos de borrado ficticio, cero reservas de stock retenidas y trigger antiguo de compactaci?n ausente. El frontend administrativo responde HTTP 200.
