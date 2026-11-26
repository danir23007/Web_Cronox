# Productos y códigos durante Black Friday

## Mensajes de Productos

La franja vacía procedía de borrar `productsMessage.innerHTML` manteniendo `message show error` o `success`. `fetchProducts` utiliza ahora `setScopedMessage(..., '')`, que restablece texto y clases, y devuelve el resultado de la carga. Las llamadas a la API dejan de considerar una función ausente como una operación confirmada.

El mensaje de éxito se presenta después del refresco. Si el servidor confirmó el guardado y después falla la lista, se indica expresamente que el producto está guardado y que hay que recargar la lista. Un fallo real de escritura mantiene el error útil dentro del formulario abierto. El recorrido de lotes también distingue una escritura confirmada de un fallo posterior al releer el editor. No hay cambios en el guardado de productos, precios ni inventario del backend.

## Calendario y fuente de verdad

El bloqueo de códigos usa las fechas persistentes existentes de `BlackFridaySettings.global`, mediante `common/black-friday-discounts.ts` y la hora del servidor. El interruptor visual `enabled` no es una excepción para aplicar códigos. Los valores de respaldo coinciden con los valores predeterminados existentes del esquema:

- Inicio incluido: **26/11/2026 21:00 Europe/Madrid** (`2026-11-26T20:00:00Z`).
- Fin excluido: **28/11/2026 00:00 Europe/Madrid** (`2026-11-27T23:00:00Z`). Se incluye todo el minuto 23:59 del 27.
- Aviso exacto: **Los códigos de descuento no son acumulables con las ofertas de Black Friday.**

La consulta de producción encontró el fin anterior en `2026-11-27T22:59:00Z`, que excluía el último minuto. El script explícito siguiente reutiliza `BlackFridayService.save`, bloqueo transaccional y revisión optimista. Solo alinea las dos fechas y conserva activación, textos, colores y autor. No inicia Nest, trabajadores, SMTP ni llamadas a proveedores de pagos:

```powershell
# Desde cronox-backend, después de compilar
node scripts/configure-black-friday-discounts.cjs --production
node scripts/configure-black-friday-discounts.cjs --production --apply
```

Guardado realizado: revisión **10 → 11**, inicio intacto y fin corregido a `23:00:00Z`. La lectura posterior devolvió `blocked: false` con el reloj productivo anterior al inicio. No se modifican registros PromoCode/DiscountCode, vigencias, límites ni contadores. No hay migraciones ni acciones de email.

## Cálculo, revalidación y pagos anteriores

La validación central del cálculo rechaza todos los códigos durante el intervalo antes incluso de consultar su tipo o titular. Checkout summary, aplicación directa, cotización de wallets, sesión de checkout y preparación de pago comparten el cálculo del servidor; un importe del navegador no participa en los totales. Se conserva `resolveWebPrice`, incluidas ofertas y validación de tiradas/precios aceptados del carrito. El cierre transaccional vuelve a comprobar la política antes de reservar un código para cubrir el cambio de intervalo durante una petición.

Una respuesta de resumen incluye la política y el reloj del servidor. Checkout elimina también los rechazos que devuelven el mismo nombre de código, limpia el estado de sesión y recalcula sin el descuento. La interfaz y la cesta solicitan revalidación en los límites temporales y al volver a una pestaña; los temporizadores del navegador no autorizan descuentos. Tras terminar, no se reconstruye el código retirado: el cliente debe introducirlo de nuevo.

Las reservas con código creadas antes del comienzo limitan su caducidad a ese inicio. Los heartbeats y la protección de pago no pueden renovar esa ventaja más allá del límite. Preparar, iniciar o reservar un pago con código durante Black Friday devuelve el rechazo correspondiente. El trabajador existente de caducidad también selecciona intentos antiguos con código que todavía conservaran una fecha posterior al comienzo, sin incluir pedidos completados.

Se conserva la conciliación existente con el proveedor: no se cambia el importe de un PaymentIntent antiguo. Los intentos cancelables se cancelan antes de liberar inventario o sustituir la reserva; si Stripe ya está procesando o ha confirmado un pago, se conserva su importe inmutable y se concilia su resultado antes de permitir otro intento. No se fuerzan devoluciones ni se reescriben pedidos pagados. Este comportamiento respeta el [ciclo de vida de PaymentIntents](https://docs.stripe.com/payments/paymentintents/lifecycle) y las [condiciones de cancelación](https://docs.stripe.com/api/payment_intents/cancel). La conciliación es la del trabajador existente, con sondeo de un segundo; una operación ya en tránsito se resuelve por el proveedor, no se revaloriza retroactivamente.

La inspección previa de producción devolvió cero intentos pendientes con código. No se ejecutaron cobros, compras ni cancelaciones manuales para probar. Tampoco se modifican ventas físicas, descuentos históricos, devoluciones, firmas o plantillas de correo.

## Comprobaciones

- **344 suites y 3.703 pruebas aprobadas**. Tipos y compilaciones frontend/backend correctos; comprobación de sintaxis y diff sin errores.
- Reloj controlado en pruebas, sin cambiar el reloj del sistema: milisegundo anterior al inicio, inicio exacto, durante el intervalo, último milisegundo del 27 y fin exacto. Todos los orígenes/tipos se rechazan sin consultar ni consumir el código; fuera del intervalo se restauran las reglas normales.
- Código aplicado antes del inicio: rechazo con el mismo nombre, retirada de la sesión y del descuento, total recalculado, oferta de producto conservada y ausencia de reactivación silenciosa al terminar.
- API directa y payment-start protegidos; caducidad limitada y selección de reservas anteriores para el trabajador. Las regresiones existentes de reserva, reemplazo, conciliación e idempotencia también pasan con proveedor simulado.
- Productos: limpieza de clases de error/éxito, confirmación real de guardado, fallo posterior de lista y fallo real de escritura, incluido el lote guardado con relectura fallida.
- Playwright local a 1440 y 390 px: aviso exacto junto al campo de checkout y en el resumen de la cesta, sin desbordamiento. Se usan los HTML/JS/CSS del proyecto con respuestas simuladas y llamadas de pago prohibidas. No se atribuyen pruebas de compra real ni de cobro en producción. Capturas y herramientas operativas quedan fuera del commit.

La publicación se realiza mediante **Deploy CRONOX**, `workflow_dispatch` con `publish=true`. Se contrastan el SHA de Actions/VPS, salud pública, fechas guardadas y política aún inactiva antes de las 21:00. No se publica ni envía ninguna campaña de correo.
