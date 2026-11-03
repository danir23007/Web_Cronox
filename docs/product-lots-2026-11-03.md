# Lotes de producto — implementación local

**Nota:** este documento describe la primera implementación. El flujo y el estado local posteriores se documentan en [Fichas por tirada](product-editions-2026-11-03.md); las ventas web nuevas ya no usan FIFO entre tiradas distintas.

## Uso

En **Administrador → Productos → Editar → Lotes**, un superadministrador puede previsualizar y aceptar el saldo inicial. La activación exige una previsualización vigente, stock no negativo y ausencia de reservas activas. No modifica el ID, slug, variantes, imágenes ni precio del producto.

El saldo inicial representa únicamente unidades disponibles observadas: no una cantidad fabricada ni una recepción histórica reconstruida. Fecha y costes quedan pendientes hasta aportar evidencia. Los productos no activados mantienen el comportamiento anterior.

Después, **Registrar nuevo lote** solicita nombre, fecha de recepción, cantidades por talla, producción por unidad, transporte de aprovisionamiento y otros gastos totales. Los gastos se reparten por unidades en céntimos enteros, conservando exactamente los totales; los restos se asignan en orden de variante/unidad. Un campo vacío significa desconocido; cero significa coste cero explícito. Los costes pueden ser confirmados, estimados o pendientes.

El **Precio** público sigue editándose en el formulario del producto. El precio previsto del lote es solo una referencia. Crear un lote nunca modifica el precio público. Para el restock, completar los datos documentados anteriores y cambiar el precio público por separado cuando corresponda; esta implementación no introduce cantidades, costes ni precios reales.

## Stock y ventas

- FIFO por fecha de recepción dentro de cada variante; los saldos iniciales sin fecha se consumen primero. Una venta puede consumir varios lotes.
- La proyección de stock público y los saldos de lotes se actualizan en la misma transacción. Restricciones diferidas de PostgreSQL rechazan desajustes y saldos incompatibles con sus movimientos.
- Reservas, caducidad, cancelaciones, pedidos manuales y puntos de venta conservan sus flujos y duración existentes. Las liberaciones y devoluciones restituyen las unidades de origen cuando el flujo pide reposición.
- «Ya descontado» no descuenta de nuevo. Una conciliación puede vincular una salida de inventario documentada; sin evidencia no se inventa procedencia.
- Un ajuste manual de existencias queda registrado como ajuste. Una entrada sin información de recepción genera saldo desconocido; para recepciones reales debe usarse Registrar lote.
- Archivar conserva saldo e histórico y no retira unidades disponibles de FIFO. No existe eliminación de lotes por esta API.

## Histórico e informes

La implementación anterior ya conservaba instantáneas financieras en pedidos y ventas físicas. Se amplían con cantidades y costes por lote, conservando esos datos antiguos. No se aplica el coste vigente del producto retroactivamente.

Las correcciones sin movimientos requieren motivo y revisión vigente. Las ventas cerradas solo se corrigen mediante conciliación explícita y auditada; el registro original de los puntos de venta permanece inmutable y las revisiones de coste se aplican como una capa separada. La conciliación nunca cambia el importe cobrado ni crea entradas ficticias de stock.

**Rentabilidad por lote** muestra ingresos, unidades, devoluciones, coste, beneficio, margen y valoración del stock. Usa las mismas definiciones de los informes existentes (descuentos, devoluciones y comisiones incluidos; envío al cliente separado). Los gastos fijos del punto, sin atribución verificable a un producto, permanecen en el informe global. Los costes estimados o desconocidos no se presentan como beneficio confirmado. Las vistas financieras y el mapa respetan estas instantáneas y estados pendientes.

## Migración y estado local

Migraciones aditivas:

1. `20261103120000_inventory_lots`
2. `20261103121000_inventory_lot_balance_guards`

Aplicadas únicamente a `cronox_dev` local, después de previsualizar y probar sobre copias aisladas. Conservados los 19 productos, 55 variantes, existencias, slugs y precios. Cero productos activados y cero lotes reales creados. La migración anterior `20261103090000_armored_coal_slug` se ha conservado pendiente en esa base; no se ha ejecutado indirectamente un despliegue global de migraciones.

Antes de una futura publicación: revisar todas las migraciones pendientes, obtener copia de seguridad, restaurarla en una base local aislada y ejecutar previsualización y pruebas. Aplicar el esquema revisado antes de arrancar el código nuevo; después activar cada producto desde la previsualización del administrador. No activar automáticamente mientras existan reservas. Esta tarea no autoriza ni realiza publicación.

Comandos desde `cronox-backend`:

```text
npm run lots:preview:local
npm run test:inventory-lots:db
npm run typecheck
npm run build:compiled
npm test -- --runInBand
```

La previsualización solo admite PostgreSQL loopback y es de lectura. La prueba de base de datos crea una copia con nombre único, escribe exclusivamente allí y la elimina al terminar. Usa PostgreSQL 17 local y, si existe, el respaldo previo a la migración guardado en `output/playwright/inventory-lots/pre-lots-baseline.dump`. No versionar respaldos ni datos de clientes.

## Verificación

Resultado local: 289 suites y 3.118 pruebas Jest correctas; comprobaciones de tipos del backend y administrador, compilación del backend y construcción del administrador correctas.

La prueba aislada comprueba conservación del histórico mediante hashes antes/después de migrar, reservas simultáneas, FIFO entre lotes y tallas, caducidad y reintentos, devoluciones parciales con/sin reposición, ventas físicas/manuales, conciliación auditada y cambio de precio 90→110 sin alterar el coste anterior. Verifica también los servicios reales y la concordancia del informe por lote.

La comprobación de navegador utiliza la página y los estilos reales a 390 y 1366 px con respuestas API simuladas: creación, importes exactos, precio público intacto y ausencia de errores JavaScript. La integración de persistencia se verifica por separado en PostgreSQL aislado, sin compras ni pagos reales. Evidencias locales en `output/playwright/inventory-lots/`.
