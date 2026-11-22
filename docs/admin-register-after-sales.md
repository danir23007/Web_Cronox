# Devoluciones y cambios en CAJA

La migración local 20261122190000_register_after_sales añade AfterSaleOperation y AfterSaleUnit. Las operaciones son inmutables. Una posición por unidad de la línea conserva su importe pagado, variante actual, lote, coste, asignación de inventario, versión y estado. Estas posiciones representan cantidades de una compra; los códigos de barras siguen identificando combinaciones de variante y lote y no prendas individuales.

## Recorridos

DEVOLUCIÓN y CAMBIO comienzan identificando la cuenta mediante acreditación o correo, con avance automático. El historial incluye pedidos online y físicos ordenados por la fecha efectiva descendente y páginas de veinte compras. Las compras invitadas sin usuario quedan fuera de ese historial.

La devolución permite seleccionar unidades, comprobar el importe histórico y marcar la casilla de buen estado y etiqueta. Marcada, repone todas las unidades seleccionadas al lote original. Desmarcada, exige motivo y las registra como no vendibles. El método y la confirmación expresa del reintegro externo son obligatorios. Revisar operación permite validar el resumen antes de entregar el dinero. DEVOLVER requiere después la confirmación del reintegro ya realizado. El botón no llama a Stripe ni a Bizum.

El cambio permite crear una cola de unidades y escanear las dos etiquetas de cada pareja. El servidor exige la variante actualmente conservada y una talla distinta del mismo producto y lote. Cada lectura puede hacerse con cámara, lector de teclado o entrada manual. Un código antiguo sin lote se acepta únicamente cuando las relaciones registradas permiten una identificación inequívoca. Cada pareja mantiene el importe pagado. CAMBIAR exige revisión y casilla de buen estado, y no crea otra venta ni mueve dinero.

Los resultados muestran el pedido y las unidades. Ver compra actualizada permite consultar las cantidades conservadas y su historial. Nueva compra inicia otro recorrido. Mientras el resultado es incierto, la operación queda bloqueada y ofrece recuperación o reintento con su clave original. sessionStorage conserva únicamente los identificadores, códigos internos de prendas y parámetros necesarios para recuperar ese intento, sin acreditaciones ni datos personales de presentación.

## Importes e inventario

Los importes salen de OrderItem.lineTotal y del descuento histórico del pedido, distribuido con la función de reparto existente. El neto de cada línea se distribuye entre sus unidades en céntimos enteros, con el resto asignado por orden de unidad. La suma de todas las unidades coincide con el neto de artículos pagado. Los impuestos históricos se distribuyen entre artículos y envío y después por unidad. El envío queda fuera del reintegro de artículos.

Los costes proceden de las instantáneas de asignación. Un cambio conserva por separado el coste de la talla que vuelve y de la que sale. Al reponer una devolución, se transfiere su cantidad a una recepción valorada con los componentes históricos y se registra el traslado en InventoryLotAudit. Se conserva el saldo total de recepciones y la evidencia de la asignación original. Las prendas no vendibles dejan una disposición trazable y no aumentan disponibilidad. Los costes incompletos permanecen desconocidos.

La confirmación usa transacción serializable, bloqueos de pedido y variantes, clave idempotente y huella del contenido. Comprueba versiones y cantidades pendientes, disponibilidad del lote y reservas ya descontadas del inventario. Una cadena M → L → XL mantiene una sola posición. Devolver XL cierra esa posición y no permite devolver M o L como compras distintas.

## Informes, cuenta y reembolsos existentes

La compra original conserva sus líneas, cantidades y estado. Las devoluciones generan ingresos e impuestos negativos en su propia fecha. Se revierte el coste solamente al reponer stock vendible. Una prenda no vendible conserva su coste perdido. Las comisiones permanecen retenidas salvo recuperación acreditada mediante otro proceso compatible. Los cambios registran únicamente la diferencia de coste entre tallas.

Para pedidos de puntos, los movimientos se añaden al libro existente de ese mismo punto. Los cambios se representan como CORRECTION y las devoluciones como RETURN, vinculados a la operación de CAJA. Para pedidos sin punto, la proyección financiera incorpora las operaciones al archivo original. El pedido enlazado a un punto sigue excluido de la suma de pedidos para evitar duplicación.

HistorialService cuenta las unidades devueltas explícitamente y conserva el pedido histórico. Los cambios no añaden pedidos ni artículos comprados. Las métricas personales descuentan los reintegros vinculados y conservan los cambios. Se reutiliza reconcileCircle2, cuya política existente no degrada automáticamente un círculo ya obtenido. La cuenta muestra la cadena de cambios y las devoluciones sin exponer costes privados.

Las devoluciones o ajustes anteriores de otros flujos que carecen de correspondencia inequívoca con las posiciones se bloquean para conciliación. No se deducen cantidades de prendas a partir de importes. Los pedidos no pagados, cancelados, reembolsados, disputados o con evidencia histórica insuficiente no admiten la operación afectada.

Para reintegros Stripe externos se exige la referencia real re_… y se registra la confirmación manual. Los webhooks firmados se concilian por esa referencia y su importe. Su importe se excluye de la proyección del webhook cuando ya está registrado en CAJA. Un webhook completo coincidente no vuelve a reponer stock. Si afecta a una compra cambiada y no hay correspondencia, queda en revisión; el reintegro firmado que ya consta como exitoso puede vincularse expresamente a sus unidades mediante su referencia y después reintentarse el evento. Un reintegro realmente pendiente o ambiguo sigue bloqueado. Los eventos originales se conservan.

Los bloqueos del pedido y guardas de base de datos coordinan estos procesos con ajustes de líneas, cancelaciones y devoluciones antiguas de puntos, evitando que otro flujo restaure otra vez las mismas unidades. No se hacen llamadas de reembolso ni envíos de correo desde la confirmación de CAJA.

## Evidencia local

El script cronox-backend/scripts/test-register-after-sales-db.cjs crea una base desechable a partir de un esquema sin datos, carga fixtures sintéticos y la elimina al terminar. Comprueba devoluciones parciales y totales, prendas vendibles y no vendibles, redondeos de descuento, impuestos, dos cambios y devolución posterior, colas de varias unidades, reservas, lecturas incompatibles, códigos antiguos ambiguos, cliente incorrecto, paginación, concurrencia, idempotencia, rollback, reconciliación de webhooks, informes, estadísticas, cuenta del cliente y recuperación desde Chrome.

El caso físico parte de tres unidades a 40 €, total 120 €, coste inicial 30 € y comisión 12 €. Una unidad cambia M → L → XL y se devuelve como no vendible. Las otras dos se reponen. Al finalizar, los ingresos netos son 0 €, queda un coste perdido de 10 € y la comisión retenida de 12 €, con beneficio de −22 €. La compra original sigue teniendo tres unidades y el cliente conserva cero. Los archivos de evidencia y capturas se guardan en output/playwright/register-after-sales.

Los pagos, referencias externas, escaneos de teclado y fallos de red son sintéticos. Quedan pendientes las comprobaciones con cámara y lector físicos. Las pruebas no realizan reintegros ni envían correos reales y no crean ventas sobre los datos comerciales de la base habitual.
