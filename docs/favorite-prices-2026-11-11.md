# Favoritos: contrato de precios y reproducción local

Corregido en local sobre `fix/sale-point-costs-20261111`, base `5766a08ad124977e2dbc222a460817685e31e42c`, respetando los cambios pendientes de costes y avisos. Sin commit, push, despliegue ni escrituras en producción.

## Reproducción y primera divergencia

Se reprodujo el caso exacto en navegador autenticado **antes de modificar el código de precios**, con Nest y PostgreSQL reales sobre una copia desechable local. Se utilizó una cuenta sintética con el favorito ya guardado antes de pasar a la segunda tirada. ASHEN SHELL y ARMORED COAL proceden de la base local del proyecto.

En esos datos, ASHEN (producto 3) tiene:

- Tirada 1 `initial-edition:3`, precio público histórico **9000 céntimos / 90 €**.
- Tirada 2 `a8f7fa53-5b60-4ac8-b5e9-8604b4fa43fa`, activa al reproducir, **11000 céntimos / 110 €**.
- La base local original tenía una unidad M. Para reproducir el caso agotado se retiró solamente esa unidad en la **copia**, mediante `AdminInventoryService.update`, con motivo de prueba. Todas las variantes de la tirada activa quedaron a cero. No se ajustó la base original.
- ARMORED (producto 4) conserva tirada 1, **6500 céntimos / 65 €**.

| Punto del recorrido | ASHEN | ARMORED | Unidad |
|---|---:|---:|---|
| `Product.price`, proyectado desde tirada activa | 11000 | 6500 | Céntimos enteros |
| `FavoritesService.toProductResponse`: `price`, `priceInCents` | 11000 | 6500 | Céntimos enteros |
| `CRONOX_API.getFavorites` → `mapFavoriteProduct` → `mapProduct`: `priceCents` | 11000 | 6500 | Céntimos enteros |
| Mismo mapper: `price` | 110 | 65 | Euros |
| Mismo mapper: `priceLabel` | 110,00 € | 65,00 € | Texto formateado |
| Antiguo `profile.js/normalizeFavoriteProduct`: campo elegido primero | `product.price = 110` | `product.price = 65` | Euros, tratados erróneamente como céntimos |
| Antiguo `normalizeCentsValue`, regla `0 < n < 100 → n × 100` | 110 | 6500 | Unidad deducida del tamaño del número |
| Antiguo `formatPriceFromCents`, división entre 100 | **1,10 €** | **65,00 €** | Resultado visible |

**La primera divergencia está en `cronox-front/assets/profile.js`, función `normalizeFavoriteProduct`.** El mapper ya había convertido correctamente los céntimos a euros; el perfil prefería ese campo sobre `priceCents` y lo volvía a tratar como céntimos. La regla por magnitud ocultaba el error en ARMORED: 65 se multiplicaba por 100 antes de dividirse otra vez. ASHEN, con 110, no entraba en esa regla. No era una excepción del producto ni del estado agotado. Una prueba adicional muestra que un importe real de 0,65 € terminaba en 65 € en el perfil, por repetir la heurística al normalizar y al formatear.

Antes de la corrección, el navegador confirmó:

| Producto | Mi cuenta | Favoritos independiente | Ficha |
|---|---:|---:|---:|
| ASHEN SHELL | **1,10 €** | 110,00 € | 110,00 € |
| ARMORED COAL | 65,00 € | 65,00 € | — |
| Control decimal | 34,95 € | 34,95 € | — |
| Precio real 1,10 € | 1,10 € | 1,10 € | — |
| Precio real 0,65 € | **65,00 €** | 0,65 € | — |

La página independiente recibía registros HTTP sin normalizar desde `FavoritesManager.serverFavorites` (`/api/favorites`) o `/api/favorites/products`. Su `normalizeFavorite` trataba `price` como céntimos, con otra heurística `<100`. Además, `renderFavorites` prefería una entrada coincidente de `CRONOX_PRODUCTS`, aunque fuera anterior a la respuesta de Favoritos. Con catálogo reciente, ASHEN se veía correctamente y el catálogo también ocultaba el fallo de importes inferiores a un euro. Una regresión con catálogo a 90 € y respuesta de Favoritos a 110 € demostró la segunda divergencia: la página independiente pintaba **90 €**.

La ficha y las tarjetas del catálogo utilizan `api.ts/mapProduct` y el componente compartido `products.js/createProductCard`, que pinta `priceLabel`. La ficha usa el `priceLabel` del producto/variante normalizado. `ProductEditionsService.project` proyecta el precio de la tirada activada a `Product.price`, y `FavoritesService` lee ese producto actual dentro de una transacción RepeatableRead. No se elige la tirada histórica al recuperar el favorito.

## Hipótesis contrastadas y corrección

- **Conversión duplicada/campo equivocado:** demostrada con valores HTTP, mapper y DOM anteriores a la corrección.
- **Precio guardado con el favorito:** descartada. `Favorite` guarda `id`, `userId`, `productId`, `createdAt`; no tiene precio. Las cinco filas de la cuenta sintética conservaron exactamente IDs y fechas durante las pruebas.
- **Tirada histórica/agotado:** descartados como causa del 1,10 €. El precio recibido era 11000, la tirada 2 estaba activa y cambiar el stock no interviene en las operaciones numéricas del perfil.
- **Caché/fallback:** no causaban el 1,10 € reproducido, pero sí podían conservar un precio antiguo. El perfil cargaba Favoritos una sola vez mediante `favoritesLoaded`, y la página independiente sustituía el precio de servidor por el catálogo en memoria.

Ahora `api.ts` expone el **mapper existente** como `normalizeProductResponse`: recibe un registro público con `price` en céntimos y devuelve `priceCents` en céntimos, `price` en euros y `priceLabel`. `getFavorites` sigue usando ese mismo mapper y pide `cache: no-store`.

El perfil consume directamente ese modelo ya normalizado. Se retiraron sus dos funciones de reinterpretación/formateo de precios. La página independiente normaliza su respuesta HTTP con el mapper compartido y pasa el resultado directamente al componente de tarjeta; se eliminan su heurística, formateador duplicado y sustitución por un catálogo posiblemente obsoleto. No se deducen unidades por rangos ni se introduce ninguna excepción para ASHEN.

El perfil recarga al volver a abrir su pestaña de Favoritos; ambas páginas refrescan al recuperar foco/visibilidad y al volver desde bfcache. La protección de peticiones en curso se mantiene. El controlador ya devolvía `Cache-Control: private, no-store`. No hace falta migración de datos, borrar favoritos ni volver a añadirlos.

Consumidores revisados: `app.js/FavoritesManager` (registros HTTP y IDs, sin normalizar precios), `favorites-toggle.js` y el puente antiguo `fav-toggle.js` (IDs), `products.js` (tarjetas y selección rápida), `product-page.js` (ficha), `api.ts/mapProduct`, `mapVariant`, `mapCartItem`, `cart.js`, checkout/recomendaciones y `admin-favorites.js` (recuentos, sin el formateador defectuoso). Tras retirar las funciones duplicadas no quedan consumidores de `window.formatPriceFromCents` ni `normalizeCentsValue` en estos recorridos. No se cambiaron los importes ni los formateadores de pedidos/ventas históricos.

## Verificación

La regresión `src/frontend/favorite-prices.dom.spec.ts` ejecuta **el `api.js` compilado real** y las dos vistas. Antes del arreglo falló con `Expected 110,00€ / Received 1,10€` en perfil y `Received 90,00€` en Favoritos con catálogo obsoleto. Después pasan los cuatro casos: las dos vistas muestran 110 €, 65 €, 34,95 €, 1,10 € y 0,65 €, y recargan un nuevo precio de 125 € conservando los mismos favoritos.

Navegador con sesión iniciada, 1440 y 390 px:

1. Perfil, Favoritos independiente y ficha muestran ASHEN a **110,00 €**, tirada 2 activa y agotada. Ambas vistas de Favoritos muestran ARMORED a **65,00 €**, decimal a **34,95 €** y controles a **1,10 / 0,65 €**.
2. Se activa la tirada 1 después de guardar el favorito: el perfil ya abierto, al entrar otra vez en Favoritos, muestra **90 €**, y también la página independiente y la ficha. Esa tirada histórica tiene su propio stock; la activación conserva las reglas de inventario.
3. Volver a tirada 2 recupera **110 €** y estado agotado. Cambiar su precio a **125 €** actualiza Favoritos al recuperar foco, el perfil al abrir/recargar y la ficha. Finalmente se restaura **110 €** en la copia.
4. Comparación completa del pedido sintético histórico y su snapshot financiero antes/después: idénticos. Total, precio unitario y línea de pedido permanecen en **90 €**; coste histórico **26,20 €**, tirada 1. `/api/me/orders` y la tabla Pedidos siguen mostrando 90 EUR. La representación histórica de pedidos no se modifica.
5. Favoritos conservados íntegramente y stock final idéntico al inicial de la tirada 2. «Avisarme» sigue abriendo las seis tallas. No se realiza ningún pago real.

Pruebas ejecutadas:

- 7 suites / 48 pruebas: Favoritos/precios, contrato de cuenta, stock, componentes compartidos, selección rápida, selector de avisos y Favoritos de administración.
- 5 suites / 39 pruebas: carrito, envío, recomendaciones de checkout, reintentos de preparación y ciclo de checkout.
- Total: **12 suites / 87 pruebas aprobadas**.
- `npx.cmd vite build -c vite.admin.config.ts`: API recompilada. `npx.cmd tsc --noEmit -p tsconfig.admin.json`: aprobado. Typecheck de backend, sintaxis JS y `git diff --check` comprobados.
- Cachés: `api.js` **v30**, `profile.js` **v36**, `favorites.js` **v8**. Se mantienen las versiones de CSS/avisos de los cambios anteriores.

No se consultó una cuenta real ni se comprobó el despliegue actual de producción: el fallo se reprodujo íntegramente en local, por lo que no fue necesario investigar recursos externos para explicar la divergencia. El alcance verificado es la copia local y sus recursos compilados; no se ejecutó un cobro real.

## Revisión local

Servidor abierto: `http://127.0.0.1:43134/profile.html`, pestaña **Favoritos**. Comparación: `http://127.0.0.1:43134/favorites.html` y `http://127.0.0.1:43134/producto/ashen-shell`. La sesión de prueba está abierta en el navegador de revisión. Credenciales sintéticas en `output/playwright/favorite-prices/fixture.json` (`users.buyer.email`, `password`), excluido de Git.

```powershell
# Crear otra copia aislada de la base LOCAL (puerto 43134 libre).
node cronox-backend/scripts/review-product-editions-integrated.cjs --favorite-prices
node cronox-backend/scripts/prepare-favorite-prices-browser.cjs
# Iniciar sesión con el comprador de fixture.json antes del recorrido:
playwright-cli --session cronox-favorite-prices open http://127.0.0.1:43134/ --headed
playwright-cli --session cronox-favorite-prices run-code --filename output/playwright/favorite-prices/browser.cjs
```

La copia se elimina al cerrar mediante `/__review/stop`. Los controles de activación/precio y fixtures pertenecen exclusivamente al script de revisión, no a la aplicación publicada. Evidencia excluida de Git: `output/playwright/favorite-prices/source-version.json`, capturas `before-profile-1440.png`, `before-favorites-1440.png`, `after-profile-*`, `after-favorites-*`, `after-pdp-*`, `ashen-corrected-1440.png`, `ashen-corrected-390.png`.
