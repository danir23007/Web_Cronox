# Mapa, territorio y eliminación de puntos de venta

**Actualización:** publicado en producción en `09525386`. Migraciones y conciliación de los tres puntos reales verificadas en solo lectura, sin eliminar puntos ni alterar ventas. Estado vigente en [publicación conjunta](release-final-2026-10-27.md). Se conserva a continuación el registro local previo.

Estado local: implementado el 27/10/2026. Sin commit, push ni despliegue. No se han eliminado puntos reales ni efectuado pagos. Se conserva el trabajo pendiente de checkout, usuarios, eventos QR, footer y compatibilidad móvil.

## Comportamiento

- La entrada normal a Mapa muestra Provincias: selector, título, SVG de 52 territorios y tabla sincronizados. Una URL con `division=communities` mantiene esa selección explícita; las preferencias antiguas de almacenamiento no imponen comunidades.
- El mapa combina el archivo financiero de pedidos con los movimientos originales `PointEntry`. Finanzas y el detalle del punto utilizan el mismo libro y las mismas funciones económicas; no hay tablas nuevas de totales ni sincronización por scripts.
- Las ventas físicas se atribuyen por `SalePoint.provinceId` (código INE de dos caracteres). La comunidad se deriva del catálogo existente. Las ventas web mantienen la clasificación de dirección existente.
- La normalización inicial es exacta y conservadora: nombres/alias de provincias, Bilbao/Bilbo y otras ciudades inequívocas expresamente catalogadas. Bizkaia y Vizcaya asignan `48`. Los textos ambiguos permanecen sin provincia. Sus importes, unidades y gastos siguen incluidos en el total general y en «España sin ubicación identificada».
- El editor permite elegir/corregir la provincia, incluida la opción sin ubicación. La corrección reasigna **todo el historial del punto**; no altera sus importes, pedidos, entradas ni stock. También puede corregirse la ubicación de un punto retirado desde su detalle histórico, sin reactivarlo.

## Criterios económicos visibles

- Ventas/pedidos cuenta operaciones registradas; no equivale a prendas. Conserva la venta original al devolverla. Los cambios de fecha usan los contramovimientos existentes de ese libro. Se mantiene la definición de Finanzas.
- Unidades netas = unidades vendidas menos devoluciones documentadas. Un reembolso de dinero no inventa unidades devueltas.
- Facturación = productos tras descuentos, IVA incluido y envío excluido. Beneficio neto = facturación menos costes históricos; para puntos también descuenta comisiones y gastos fijos registrados.
- Se conservan los costes congelados, la política de recuperación de comisiones y la reposición elegida en una devolución. No se sustituyen por costes actuales del catálogo.
- Fechas en Europe/Madrid. Cobros por su fecha; correcciones, reembolsos y gastos por la fecha de su movimiento. Una devolución en mayo de una venta de abril afecta a mayo. Los gastos de participación se imputan una sola vez, incluso sin ventas.
- **Cambio explícito del criterio antiguo del mapa:** ahora usa actividad económica del período, igual que Finanzas. Antes seleccionaba una cohorte por fecha de cobro y excluía devoluciones completas. Los textos de criterios explican el nuevo comportamiento; se ha retirado esa lógica antigua del cálculo.
- Beneficios negativos conservan su signo en tabla, detalle, tarjetas, porcentajes y colores. Azul representa valores negativos; rojo positivos, gris cero. Un denominador neto cero con importe territorial no nulo muestra porcentaje no disponible. Importes incompletos permanecen no disponibles, no se convierten en cero. Los enteros monetarios se comprueban antes de superar la precisión segura; las comisiones mantienen el redondeo entero existente.

## Vinculación sin duplicados

Se añade una referencia opcional única `PointSale.orderId`, sin asociaciones automáticas por similitud. El formulario permite vincular un **pedido presencial manual confirmado en EUR**, sin pago integrado, con las mismas prendas, cantidades e importes netos. Exige «Ya estaba descontado» y conserva sus costes congelados: no genera otro descuento de stock.

Un pedido vinculado se excluye del recorrido de pedidos del mapa y de Finanzas; se contabiliza una sola vez desde el libro del punto. En los filtros de origen pertenece a Puntos de venta. Las exclusiones estadísticas del pedido presencial se aplican también a sus movimientos vinculados; los gastos generales del punto siguen siendo gastos propios.

Los ajustes y devoluciones de un pedido vinculado se realizan desde el punto; el editor y la anulación independientes del pedido se bloquean con una explicación. No se vinculan pagos Stripe/web para evitar sustituir sus reembolsos automáticos por ajustes manuales. Una operación sin referencia permanece independiente: no se deduplica por nombre, importe o email ni se modifican registros reales automáticamente.

## Eliminación y concurrencia

- Solo SUPERADMIN ve Eliminar. Los endpoints de previsualización y borrado exigen autenticación, permisos administrativos y SUPERADMIN; el servicio vuelve a comprobar rol y estado activo dentro de la transacción.
- El diálogo identifica nombre, provincia/ciudad/lugar y número de operaciones/ventas. Explica el modo concreto antes de confirmar, con Cancelar y Eliminar punto de venta. Durante la petición se deshabilitan confirmación, cancelación y Escape; los errores conservan la tarjeta y permiten revisar/reintentar.
- Con ventas, gastos u otro historial económico: `deletedAt` y archivado; desaparece del listado operativo y bloquea nuevas operaciones y reactivación. Se mantienen ventas, referencias, pedidos, pagos, costes, gastos, movimientos de stock, territorio y estadísticas. No se devuelve stock.
- Vacío: borrado real únicamente de la configuración y entradas de creación/edición de valor cero. El trigger SQL sigue impidiendo borrar movimientos económicos. Las relaciones existentes siguen protegidas por sus claves foráneas.
- Se bloquea la fila del punto, igual que en sus escrituras económicas. La confirmación incluye revisión y modo; si un punto vacío recibe una venta antes del borrado, se responde 409 y se exige revisar el alcance. No se cambia silenciosamente de borrado definitivo a archivado.
- Borrado repetido o concurrente de un punto ya retirado/ausente: respuesta idempotente. Solo se registra una auditoría `POINT_DELETE` para la eliminación efectiva, en la misma transacción. La tarjeta se retira tras éxito explícito del servidor, se recarga el listado conservando búsqueda y se ajusta la página si queda vacía.

## Actualización de datos

Mapa, Finanzas y puntos sirven respuestas privadas sin caché de datos. Los cambios del editor y las eliminaciones emiten una invalidación local y una señal entre pestañas con un marcador temporal aleatorio, sin datos de clientes. El mapa visible se recarga; también al recuperar visibilidad. Volver al módulo consulta de nuevo la base. No hay caché persistente de cifras ni tareas manuales para actualizar totales.

## Migraciones y activación local

Destino verificado antes de modificar: PostgreSQL de desarrollo `127.0.0.1:5433/cronox_dev`.

Respaldo previo completo: `output/map-sale-points/cronox_dev-before.dump` (596294 bytes), catálogo comprobado con pg_restore. SHA-256: `0db7a2ec736f1c01548015ba9b03e573961fe511163f88d444a849ce0318ef99`. Respaldo excluido de Git.

Aplicadas con `npm run migrate:local`, en este orden:

1. `20261027230000_point_territory_and_safe_removal`: provincia, retirada lógica, relación única opcional con pedido y excepción estricta del trigger para puntos vacíos.
2. `20261027231000_point_place_normalization`: normalización conservadora completa con caracteres Unicode/accentos expresados de forma independiente de la codificación de consola; solo rellena provincias nulas, sin sobrescribir selecciones explícitas.

Ambas figuran finalizadas, sin rollback, con checksum igual al archivo local. Las migraciones anteriores de checkout y eliminación de usuarios siguen registradas con sus checksums originales. No se ha reseteado la base ni aplicado nada a producción.

Cliente Prisma regenerado. Para liberar la DLL se detuvieron únicamente el lanzador, watcher y servidor identificados de este backend; después se ha vuelto a iniciar el proyecto con `node scripts/start-local.cjs --watch`. Arranque Nest y conexión Prisma correctos. Los procesos ajenos y el trabajo pendiente permanecen intactos.

## Verificaciones

- TypeScript sin errores y compilación Nest correcta.
- 152 pruebas focales aprobadas en 11 suites de mapa, Finanzas, puntos, fechas, historial, compras manuales e interfaz. Resultados finales en `output/map-sale-points/focal-tests.log`; comprobaciones adicionales de desarrollo en `profit-ui-tests.log` y `map-period-tests.log`.
- PostgreSQL real **desechable**, aislado de la base habitual: migraciones incrementales reales, trigger append-only/RLS, cobros web y físicos, provincias/comunidades, gastos sin provincia, alias/accentos, costes congelados, comisiones, gastos, devoluciones dentro/fuera del período, exclusiones, pedido vinculado sin duplicación y bloqueo de edición/anulación paralela. Conciliación exacta de ingresos, beneficio, unidades y ventas con Finanzas y detalle del punto.
- Borrado real vacío y retirada con historial, peticiones repetidas, rechazo sin confirmación, HTTP 401/403 para invitado/USER/ADMIN y éxito SUPERADMIN. Comprobación de auditoría única y conservación íntegra de usuarios, pedidos, entradas y stock capturados antes/después.
- Venta y eliminación **simultáneas**, ambas esperando realmente en PostgreSQL al mismo bloqueo de fila: solo una puede ganar; venta anterior invalida la confirmación vacía o borrado anterior rechaza la venta. También se comprueba cambio de historial entre previsualización y confirmación.
- DOM: cancelación sin escritura, error sin retirar tarjeta, bloqueo de doble envío/Escape, contenidos escapados, alcance vacío/con historial, búsqueda y cambio de página 26→25, CSRF, permisos visuales, invalidación del mapa, métrica de beneficio y colores negativos. Se ha corregido el corte efectivo de las tarjetas por página.
- Chromium mediante la skill Playwright, contra la instalación aislada: provincias iniciales (52), comunidades explícitas (19), período de abril de 2027, beneficio negativo, borrado cancelado y confirmado de punto vacío, retirada de punto con historial y éxito visible. Totales antes/después de retirar el punto: 6 ventas, 6 unidades netas, 38,00 € de facturación y −83,72 € de beneficio; iguales por ambas divisiones, diferencia con Finanzas 0,00 €. Son cifras de fixtures, no constantes de producto.
- Revisión visual en 1366 px, tarjetas a 320 px y mapa/diálogo a 390 px. Sin intersección entre título y Eliminar, sin scroll horizontal del documento; diálogo dentro del viewport. Capturas en `output/playwright/point-cards-desktop.png`, `map-profit-desktop.png`, `map-profit-mobile.png`, `point-cards-mobile-320.png` y `point-delete-dialog-mobile.png`.
- Bases de prueba eliminadas al terminar. No se borraron puntos ni cuentas reales.

La revisión en navegador utiliza Chromium con tamaños emulados; no constituye validación física de Safari, Xiaomi u otros móviles. Las comprobaciones físicas de zoom, wallets y accesibilidad de los trabajos anteriores siguen pendientes según sus informes; este cambio no las marca como resueltas.

## Archivos de esta entrega

- Esquema Prisma y las dos migraciones citadas.
- `src/admin/points/`: DTO, controlador, servicio, cálculos y nuevos `point-geography.ts`/`point-report.ts`.
- `src/admin/map/`: servicio/controlador y pruebas; `src/admin/finance/`: servicio/controlador y fixtures de pruebas.
- `src/admin/manual-purchases/`: protección de editor/anulación para pedidos vinculados y adaptación del mock transaccional.
- `cronox-front/assets/admin-map.js`, `admin-points.js`, `admin-shell.css` y versiones de recursos en `admin.html`.
- Tests DOM de mapa y nueva confirmación de puntos; harness `scripts/test-sale-points-db.cjs` y nuevos fixtures `test-map-sale-points-fixtures.cjs`.
- `.gitignore` para el respaldo privado y este informe.

Control de conservación: 143 archivos pendientes capturados al inicio; ninguno desaparecido. Solo cambiaron, por este trabajo, los tres compartidos ya pendientes `.gitignore`, `schema.prisma` y `admin.html`, con adiciones acotadas.
