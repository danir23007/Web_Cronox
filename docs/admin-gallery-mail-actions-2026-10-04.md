# CRONOX: Galería anidada y acciones de Correo

Esta corrección sustituye la decisión anterior de mostrar Galería como rótulo estático descrita en `admin-sidebar-mail-presentation-2026-10-04.md`. Conserva los demás trabajos anteriores.

Galería es un botón desplegable dentro de Multimedia en `admin.html` y `admin-user.html`. Mosaico y Carrusel conservan sus destinos y `aria-current`. El controlador principal conserva un único grupo visible, fijación por clic, hover temporal y prioridad del foco en sus descendientes. Galería pertenece a la misma zona de puntero que Multimedia y controla únicamente su panel; la selección de una ruta de Galería abre ambos niveles. Enter, Espacio y pulsación táctil usan el botón nativo; Escape desde sus enlaces cierra Galería y devuelve el foco a su botón. Cada botón actualiza `aria-expanded` y controla su panel mediante `aria-controls`.

Correo elimina únicamente Actualizar y Notificaciones, sus manejadores exclusivos y el panel/estilos de dispositivos sin uso. Notificaciones push sigue en la columna izquierda del administrador. No se modifican el módulo push, los permisos, las preferencias, la carga inicial, el intervalo de 30 segundos, los avisos ni el backend o su trabajador de sincronización. Los errores de sincronización siguen visibles.

## Verificación

- `npm run admin:build`: correcta; sin cambios en los recursos compilados.
- `npm test --prefix cronox-backend -- --runInBand admin-inbox.dom admin-gallery.dom admin-auth-flow.dom admin-preview-navigation admin-push.sw`: 5 suites y 49 pruebas correctas.
- `git diff --check`: correcto.
- Revisión con la skill Playwright, servidor estático `node tests/cart/server.cjs` y `tests/admin-review/sidebar-mail-settings.browser.js`: correcta. Para reproducir: `npx --yes --package @playwright/cli playwright-cli -s=cronox-review open http://127.0.0.1:4173/admin.html`, seguido de `npx --yes --package @playwright/cli playwright-cli -s=cronox-review run-code --filename tests/admin-review/sidebar-mail-settings.browser.js`.

La revisión usa HTML, CSS y controladores reales de menú y Correo; omite los demás scripts y simula la navegación de secciones y las respuestas de API. Comprueba fijación, hover, prioridad del foco, clic y teclado, navegación y resaltado de ambos destinos, apertura de la jerarquía por selección de ruta, controles ARIA, entrada lateral push y ausencia de acciones duplicadas. Prueba listas, contador y aviso automático invocando el callback real del intervalo registrado a 30 segundos; un error 503 simulado debe seguir visible. Conserva las comprobaciones anteriores de configuración de buzones y nombres personalizados.

Escritorio a 1366 píxeles y móvil táctil a 390, en claro y oscuro y en ambas páginas. Barra de Correo a 320, 390 y 1366 píxeles, sin desbordamiento. Capturas de Galería y Correo en `output/playwright/`, revisadas visualmente. Las API solo aceptan lecturas simuladas; cero mutaciones. No se ha probado recepción real del proveedor ni entrega push física, enviado correo, modificado mensajes, conectado a producción o cambiado servicios internos. Entrega mediante commit local, sin push ni despliegue.
