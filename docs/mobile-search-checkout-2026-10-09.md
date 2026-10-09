# Buscador y espacio de pago en móvil — 9 de octubre de 2026

Cambios preparados únicamente en local, sin commit, push ni despliegue. Se conserva el commit local anterior de numeración de usuarios. No se han modificado datos, credenciales ni pagos. No llegaron capturas adjuntas con este mensaje; se reprodujo el problema a partir de los componentes existentes.

## Causas y correcciones

El input del buscador no tenía una regla propia para su contorno de enfoque. WebKit considera `:focus-visible` verdadero incluso al enfocar un campo de texto mediante toque; usar solamente `:focus:not(:focus-visible)` no resolvería este caso. En `app.js` se registra la modalidad de navegación exclusivamente para el campo del buscador: Tab y Enter/Espacio en su botón activan la indicación de teclado; tocar el botón o el campo la desactiva. El teclado virtual no activa esta indicación por escribir caracteres. Las reglas móviles de `store.css` eliminan el outline, la sombra y el resaltado de toque, conservando su borde normal de 1 px, cursor y funcionamiento. Tab mantiene un contorno visible de 2 px. Los estilos de escritorio quedan fuera del media query.

El contenedor `.payment-element` reserva **900 px de altura mínima**, independientemente de la altura real del formulario. No hay un margen enorme en el botón: su margen superior normal es 18 px. En el breakpoint móvil existente del checkout (`max-width: 900px`) se elimina esa reserva con `min-height: 0`. El contenido de Stripe determina la altura: no se establece una altura fija, no se recorta contenido y no se usan márgenes negativos. El botón y el texto de seguridad conservan el orden y la separación existentes. La reserva de escritorio permanece en 900 px por petición expresa de conservar PC. No se modifica `checkout.js`, la validación ni el estado del botón.

Se actualizan todas las referencias HTML compartidas: `store.css` 114 → 115, `app.js` 90 → 91 y `checkout.css` 22 → 23. Se ajusta la prueba existente que comprueba la versión del CSS del checkout.

## Verificación

Se utilizó Playwright CLI con **WebKit 26.6 / iPhone 13 emulado (390 × 844)** y Chrome de escritorio (1440 × 1000). Se inspeccionaron las capturas visualmente.

- Buscador real sobre el catálogo local: toque en botón y campo, Tab/Shift+Tab, nuevo toque después del teclado, escritura `core`, dos sugerencias y selección mediante ArrowDown. Al tocar: outline `none`, sombra `none`, borde normal `1px`. Con teclado: outline `solid`. El cursor/enfoque permanece en el campo.
- Se redujo el viewport a 390 × 450 para comprobar el espacio disponible al escribir y visualizar sugerencias. **Esto no reproduce el teclado virtual ni el zoom de Safari de un iPhone físico**; esa comprobación sigue pendiente en dispositivo real.
- Checkout: **contenido local simulado**, sin SDK, PaymentIntent ni pago real. Se insertó contenido de altura variable en el contenedor real para comprobar su layout. Se alternaron tarjeta/transferencia simuladas, se desplegó «Más» y se mostraron mensajes de validación. No se afirma haber probado estos métodos dentro de Stripe real.
- Con formulario de 257 px, la regla anterior produce 661 px de separación hasta el botón; la nueva regla deja 18 px. Con contenido expandido de **1.056 px**, el contenedor crece sin recortar y la separación sigue en 18 px. Con otro contenido de 219 px, sigue en 18 px. El texto de Stripe queda debajo, el estado deshabilitado se conserva y no hay desbordamiento horizontal.
- Escritorio: se revisaron buscador y checkout; el outline automático del buscador permanece y `.payment-element` mantiene `min-height: 900px`.
- Pasan **5 suites / 166 pruebas**: storefront-search, responsive-design, stripe-runtime-config, guest-checkout-refinement y storefront-final-refinement. `node --check assets/app.js` y `git diff --check` pasan. No hay cambios de backend que requieran Prisma o compilación Nest.

## Capturas locales

Las capturas están bajo `output/playwright/`, ignorado por Git. La captura de checkout «antes» reproduce la reserva original de 900 px con el mismo contenido simulado; las de «después» usan el CSS final.

| Vista | Antes | Después |
| --- | --- | --- |
| Buscador WebKit móvil | [antes](../output/playwright/mobile-layout-search-before.png) | [después](../output/playwright/mobile-layout-search-after.png) |
| Pago móvil simulado | [antes](../output/playwright/mobile-layout-payment-before.png) | [tarjeta](../output/playwright/mobile-layout-payment-after-card.png) |
| Contenido expandido y errores | — | [después](../output/playwright/mobile-layout-payment-after-expanded.png) |
| Otro método simulado | — | [después](../output/playwright/mobile-layout-payment-after-transfer.png) |
| Buscador con viewport reducido | — | [captura](../output/playwright/mobile-layout-search-reduced-viewport.png) |
| Escritorio | — | [buscador](../output/playwright/mobile-layout-desktop-search.png), [checkout](../output/playwright/mobile-layout-desktop-checkout.png) |

Los scripts de revisión y resultados locales también están en `output/playwright/mobile-layout-*`. Queda pendiente la comprobación en Safari/iPhone físico y con Payment Element real en un entorno Stripe de pruebas: cambio de métodos, «Más», teclado virtual y errores reales, sin confirmar pagos.
