# Carrito: corrección y verificación local (2026-09-24)

## Causas comprobadas

- Antes de la corrección, Chromium a 1366×600 devolvía una altura de **0 px** para la lista del drawer con dos artículos presentes en el DOM y seis recomendaciones. El panel ocultaba el desbordamiento y la lista era el elemento flexible que cedía su altura a las recomendaciones. La solución de scroll único sólo se aplicaba en móvil.
- Una lectura inicial lenta podía terminar después de una escritura y sustituir el carrito nuevo por una respuesta anterior. La prueba previa a la corrección acababa con un artículo en vez de dos.
- La página independiente eliminaba del DOM su propio mensaje de cesta vacía. Los errores de lectura se convertían en una cesta vacía aparente, y algunos cambios de sesión no actualizaban inmediatamente el drawer. El reseteo de sesión referenciaba además variables de otro ámbito.
- PDP y Quick Add anunciaban éxito antes de recibir la respuesta del servidor.

No se ha demostrado pérdida de datos en producción ni se ha borrado persistencia para resolver estos síntomas.

## Implementación

- `cronox-front/assets/app.js`: cola común para lecturas y escrituras, lectura inicial compartida, protección frente a respuestas anteriores y cambios de propietario; render centralizado; estados de carga/error/reintento; actualización tras restauración de página; adaptación a VisualViewport sin desactivar zoom.
- `cronox-front/assets/cart-badge.js`: observa el estado actual, sin una lectura paralela que lo sobrescriba.
- `cronox-front/assets/cart.js` y `cart.css`: estados explícitos, mensaje vacío conectado al DOM, totales de línea, controles y nombres largos adaptables.
- `cronox-front/assets/store.css`: un único scroll vertical en el panel, artículos sin encogimiento, recomendaciones después de los artículos, cabecera/pago sticky y safe areas.
- `cronox-front/assets/products.js` y `product-page.js`: confirmación de añadido sólo tras respuesta; carga y error visibles.
- `cronox-front/src/admin/api.ts`: GET del carrito sin caché y rechazo de respuestas sin lista de artículos. `assets/api.js` regenerado con Vite; no editado manualmente.
- Referencias de caché actualizadas en los HTML que cargan estos recursos. Los cambios en HTML administrativos, checkout y lanzamiento son sólo versiones de las URL de recursos compartidos.
- `tests/cart/cart.spec.cjs`, `tests/cart/server.cjs`, `playwright.cart.config.cjs`, `package.json`, `package-lock.json`, `.gitignore`: regresiones locales reproducibles. El servidor sólo sirve archivos; la API se simula en memoria y se bloquean destinos externos.
- Pruebas existentes ajustadas al scroll/viewport nuevo y a recursos versionados: `informational-topbar`, `mobile-cart-quick-add`, `product-card-framing`, `responsive-design`, `storefront-final-refinement`, `storefront-overlay-footer-images`, `storefront-product-order`, `storefront-shared-systems` en `cronox-backend/src/frontend`.

## Verificación

Comandos desde la raíz, salvo donde se indica:

```sh
npm run admin:build
npx playwright install chromium firefox webkit
npm run test:cart:browser
cd cronox-backend
npm test -- --runInBand src/frontend src/cart src/auth/auth.service.spec.ts src/common/cookies/cart-cookie.spec.ts
npm run build
```

- Playwright: **86 aprobadas, 1 omitida**. Chromium, Firefox y WebKit; Windows, sin dispositivos físicos. Firefox no soporta la opción de emulación `isMobile` usada por la prueba táctil; sí pasó los tamaños móviles y paisaje normales.
- Tamaños: 320×568, 375×667, 390×844, 430×932, 768×1024, 1024×768, 1366×600, 1920×1080, 844×390 y 568×320. Cesta vacía, uno y siete artículos, nombres largos y tallas distintas, reapertura y rotación.
- Primera apertura con lectura pendiente, navegación/recarga/atrás/adelante, evento de restauración `pageshow`, PDP, tarjetas y recomendaciones, cantidades/eliminación del último artículo, subtotal/envío/badge, fallos de lectura/escritura y respuestas malformadas, reintento, operaciones rápidas, respuestas antiguas y cambio de sesión.
- Login/logout y carrito fusionado probados con API simulada; las pruebas de servicio cubren el flujo backend con dependencias simuladas. No se ha iniciado una sesión real ni conectado a una base de datos de producción.
- Zoom 125 %, 150 % y 200 %: equivalencia de layout mediante viewport CSS reducido y escala de dispositivo. **No es una prueba del zoom nativo de la interfaz del navegador**. Viewport táctil/barra móvil simulados, no Safari/iPhone real. BFCache: navegación automatizada y evento persistido simulado, sin garantizar restauración nativa en todos los motores.
- Capturas y geometría revisadas, incluidas 1366×600 Chromium y 320×568 WebKit: artículos visibles y cierre/pago accesibles. Las pruebas comprueban desbordamiento, alturas y controles; no detectaron excepciones JavaScript sin capturar en las páginas instrumentadas. Errores de red deliberados y recursos externos bloqueados son parte del entorno de prueba.
- Vite y build del backend: correctos. `prisma generate` genera el cliente local; no ejecuta migraciones.
- Batería amplia Jest: **650 aprobadas, 1 fallida** (65 suites aprobadas de 66). Queda un fallo preexistente en `cookie-consent.spec.ts`, que incluye `admin-launch.html` entre páginas públicas y exige recursos de consentimiento que tampoco estaban en HEAD. No se cambia esa pantalla ni la lógica de cookies en esta tarea.

## Publicación y límites

El proceso normal debe ejecutar `npm ci` y `npm run admin:build` para generar la API compartida. El artefacto actualizado ya está incluido en el diff. Playwright y sus navegadores son dependencias de desarrollo/verificación, no se ejecutan automáticamente durante el despliegue. No se necesitan migraciones ni variables de entorno nuevas para este cambio.

No se ha modificado el backend de negocio, inventario, pedidos, precios, Stripe, correos ni campañas. No se han ejecutado pagos, reembolsos, ajustes de stock, limpieza, commit, push ni despliegue. Se recomienda una comprobación manual posterior en dispositivos físicos y con zoom nativo antes de afirmar compatibilidad universal.
