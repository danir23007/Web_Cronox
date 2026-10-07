# Últimas unidades por producto — 7 de octubre de 2026

Implementación revisada localmente y preparada para la publicación autorizada. Las operaciones de prueba no modifican productos reales ni envían correos.

## Regla y persistencia

`Product.lastUnitsThreshold` es un entero nullable. Los productos existentes quedan en `NULL` (desactivado). El editor admite enteros de 0 a 2147483647; vacío envía `null`. Tanto `null` como **0 desactivan únicamente el aviso de últimas unidades**, según la aclaración del propietario. «AGOTADO» depende del stock real, conserva las restricciones de compra y aparece arriba en las tarjetas y junto al precio en Quick Add.

El aviso aparece únicamente si `0 < stock disponible total <= lastUnitsThreshold`. Se reutiliza `availableStock` en `src/common/stock-status.ts`: variantes activas y disponibles, sumando cantidades positivas. `purchasableStock` exige cantidades conocidas de las variantes activas y `productStockStatus` comparte el resultado entre superficies. Total cero produce agotado antes de consultar el umbral; con información incompleta no se infiere escasez ni agotado. El checkout ya descuenta las reservas de `stockQty` al reservar (`OrdersService.reserveStockForCheckoutSnapshot`) y las devuelve al liberarlas; no se descuentan por segunda vez. Se conserva la clasificación del inventario administrativo y no se cambian precios, reservas ni reglas de compra. El frontend deja de usar el umbral fijo anterior de 14 unidades para sus avisos.

La configuración se valida en los DTO de alta y edición, en el editor y con un CHECK PostgreSQL no negativo. Se mantiene el control de concurrencia existente del editor. Las respuestas públicas de catálogo incorporan el nuevo escalar y la disponibilidad existente; no incluyen `privateCost`, `unitCostCents` ni palabras de búsqueda internas. Favoritos conserva explícitamente el umbral en su respuesta limitada.

## Presentación y actualización

`CRONOX_STOCK.decorateLastUnits` añade un único aviso en la esquina superior izquierda de la imagen en las tarjetas compartidas de tienda, Favoritos, Perfil y productos relacionados, usando sus datos ya cargados. «ÚLTIMAS UNIDADES» y «AGOTADO» se excluyen mutuamente; no queda ningún aviso bajo el precio. Solo punto rojo fijo y texto: sin fondo, borde, sombra, padding ni recuadro, sin animación y con `pointer-events:none`. Se reserva el área de los controles de favorito; el texto puede envolver en espacios estrechos. Carrusel y navegación se conservan.

`decoratePurchase` mantiene el aviso junto al precio en Quick Add (y en la ficha que reutiliza este componente): «Últimas unidades» o «Agotado», con un punto rojo fijo. Usa el mismo estado por producto, sin una condición independiente basada en tallas o en el umbral antiguo. El precio tachado y el bloqueo de compra se conservan cuando el total es cero.

Los colores se reutilizan exactamente desde `store.css`: naranja original **`--stock-low-warning: #D9A21B`** y rojo original **`#ff6464`**, ahora identificado como `--stock-out-warning`. Ambos avisos y el punto usan esas variables. Se eliminan las reglas obsoletas de `.product-card__stock-label` y su cambio de color contextual; no se usa el naranja aproximado `#a84400` de la primera implementación.

### Ajustes adicionales de Quick Add y recomendaciones

`soldOutSizeCount` agrupa las variantes activas por talla normalizada y cuenta únicamente grupos con stock comprable conocido igual a cero. Una variante comprable impide considerar agotada esa talla. No cuenta filas duplicadas, tallas externas al producto ni stock desconocido como cero. La base actual tiene UNIQUE(productId, size); las duplicaciones se prueban con snapshots locales del renderer y pruebas unitarias, sin alterar esa restricción. Quick Add elige una variante comprable cuando recibe un snapshot con variantes duplicadas.

| Situación | Acción | Mensaje inferior | Entrega |
| --- | --- | --- | --- |
| Ninguna talla agotada | Añadir al carrito | Ver detalles del producto | Debajo del botón |
| Una o dos agotadas, compra disponible | Añadir al carrito | Pregunta sobre talla agotada y aviso desde el producto | Inferior derecha |
| Tres o más agotadas, compra disponible | Añadir al carrito + AVÍSAME | Ver detalles del producto | Inferior derecha |
| Agotado completo, incluso una sola talla | Compra bloqueada + AVÍSAME | Ver detalles del producto | Oculta; no promete reposición |

**Comportamientos iniciales solicitados:** AVÍSAME es un enlace con estilo de botón hacia `#productWaitlist` del producto actual; enfoca el selector existente sin preselección ni suscripción. Solo tras elegir una talla se consulta el aviso y se conserva la confirmación explícita y el acceso autenticado. Si deja de ser elegible la talla elegida, esta entrada no elige otra automáticamente. La posición inferior derecha con una o dos tallas agotadas también es el tratamiento inicial indicado, que podrá ajustarse posteriormente.

`product-delivery.js` expone su actualización compartida. Quick Add usa la misma estimación que producto y cesta, con los festivos, fines de semana y cambio de fecha de Madrid existentes; no añade fórmula ni calendario nuevos. La fecha se oculta con disponibilidad incompleta o total cero y al cerrar. El módulo conserva un único temporizador de cambio de día; no hace consultas externas ni sondeos. La posición inferior derecha forma parte del flujo normal del contenido para evitar solapamientos al envolver texto en móvil.

Las filas añadidas a la cesta no reciben avisos decorativos de stock; sus errores funcionales siguen intactos. Las recomendaciones filtran el stock comprable confirmado cero **antes** de limitar a seis. Las pocas unidades siguen siendo recomendables y comprables. Su aviso es exclusivamente ` · Últimas unidades` a continuación del precio, naranja original, sin punto rojo ni aviso sobre la imagen. La firma existente de renderizado incluye los datos de disponibilidad y umbral y se invalida al recibir datos nuevos.

La decoración puede repetirse con datos nuevos: elimina el aviso anterior, vuelve a calcularlo y no duplica filas de precio. Catálogo, detalle, productos por categoría y favoritos se sirven sin caché HTTP de disponibilidad; las lecturas públicas correspondientes usan `no-store`. El catálogo y Favoritos se refrescan al restaurar una página desde la caché de navegación. El catálogo usa la búsqueda actual al refrescar. Las referencias de recursos HTML llevan nueva versión para invalidar los archivos JS/CSS anteriores.

No existe una caché nueva de producto, una consulta por tarjeta ni sondeo. La actualización ocurre al recibir disponibilidad nueva, recargar catálogo/página o restaurar las vistas indicadas. Una pestaña que permanece abierta no recibe stock en tiempo real sin una nueva lectura; la compra mantiene sus comprobaciones de stock en servidor.

## Verificación local

Base de desarrollo confirmada: **127.0.0.1:5433 / cronox_dev**, correo y trabajos automáticos desactivados. Copia PostgreSQL custom anterior a la migración, 411909 bytes, en `output/playwright/last-units/cronox_dev_before_last_units.dump` (ignorada por Git). `npm --prefix cronox-backend run migrate:local` aplicó exclusivamente `20261007160000_product_last_units_threshold`; las 79 migraciones del repositorio quedan aplicadas en local. Sin reset.

Prisma Client regenerado en la implementación inicial; estas revisiones no cambian el esquema ni necesitan otra migración o generación. Compilaciones Nest y Vite del administrador/API completadas de nuevo. Pruebas mantenibles: DTO de alta/edición, persistencia en alta HTTP, función compartida, avisos inline, redecoración DOM y nuevas acciones/fechas de Quick Add y recomendaciones. Batería completa: **202 suites y 1850 pruebas aprobadas**, incluyendo productos, stock, autenticación, avisos y checkout. Tras el último ajuste que evita elegir otra talla automáticamente se repiten las pruebas DOM y de controlador/servicio de avisos, también aprobadas. Se actualizan dos expectativas de versión de quick-add.css para conservar sus comprobaciones de caché.

Chromium con catorce productos y un SUPERADMIN desechables, exclusivamente locales:

- Umbral 5: total 6 sin aviso; 5 (2+3) y 1 con aviso; 0 muestra AGOTADO arriba sin aviso de últimas unidades. Los precios de las tarjetas no tienen avisos debajo.
- Umbral vacío y 0: sin últimas unidades con stock positivo; con todas las tallas a cero muestran agotado. Una talla positiva y las demás cero nunca produce agotado. Una variante inactiva con 100 unidades no altera la suma.
- Frontend rechaza negativos y decimales. Peticiones reales con -1, 1.5, texto, cadena vacía, booleano y valor fuera de rango devuelven HTTP 400.
- Guardado/reapertura y recarga del editor conservan 5, 0 y null. Cambiar umbral y stock actualiza la tarjeta tras leer el catálogo de nuevo.
- Favoritos usa la misma decoración y los datos recientes; respuesta pública sin costes privados.
- Escritorio 1365×900 y móvil 390×844, comprobación visual y geométrica: aviso dentro de la imagen y sin solapar favorito/Quick Add. Hover, flechas, swipe táctil real mediante CDP, selección de talla y apertura/cierre de Quick Add funcionan. Se comprueban las catorce combinaciones también dentro de Quick Add, junto al precio, y su botón queda deshabilitado únicamente por agotado cuando no hay stock comprable.
- Colores efectivos de navegador: `rgb(217, 162, 27)` y `rgb(255, 100, 100)`, exactamente los valores originales. Puntos sin animación, un único aviso por superficie. Búsqueda de «Últimas tallas» en HTML, CSS, TS y JS del frontend: ninguna aparición, incluido el bundle regenerado. La ficha de producto también adopta el texto y cálculo compartidos para que no sobreviva ese aviso antiguo en otra vista.
- Casos 0, 1, 2, 3 y 4 tallas agotadas, agotado completo con una y dos tallas, recuento duplicado y talla externa: botón y mensaje correctos. Fecha idéntica a estimateCart bajo las mismas condiciones, sin solapamientos con botones/enlace; oculta si agotado. Estilos de tarjetas sin fondo, borde ni sombra comprobados en navegador.
- Cesta real local: añadir desde Quick Add un producto con pocas unidades, añadir otro desde recomendaciones, conservar ambos, retirar el segundo y reabrir. Sin textos decorativos en sus filas; recomendaciones con texto naranja al lado del precio y sin productos agotados. Comprobado en ambas dimensiones.
- Entrada AVÍSAME y enlace de una/dos tallas: navegan al producto correcto. AVÍSAME enfoca la sección, no elige talla ni llama a /api/waitlist antes de elegir. Tras elegir, GET consulta el estado; un visitante debe abrir el acceso y confirmar después. **Límite local confirmado:** el POST explícito devuelve HTTP 403 «Operación deshabilitada en la revisión local de datos históricos.» por `localReviewSafety`. Se conserva esta protección y se comprueba que el error se muestra y permite reintentar; no se declara una alta/cancelación real de avisos completada en navegador. Las validaciones de autenticación, elegibilidad, confirmación y cancelación del controlador/servicio pasan sus pruebas aisladas existentes, sin correo real.
- Doce aperturas/cierres sucesivos: máximo dos nodos de imagen mientras está abierto, cero al cerrar y cero nuevas peticiones de imágenes o catálogo durante el segundo de reposo observado. No se añaden peticiones por tarjeta, sondeos ni listeners por apertura.

### Revisión de lo que ya funcionaba y lo corregido

Ya funcionaban la persistencia y validación, vacío/0 como desactivación de últimas unidades, suma de stock disponible respetando reservas, punto fijo, actualización y las interacciones de tarjetas. Faltaba retirar el aviso antiguo bajo el precio, usar el color original en lugar de uno aproximado, trasladar agotado arriba con independencia del umbral y actualizar Quick Add para que usara ese mismo umbral y un punto fijo. Esta revisión corrige esas diferencias sin modificar datos reales de producción.

El encargo adicional sustituye el fondo negro de la revisión anterior por punto y texto sin etiqueta, añade las acciones según tallas agotadas y la fecha compartida en Quick Add, y separa la presentación de recomendaciones de las tarjetas normales. No cambia el campo del administrador, precios, existencias, reservas ni las comprobaciones de identidad.

Capturas locales, después de terminar el preloader. Para exportar el grid completo se amplía únicamente la altura del viewport de captura; las interacciones móviles se prueban a 390×844.

| Superficie | Escritorio | Móvil |
| --- | --- | --- |
| Tarjetas, todos los casos | [Captura](../output/playwright/last-units/desktop-cards.png) | [Captura](../output/playwright/last-units/mobile-cards.png) |
| Quick Add, últimas unidades | [Captura](../output/playwright/last-units/desktop-quick-add-low.png) | [Captura](../output/playwright/last-units/mobile-quick-add-low.png) |
| Quick Add, agotado | [Captura](../output/playwright/last-units/desktop-quick-add-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-out.png) |
| Quick Add, una talla agotada | [Captura](../output/playwright/last-units/desktop-quick-add-one-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-one-out.png) |
| Quick Add, tres tallas agotadas | [Captura](../output/playwright/last-units/desktop-quick-add-three-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-three-out.png) |
| Quick Add, cuatro tallas agotadas | [Captura](../output/playwright/last-units/desktop-quick-add-four-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-four-out.png) |
| Cesta y recomendaciones | [Captura](../output/playwright/last-units/desktop-cart-recommendations.png) | [Captura](../output/playwright/last-units/mobile-cart-recommendations.png) |
| Entrada a avisos sin talla elegida | [Captura](../output/playwright/last-units/desktop-alert-entry.png) | [Captura](../output/playwright/last-units/mobile-alert-entry.png) |

Regresión local de rendimiento con 51 productos, 6 imágenes activas y 3 archivadas por producto: listado inicial 159 ms (API 15 ms), editor inicial 97 ms (detalle 8 ms), listado posterior 107 ms. Cero tareas largas y cero peticiones/cargas de imágenes en editor inactivo y tras cerrarlo. Comprueba también borradores, respuestas antiguas, guardar stock/precio/coste privado, orden/restauración de imágenes, categorías, activación, paginación y Bulk Edit. Estas cifras son **locales**, no mediciones de producción. El benchmark ahora fuerza una navegación de documento en su muestra inicial: cambiar solo el hash podía reutilizar la página y omitir los contadores de esa muestra.

Los resultados temporales, capturas y credenciales desechables están en `output/playwright/last-units/`, excluidos de Git. Se han eliminado los catorce productos, sus cestas y el usuario de prueba; se conserva la copia local anterior a la migración.

Scripts mantenibles en `tests/admin-review/last-units-fixtures.cjs`, `last-units.browser.js` y `last-units-actions.browser.js`. El generador valida el destino local y produce ambos scripts privados para ejecutar por Playwright CLI (`run-code --filename`), en ese orden, con una sesión inicialmente en `/admin-login.html`. Al terminar, `node tests/admin-review/last-units-fixtures.cjs cleanup` comprueba la pertenencia de los datos antes de retirarlos. No introducir los scripts privados, credenciales o capturas en Git.

Verificación final con la compilación actual: `localhost:3000/api/health`, productos, categorías y los recursos `api.js?v=16` y `store.css?v=113` devuelven HTTP 200. Los recursos adicionales llevan products v68, app v87, quick-add.css v8, product-delivery v4 y waitlist v2. El catálogo incluye el umbral y ya no contiene los productos desechables; el CSS servido contiene los dos colores originales. La preparaci?n de publicaci?n posterior conserva estos recursos y las comprobaciones locales.

## Publicación posterior (no ejecutada)

Seguir `.github/workflows/deploy.yml` y `.github/scripts/deploy-production.sh`. Esta tarea requiere una migración; el backend nuevo no debe arrancar contra un esquema que carezca de la columna.

1. Revisar el diff y los despliegues activos. Confirmar explícitamente el destino de publicación, consultar **todas** las migraciones pendientes y guardar/verificar una copia de seguridad del destino antes de migrar.
2. Usar la instalación reproducible prevista (`npm ci` en raíz y backend), generar Prisma Client y compilar con los comandos del proyecto (`npm --prefix cronox-backend run prisma:generate`, `npm --prefix cronox-backend run build:compiled`, `npm run admin:build`). No añadir dependencias ni actualizar paquetes por esta función.
3. Aplicar con el flujo de publicación `prisma migrate deploy` las migraciones pendientes verificadas, incluida `20261007160000_product_last_units_threshold`. No usar `reset`, ni presuponer que las migraciones locales están en producción. La migración añade una columna nullable y un CHECK; no modifica stocks ni activa avisos existentes.
4. Arrancar el backend compilado y publicar los recursos/versiones HTML juntos. No requiere una variable de entorno nueva.
5. Verificar salud, historial de migraciones, recursos nuevos, DTO/API pública y editor. En producción, verificar las vistas sin alterar productos, pedidos ni inventario reales. No enviar correos ni realizar pagos de prueba reales.

## Confirmación AVÍSAME y preflight de publicación

El HTTP 403 de la revisión histórica local procede de `localReviewSafety`, que rechaza escrituras de `/api/waitlist` cuando `CRONOX_LOCAL_DEV=true`, antes del controlador. No se ha cambiado ni omitido este middleware. Producción no activa ese indicador.

Se ha completado el flujo real en una base PostgreSQL desechable independiente (`127.0.0.1:5433/cronox_avisa_release_test_*`), con esquema e historial de migraciones copiados del desarrollo local y sin copiar datos históricos. Las migraciones históricas requieren un baseline legado: por eso no se presentan como una instalación desde cero autosuficiente. El perfil de pruebas utiliza JWT y CSRF reales, correo y todos los workers desactivados, claves ficticias y ninguna credencial de producción.

Playwright CLI verifica en escritorio y móvil la entrada desde Quick Add sin talla preseleccionada, elección de S, inicio de sesión sin suscripción automática, confirmación HTTP 201, respuesta idempotente, persistencia tras recargar y cancelación HTTP 200. Se comprueba en base de datos que el único aviso pertenece al producto elegido y a S, sin reclamación ni aceptación de correo. Sin sesión: 401; sin CSRF: 403; talla con stock: 409. No se envían correos. Scripts mantenibles: `last-units-isolated.cjs` y `last-units-isolated.browser.js`; credenciales, logs y capturas quedan excluidos en `output/playwright/last-units-release/`.

Preflight de producción del 7 de octubre: destino confirmado `aws-1-eu-west-1.pooler.supabase.com:5432/postgres`; 78 migraciones aplicadas, sin fallidas y checksums coincidentes. Única pendiente: `20261007160000_product_last_units_threshold`. Copia privada previa del esquema público y sus datos: `/home/deploy/.cronox-ops/last-units-2026-10-07T12-29-57-570Z/public-before-last-units.dump`, 614415 bytes; índice de restauración verificado; SHA-256 `879c177d04deedccbabf6a9dd09b7493dc10885be35c39a76e3ca12856f9c42c`. No se copia la base de producción al repositorio.

Instalación reproducible de raíz y backend, Prisma Client y compilaciones Vite/Nest completadas. Se reutiliza la suite completa previa (202 suites, 1850 pruebas); se repiten 8 suites afectadas (108 pruebas), exportaciones CI (59 pruebas), comprobación de artefactos y smoke compilado: todo correcto. La publicación sigue el workflow existente, que genera, compila, aplica las migraciones pendientes mediante `prisma migrate deploy` y reinicia el backend. El resultado del workflow y la comprobación online se entregan al finalizar; este preflight no acredita por sí solo un despliegue terminado.
