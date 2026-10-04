# CRONOX: menú lateral y presentación de buzones

Cambios de presentación que complementan el commit `d6d460c` y conservan los flujos de correo, campañas, plantillas y contraseñas.

- «Añadir buzón» usa blanco y negro literales en ambos temas, borde propio y estados de hover, foco y pulsación. Sigue llamando al formulario sin identificador; los selectores existentes pasan el identificador del buzón.
- Los nombres predeterminados `No reply`, `Noreply` y `NOREPLY` se muestran como «No-reply», también en sugerencias, formularios y avisos. Los nombres personalizados del buzón No-reply se conservan. La preparación de nuevos buzones usa el nombre corregido y las tarjetas de plantillas identifican la cuenta como «No-reply». No requiere migración ni escritura de nombres existentes: la normalización es de presentación.
- El menú compartido por `admin.html` y `admin-user.html` mantiene un grupo fijado y otro temporal. Cabecera y enlaces forman una única zona de puntero. Cerrar el fijado mediante clic suprime su hover hasta salir de esa zona. El foco dentro de un submenú tiene prioridad para que sus enlaces sigan utilizables. Enter y Espacio usan la activación nativa del botón.
- Mosaico y Carrusel aparecen dentro de Multimedia, bajo el rótulo Galería, sin otro desplegable anidado. Esto permite cumplir un único desplegable visible y conserva ambos destinos.
- La página actual conserva `aria-current`; la navegación por enlaces fija su grupo. El menú móvil conserva su cierre, bloqueo de fondo y control de foco. No existe persistencia de aperturas del menú: la ruta inicial abre su grupo y el hover no escribe almacenamiento.
- Se actualizan las versiones de los recursos modificados en ambas páginas.

## Verificación local

Compilaciones `npm run build:compiled --prefix cronox-backend` y `npm run admin:build`: correctas.

Ocho suites Jest relacionadas: 108 pruebas correctas (buzones, navegación, autenticación del administrador, Galería, plantillas y propósitos de correo). Cinco pruebas Node de preparación de buzones: correctas.

La revisión reproducible `tests/admin-review/sidebar-mail-settings.browser.js` funciona con el servidor estático `node tests/cart/server.cjs`:

```powershell
npx --package @playwright/cli playwright-cli -s=cronox-admin-menu open http://127.0.0.1:4173/admin.html
npx --package @playwright/cli playwright-cli -s=cronox-admin-menu run-code --filename=tests/admin-review/sidebar-mail-settings.browser.js
```

La revisión usa HTML, CSS y scripts reales del menú y de buzones, con respuestas de API simuladas; bloquea recursos externos y toda escritura de API. Comprueba fijación, hover, sustitución, cierre sin reapertura, paso hacia enlaces, navegación, foco, Enter/Espacio, `aria-expanded`, ausencia de almacenamiento del hover, selección de los cuatro buzones, creación vacía, dirección intacta y nombre personalizado. Comprueba móvil táctil en ambas páginas y temas; las capturas en `output/playwright/` se revisan visualmente a 1366 y 390 píxeles. No conecta con SMTP/IMAP ni con bases de datos.

No se envían correos ni se cambian credenciales, activación, preferencias o datos de producción. El cambio se entrega como commit local, sin push ni despliegue.
