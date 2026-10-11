# Publicación y recuperación de beneficio manual — 11/10/2026

## Publicación

Commit de código: `ba6787f8fa4dee26ca73502d3c1fc7798ece3e29`, `fix(admin): calculate manual purchase profit from paid prices and frozen costs`.

[Deploy CRONOX, ejecución 38172467902](https://github.com/danir23007/Web_Cronox/actions/runs/38172467902): `success`, tanto `verify-release` como `deploy`. Se comprobó el mismo commit instalado en el VPS, salud y disponibilidad con HTTP 200, y coincidencia de los recursos públicos `app.js`, `products.js`, `product-page.js` y `admin-finance.js` con Git. También terminó correctamente la publicación automática de Pages.

## Recuperación aplicada

Los registros de #19 y #20 se revisaron de nuevo en solo lectura y coincidían con el desglose aprobado. Dentro de una transacción serializable se bloquearon los pedidos y archivos pertinentes, se verificaron las ocho líneas, precios pagados, cantidades, revisiones y costes configurados, y se guardó y sincronizó a disco la copia anterior antes de modificar costes.

Se verificó la identidad ADMIN/SUPERADMIN del administrador original de estas compras para la auditoría. Se completaron únicamente costes ausentes en las líneas y el archivo financiero. Se guardó una nueva revisión de cada pedido y una auditoría por pedido. Las revisiones originales permanecen disponibles. Se compararon los valores anteriores y posteriores antes del commit: pedidos, precios, cantidades, stock, movimientos y referencias de pago permanecieron idénticos.

| Pedido | Facturación productos | Coste total | Beneficio | Revisión |
| --- | ---: | ---: | ---: | ---: |
| 19 | 215,00 € | 100,25 € | 114,75 € | 2 |
| 20 | 25,00 € | 10,60 € | 14,40 € | 2 |

No hay costes pendientes. La inspección posterior muestra ocho líneas con coste guardado que debe conservarse, cero propuestas y cero costes ausentes. Las dos unidades regaladas siguen teniendo coste: aportan una pérdida de 6,60 €, incluida en el pedido #19.

## Verificación

El servicio financiero compilado desplegado, consultado por SSH sin arrancar otra aplicación ni crear sesiones, devuelve para el 23/09/2026: facturación de productos **240,00 €**, costes **110,85 €** y beneficio **129,15 €**. La recarga devuelve los mismos importes; indicador, suma de periodos del gráfico y suma del desglose coinciden. El mapa concilia dos pedidos, nueve unidades y 240,00 € de productos, sin diferencia con Finanzas.

Se comprobó visual y funcionalmente `admin-finance.js` publicado en escritorio y móvil, renderizando el informe real de producción en una ruta de navegador aislada. Indicador, tooltip, punto de beneficio y tabla coinciden tras dos recargas. Esta comprobación no utiliza una sesión autenticada del administrador; no se falsificaron credenciales ni se crearon sesiones de usuarios.

En `https://cronox.es`, las pruebas de navegador comprobaron:

- Selección única con el catálogo real: Pantalones → Chaquetas → Camisetas, drop, repetir selección, Todos, URL y recarga; respuesta vacía simulada únicamente para el estado vacío.
- Recomendaciones independientes con catálogo y cesta simulados: categorías, drops, filtro vacío, últimas unidades y exclusión de agotados; añadir otra categoría conserva el filtro y actualiza cantidades y totales.
- Recomendaciones y apertura/cierre en la tienda y las nueve páginas reales del footer, a 1440, 390 y 320 px.
- Listas largas en una ventana de 320 px de alto: sin desplazamiento horizontal, desplazamiento vertical útil y acceso al logo y la X.
- Ausencia de menú y de su botón dentro de la página y el panel de cesta; cantidades, eliminación, totales, checkout y menú de tienda/ficha de producto conservados.
- Menú idéntico, logo cargado y X accesible en 17 rutas públicas anónimas (34 comprobaciones entre escritorio y móvil), incluyendo ficha, galería, favoritos, búsqueda, checkout y páginas informativas; apertura, cierre, reapertura y restauración de scroll junto al footer. La ruta de perfil autenticado no se verificó con sesión real: el visitante anónimo es redirigido a la portada.
- Estado superpuesto de menú y cesta: la X queda por encima de la cesta; al cerrar el menú se restaura la cesta, su fondo y su bloqueo de scroll; cerrar el último panel devuelve la posición original junto al footer. El estado superpuesto se activó directamente para comprobar el clic real de la X, sin añadir ningún botón dentro de la cesta.

Las mutaciones de cesta de las pruebas se interceptaron y resolvieron en memoria. No se realizaron pedidos, cobros ni cambios reales de stock para verificar la web. La recuperación autorizada fue el único cambio de datos financieros.

## Evidencias privadas

Los informes, el desglose por línea, las capturas y la copia anterior permanecen bajo `test-results/manual-finance/`, ignorado por Git. No se incorporan credenciales, costes privados por artículo ni copias de producción al commit.

- Copia anterior: `production-before-2026-10-11T20-34-53-200Z.json`.
- Resultado transaccional: `production-recovery-receipt.json`.
- Inspecciones: `pre-execution-review.json` y `post-execution-review.json`.
- Revisiones originales y auditorías: `production-history-verification.json`.
- Servicio financiero/mapa desplegados: `deployed-finance-report.json`.
- Recursos publicados: `published-assets.json`.
- Capturas: `live-finance-chart-*.png`, `live-finance-breakdown-*.png`, `menu-long-list-*.png` y capturas de cesta/selección.

El plan original de recuperación ya está consumido. No repetirlo: sus controles de revisión impiden reutilizarlo después de completar costes.

## Estado de Git

Todos los cambios de código de esta tarea están en el commit de publicación. Este documento y la actualización del procedimiento se añaden en un commit posterior de documentación; `Deploy CRONOX` excluye los cambios exclusivamente bajo `docs/`, por lo que el código activo sigue correspondiendo a `ba6787f` y no necesita otro reinicio.

El repositorio local queda limpio y sincronizado con `origin/main`. En el VPS, `npm ci` deja diferencias en `node_modules` que el repositorio ya tenía versionado; esas dependencias generadas no se incorporan a los commits de esta tarea. El archivo ajeno preexistente `cronox-backend/src/main.ts.cronox-before-stripe` se conservó y su SHA-256 coincide con la evidencia de la publicación anterior. No se descartaron ni incorporaron cambios ajenos.
