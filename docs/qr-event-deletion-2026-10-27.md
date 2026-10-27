# Eliminación de eventos QR — 27/10/2026

Implementado en local. Solo SUPERADMIN puede eliminar eventos. No se han eliminado eventos reales, modificado producción, realizado commit/push ni desplegado cambios.

## Interfaz

Cada tarjeta incluye «Eliminar» arriba a la derecha, con estilo destructivo. El encabezado distribuye nombre y botón en una fila flexible; descripción, número de participantes y «Abrir grupo» mantienen su espacio. El servidor devuelve `canDelete` al listado según el rol autenticado: ADMIN sigue pudiendo listar, crear, abrir y escanear, sin recibir la acción de borrado.

El diálogo muestra nombre y número de participantes del listado leído, además del alcance y la advertencia irreversible. Sus contenidos se insertan como texto. «Cancelar» y Escape no envían ninguna petición. Tras confirmar se deshabilitan confirmación, cancelación y Escape mientras se procesa, impidiendo solicitudes repetidas desde el diálogo. El número mostrado es una instantánea; si otro administrador registra una participación antes del bloqueo de borrado, también se elimina y su cantidad real queda en la auditoría.

Solo una respuesta del servidor con `deleted: true` y el UUID solicitado retira la tarjeta. Después se consulta de nuevo el listado conservando la búsqueda y ajustando la página al total vigente. Si se vacía la última página se pasa a la anterior disponible. Se muestra un aviso de éxito. Un fallo de borrado conserva la tarjeta y permite cancelar o reintentar. Un fallo de red puede ocultar una respuesta ya confirmada en servidor: el texto indica comprobar el listado o repetir la confirmación, que es idempotente. Si el borrado se confirma pero falla la actualización posterior del listado, la tarjeta eliminada sigue retirada y se explica que falta actualizar los datos.

## Backend, relaciones y concurrencia

`DELETE /api/admin/qr-events/:id` exige UUID válido, sesión administrativa, rol SUPERADMIN, guard SuperAdmin y cuerpo `{ "confirmed": true }`. Conserva la protección CSRF global y las cabeceras privadas/no-store. Además de los guards, la transacción vuelve a leer y bloquear el administrador, exigiendo SUPERADMIN activo.

Se revisaron los modelos y la migración QR existente: `QrEventParticipant.groupId` es la única relación dependiente del grupo, con FK `ON DELETE RESTRICT`. La operación usa una transacción READ COMMITTED:

1. Bloquea el grupo con `SELECT ... FOR UPDATE`.
2. Comprueba y bloquea el actor con `FOR SHARE`.
3. Elimina únicamente participaciones cuyo `groupId` coincide y después el grupo.
4. Registra `qr_event.delete` en `AuditLog`, con actor, UUID, nombre y número realmente eliminado, usando `requestKey = qr-event-delete:<UUID>`.

El recibo de la petición incluye el número de participaciones eliminadas. Si no existe el UUID, un SUPERADMIN recibe `alreadyDeleted: true`; no se añade otra auditoría. Dos borrados concurrentes se serializan por la fila del grupo. Si falla cualquier paso, incluida la auditoría, se revierte el grupo y todas sus participaciones. No se usan archivado ni borrado simulado.

El escaneo mantiene `FOR SHARE` sobre la misma fila. Si empieza primero, el borrado espera su confirmación y luego retira también esa participación. Si el borrado empieza primero, el escaneo espera y obtiene `GROUP_UNAVAILABLE`, sin insertar nada. Detalle, participantes y exportación también rechazan grupos inexistentes.

Se adelantó la comprobación/bloqueo del grupo a cualquier posible promoción de círculo. La rutina de promoción acepta ahora la transacción existente; sus reglas y su uso habitual siguen iguales. Esto permite que el escaneo use una única conexión y evita agotar el pool mediante transacciones anidadas. El bloqueo de promoción es `FOR NO KEY UPDATE`, adecuado para cambios de círculo, compatible con las referencias FK del registrador y sin permitir modificar identidades.

Una pantalla abierta detecta la eliminación en su siguiente lectura, exportación o intento de escaneo. Explica que el grupo puede haber sido eliminado, detiene la cámara, deshabilita nuevos escaneos y mantiene «Todos los grupos» para volver. No requiere notificaciones push ni sondeo adicional.

La eliminación no escribe en User, acreditaciones, QR, códigos CRX, círculos, otros grupos, pedidos o compras. Los usuarios no se eliminan ni se fusionan. Las posibles promociones al escanear un grupo válido mantienen sus reglas anteriores; una petición sobre un grupo ya eliminado no llega a ejecutarlas.

## Migración y estado local

**No hace falta ninguna migración nueva ni regenerar Prisma:** los modelos y relaciones existentes permiten el borrado explícito y la auditoría. No se modificaron migraciones ni el esquema Prisma. Se compiló el backend, y el observador local reinició correctamente con la ruta DELETE registrada y la conexión establecida. Los trabajos pendientes de checkout, borrado de usuarios, footer y compatibilidad móvil se conservaron.

Los borrados reales de prueba se ejecutaron exclusivamente en una base PostgreSQL desechable con nombre `cronox_qr_delete_test_<UUID>`, creada en loopback y eliminada al terminar. La instalación habitual no recibió borrados ni cambios de sus grupos. El test instala la migración SQL QR original sobre el esquema de pruebas para conservar sus checks y FK reales; no depende solo de `db push`.

## Verificación

- **89 pruebas Jest, cuatro suites:** servicio QR/exportación, ciclo de cámara/lecturas, nuevo diálogo de borrado y reglas de promoción. Incluyen cancelación, error/reintento, confirmación deshabilitada, doble clic, respuesta no confirmada, lectura tardía, conservación de búsqueda y ajuste de paginación.
- **Nueve grupos PostgreSQL y HTTP reales:** borrado vacío y con tres participaciones —incluida una histórica anónima—, dos borrados simultáneos con auditoría única, 12 escaneos concurrentes con un pool de solo dos conexiones, ambas carreras escaneo/borrado, promoción pendiente sin ejecutar tras borrar, JWT/roles/CSRF/confirmación, rollback por fallo SQL de auditoría y conservación de otros datos.
- El test compara todos los campos de los usuarios, CRX/QR, círculo, diseño y selección de acreditación, pedido y registros de otro evento antes y después. Comprueba cero participaciones huérfanas. La base desechable terminó eliminada.
- **Cuatro escenarios Chromium** sobre el HTML/CSS/JS reales con API aislada: SUPERADMIN en escritorio a 1366 px y móvil a 390 px, ADMIN sin botón, y última página a 320 px con búsqueda activa. Se verificaron nombre/cantidad, cancelación sin DELETE, error conservando tarjeta, reintento, estado ocupado, éxito, ausencia de solapamientos/scroll horizontal y regreso desde un grupo eliminado. Al borrar el grupo 26 se pasa de página 2 a 1 conservando la búsqueda y mostrando 25 grupos.
- TypeScript, compilación Nest, sintaxis JavaScript y `git diff --check`: correctos. No se repitieron pagos ni pruebas ajenas al cambio.

La autorización de cámara física no se volvió a solicitar: el cambio de estado por grupo eliminado se comprobó con medios simulados en los tests de cámara. La concurrencia y la conservación de datos se verificaron con los servicios y la base PostgreSQL reales, separadas de la API simulada del navegador.

## Archivos y evidencias

- Backend: `src/admin/qr-events/qr-events.controller.ts`, `qr-events.dto.ts`, `qr-events.module.ts` y `qr-events.service.ts`.
- Coordinación de transacciones: `src/membership/circle.service.ts` y su prueba.
- Interfaz: `cronox-front/admin.html`, `assets/admin-qr-events.js` y `assets/admin-qr-events.css`, con versión de caché actualizada.
- Pruebas: `src/frontend/admin-qr-events.dom.spec.ts`, nuevo `admin-qr-event-deletion.dom.spec.ts`, nuevo `scripts/test-qr-event-deletion-db.cjs` y `tests/qr-event-deletion/browser.cli.js`.

Evidencias en `output/qr-event-deletion/`: `database-results.json`, `browser-results.json`, `final-tests.log`, `circle-tests.log`, `typecheck.log`, `build.log` y `preservation-result.json`. Capturas `output/playwright/qr-event-delete-*.png`.

Para repetir las pruebas PostgreSQL, desde `cronox-backend`: `node scripts/test-qr-event-deletion-db.cjs`. El ejecutable rechaza servidores remotos y solo borra la base desechable que acaba de crear. El script de navegador usa Playwright CLI y el servidor de fixtures `127.0.0.1:4173`; intercepta todas las API y no elimina eventos guardados.

Preservación: 130 archivos con cambios previos comprobados por SHA-256, ninguno ausente. Solo cambia `cronox-front/admin.html` entre esos archivos, para incorporar el diálogo y actualizar la versión de los assets; sus modificaciones previas permanecen.
