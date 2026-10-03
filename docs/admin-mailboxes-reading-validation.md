# Correo: carpetas, lectura y coordinación IMAP

## Diagnóstico de 2026-10-03

`MAILBOX_BUSY` se originaba en `MailboxLeasesService.run`: rechazaba inmediatamente la adquisición si otro trabajo poseía el buzón o había dos conexiones reservadas globalmente. `MailboxWorkerService` usa ese mismo bloqueo para sincronización y descarga anticipada. `MailboxSyncService` lo mantenía también durante hasta diez segundos de IDLE. Esto se reproduce de forma aislada; no es una conclusión sobre un fallo de autenticación del proveedor.

En `admin-inbox.js`, abrir hacía GET del cuerpo y después POST de leído. El aviso «Contenido disponible…» correspondía al segundo paso. Algunos errores de ese POST subían al catch de la descarga y sustituían un cuerpo ya disponible. El lector no tenía el control de respuestas antiguas que ya existía para la lista. Una respuesta o error atrasados podían sustituir el mensaje seleccionado.

«Contenido pendiente de descargar» era además la alternativa de cualquier vista previa vacía, incluso con `bodyState=LOADED`. Una descarga que no devolvía una parte MIME se omitía silenciosamente; los fallos no dejaban un estado FAILED ni diagnóstico seguro de descarga y la descarga anticipada podía insistir siempre en el mismo mensaje. ImapFlow 2.2.1 devuelve partes decodificadas y texto convertido a UTF-8: reinterpretarlo con el charset original podía deteriorar caracteres. Se ha corregido y probado, sin atribuirle un incidente histórico concreto.

### Evidencia de producción, exclusivamente de lectura

A las **2026-10-03 13:25:42.731 UTC** (15:25:42.731 en Madrid), los cuatro buzones figuraban CONNECTED, sin errores ni fallos acumulados. Los mensajes vivos eran Soporte 5, Información 3, No-reply 3 y Pedidos 6; todos LOADED y con referencia a cuerpo privado. Soporte e Información tenían leases vigentes en esa instantánea. No se leyeron cuerpos, asuntos, contraseñas ni suscripciones push privadas.

La auditoría consultada a las 13:50:00.362 UTC contenía operaciones correctas de lectura, conexión, configuración y envíos anteriores. La versión publicada no auditaba estos fallos de descarga: su ausencia en la auditoría no demuestra que no ocurrieran. La cuenta `deploy` carece de acceso a `/root/.pm2/logs` y a los logs de Nginx protegidos por `www-data:adm`. Por ello **no se confirma la causa concreta de cada error histórico de «contenido no disponible»**, ni la existencia de un archivo privado referido por la base. No se ha cambiado producción para investigar.

## Comportamiento corregido

- Las etiquetas españolas usan special-use antes que nombres equivalentes. Las carpetas personalizadas y los identificadores/rutas IMAP se conservan. La vista conjunta incluye el buzón; la individual muestra solo la etiqueta. Se mantienen casillas y selección múltiple, también en el diagnóstico de conexión.
- Las operaciones interactivas esperan hasta 30 segundos para adquirir el lease, reintentando solo su adquisición. No se repiten STORE, MOVE ni envíos después de un resultado incierto. Se conservan el límite global de dos leases, heartbeat, expiración y commits con comprobación del propietario.
- La sincronización cede entre carpetas completas y finaliza IDLE mediante NOOP cuando hay un usuario esperando. Los cursores ya confirmados se conservan y la siguiente sincronización queda pendiente. La prioridad y el despertar de IDLE son locales al proceso; en procesos distintos sigue coordinando el lease de PostgreSQL y su espera acotada.
- Aperturas concurrentes reutilizan el cuerpo confirmado al conseguir su turno. Una parte solicitada ausente da un fallo explícito; UID desaparecido se distingue e invalida su referencia viva. FAILED queda registrado con un código seguro de auditoría. El trabajador aplica una pausa de quince minutos a descargas fallidas y sigue con otros mensajes; la apertura manual puede reintentar inmediatamente.
- Si falta el archivo privado del cuerpo, se invalida su referencia mediante comparación y se descarga una vez de nuevo, sin duplicar metadatos de adjuntos. Fallos de descifrado/almacenamiento no se presentan como cuerpos descargados correctamente.
- Marcar leído/no leído vuelve a consultar el mensaje después de esperar, verifica existencia y flags reales después de STORE, y solo entonces confirma la caché. El contador de la bandeja usa esa caché. Si falla, el cuerpo permanece visible y el estado no se presenta como confirmado.
- El lector cancela GET antiguos y comprueba la selección incluso si una respuesta ignora esa cancelación. Limpia errores al navegar y separa reintentar descarga de reintentar leído. Distingue descarga en curso, descarga fallida, mensaje no disponible y cuerpo disponible con fallo de leído.
- Solo quedan Responder, Reenviar, Marcar como no leído y Mover a papelera. Responder exige una dirección válida del Reply-To, o del remitente si aquel no tiene ninguna válida. Varias opciones requieren elección. No añade To/CC/CCO originales ni círculos; usa el buzón receptor y mantiene referencias. Guardar y poner en cola validan destinatario único y ausencia de CC/CCO, incluso sin Message-ID. Los reenvíos nacen sin destinatario y requieren confirmación de envío. Papelera utiliza primero special-use y después una ruta equivalente del propio buzón; no usa borrado permanente.

## Verificación reproducible

Desde `cronox-backend`:

```powershell
npm run build:compiled
npx jest --runInBand admin-inbox.dom mailbox admin-push.sw visitor-history visitor-auth-bridge waitlist mail-renderer managed-mail.service mail-lifecycle mail-transport.factory email.service admin-mails.dom csrf-protection.guard
```

Desde la raíz:

```powershell
npm run admin:build
node cronox-backend/scripts/review-mailbox.cjs --serve
```

El último comando crea PostgreSQL temporal, IMAP simulado, SMTP/TLS de loopback y push simulado. Nunca carga `.env` ni contacta Hostinger/Apple. Incluye `review-mailbox-reading.cjs`: contención con sincronización, adquisición acotada, despertar IDLE, fallos de STORE, flags, descargas duplicadas/fallidas, UID desaparecido, UTF-8, recuperación de archivo privado, destinatario único, referencias y papelera. Conserva regresiones de campañas, programación, consentimiento y push. Terminar con `stop` en su terminal.

Con ese fixture abierto:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=mail-reading open http://127.0.0.1:43121/__mailreview/superadmin
npx --yes --package @playwright/cli playwright-cli -s=mail-reading run-code --filename tests/admin-review/mailbox-reading.browser.js
npx --yes --package @playwright/cli playwright-cli -s=mail-reading run-code --filename tests/admin-review/mailbox-campaigns.browser.js
npx --yes --package @playwright/cli playwright-cli -s=mail-reading run-code --filename tests/admin-review/admin-push.browser.js
npx --yes --package @playwright/cli playwright-cli -s=mail-reading close
```

Las pruebas de lectura usan 1440 y 390 píxeles, errores y respuestas demoradas simulados, cambios rápidos de mensaje/buzón, cuerpo conservado, elección de respuesta, compositor individual y reenvío pendiente. La prueba DOM cubre rutas equivalentes, nombres personalizados, prioridad de special-use y respuestas tardías que ignoran AbortSignal. Capturas y resultados quedan en las ubicaciones de pruebas ya excluidas de Git.

## Publicación pendiente

Esta tarea solo crea un commit local en main. No requiere migración nueva, cambio de claves ni configuración del proveedor. El recurso `admin-inbox.js` pasa a `v=5`. Cuando se autorice publicar, sincronizar main mediante el despliegue existente, comprobar backend y recurso nuevo y revisar el panel autenticado. Para atribuir incidentes históricos restantes haría falta una lectura segura de los logs root, sin divulgar su contenido privado. La recepción física de push en iPhone y correos reales no se revalida en esta tarea.

En desarrollo, ejecutar `npm run admin:watch`.
