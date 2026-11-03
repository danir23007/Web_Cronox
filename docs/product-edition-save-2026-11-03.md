# Guardado del editor de tiradas — 3 de noviembre de 2026

## Causa reproducida

En navegador, contra Nest y una copia PostgreSQL local, introducir una fecha y guardar sin cambiar existencias mostraba éxito, pero dejaba `InventoryLot.receivedAt` a `null` y vaciaba el campo.

Había dos causas: el cliente limpiaba todos los campos `edition*` y no volvía a cargar la fecha; el servicio solo guardaba `receivedAt` al recibir unidades y utilizaba la fecha existente antes que la nueva. Esto impedía corregirla incluso con entradas posteriores. El histórico tampoco conservaba una fecha individual para las recepciones de este editor.

## Cambios

- `receivedAt` es ahora un dato persistente de cada tirada, editable sin cambiar cantidades. Omitirlo conserva la fecha; `null` la borra expresamente. Se valida como día de calendario `AAAA-MM-DD`, se almacena a medianoche UTC y se devuelve como día, sin formatearlo en la zona horaria local.
- `receiptReceivedAt` documenta la fecha de una nueva entrada. Es opcional: si se deja vacío al añadir unidades, se utiliza la fecha de la tirada. Una entrada no modifica la fecha persistente. Editar solo esta última no crea stock ni gastos.
- Se retira el transporte del formulario. Las nuevas entradas de este editor usan transporte conocido de cero: está incluido en el coste por unidad. Se rechaza un transporte separado positivo de clientes antiguos para evitar duplicarlo. Los transportes históricos y el envío del pedido al cliente conservan su tratamiento independiente.
- Otros gastos sigue disponible; vacío o cero significa sin gastos adicionales. Solo deben introducirse importes que todavía no estén incluidos en el coste por unidad. Una operación con gastos o fecha de entrada y sin unidades nuevas devuelve un error, en vez de descartarla silenciosamente.
- Ficha, categorías, galería, coste, fecha, visibilidad, stock, gastos e histórico se guardan en una transacción. Se añade una clave de idempotencia por contenido pendiente, comprobada antes de las revisiones, para recuperar una respuesta perdida sin repetir la recepción. Se mantiene el control de versión de tirada, ficha activa, stock y visibilidad.
- Durante el guardado se bloquean edición y cambio de pestaña. Solo tras la respuesta satisfactoria se cargan los valores confirmados y se limpian las entradas operativas. Los errores conservan los datos y permiten reintentar. Se evita reemplazar la galería por una lista vacía si su módulo no está disponible.

## Auditoría de campos

Nombre, colección, categorías, precio, coste, umbral, detalles, palabras de búsqueda, imágenes, orden, principal, texto alternativo, encuadre, ajuste, encuadre de tarjeta, sistema de tallas y stock ya persistían mediante el perfil y su proyección. Se comprobaron con valores distintos en dos lotes; no fue necesario cambiar su modelo de almacenamiento. También se verificaron coste cero frente a coste desconocido y visibilidad global al alternar tiradas.

Se han corregido la persistencia y recarga de fecha, el registro de fecha y gastos de cada recepción, la valoración sin transporte separado y las garantías de error/reintento. Los campos de operación se limpian después del éxito; los de ficha permanecen.

Las recepciones y sus gastos se consultan en **Editar producto → seleccionar lote → Recepciones y gastos guardados**. Se muestran fecha de entrada, unidades, coste por unidad, transporte histórico, otros gastos y momento de registro, además de las correcciones de fecha. El histórico de inventario existente sigue disponible. Las recepciones antiguas sin fecha individual documentada aparecen como **Pendiente de conciliar**; no se deduce esa fecha de la fecha actual de la tirada. Tampoco se reconstruyen costes históricos desconocidos.

## Verificación ejecutada

Navegador Chromium real, administrador servido por el backend Nest real, guardas/CSRF/validaciones y PostgreSQL local aislado. El proceso clona la base local; solo pago, correo y almacenamiento externo se simulan. Las imágenes se procesan y guardan en archivos locales de prueba. No se utilizaron servicios de cobro o correo reales.

1. Reproducción anterior al arreglo: fecha vacía y base sin fecha tras guardar sin stock.
2. Guardar fecha sin stock, cerrar/reabrir, corregir a `2026-03-29` y recargar: persiste y no cambia cantidades.
3. Entrada de dos unidades con coste 35 €/u, fecha `2026-11-03` y 2 € adicionales: valoración 72 €, transporte nuevo cero, fecha de tirada intacta. Guardar otra vez no duplica unidades ni gastos.
4. Dos lotes con fichas, galerías, categorías, fechas y sistemas de tallas diferentes: independencia tras alternar, activar y recargar; visibilidad global correcta. Fechas verificadas también en contexto `America/Los_Angeles`, incluidos días de cambio horario. Revisión visual a 390 y 1366 px.
5. Fallo controlado de base de datos al escribir auditoría, después de intentar escribir ficha y recepción: HTTP 500, rollback completo comprobado contra el estado anterior, campos conservados y reintento correcto. Formulario y pestañas bloqueados durante la solicitud.
6. Respuesta perdida después del commit real: reintento con la misma clave devuelve el resultado sin incrementar revisión, unidades ni gastos. Resultado final del lote 2: tres unidades y 7 € adicionales, sin duplicación. Gastos sin unidades: HTTP 400 y entrada conservada.
7. Venta histórica sintética: precio 90 €, producción 25 €, transporte 0,75 €, otros 0,25 €, coste congelado 26 € y beneficio 64 €, sin cambios tras todas las ediciones. Se contrastan registros de pedido y el informe financiero real; no se modifican ventas reales ni se inventan valores desconocidos.

Regresiones: 9 suites Jest, 72 pruebas aprobadas; regresión PostgreSQL aislada de ediciones aprobada (incluye calendario, fecha independiente, recepción, reintento idempotente y protección de costes, reservas y stock); typecheck de backend y administrador, compilación Nest y sintaxis de los scripts comprobados. Evidencia local en `output/playwright/editions-editor-save/`, incluido estado final y limpieza.

## Repetición y entrega

Arrancar `node cronox-backend/scripts/review-product-editions-integrated.cjs --editor-save`. Preparar cada paso con `node cronox-backend/scripts/prepare-product-editions-browser.cjs <paso> --editor-save` y ejecutarlo en la sesión Playwright CLI autenticada: `editor-date-save`, `editor-full-save`, `editor-two-lots`, `editor-save-retries`, en ese orden. `date-reproduction` documenta el fallo de la versión anterior y no debe pasarse como expectativa de la versión corregida. El cierre mediante `/__review/stop` guarda la evidencia y elimina exclusivamente su base aislada.

No requiere nuevas migraciones respecto a la implementación de tiradas existente. Se conserva el resto del trabajo local. Sin push ni despliegue; la comprobación en producción queda fuera de esta tarea.
