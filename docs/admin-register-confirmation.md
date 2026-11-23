# Confirmación de ventas en CAJA

La ruta local es /admin.html#section-register. Tras revisar el ticket, el administrador elige Tarjeta · Stripe, Bizum o Efectivo y pulsa PAGADO cuando ha recibido el dinero. Ningún método se selecciona al comenzar. La confirmación recalcula la cotización y rechaza cambios de precio. El ticket confirmado muestra el pedido y queda en modo de lectura.

Selección manual utiliza Producto → Tirada → Talla → Unidades → Añadir. Las tiradas se ordenan y nombran por su número real. Con varias tiradas se exige elegir una; con una sola se selecciona automáticamente. Cada cambio limpia la talla, consulta nuevamente el catálogo protegido en el contexto elegido y descarta respuestas anteriores. Las tallas muestran su disponibilidad y precio final del servidor; las agotadas no pueden añadirse. Los productos históricos sin lote registrado se identifican expresamente como tales. Seleccionar no escribe inventario ni modifica el ticket; Añadir conserva los IDs de variante y lote y cotiza el conjunto en el servidor. Este cambio no requiere migración.

La migración 20261122160000_register_sale_confirmation añade RegisterSale. Relaciona una confirmación inmutable con un único Order, conserva la clave y la huella de la petición, el método, el canal externo, el administrador, la fecha y el recibo con precios, descuentos, impuestos y costes. Los pedidos usan IN_PERSON_ADMIN, DELIVERED y proveedor manual. Invitado tiene userId vacío. Bizum se identifica expresamente en RegisterSale, mientras el enum histórico del pedido utiliza OTHER.

La misma transacción consume las recepciones del lote mediante allocateLots, congela su evidencia y coste con las reglas existentes y registra el movimiento de inventario. Las reservas web ya reducen los saldos disponibles. stockQty representa la tirada activa. Las recepciones de otras tiradas mantienen su saldo propio.

El modelo actual carece de una entidad de stock trasladado y disponible por punto. ALREADY_ADJUSTED describe ventas históricas cuyo inventario ya se ajustó y no representa unidades asignadas a un evento. CAJA utiliza el almacén compartido que usa actualmente Puntos de venta. Una futura asignación física necesitará una procedencia de traslado y saldo identificable antes de habilitar su consumo.

Para eventos, PointSale enlaza el mismo pedido y su asiento SALE conserva la comisión vigente. Los informes excluyen el pedido enlazado de la suma de pedidos y agregan su asiento una sola vez. Sin evento se utiliza directamente el archivo financiero del pedido. El desglose CAJA por método consulta exclusivamente confirmaciones registradas y respeta fechas, moneda, fuente y punto.

La estadística del cliente se reconstruye con HistorialService. La promoción a círculo II usa reconcileCircle2 después de capturar el archivo financiero en la transacción. Esta función no envía correos. La confirmación no llama a la entrega de efectos de checkout ni a los servicios de correo o transporte.

La idempotencia utiliza una clave estable, bloqueo transaccional y comprobación del contenido. Ante una respuesta incierta, la interfaz bloquea el ticket y permite recuperar el resultado o repetir exactamente la operación. El intento pendiente se conserva en sessionStorage con IDs y cantidades, sin tokens de acreditación ni nombres o correos. Cancelar queda bloqueado mientras el resultado sea incierto. Un error definitivo de precio exige revalidar y revisar antes de confirmar.

El inicio no muestra ninguna acción de cancelación. Durante cada preparación, la cabecera indica Cancelar compra, Cancelar devolución o Cancelar cambio. El diálogo propio permite seguir, cerrar o pulsar Escape conservando el estado y devolviendo el foco al botón. Confirmar la cancelación detiene cámara, consultas y actualización de precios, invalida respuestas antiguas y limpia únicamente la preparación. El resultado registrado utiliza Volver al inicio sin diálogo ni reversión. El foco programático del encabezado se conserva con una excepción CSS localizada; los controles mantienen su indicador de teclado.

## Pagos externos y duplicación

Tarjeta · Stripe registra la confirmación manual de un pago recibido en un dispositivo externo. No se crean objetos Stripe ni identificadores ficticios. providerRef queda vacío. Confirmación manual, canal externo y método tienen campos distintos.

El webhook exige metadata.checkoutSnapshotId, un checkout existente y la coincidencia de su PaymentIntent antes de crear pedidos. Un pago externo sin ese vínculo se rechaza y no crea otra venta. Una prueba cubre este caso. No existe un importador de pagos externos que cree ventas de CAJA. Si se incorpora uno, deberá reconciliar con RegisterSale y una referencia externa real y única antes de crear pedidos. El sistema no puede correlacionar dos registros manuales independientes del mismo pago sin esa referencia.

## Verificación local

El script cronox-backend/scripts/test-register-confirmation-db.cjs copia únicamente el esquema a una base PostgreSQL vacía, carga fixtures sintéticos, desactiva servicios externos y elimina la base al terminar. Nunca registra ventas de prueba sobre los productos o usuarios de la base habitual.

Comprueba los tres métodos, cliente e invitado, evento y venta directa, dos tiradas con costes distintos, ofertas, cotizaciones caducadas, seis peticiones concurrentes de la misma operación, contenido distinto con la misma clave, competencia por la última unidad, unidades reservadas, rollback intermedio, costes históricos e informes y estadísticas. Arranca además la aplicación real y prueba permisos HTTP, PAGADO y recuperación de una respuesta perdida desde Chrome en escritorio y móvil.

El caso principal registra una única venta de tres unidades a 40 € en lugar de 50 €, total 120 €, coste 30 €, comisión de evento 12 € y beneficio 78 €. El stock pasa de 30 a 27. El cliente obtiene un pedido entregado y tres artículos, con promoción según el gasto. La evidencia está en output/playwright/register-confirmation/evidence.json. Los pagos y fallos de red son simulados. No se realizan cobros ni se envían correos reales.
