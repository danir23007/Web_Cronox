# Incidente de confirmación Stripe — 23/09/2026

## Resumen público

Una entrega de `payment_intent.succeeded` al webhook de producción recibió inicialmente HTTP 400 con `STRIPE_SIGNATURE_VERIFICATION_FAILED`. La verificación de la firma ocurre antes de reclamar el evento, crear el pedido o enviar la confirmación de compra. No se desactivó la verificación ni se modificó el cuerpo firmado de la petición.

En un reenvío posterior, el evento auténtico recibió HTTP 200 del webhook de producción. Esta entrega confirma que el proceso aceptó la firma y el cuerpo de ese evento; por sí sola no identifica qué configuración operativa se corrigió. Se comprobó por separado que la compra previamente reembolsada permanece `REFUNDED`, con la reserva liberada y sin una segunda deducción de stock. No se generó otro pago, reembolso ni ajuste de inventario. La conciliación de esta compra está terminada; **no se debe reprocesar**.

## Cambios de aplicación

- El webhook conserva la verificación de firma, el cuerpo original y la deduplicación de eventos.
- La página de resultado muestra el estado reembolsado cuando así lo informa el backend.
- El reintento administrativo de correo de confirmación requiere autorización `SUPERADMIN` y la protección CSRF habitual. Solo toma el destinatario del pedido y comprueba que el pedido sigue `PAID` antes de enviar; un pedido ya `REFUNDED` no es apto.
- La marca de confirmación enviada se registra únicamente tras la aceptación del destinatario por SMTP. Una aceptación SMTP no garantiza la entrega en el buzón. Si SMTP acepta el mensaje pero falla la escritura posterior en la base de datos, se debe comprobar el buzón antes de reintentarlo.
- El envío de correo continúa sujeto a la configuración privada del entorno. Habilitarlo requiere una comprobación operativa independiente; no forma parte de la corrección de la firma del webhook.

## Verificación y alcance

Las pruebas enfocadas cubren cuerpo firmado, secreto incorrecto, reintento y deduplicación del webhook, rechazo del correo para pedidos reembolsados, reembolso anterior al evento de éxito y presentación del estado reembolsado. El backend y el frontend administrativo compilan. Los detalles de la transacción y de la infraestructura se mantienen fuera de este repositorio público.

Existe otro destino LIVE de Stripe que apunta a un entorno de desarrollo y presenta fallos de entrega. No se modificó ni se deshabilitó: su finalidad debe confirmarse con su propietario antes de cualquier cambio.
