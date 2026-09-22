# Cesta y checkout: carga inicial

## Causas confirmadas y cambios

- `assets/app.js`: la lectura inicial de sesión emitía el mismo evento que un login. Esto repetía las lecturas de cesta y reiniciaba el checkout. Se identifica ese evento inicial y se comparte la promesa de sesión con checkout. La sesión empieza sin esperar la descarga del modal de login. Los eventos de login/logout reales siguen actualizando los datos.
- `assets/cart.js`: reutiliza exclusivamente la petición inicial de cesta que ya inicia `app.js`. Las posteriores sincronizaciones y operaciones siguen consultando al servidor; no se añade una caché persistente.
- `assets/checkout.js`: dirección y resumen se solicitan en paralelo. El preloader se retira cuando el resumen autorizado o su error están renderizados. Stripe y recomendaciones no bloquean el acceso a esa información. La preparación del pago espera la dirección y Stripe, manteniendo el coordinador de revisiones y la validación del servidor. Se comparte la descarga de recomendaciones que esté en curso.
- `checkout.html` y el nuevo `assets/checkout-stripe.js`: Stripe se descarga desde su origen oficial de forma asíncrona, sin bloquear el parser ni los scripts de la tienda. La configuración pública se lee primero. La descarga tiene manejo de error y límite de 15 segundos; el botón sigue deshabilitado sin un Payment Element listo.
- Referencias a `app.js` actualizadas a v69 en las páginas públicas; `cart.js` a v5 y `checkout.js` a v19. Se actualizan los contratos de versiones/carga en las pruebas existentes.

## Comparación reproducible

Ejecutar desde la raíz: `node cronox-backend/scripts/measure-checkout-startup.cjs`.

El script ejecuta el código anterior de HEAD y el código actual en JSDOM, con el mismo HTML actual, respuestas locales inmediatas para cesta/sesión/resumen/modal y recomendaciones pendientes. No realiza llamadas HTTP, cobros, pedidos ni accesos a base de datos. La diferencia previa del preloader general no interviene en estos recuentos. Resultado guardado en `checkout-startup.json`.

| Ruta y petición | Antes | Después |
| --- | ---: | ---: |
| Cesta: `/api/cart` | 4 | 1 |
| Cesta: `/api/me` | 3 | 2 |
| Checkout: `/api/cart` | 3 | 1 |
| Checkout: `/api/me` | 4 | 2 |
| Checkout: resumen | 2 | 1 |
| Checkout: recomendaciones | 5 | 1 |

El total de sesión incluye la comprobación directa del módulo de favoritos; las llamadas al cliente `API.getMe` del checkout por sí solas pasan de 2 a 1. Los recuentos dependen del escenario de respuestas y no representan todas las solicitudes de una página real.

Con recomendaciones pendientes, el checkout anterior seguía cubierto por el preloader; el actual muestra el resumen. Para usuarios identificados, el tramo dirección + resumen pasa de ejecutarse en serie a ejecutarse en paralelo. Las pruebas también mantienen Stripe sin resolver y verifican que el resumen ya está disponible.

No se han medido segundos en producción, FCP/LCP/CLS ni latencias de Stripe/SQL. JSDOM no reproduce red, pintura ni descarga del GIF. No se atribuye una reducción porcentual del tiempo total a estos recuentos. El GIF de 7 MB permanece intacto por la restricción de conservar medios/diseño.

## Verificación

- Nueva suite `checkout-startup-performance.dom.spec.ts`: sesión inicial compartida, modal pendiente, peticiones únicas de cesta/resumen, direcciones lentas, recomendaciones pendientes, error visible, carga/error del script oficial de Stripe y pago habilitado únicamente tras el evento `ready` de Payment Element. Todos los pagos son simulados.
- Suites existentes de recomendaciones, ciclo de pago, consentimiento, configuración Stripe y cabeceras verificadas.
- `npm run admin:build` y `npm run build:compiled`: aprobados.
- `node --check` de los cuatro scripts de aplicación modificados: aprobado.
- ESLint de la nueva suite: aprobado.
- Suite completa: 145 suites / 1.300 pruebas aprobadas. Tras añadir una protección para cambios de envío mientras llega la dirección guardada, se ejecutaron de nuevo las tres suites de checkout: 27 pruebas aprobadas, incluida la nueva regresión (ocho escenarios en la suite de arranque).
- `git diff --check`: aprobado.

Se conservan los cambios anteriores del catálogo. No se modificaron datos, stock, productos, esquema, configuración de autenticación ni lógica de cobro del servidor. Sin commit, push, PR ni despliegue. Pendiente validar el resultado visual y los tiempos de las peticiones reales en navegador tras desplegar los cambios por el flujo habitual.
