# CRONOX: bandeja y campañas

La revisión de los tres trabajos y el procedimiento detallado de publicación
están en [la revisión integrada](mail-admin-joint-release-review-2026-10-04.md).

## Cambios

- Carpetas plegadas inicialmente mediante `details/summary`, con teclado y selección conservada. La entrada habitual utiliza INBOX; las carpetas especiales y las banderas IMAP separan recibidos, enviados y borradores. Se mantienen las carpetas personalizadas y la selección múltiple.
- Estado leído/no leído aplicado en la consulta antes de contar y paginar. Búsqueda automática con espera de 250 ms, cambio de estado inmediato y descarte de respuestas antiguas. Marcar leído/no leído actualiza lista y contadores sin cerrar el mensaje abierto; la sincronización no reutiliza respuestas anteriores a esa operación.
- Nombre interno opcional de campaña, independiente del asunto y del contenido del cliente. Las campañas antiguas sin nombre muestran su identificador y conservan sus datos.
- Borradores, Salidas e Historial separados mediante consultas por estado persistido. Abrir, editar, contar y exportar no crean campañas. Guardar borrador es explícito y permite datos incompletos. Confirmar envío o programación guarda y encola en una transacción; un borrador existente pasa a Salidas conservando su identidad.
- Eliminado Revisar campaña. La revisión interna se actualiza automáticamente. La confirmación de envío muestra nombre, familia, círculos y contador; requiere confirmación expresa. Las fechas se validan en Europe/Madrid, incluida la ambigüedad del cambio de hora. El backend mantiene las comprobaciones de permisos, contenido, variables, versiones por círculo, consentimiento y políticas de envío.
- Contador, exportación XLSX y envío comparten la resolución de destinatarios. El Excel contiene únicamente nombre, correo, círculo y versión; los textos se escriben como datos, incluso si empiezan por `=`. La confirmación y el trabajador vuelven a validar la elegibilidad. La clave de idempotencia permanece estable durante la edición para recuperar una confirmación cuya respuesta se haya perdido.
- Se conservan las plantillas, remitentes, contraseñas, configuración de buzones y comportamiento del menú del encargo anterior. Las familias retiradas de Info no vuelven a ofrecerse para nuevas campañas.

## Migración

`20261004130000_campaign_internal_name` añade únicamente `MailboxDraft.campaignName`, nullable. No cambia asuntos, contenido ni estados existentes. Comprobada en la base local y sobre una base desechable con un borrador anterior a la migración; no aplicada a producción.

## Verificación local

- Backend Nest y administrador Vite compilados correctamente.
- Jest: 20 suites, 194 pruebas aprobadas, incluyendo correo integrado, campañas, plantillas, navegación y contraseñas.
- `node cronox-backend/scripts/review-mailbox.cjs`: integración con PostgreSQL desechable, IMAP simulado y SMTP limitado a loopback. Incluye migración conservadora, lectura paginada de 30 mensajes, filtros vacíos, carpetas especiales con nombres arbitrarios, banderas de borrador/envío, búsqueda por destinatario, XLSX real, consentimiento, deduplicación, confirmación concurrente y transición sin duplicados. Las comprobaciones nuevas no entregan mensajes SMTP.
- `tests/admin-review/inbox-campaign-controls.browser.js`, ejecutado con Playwright CLI sobre servidor local: escritorio de 1366 px y móvil táctil de 390 px, cada uno en claro y oscuro. Cubre carpetas, teclado, paginación, búsqueda con respuestas fuera de orden, lectura/sincronización, contador cero y error, exportación sin guardado, confirmación/cancelación, guardado incompleto, programación y recuperación de respuesta perdida sin duplicar campañas.
- Revisión visual de bandeja, editor y modal en las cuatro combinaciones. Capturas locales en `output/playwright/`. Regresión del menú lateral y configuración de buzones verificada con `tests/admin-review/sidebar-mail-settings.browser.js`.
- Ningún correo real enviado, ningún dato de producción alterado; sin push ni despliegue.

## Pasos pendientes para publicar

1. Revisar el commit y respaldar la base del entorno de destino.
2. Aplicar las migraciones pendientes con el procedimiento habitual, generar Prisma y compilar backend y administrador. Desplegar los archivos y versiones de caché conjuntamente.
3. Reiniciar los servicios según el procedimiento del proyecto y comprobar bandeja, listas y permisos en el entorno de destino. Mantener las políticas y límites de envío actuales; estos cambios no requieren activar campañas ni modificar SMTP/IMAP.

No se han ejecutado estos pasos de publicación.
