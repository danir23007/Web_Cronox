# Publicación conjunta de checkout y estados de clientes · 14/10/2026

Publicación y reapertura completadas. Código instalado: `91d41e1d3b1bc4c4f8ba24f61d8917a917f22567`. Este informe actualiza los pendientes históricos de preparación; no convierte las pruebas de sandbox en pagos LIVE.

## Revisión publicada y controles

- `ab4f98a`: PayPal seleccionable debajo de Payment Element, PayPal exprés conservado, bloqueo de confirmación compartido y ajustes visuales revisados.
- `11d3ef8`: estados `ACTIVE` / `INACTIVE`, reconciliación revisada y separación de habilitación y credenciales.
- `1954ca5`, `91d41e1`: coordinación de mantenimiento, controles antes de mezclar código y publicación únicamente mediante dispatch explícito. Un push verifica; no publica automáticamente. Durante mantenimiento el instalador deja el backend detenido.
- [CI y despliegue 38548937447](https://github.com/danir23007/Web_Cronox/actions/runs/38548937447): `verify-release` y `deploy`, success. Jest: **2.290 pruebas, 231 suites**; HTTP/Excel: **59 pruebas, 6 suites**. TypeScript, builds, controles de despliegue y exclusión de contenido privado correctos. La validación previa [38510735475](https://github.com/danir23007/Web_Cronox/actions/runs/38510735475) también pasó, sin publicar.
- Los archivos servidos de checkout coinciden con el commit; Prisma generado contiene exclusivamente `ACTIVE` / `INACTIVE`. El control productivo de entrega pasó con 7.344 archivos registrados y 1.155 artefactos revisados.

Se conservan sin publicar las tres excepciones locales del sandbox: `cronox-backend/src/main.ts`, `src/common/config/local-review-safety.ts` y su spec. Las claves, perfiles privados, operadores temporales, dumps, capturas y evidencias permanecen fuera de Git. Las dependencias necesarias en producción no se excluyeron: instalación limpia, compilaciones y arranque productivo pasaron.

## Ventana y datos

Root confirmó la recuperación del código, runtime, Prisma y configuración originales. Respaldo privado de runtime: `/root/cronox-backups/joint-feAWYe`. Se activó mantenimiento 503, incluido el webhook, y la tabla temporal nft `inet cronox_account_maintenance` bloqueó el acceso externo a 3000 conservando loopback. No se habilitó UFW ni se modificó SSH. Root acreditó PM2 detenido y puerto sin escucha; la comprobación de actividad de base encontró cero escritores activos y cero transacciones inactivas abiertas. La prueba externa IPv4 quedó bloqueada; el equipo de pruebas carecía de ruta IPv6 y no se presenta ese sondeo como validado.

Respaldo definitivo consistente: `/home/deploy/cronox-release-backups/joint-108c226dd2fd4ad38dd5fee002184ef0`, con copia sellada bajo el respaldo privado de root. Se restauraron realmente las **100 tablas** en un clúster aislado por socket Unix, conservando propietarios, permisos y RLS. Se probaron migración y recuperación con el esquema `public` y su extensión existente, sin arrancar aplicación ni workers. No se ejecutó una restauración sobre producción.

Con los escritores detenidos se repitió la auditoría: 49 cuentas, cero altas/bajas desde el ensayo preliminar. Solo había cambiado `updatedAt` de otra cuenta activa, conservando rol y clasificación. El cliente n.º 49 mantenía UUID, estado y versión esperados; se aplicó la decisión explícita del titular de conservarlo activo por ser un alta automática. No se dedujo la habilitación de contraseñas, compras, sesiones ni ausencia de auditoría.

Se registró una revisión y se aplicó `20261015120000_customer_account_enablement` mediante Prisma desde la revisión verificada. Pasaron ambos guards, incluido checksum e historial de migración. Resultado: **49 ACTIVE, cero estados antiguos**; cliente n.º 49 activo, identidad y versión conservadas. La comparación posterior confirmó que las demás columnas de clientes y las tablas ajenas a User/AuditLog/historial de Prisma no cambiaron por la migración. No se duplicó la reconciliación.

El backend compatible arrancó primero con los seis flags de correo/jobs en false. Root confirmó salud, cero errores nuevos de arranque y cero referencias a estados retirados en logs. Se revisaron las colas: siete bienvenidas SENT, cinco envíos SMTP_ACCEPTED, sin campañas, entregas de campaña ni reclamaciones de lanzamiento pendientes. Después se restauró el comportamiento original; `BACKGROUND_JOBS_ENABLED`, antes implícitamente habilitado, quedó explícitamente true en PM2. Los otros flags recuperaron sus valores originales. Tras comprobar salud y logs se retiraron el flag de mantenimiento y exclusivamente la tabla nft creada por esta ventana; PM2 quedó guardado.

Después de reabrir no debe arrancarse código antiguo sobre este esquema ni restaurarse ciegamente el snapshot: cualquier recuperación exige detener escritores de nuevo y conservar/reconciliar operaciones posteriores. El procedimiento preparado verifica datos y compatibilidad antes de recuperar base y runtime como unidad.

## Verificaciones reales después de reabrir

- Ambos dominios: `/api/health` y `/api/ready` HTTP 200. Catálogo público: siete productos. Rutas administrativas sin sesión: 401.
- Chromium contra la web pública, anchuras 390 y 1.440 px: un solo Express Checkout, Google Pay y PayPal disponibles; Apple Pay no disponible en ese navegador. Orden configurado conservado: Apple Pay → Google Pay → PayPal, omitiendo los no disponibles. Botones oficiales, `plain` en Apple/Google, separación de 20 px de la cabecera, distribución adaptable y personalización de Google aceptadas. No se implementó la distribución exacta descartada ni otro grupo Elements.
- PayPal inferior visible y seleccionable también por teclado. Al seleccionarlo se oculta Payment Element sin eliminar validaciones; con campos vacíos el botón de confirmación sigue deshabilitado. Se conservan Link y Amazon Pay en el formulario inferior cuando Stripe los ofrece.
- Producto público de 40 EUR, carrito invitado sin datos de comprador: estándar **42,95 EUR**, exprés **44,95 EUR**, vuelta a estándar **42,95 EUR**. Respuestas reales del servidor: subtotal 4.000 céntimos, envío 295/495, total 4.295/4.495. Payment Element conservó su iframe durante el cambio de tarifa. Cero solicitudes de crear PaymentIntent o iniciar transferencia en los cambios observados. Esto prueba el envío del formulario web, no la hoja nativa de Google Pay.
- Transferencia bancaria propia: disponibilidad productiva false y opción oculta. No se modificó el Dashboard ni se sustituyó `customer_balance` por Multibanco; este último, ofrecido por Stripe en Payment Element, es un método separado. Bizum no se fuerza ni se simula aprobado.
- Dominios de carteras y eventos requeridos del webhook productivo comprobados. SDK/API conservados; sin actualización adicional. Petición sin firma: 400.
- Stripe reenvió un evento LIVE original `payment_intent.canceled`, ya PROCESSED, al único endpoint habilitado suscrito a ese tipo. Reenvío aceptado, `pending_webhooks=0`; registro y fechas PROCESSED sin cambios, cero pedidos asociados, los mismos dos movimientos históricos y cero emails de confirmación. No se fabricó una firma ni se creó un cobro. Informe filtrado privado: `test-results/joint-release/webhook-resend-verified.json` en el worktree operativo.
- Tras vaciar el carrito invitado de verificación: cero artículos, snapshots, pedidos y movimientos asociados; siguen existiendo 49 cuentas y cero estados antiguos. El único webhook FAILED conservado ya existía antes de la ventana; no se presenta como un error nuevo. En navegador solo se observaron los 401 esperados de invitado y una advertencia interna de Stripe sobre origin trials.

Capturas privadas verificadas en `output/playwright/joint-release/public-checkout-{desktop,mobile}.png`. Se comprobó además el viewport móvil de 390×844 sin desbordamiento; la captura larga usa una altura ampliada para que Chromium pinte los iframes fuera del primer viewport. No es una prueba en iPhone. Se cerraron los dos navegadores de revisión. No quedan túnel, listener Stripe ni servidor local del sandbox; no hay escucha local en 3000/3001.

## Alcance de los pagos y pendientes aceptados

Las compras de prueba 23 y 24 con PayPal inferior siguen siendo **válidas en Stripe Sandbox con autorización simulada oficial**: regreso, confirmación, webhook original y un pedido/consumo de stock por compra; cancelación/reintento sin duplicación según las evidencias conservadas. No se repitieron usando el comprador Personal ni se hicieron pagos LIVE.

Permanecen pendientes, sin bloquear esta publicación por decisión del titular: secuencia española dentro de la hoja de Google Pay y pago completo de Google Pay; Apple Pay en dispositivo físico; devolución bancaria efectiva. No se pedirá crear otra cuenta Google de pruebas. La devolución o conciliación bancaria real no se considera demostrada por cancelar un pedido o por recibir un webhook.
