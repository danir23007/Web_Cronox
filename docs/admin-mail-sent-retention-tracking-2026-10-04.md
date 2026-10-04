# CRONOX: borradores, conservación de enviados y atribución de campañas

## Cambios entregados

Cada borrador tiene un botón accesible de eliminación y una confirmación con Cancelar como foco inicial. La API comprueba propietario, permisos, revisión y estado dentro de la misma transacción que compite con el envío. Un envío iniciado o una campaña activa impiden eliminar el borrador. Se retiran solamente sus recursos exclusivos; las claves privadas todavía referenciadas se conservan. Los errores y conflictos mantienen el borrador visible.

La política se determina por la identidad SMTP configurada, nunca por el nombre visible del buzón. Las coincidencias ambiguas no autorizan una limpieza destructiva.

| Cuenta | Datos conservados después de la aceptación SMTP |
| --- | --- |
| NOREPLY / ORDERS | Identificadores, usuario, cuota, idempotencia, fecha y resultado del envío. Sin asunto, cuerpo, destinatarios del borrador ni adjuntos privados. Sin APPEND ni reimportación de Enviados. |
| INFO | Una versión inmutable por contenido efectivo de campaña, compartida por sus destinatarios. Cada destinatario conserva versión, resultado y atribución; no conserva otro cuerpo completo. Sin APPEND ni reimportación de Enviados. |
| SUPPORT | Enviados durante 30 días; después, limpieza local y del proveedor sobre su carpeta Enviados confirmada. Recibidos y borradores quedan fuera. |

Los borradores todavía no enviados siguen siendo editables y persistentes. Rechazo SMTP, resultado incierto y fallo al guardar una copia siguen siendo estados diferentes: nunca se simula una recepción correcta ni se reenvía automáticamente un resultado incierto. El recolector de archivos usa una cola durable y vuelve a comprobar referencias antes de borrar.

Las campañas nuevas congelan el cuerpo efectivo, incluido su pie, antes del envío. El marcador de baja se sustituye por destinatario al enviar. El historial muestra estas versiones guardadas, no vuelve a renderizar una plantilla que haya cambiado. Para campañas antiguas se utiliza solamente contenido realmente almacenado; si no permite una asociación fiable, se conserva y se informa.

El historial incorpora nombre interno, fecha del primer envío aceptado, versiones, destinatarios y resultados individuales. Los previews son iframes aislados sin scripts ni acceso a recursos externos. La ausencia de fecha confirmada se muestra explícitamente.

## Medición y límites

La efectividad es `destinatarios únicos con acceso atribuido / destinatarios aceptados por SMTP × 100`. Sin denominador o sin seguimiento disponible se muestra **Sin datos**. Un rechazo, una incertidumbre y un rebote confirmado se presentan por separado; un rebote no elimina la aceptación SMTP histórica del denominador. La aceptación SMTP no acredita entrega en la bandeja del destinatario. No se ha incorporado un adaptador de verificación de DSN/webhooks del proveedor: el contador de rebotes cuenta solamente evidencias ya registradas, nunca rebotes inferidos.

El seguimiento requiere `MAILBOX_CAMPAIGN_TRACKING_ENABLED=true` tanto al preparar/enviar como al recibir la visita. Está desactivado por defecto. No se inventan accesos para campañas antiguas.

Los enlaces cifrados contienen un identificador aleatorio y un destino público autorizado de CRONOX; no incluyen correo, sesión ni identidad personal. Se excluyen destinos externos, bajas, mailto/tel, administración, autenticación y URLs con credenciales o tokens sensibles. La redirección no autentica ni concede acceso y no cuenta como visita. La página de destino conserva su consulta y fragmento y retira el parámetro de atribución de la barra de direcciones.

La atribución exige consentimiento analítico existente, una página visible, permanencia y una interacción humana del navegador. Se rechazan prefetch, agentes automatizados conocidos, sesiones administrativas y visitas fuera de la ventana temporal. No hay píxeles ni nuevas cookies no esenciales. Revocar el consentimiento detiene la medición; un fallo de métricas deja la página utilizable. Esta es una estimación de visitas atribuidas: un escáner que imite interacción humana puede pasar los filtros, un enlace reenviado puede atribuirse al destinatario original y la falta de consentimiento, JavaScript o solicitudes bloqueadas reduce el recuento. No demuestra identidad ni apertura del correo.

## Migración y limpieza

Migración: `cronox-backend/prisma/migrations/20261004150000_mailbox_sent_policy_tracking/migration.sql`. Añade versiones compartidas, campos de resultados/atribución, cursor de limpieza y cola de archivos; no ejecuta una eliminación histórica masiva. Las nuevas tablas tienen RLS y revocación de acceso público. Se aplicó solamente a PostgreSQL efímero local durante las pruebas. Antes de un despliegue futuro, revisar configuración, copia de seguridad y salida de simulación; esta entrega no modifica producción.

El trabajador existente ejecuta la cola de archivos y retira contenido de borradores aceptados de las cuentas sin conservación. La limpieza periódica de Enviados requiere `MAILBOX_SENT_RETENTION_ENABLED=true`; rota buzones activos sin depender de abrir el panel. Los fallos se registran y no bloquean el envío o la sincronización. No se ha activado esta opción en producción.

La limpieza usa leases, comprobaciones de UIDVALIDITY y lotes de hasta 100 mensajes, con cursor por carpeta. Solo acepta una carpeta con el atributo real `\\Sent`; no adivina carpetas destructivas por etiquetas. La eliminación remota exige UIDPLUS y expunge de los UID seleccionados, nunca EXPUNGE general. Las copias INFO necesitan una asociación exacta por Message-ID, cuenta y versión congelada; las no asociables permanecen y aparecen en `unresolved`. La simulación no elimina ni normaliza contenido (puede adquirir y liberar el lease de coordinación).

Procedimiento de revisión, con variables de entorno explícitas y el backend compilado:

```powershell
npm run build:compiled --prefix cronox-backend
# Configurar DATABASE_URL y las referencias de credenciales del entorno que se desea revisar.
# El script no carga .env automáticamente.
node cronox-backend/scripts/mailbox-cleanup.cjs --mailbox=<ID-exacto> --simulate
# Revisar local, provider, drafts, normalizedCampaigns, unresolved, more y folders[].nextUid.
node cronox-backend/scripts/mailbox-cleanup.cjs --mailbox=<ID-exacto> --simulate --after-uid=<nextUid>
```

`--execute` en este CLI está limitado a una base de datos loopback y exige `MAILBOX_CLEANUP_TEST_ADAPTER`, un módulo local que exporte la función asíncrona que devuelve el cliente IMAP simulado. Una base local podría contener credenciales reales, por eso no basta con comprobar DATABASE_URL. La ejecución real periódica es responsabilidad del trabajador tras revisar y activar su configuración en un despliegue posterior; no está autorizada ni realizada por esta entrega. Repetir la limpieza no vuelve a borrar recursos ni recrea cuerpos ya retirados.

No hacer APPEND evita la copia creada por CRONOX, pero no desactiva una copia que el proveedor o un cliente de correo guarde por su cuenta. Revisar esa opción de guardado automático de Enviados en las cuentas NOREPLY, ORDERS e INFO. Si no se puede desactivar, el trabajador puede retirar las copias según la política anterior; las copias INFO sin asociación fiable requieren revisión. El proveedor debe anunciar `\\Sent` y UIDPLUS para la eliminación remota segura. No se cambiaron ajustes del proveedor en esta entrega.

## Verificación local

Se mantuvo el commit anterior de menú anidado y retirada de botones de Correo. No se enviaron correos a destinatarios reales, no se modificaron mensajes de un proveedor real y no hubo push ni despliegue.

- 62 comprobaciones de integración con PostgreSQL efímero, servidor SMTP/TLS loopback e IMAP simulado. Incluyen migración, permisos, concurrencia borrar/enviar, almacenamiento por cuenta, recursos compartidos, límites de 30 días, UIDPLUS, ausencia de EXPUNGE general, limpieza idempotente, campañas antiguas, atribución 50/100 y continuidad de errores/reintentos.
- 121 pruebas unitarias en 10 suites del buzón, planificación, políticas, autenticación, galería, navegación, push y DOM del administrador; incluye 16 casos específicos de seguimiento.
- Navegador: escritorio y móvil táctil, temas claro y oscuro; cancelar/eliminar/conflicto, foco de teclado, historial y contenido congelado, resultados y ausencia de desbordamiento. También consentimiento, retirada del parámetro, interacción, fallo temporal, reintento, deduplicación y revocación en una página pública simulada.
- Compilación del backend y administrador, comprobación de sintaxis y `git diff --check`.

Comandos reproducibles:

```powershell
npm test --prefix cronox-backend -- --runInBand mailbox.spec mailbox-tracking mailbox-campaign-policy campaign-plan admin-inbox.dom admin-auth-flow.dom mail-purposes admin-gallery.dom admin-preview-navigation admin-push.sw
npm run build:compiled --prefix cronox-backend
node cronox-backend/scripts/review-mailbox.cjs
# Para la revisión del navegador: arrancar el mismo harness con --serve.
npx --yes --package @playwright/cli playwright-cli -s=cronox-delivery open http://127.0.0.1:43121/__mailreview/superadmin
npx --yes --package @playwright/cli playwright-cli -s=cronox-delivery run-code --filename tests/admin-review/mailbox-sent-policy.browser.js
npx --yes --package @playwright/cli playwright-cli -s=cronox-delivery run-code --filename tests/admin-review/campaign-arrival.browser.js
```

Las fixtures del navegador son descartables. El primer test permite únicamente eliminar borradores sintéticos del harness y bloquea otras mutaciones; el segundo simula completamente los destinos públicos y las métricas. Los resultados locales quedan en `output/mailbox-review` y las capturas en `output/playwright`, fuera del commit.
