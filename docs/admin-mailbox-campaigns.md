# Correo: campañas por familia y círculo

Actualizado el 3 de octubre de 2026. Cambios locales en `main`, sin publicación ni operaciones de correo reales. La evidencia anterior de producción se conserva en [admin-publication-2026-10-03.md](admin-publication-2026-10-03.md).

## Uso

1. **Correo → Nueva campaña** usa exclusivamente `info@cronox.es`, aunque esté seleccionado Soporte u otro buzón. El remitente es fijo y el servidor también lo valida.
2. Selecciona una familia y marca los círculos destinatarios. Una familia aparece una sola vez; su identidad no depende de su nombre ni de la carpeta.
3. Para reposición, selecciona el producto y la talla disponibles. El servidor obtiene nombre, talla, imagen y enlace del catálogo activo. Los datos personales proceden de la cuenta elegible, sin valores de ejemplo.
4. Guarda el borrador y pulsa **Revisar campaña**. Verás total único, cantidades por círculo, asuntos y contenidos de solo lectura. Las versiones o variables faltantes bloquean la campaña completa. No se sustituye una versión por otra.
5. Confirma **Enviar ahora** o **Programar envío**. La fecha pertenece a `Europe/Madrid`; las horas inexistentes se rechazan y las repetidas requieren escoger UTC+02:00 o UTC+01:00.
6. **Borradores y salida** muestra seguimiento por círculo, destinatarios pendientes y espera por capacidad. Una programación aún no iniciada se puede cancelar para editar y revisar de nuevo; cancelar una campaña detiene sus pendientes.

Esta pantalla no contiene redacción libre, destinatarios manuales, adjuntos, selector de remitente ni opción «Sin plantilla». Responder y reenviar siguen usando su compositor individual desde el mensaje recibido y su buzón original, sin plantillas de campaña. Los filtros con casillas, la selección múltiple de carpetas y sus etiquetas en español se conservan.

## Plantillas Mail

**Plantillas Mail → Información → Familias de campañas** permite cambiar el nombre general, crear una familia y relacionar versiones existentes disponibles. Cada círculo abre su propio editor: asunto, HTML mediante el constructor existente, variables y texto plano alternativo independiente. Guardar una versión no sobrescribe las otras. Las identidades de familia/círculo son independientes de la carpeta física y no se cambian moviendo carpetas.

Las plantillas importadas conocidas se relacionan por `INFO:<círculo>:<propósito>`, exclusivamente para `RESTOCK`, `LAUNCH` y `GENERIC`. La migración conserva ID, nombre, asunto, HTML, texto, documento, revisión, publicaciones y automatizaciones. Plantillas personalizadas sin esa identidad necesitan una relación explícita; compartir título no las agrupa. Las transaccionales permanecen fuera de las familias y conservan sus remitentes actuales.

El evento de una familia es estable. Una versión vinculada se edita por separado y conserva su propósito. Una copia de plantilla queda sin vínculo hasta relacionarla explícitamente con una familia y un círculo libres. Si una versión está archivada, debe restaurarse para poder utilizarla; no existe sustitución automática.

Los textos dinámicos genéricos como `{{message}}` o `{{subject}}` no reciben contenido libre desde Nueva campaña. Deben convertirse en contenido definido en esa versión desde Plantillas Mail. El panel indica las variables faltantes. No se altera automáticamente ninguna plantilla para resolverlas.

## Persistencia y protección

- `CampaignTemplateFamily`: ID estable, nombre, evento y revisión.
- `ManagedEmailTemplate`: vínculo opcional a familia/círculo, combinación única y alternativa de texto opcional.
- `MailboxDraft` con modo `campaign`: familia, círculos y evento; las entradas de cuerpo, destinatarios o cambio de buzón se rechazan.
- `MailboxCampaign.snapshot` versión 2: familia y vistas de contenido aprobadas por círculo. Cada entrega guarda círculo, ID/revisión de plantilla y asunto/HTML/texto personalizados e inmutables. Una edición posterior no cambia una campaña confirmada.
- Revisión con hash y confirmación en transacción `RepeatableRead`, revisión optimista y claves únicas de idempotencia. Cambios en contenido o audiencia requieren otra revisión. No se muestran listas de destinatarios en el resumen.
- `User.circleLevel` es escalar. Se deduplican direcciones normalizadas; cuentas activas suscritas con la misma dirección y círculos distintos bloquean la confirmación. Antes del SMTP se revisan consentimiento, supresión, estado, permiso y círculo actual. Cambiar de círculo excluye la entrega; no cambia su versión.
- Una entrega por dirección, CCO y sobre SMTP individual. No se publican direcciones de otros destinatarios. Se conserva la baja mediante token opaco y la supresión persistente.
- Se mantienen el bloqueo por buzón, el reloj persistente, la recuperación de interrupciones y los reintentos limitados para rechazos temporales confirmados. Un resultado incierto tras el envío queda `UNKNOWN` y no se repite automáticamente.
- La cuota diaria y horaria cuenta campañas, envíos manuales y transaccionales **del buzón Información**. No reserva capacidad para otros buzones; `MAILBOX_CAMPAIGN_TRANSACTIONAL_RESERVE` ya no se usa. El uso desde clientes externos no está incluido en esos contadores; deben conservarse límites configurados adecuados al plan real.
- Las familias y los datos de campaña permanecen privados, sin acceso para `anon` ni `authenticated`.

## Compatibilidad y publicación posterior

Los borradores `circles` y campañas sin snapshot versión 2 conservan sus datos y se señalan como anteriores. El trabajador los bloquea con `MAILBOX_CAMPAIGN_LEGACY_REVIEW_REQUIRED`; no los convierte ni envía. Se pueden consultar y cancelar. Para utilizarlos, hay que crear y revisar una nueva campaña con familia y versiones válidas. Las respuestas, reenvíos, plantillas transaccionales y push conservan sus mecanismos actuales.

La migración nueva es `20261003170000_mailbox_template_families`: solo añade estructura, relaciones e identidades explícitas. No resetea bases, elimina registros ni reescribe contenidos. Se verifica con plantillas anteriores renombradas y una transaccional del mismo título en PostgreSQL aislado.

Cuando se autorice publicar, sincronizar los commits con `origin/main` mediante el flujo existente, aplicar las migraciones con `prisma migrate deploy` durante el despliegue y regenerar/compilar el backend antes de reiniciarlo. El frontend utiliza las nuevas API y sus recursos tienen versiones incrementadas. Revisar familias/variables faltantes y campañas anteriores antes de confirmar nuevos envíos. Esta tarea no cambia flags, credenciales ni trabajadores de producción.

## Verificación reproducible

Resultado del 3 de octubre de 2026: compilaciones de backend/panel correctas, 154 pruebas Jest en 16 suites y 52 comprobaciones de integración aprobadas. Las vistas de campañas, el editor independiente y las regresiones de lectura/respuesta se comprobaron a 1440 y 390 px. La migración está aplicada también en `127.0.0.1:5433/cronox_dev`; producción no se modificó.

- Backend: `npm run build:compiled`, suite Jest de correo/buzones/push/visitantes y `node scripts/review-mailbox.cjs` desde `cronox-backend`.
- El revisor crea PostgreSQL efímero, proveedor IMAP simulado y SMTP exclusivamente loopback; no carga `.env` ni contacta servicios reales. Verifica migración con contenido anterior, identidades estables, Info exclusivo, versiones distintas, manipulación de peticiones, ausencia de variables/versiones, datos reales del evento, bajas, deduplicación, ambigüedad, cambio de círculo, contenido congelado, horarios, cancelación, capacidad y reinicios/reintentos.
- Panel: `npm run admin:build`. Con el revisor `--serve`, ejecutar los scripts CLI de `tests/admin-review/mailbox-campaigns.browser.js`, `mailbox-family-editor.browser.js` y `mailbox-reading.browser.js`. Cubren 1440 y 390 px, edición independiente de versiones, ausencia de redacción en campañas y conservación de lectura/respuesta/reenvío con cambios rápidos.
- Las capturas y resultados quedan en directorios locales ignorados; no forman parte del commit.

Para actualizar los recursos locales durante desarrollo, ejecutar **`npm run admin:watch`** en la raíz.
