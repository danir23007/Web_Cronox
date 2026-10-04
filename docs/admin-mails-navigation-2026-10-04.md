# Navegación Mails y hover de Galería en CRONOX

## Cambios

`admin.html` y `admin-user.html` comparten el nuevo grupo vertical **Mails**, entre **Clientes** y **Admin**, con **Plantillas mails**, **Buzones** y **Nueva campaña**, en ese orden. Clientes conserva Usuarios, Círculos y Pedidos. Se conservan `#section-mails`, `#section-inbox`, el contador de no leídos y los permisos existentes.

`#section-mail-campaign` es un destino lógico independiente que utiliza el mismo workspace y compositor de campañas. La entrada directa obtiene el resumen y las opciones de Info sin cargar antes la lista de mensajes ni crear un borrador. El botón duplicado desaparece de Buzones. Se conserva la gestión de Borradores, Salidas e Historial; al acceder a esas listas se selecciona Buzones. Los títulos visibles y accesibles siguen la vista activa. Las direcciones, los nombres personalizados y las rutas técnicas no cambian.

La selección lógica distingue Buzones de Nueva campaña para aplicar la protección de cambios sin guardar incluso entre vistas del mismo workspace. Pulsar de nuevo la entrada activa no sustituye el formulario. Las cargas concurrentes conservan el destino más reciente e invalidan respuestas anteriores. Los eventos tardíos de un formulario descartado no pueden volver a marcarlo como modificado. El permiso de envío desde Info controla la entrada; el backend continúa validando sus permisos.

## Causa y solución de Galería

Galería tenía manejadores de clic y Escape, pero no estado temporal de hover. El seguimiento de puntero del grupo principal terminaba al permanecer dentro de Multimedia, sin atender a la cabecera anidada.

La cabecera y el panel de Galería forman ahora una zona vertical propia dentro de Multimedia, con fijación, apertura temporal y supresión tras cierre explícito. Se procesa la intención anidada antes del retorno del grupo principal. Solo un movimiento real de coordenadas puede cambiar el hover; los eventos causados por reflujo bajo un puntero inmóvil no abren otros grupos. Se conserva el estado del grupo principal, su región de tránsito, la restauración del fijado y el diseño dentro de la columna. No se añaden paneles flotantes, retardos de apertura ni persistencia del hover.

## Verificación local

- Compilaciones `npm run admin:build` y `npm run build:compiled` del backend.
- 63 pruebas Jest en ocho suites: acceso, navegación, galería, plantillas, buzones, reconciliación periódica y tres casos nuevos de entrada directa, respuesta de compositor retrasada y permisos de Info.
- `mails-navigation.browser.js`: escritorio y móvil táctil, claro y oscuro; ambas páginas del administrador; orden y resaltado de Mails; enlace profundo a campaña; protección al aceptar/rechazar salida; listas de borradores/salidas/historial; recorridos reales lentos y rápidos del ratón, Galería temporal y fijada, cierre sin reapertura, restauración del padre fijado, enlaces, teclado, ARIA, scroll y límites de la columna. Sin errores de consola en estos recorridos.
- `inbox-campaign-controls.browser.js`: las mismas cuatro variantes; filtros, búsqueda, paginación, respuestas antiguas, lectura, familias/círculos, audiencia, Excel, guardado explícito, programación, confirmación inmediata y recuperación sin duplicados. Las respuestas fallidas y perdidas se inyectan expresamente; se comprueba su tratamiento y la ausencia de errores inesperados.

Las dos funciones de navegador utilizan HTML y scripts locales, el router real y respuestas API interceptadas con datos sintéticos. Plantillas verifica el destino y la invocación de su módulo; su funcionamiento se cubre además con la suite existente. Las solicitudes de guardado/programación/envío de la prueba de controles solo actualizan mapas del fixture: no llegan a Nest, SMTP, IMAP, proveedores ni producción. La descarga Excel del navegador también es simulada. Los otros fixtures anteriores se adaptan al nuevo acceso, sin ejecutar en este encargo el servidor de integración que realiza envíos SMTP en loopback.

Reproducción, desde la raíz, en dos terminales:

```powershell
node tests/admin-review/serve-static.cjs
```

```powershell
npx --yes --package @playwright/cli playwright-cli -s=mails-review open http://127.0.0.1:4173/admin.html
npx --yes --package @playwright/cli playwright-cli -s=mails-review run-code --filename tests/admin-review/mails-navigation.browser.js
npx --yes --package @playwright/cli playwright-cli -s=mails-review run-code --filename tests/admin-review/inbox-campaign-controls.browser.js
npx --yes --package @playwright/cli playwright-cli -s=mails-review close
```

La página inicial sin fixture no dispone de backend ni sesión; las funciones crean contextos aislados, interceptan las API y bloquean solicitudes externas. Las capturas quedan en `output/playwright`, ignorado por Git. Detener el servidor estático con Ctrl+C al terminar.

Esta revisión no verifica el administrador publicado. No se envían correos, lanzan campañas reales, modifican mensajes del proveedor, hacen push ni despliegan cambios. Se conservan los commits locales anteriores `d38188e` y `35ff67b`.
