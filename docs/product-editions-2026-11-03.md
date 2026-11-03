# Fichas por tirada — CRONOX, 3 de noviembre de 2026

La [verificación integrada posterior](product-editions-integrated-2026-11-03.md) completa el recorrido de navegador con backend y PostgreSQL reales aislados, y documenta dos correcciones adicionales.

Sustituye el flujo anterior de recepciones FIFO entre lotes por **una ficha comercial independiente por tirada**, dentro de la misma identidad de producto. No hay push ni despliegue.

## Uso del administrador

En Productos → Editar, las pestañas numeradas están junto al título. Se abre la tirada activa. Cambiar de pestaña solo consulta/edita esa tirada.

- **+** duplica la configuración de la pestaña seleccionada, con el siguiente número estable y cero unidades. No copia movimientos, reservas, devoluciones, fechas de recepción ni gastos contabilizados. Un producto nuevo obtiene Lote 1 al guardar su alta; después se pueden duplicar tiradas.
- **Guardar cambios** conserva la ficha seleccionada. Una tirada inactiva no modifica la tienda.
- **Activar lote N** publica su ficha y disponibilidad conjuntamente. La pestaña activa muestra únicamente **Lote activado**. No hay indicador global «Lote activo: N».
- El precio, nombre, colección, categorías, composición/detalles, búsqueda, umbral, tallas, configuración de variantes, galería, imagen principal y encuadres pertenecen a la tirada. El ID, slug y la casilla **Producto visible en la tienda** son globales. Cambiar el nombre no cambia la URL.
- Las existencias mostradas son las disponibles de esa tirada. Aumentarlas exige fecha de recepción; el coste de producción y los gastos indicados se asignan a las unidades nuevas. Un campo vacío es desconocido y cero es un coste cero explícito. Los céntimos se reparten sin perder totales. Las bajas justificadas mantienen el flujo de ajustes de inventario.
- Guardar un cambio de texto/precio mientras se vende una unidad no repone esa unidad accidentalmente. La petición incluye el saldo observado: una recepción con saldo desactualizado exige recargar.
- Antes de cambiar de pestaña, duplicar, activar o cerrar con cambios pendientes, aparecen Guardar, Descartar y Continuar editando.
- Histórico, informes y conciliación siguen accesibles en un bloque secundario. No se eliminan las evidencias de lotes anteriores.

## Consistencia y stock

`Product.activeLotId` es la única selección activa. El servidor bloquea el producto y las variantes en orden y proyecta ficha, imágenes, categorías y stock en la misma transacción. Las restricciones diferidas de PostgreSQL comprueban que existe exactamente una selección del mismo producto, incluso si está oculto o agotado. La numeración tiene un índice único por producto. Duplicar utiliza una clave idempotente y guardar comprueba la revisión del lote.

Los registros públicos de Product, ProductImage, ProductCategory y ProductVariant son la proyección de la tirada activa; el stock público se comprueba contra sus saldos, no contra la suma de tiradas inactivas. La configuración completa se conserva separadamente en InventoryLot.profile. Sustituir la proyección de imágenes no borra archivos; la eliminación definitiva comprueba también las referencias de las fichas guardadas.

Las ventas web nuevas solo asignan unidades de la tirada activa. FIFO sigue utilizándose dentro de sus fracciones de coste, nunca entre tiradas comerciales diferentes. Reservas y devoluciones conservan sus asignaciones originales. Una devolución a una tirada inactiva no aumenta la disponibilidad pública.

El carrito guarda la tirada y el precio aceptados. Si cambian, el checkout rechaza una preparación nueva hasta que el cliente revise la ficha y acepte la tirada/precio actuales en la cesta. La reserva vuelve a comprobar tirada y precio bajo bloqueo. Los pagos iniciados siguen usando su instantánea protegida, sin sustituir su precio por el actual. Se conserva la política de reservas y reintentos existente.

La ficha pública y quick add reconstruyen su presentación cuando reciben otra tirada activa. Los endpoints de catálogo/ficha utilizan no-store; sus lecturas y las de favoritos son consistentes. Se actualizaron las versiones de los recursos modificados.

En puntos de venta se puede escoger la tirada realmente vendida, incluida una inactiva. Se conservan Descontar stock y Ya descontado. Para dos tiradas distintas de la misma talla, se registran ventas separadas. Ya descontado conserva la tirada indicada, sin inventar el coste de una retirada no identificada: queda pendiente de conciliación. Las devoluciones con reposición regresan a esa tirada.

## Estado de los datos locales

Antes de migrar: **19 productos, 55 variantes, 0 lotes, 0 asignaciones de lote y 0 reservas activas**. Existían 17 ventas físicas; no se modificaron sus registros originales.

Después: **19 productos con Lote 1 activo**. Se conservan ficha, precio, URL y saldo disponible. Las unidades iniciales son un saldo observado, no una segunda recepción. No se introdujeron cantidades, costes ni precios reales del restock. Los 90/110 € solo se utilizaron en bases de prueba aisladas y respuestas simuladas de navegador.

Las fechas de recepción, costes y procedencia de ventas antiguas que no se pueden verificar siguen pendientes. No se ha atribuido el coste vigente a todas las ventas anteriores. Los registros que ya tenían instantáneas financieras las conservan.

La migración también conserva varios lotes preexistentes: les asigna números estables sin duplicarlos y marca sus fichas históricas como pendientes cuando solo se conoce la configuración vigente. La repetición no crea lotes ni movimientos adicionales.

## Migración y comprobaciones repetibles

Nueva migración: `20261103130000_lot_product_editions`, aplicada exclusivamente a `cronox_dev` local tras previsualización, respaldo y prueba aislada. No se editaron las dos migraciones de lotes ya aplicadas. La migración anterior de la URL de ARMORED COAL continúa pendiente en esa base.

Desde cronox-backend:

```text
npm run editions:preview:local
npm run test:product-editions:db
npm run editions:migrate:local
npm run typecheck
```

Los scripts solo admiten PostgreSQL local. La prueba crea y elimina una base aislada con nombre único; la migración local crea respaldo antes de escribir y comprueba hashes del histórico. Las evidencias y respaldos están en `output/playwright/product-editions/` y no deben versionarse.

Verificado:

- Recorrido ASHEN SHELL: duplicar, guardar a 110 sin publicar, activar, recuperar ficha de 90, crear la tercera desde la primera y reactivar.
- Activaciones simultáneas, doble petición de duplicación, producto oculto, exclusividad y stock de tiradas inactivas.
- Carrito anterior, aceptación explícita, reserva concurrente, rechazo de una preparación desactualizada, caducidad y liberación repetida.
- Costes congelados, venta física de tirada inactiva, devolución a su origen y Ya descontado sin segunda retirada.
- Migración reintentable y conservación de históricos mediante hashes.
- Editor real a 390 y 1366 px con API simulada, recarga y protección de cambios pendientes. Persistencia y servicios de negocio probados por separado en PostgreSQL real aislado.
- Suite completa: 289 suites, 3.118 pruebas correctas; pruebas dirigidas adicionales, tipos y compilaciones correctos.
- HTTP del backend local: catálogo y ASHEN SHELL 200, una sola entrada, API privada de tiradas 401 sin autenticación y ningún coste/ficha privada expuesto.

Antes de publicar en otra tarea: revisar el conjunto completo de migraciones pendientes y los cambios autorizados, respaldar y probar una copia reciente, aplicar esquema y código compatibles, y revisar las conciliaciones pendientes. No activar tiradas reales ni cambiar precios sin los datos del administrador.
