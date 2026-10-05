# Previsión única en la cesta lateral — 2026-10-05

Cambio local posterior al commit `2d84409`, conservando las correcciones
pendientes de Quick Add y ordenación de categorías. Sin stage, commit, push
ni despliegue. No se modifican producción, pedidos ni inventario.

## Implementación y límites reales

La ficha ya usaba `assets/product-delivery.js`: fecha de compra en Europe/Madrid,
más tres días de **calendario**, formato español «8 de octubre», actualización
en medianoche de Madrid, foco, pageshow y retorno desde segundo plano. No era
un cálculo de días laborables ni incluía hora de corte. Se mantiene esa política
y se expone una única implementación mediante `CRONOX_DELIVERY` para ficha y
cesta; no se duplica el cálculo ni se fijan fechas nuevas.

Se inspeccionaron el schema de producto/carrito y `ShippingMethodsService`:
no hay plazos por artículo, calendarios laborales, cortes ni ETA estructurada
por método. Las descripciones de envío no se convierten en reglas mediante
parsing improvisado. El checkout admite únicamente España. La ficha usa la
previsión general sin solicitar destino; la cesta conserva ese tratamiento y
lo expresa como **«Entrega estimada del pedido antes del …»**, sin garantía.
Con la política actual todos los artículos y cantidades comparten el mismo
plazo; no existe un artículo con un plazo distinto que condicione el conjunto.
Si se incorporan plazos diferentes en el futuro, deberán integrarse en este
servicio compartido, tomando el más tardío para un envío conjunto. No se añaden
campos ni reglas hipotéticas en esta intervención.

`app.js` inserta una única previsión después de los artículos y antes de
COMPLETA TU OUTFIT. Se renderiza con el estado vigente del carrito, que ya
serializa operaciones y protege contra respuestas obsoletas. El cálculo es
síncrono y no añade peticiones. Se oculta con cesta vacía, datos inválidos,
carga o error; al vaciarla también se limpia la fecha. Se recalcula después de
cambiar artículos/cantidades y al reabrir/refrescar el estado, así como al
cambiar el día o volver a la página. No hay datos de destino/método en el
carrito que actualmente cambien esta fecha general.

Los estilos originales `.pdp__delivery` y `.pdp__delivery-dot` se trasladan de
`product-page.css` a `store.css`, compartido por ambas superficies. Se conservan
el punto verde, tamaño, peso, interlineado y fecha en negrita. Se elimina el
borde superior de `.cart-upsell`; queda el borde inferior del último artículo.
La previsión usa el espacio entre secciones existente y no añade padding
duplicado antes de las recomendaciones. El scroll único, productos, cantidades,
eliminación, barra de envío gratis, precios, recomendaciones y checkout siguen
intactos.

## Archivos y verificación

- `assets/product-delivery.js`, `assets/app.js`, `assets/store.css` y
  `assets/product-page.css`; referencias HTML con caché actualizada. El script
  compartido se carga antes de `app.js` también fuera de la ficha.
- Tests: `product-delivery.dom.spec.ts`, nuevo `cart-delivery.dom.spec.ts`,
  `tests/admin-review/cart-delivery.browser.js` y dos ajustes de referencias CSS.
- **74 suites / 673 pruebas frontend correctas**, incluidas Quick Add/filtros,
  carrito y límites de calendario (mes/año/bisiesto y días DST de 23/25 horas).
- Compilaciones frontend/admin Vite y backend Nest correctas; sin cambios de
  schema, migraciones ni dependencias. `git diff --check` correcto.
- Navegador **localhost:3000**, escritorio 1366 y móvil 390, sobre el frontend
  y API reales: cesta anónima nueva, uno/dos productos, cambio de cantidad,
  eliminación parcial y del último, cierre/reapertura. Una previsión, fecha
  coincidente con el cálculo compartido y con la ficha real, punto verde original,
  un separador (último artículo 1px; recomendaciones 0px), sin desbordamiento.
  Capturas revisadas después de terminar la animación de apertura.
- Solo se modificó una cesta anónima de prueba en la base local y quedó vacía.
  Inventario comparado antes/después sin cambios; cero peticiones de checkout,
  pedidos, pagos, correos o notificaciones reales. No se altera una cesta ajena.
- Antes de reiniciar 3000 se identificó el proceso del backend compilado de
  este repositorio; únicamente se reinició esa instancia con `start:local`.

Reproducción segura: abrir una sesión nueva anónima contra localhost:3000,
sin una cesta previa (el script lo comprueba y aborta si existe):

```powershell
npm --prefix cronox-backend test -- --runInBand frontend
npx --yes --package @playwright/cli playwright-cli -s=cart-eta open http://localhost:3000/tienda
npx --yes --package @playwright/cli playwright-cli -s=cart-eta run-code --filename tests/admin-review/cart-delivery.browser.js
```

Evidencias locales ignoradas por Git:
`output/playwright/cart-delivery-2026-10-05/`.
No se cambia el procedimiento de publicación del trabajo anteriormente comiteado;
estas correcciones quedan pendientes de revisión local.

## Continuaci?n autorizada: calendario y publicaci?n

Este informe conserva las verificaciones de la etapa anterior. El encargo posterior
autoriza reunir estas correcciones y publicarlas, y sustituye la base de tres d?as
naturales por esa base m?s los incrementos de fines de semana y festivos oficiales.
Regla vigente, fuentes, l?mites y preparaci?n: [calendario compartido](delivery-calendar-2026-10-05.md).
