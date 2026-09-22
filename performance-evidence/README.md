# Revisión local de rendimiento de CRONOX

La base de comparación es el árbol local con los arreglos de catálogo pendientes, antes de esta revisión. Se preservaron esos arreglos. No se iniciaron servicios conectados a la base remota ni se consultaron datos de producción.

## Método y límites

`node cronox-backend/scripts/measure-storefront-performance.cjs` inventaría las referencias estáticas del HTML y ejecuta los controladores reales del preloader con un reloj simulado. `before.json` se capturó antes del cambio y `after.json` después. El script usa los mismos eventos DOM/load en ambas comparaciones. La ruta `/tienda` reutiliza `index.html`.

No había Playwright, Puppeteer ni Lighthouse instalados en el proyecto. No se midieron en un navegador FCP, LCP, CLS, TBT/INP, CPU, tareas largas, tiempo de catálogo visible, solicitudes reales, bytes transferidos, latencia de API ni duración SQL. Tampoco se emuló una conexión móvil o CPU ralentizada. Los valores siguientes son evidencia determinista de código y archivos, no puntuaciones Lighthouse ni mediciones de producción. El mismo controlador se ejecuta en móvil y escritorio, pero esto no sustituye una comprobación visual real en ambos.

## Causa demostrada y cambio

`app.js` esperaba `window.load` y añadía 1–2 segundos aleatorios antes de retirar `is-loading`. La portada tenía un segundo controlador con un mínimo de 1,5 segundos y un cierre de emergencia a DOMContentLoaded + 3,5 segundos. Este último ocultaba la capa, pero no desbloqueaba el scroll: si `load` no llegaba, el bloqueo podía persistir.

Ahora se desbloquea tras DOMContentLoaded y dos oportunidades de renderizado. Se mantiene la transición CSS y la retirada del nodo 600 ms después. `load` sigue siendo una alternativa; el cierre de emergencia también retira `is-loading` si falla `app.js`. El evento de disponibilidad se emite una sola vez. El preloader persistente del checkout sigue reservado a su controlador existente.

Reloj simulado; el generador aleatorio del antes se fija en 0,5:

| Escenario idéntico | Scroll antes | Scroll después | Capa oculta antes | Capa retirada después |
|---|---:|---:|---:|---:|
| DOM 100 ms, load 500 ms | 2.000 ms | 132 ms | 1.500 ms | 732 ms |
| DOM 500 ms, load 8.000 ms | 9.500 ms | 532 ms | 4.000 ms | 1.132 ms |
| DOM 500 ms, sin load | No se desbloqueaba | 532 ms | 4.000 ms | 1.132 ms |

Con fallo de `app.js` y sin `load`, el cierre de emergencia ahora desbloquea a 4.000 ms y retira la capa a 4.600 ms. No se ha añadido un retraso mínimo ni modificado la animación.

## Inventario por página

Referencias estáticas únicas (no solicitudes observadas) y suma de bytes de archivos locales referenciados, sin comprimir. Incluyen medios que el navegador puede cargar parcialmente o aplazar, y excluyen recursos dinámicos de la API. Por tanto, no representan el peso final ni la transferencia inicial de cada página.

| Página | Referencias antes/después | Bytes locales antes | Bytes locales después |
|---|---:|---:|---:|
| Inicio y tienda | 31 / 31 | 10.307.576 | 10.307.924 |
| Producto | 17 / 17 | 301.996 | 302.344 |
| Favoritos | 17 / 17 | 281.638 | 281.986 |
| Carrito | 16 / 16 | 283.292 | 283.640 |
| Checkout | 16 / 16 | 7.375.193 | 7.375.541 |
| Galería | 12 / 12 | 304.126 | 304.474 |

La diferencia de 348 bytes corresponde a `app.js`. No se redujeron peticiones ni bytes de medios con esta intervención. El JSON incluye tamaños gzip calculados localmente para JS/CSS; no demuestra que el servidor entregue gzip.

## Inspección de los demás puntos

- El GIF del preloader pesa 7.036.718 bytes y el vídeo del hero 2.901.933 bytes. La portada declara preload del vídeo y `preload="auto"`. Son cargas potencialmente costosas, pero no se ha demostrado contención de red ni el efecto de cambiar su prioridad. Se conservan archivos, calidad, poster y atributos de reproducción. Tampoco se supone que el preload y el elemento vídeo impliquen dos descargas: el navegador puede compartirlas.
- Productos y galería usan carga diferida y decodificación asíncrona. La galería mantiene una promesa compartida para evitar solicitudes concurrentes duplicadas; su carrusel observa visibilidad. No se ha cambiado su inicialización, framing o lightbox sin medir una mejora.
- Los arreglos de catálogo mantienen una única promesa para cargas concurrentes de inicio, descartan respuestas antiguas y conservan un catálogo válido tras error. La ficha tiene su carga propia; carrito, favoritos y perfil conservan el catálogo compartido. No se han eliminado llamadas adicionales en esta revisión.
- La recuperación del catálogo tiene un presupuesto máximo de 25 segundos para tres peticiones que agotan cada timeout de 8 segundos, más esperas de 250 y 750 ms. El estado neutro aparece desde el inicio. Es un límite de código, no una latencia observada. Se conserva para no cambiar arbitrariamente el equilibrio entre recuperación y error. Una futura medición de percentiles de API permitiría ajustar este presupuesto; las promesas que agotan el tiempo no abortan el transporte subyacente.
- `/api/products` pagina y ordena por `displayOrder` e id; consulta productos y recuento e incluye imágenes, variantes activas y categorías utilizados por el contrato público. La búsqueda obtiene los candidatos y calcula relevancia en memoria. Sin tiempos SQL ni volúmenes reales no se afirma que estas operaciones sean el cuello de botella ni se modifican consultas o índices.
- Se mantiene `cache: 'no-store'` para productos. El repositorio utiliza ServeStatic sin una política explícita de caché larga para esos assets ni middleware de compresión visible. No hay configuración de Hostinger/proxy ni service worker encontrada en el repositorio. Un proxy externo puede cambiar las cabeceras: faltan mediciones HTTP reales para decidir cambios seguros.
- No se encontraron declaraciones `@font-face` ni proveedores de fuentes externos en el frontend inspeccionado. Stripe en checkout conserva su carga existente; no se abrió un flujo de pago.

## Archivos de esta intervención de rendimiento

- `cronox-front/assets/app.js`: disponibilidad tras DOM y frames, cierre idempotente, sin pausa aleatoria.
- `cronox-front/index.html`: el cierre de emergencia desbloquea el cuerpo y preserva la transición.
- Referencias a `app.js?v=68` en `index.html`, `producto.html`, `favorites.html`, `cart.html`, `checkout.html`, `gallery.html`, `profile.html`, `faqs.html`, `develop.html`, `events.html`, `shipping-policy.html`, `returns-exchanges.html`, `privacy-policy.html`, `cookie-policy.html`, `terms-of-service.html` y `aviso-legal.html`. Sólo cambia la versión del recurso que sí se modificó.
- `cronox-backend/src/frontend/storefront-preloader-performance.spec.ts`: tiempos, idempotencia, fallo de load/app, exclusión del checkout persistente y atributos de medios.
- `informational-topbar.dom.spec.ts` y `storefront-shared-systems.dom.spec.ts`: referencias de versión esperadas actualizadas.
- `cronox-backend/scripts/measure-storefront-performance.cjs` y esta carpeta: método y evidencia antes/después.

El resto del diff corresponde al arreglo de catálogo anterior. No hubo cambios de datos, migraciones, inventario, configuración de autenticación, commit, push, PR ni despliegue. No se modificó intencionadamente el diseño o la funcionalidad; falta validación visual en navegador y medición de producción para confirmar los resultados perceptuales.

## Verificaciones

- `npm test -- --runInBand --silent`: 144 suites y 1.293 pruebas aprobadas, incluyendo catálogo, stock, orden, hover/swipe, quick-add, carrito, galería, newsletter, middleware y backend.
- Pruebas centradas en preloader/catálogo y contratos compartidos: 5 suites, 112 pruebas aprobadas.
- `npm run admin:build`: Vite aprobado; `npm run build:compiled` desde backend: aprobado.
- ESLint de `storefront-preloader-performance.spec.ts`, `informational-topbar.dom.spec.ts` y `storefront-shared-systems.dom.spec.ts`: aprobado.
- `node --check` de `app.js` y del script de medición: aprobado. `git diff --check`: aprobado.
- `npx tsc -p tsconfig.admin.json --noEmit`: cinco errores en declaraciones existentes, fuera del cambio de rendimiento: tres referencias a `Window.CRONOX_SIZES` y las declaraciones de `getProductOrder` / `saveProductOrder` en `CronoxAdminApi`. No se modificaron esos tipos para ocultar el fallo.
- Sin reproducción real en navegador, prueba de autoplay móvil, throttling, cabeceras HTTP de producción, tiempos SQL o checkout real. Los tests de atributos y DOM no demuestran reproducción de vídeo ni CLS real.
