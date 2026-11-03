# Incidencia de preparación del checkout — 27/10/2026

Corrección funcional publicada: [`18260856c805916eede0136a6e7334198eae4a8a`](https://github.com/danir23007/Web_Cronox/commit/18260856c805916eede0136a6e7334198eae4a8a). [CI del commit](https://github.com/danir23007/Web_Cronox/actions/runs/40581491917) y [despliegue oficial](https://github.com/danir23007/Web_Cronox/actions/runs/40582477375) correctos. Activación finalizada el **27/10/2026 a las 21:02:48 UTC (22:02:48 en Madrid)**. La preparación que fallaba queda verificada en producción; la autorización bancaria física mantiene las limitaciones indicadas al final.

## Causa y evidencia

Producción ejecutaba exactamente `09525386c1148393d687b8a533e2c85319a274fc`, con 109 migraciones terminadas, cliente Prisma 6.19.3 y los campos de reservas presentes tanto en esquema como en cliente generado. El backend y ambos workers estaban activos. Su configuración Prisma usa `pgbouncer=true&connection_limit=1`.

La entrada al checkout adquiere una reserva por presencia. Cuando se completa la dirección, la preparación necesita reemplazar esa primera reserva por el snapshot con envío/importes definitivos. `replaceCheckoutReservation` abre una transacción, pero `createCheckoutSnapshotForOwner` llamaba a lecturas con el cliente Prisma principal: propietario, stock propio, métodos de envío y promociones. La transacción ocupaba la única conexión disponible y la consulta externa esperaba otra, hasta agotar el pool.

Reproducción en cronox.es con una cesta anónima de diagnóstico y datos ficticios, sin confirmar ningún pago:

- `POST /api/payments/create-payment-intent`, 27/10 a 20:38:21 UTC: **503**, `{"statusCode":503,"code":"DEPENDENCY_UNAVAILABLE","message":"Servicio temporalmente no disponible. Inténtalo de nuevo."}`. La respuesta no incluía identificador de petición.
- El filtro `DatabaseAvailabilityFilter` traduce errores Prisma de disponibilidad a ese contrato y no imprime el error original del endpoint. El log del backend sí mostraba P2024 en un worker concurrente a las 20:38:20 UTC. No se presenta ese log como una traza individual de la petición.
- El navegador mostró exactamente «No hemos podido preparar el pago. Inténtalo de nuevo.» y «Pagar ahora» deshabilitado, tanto con tarjeta como al seleccionar Bizum. Consola: `checkout_payment_intent_update_failed`, `kind: server`, `isRetryable: true`. Los heartbeats de presencia continuaron respondiendo 201.
- El snapshot de diagnóstico quedó `REPLACEMENT_PENDING/PRESENCE`, sin `stripePaymentIntentId`, sin solicitud Stripe durable y sin inicio del plazo protegido. Un intento anterior de la incidencia presentaba el mismo estado. No había identificador de PaymentIntent ni de petición Stripe que correlacionar para esos fallos: el bloqueo precede a la llamada al proveedor.
- En PostgreSQL desechable con **una conexión**, antes de corregir se reprodujo **P2024 en `shippingMethod.findMany`**, con stack `getMethod → getCheckoutPreviewForOwner → createCheckoutSnapshotForOwner → replaceCheckoutReservation`, cero llamadas al proveedor y rollback de la transacción. Después de corregir, la misma prueba pasa para invitado y registrado. Esta es la evidencia directa del error original.

No se atribuye la causa a Stripe, hCaptcha, confirmación ni webhook. Consultas de solo lectura a Stripe verificaron cuenta LIVE española, cobros habilitados y tarjeta/Bizum disponibles y activos en su configuración predeterminada. El frontend publicado usa clave pública LIVE. No se cambiaron cuenta, métodos, claves ni versión API. La preparación LIVE posterior al despliegue también verificó la correspondencia cliente/servidor.

## Corrección

- `orders.service.ts` y `shipping-methods.service.ts`: todas las lecturas anidadas usan la transacción existente, incluidos envío, propietario, carrito, crédito de reserva propia y cupones. No se aumenta el pool ni se debilitan bloqueos de stock.
- `checkout.js` y `checkout.html`: «Volver a preparar el pago» permite recuperarse de errores transitorios. Revalida la presencia y reutiliza el endpoint idempotente, bloquea dobles clics y mantiene Pagar deshabilitado hasta disponer de una preparación válida. No reinicia la reserva ni ejecuta `payment-start` o `confirmPayment`. Los estados explícitos de pago incierto/en curso conservan su flujo de conciliación.
- Regresiones en `test-checkout-reservations-db.cjs --single-connection`, `orders.service.spec.ts` y `checkout-preparation-retry.dom.spec.ts`. La prueba de contrato transaccional se ejecuta en CI y rechaza cualquier consulta que vuelva a escapar al cliente raíz.
- Recurso de checkout versionado de 36 a 37. La publicación contiene exclusivamente estos siete archivos. Los trabajos pendientes de footer y eliminación de usuarios con participaciones QR permanecen locales.

**No requiere migración, regeneración especial de Prisma ni modificación manual de datos.** Se conserva cesta sin reserva, presencia en checkout y plazo protegido inmutable de 360 segundos desde `payment-start`.

## Verificación anterior a publicación

- PostgreSQL real desechable, pool de una conexión: invitado y registrado; última unidad y reserva propia; reuso; dirección/envío/cupón; recuperación de PI cancelado; estado `REPLACEMENT_PENDING` anterior y peticiones simultáneas; un único intento/reserva activa; protección de 360 segundos sin renovación y caducidad/salida seguras. Base eliminada al terminar.
- Backend: 90 pruebas focales únicas y comprobación TypeScript correctas. Frontend: 50 pruebas focales; la regresión nueva falla antes de implementar el reintento y pasa después. Revisión independiente del diff sin bloqueos.
- Navegador: 4 escenarios previos de reservas y 8 escenarios focales adicionales, invitado/registrado × tarjeta/Bizum × 390/1366 px. Verifican preparación fallida con 503, reintento, doble clic, cambio estándar→express, rechazo simulado, plazo de 360 segundos y recarga sin renovarlo. Son fixtures aisladas con proveedor simulado, no autorizaciones bancarias.
- CI del SHA exacto: **285 suites / 3088 pruebas** correctas; **6 suites / 59 pruebas** adicionales de exportación, tipos, compilación, controlador de publicación y comprobación de recursos privados correctos.
- Navegador y Stripe **test reales**: un 503 inducido localmente seguido de reintento explícito produjo una sola petición posterior y un PaymentIntent válido. El formulario con tarjeta de prueba completó el pedido local **10**, y Bizum test completó el pedido local **11**. En ambos: `livemode=false`, método efectivo verificado (`card`/`bizum`), estado `succeeded`, exactamente un pedido, webhook original de Stripe CLI `PROCESSED`, reserva `CONSUMED`, stock ficticio 5→4 y ventana exacta **360000 ms**. Productos de prueba desactivados tras verificar.
- No se eludió hCaptcha ni se cambiaron protecciones productivas. La clave pública test se sirvió únicamente a la sesión local; los recursos de producción permanecieron en LIVE. Bizum test usó el comportamiento documentado de simulación, no una autorización bancaria física.

Referencias consultadas: [Payment Element con PaymentIntents](https://docs.stripe.com/payments/payment-element/migration?integration-path=one-time), [ciclo del PaymentIntent](https://docs.stripe.com/payments/paymentintents/lifecycle) y [pruebas Bizum](https://docs.stripe.com/payments/bizum/accept-a-payment?payment-ui=direct-api#test-integration). No se realizó una migración de integración como parte del incidente.

## Publicación y comprobación productiva

- Controlador oficial: revisión exacta, `status=success`, `phase=public_check`, `phaseComplete=true`. Respaldo de base, roles y aplicación con recibos y hashes; restauración aislada de **305 objetos y cero diferencias**, completada antes de instalar. No se descargaron ni publicaron respaldos.
- Producción ejecuta `18260856`, PID 323334, sin mantenimiento y con escucha de backend exclusivamente en loopback. Home, checkout, health y ready responden 200. `checkout.js?v=37` coincide por SHA-256 con el archivo del commit. El HTML usa `no-store` y el script `public, max-age=0`.
- **109 migraciones terminadas, cero inconclusas; ninguna nueva aplicada.** Prisma conserva los campos de reservas y la configuración sigue con una conexión: el resultado no depende de aumentar el pool.
- Dos lecturas separadas a las 21:03:13 y 21:03:43 UTC muestran avance de **ambos** workers de recuperación y reservas, mismo PID, habilitados y sin error de escaneo. Una lectura posterior a las 21:06:02 vuelve a confirmarlo.

| Comprobación en cronox.es, invitado | Resultado |
| --- | --- |
| Recuperación de la cesta de diagnóstico anterior | La referencia caducada recibe 409 y el flujo existente la recupera con una reserva nueva, 201. |
| Petición que fallaba: `POST /api/payments/create-payment-intent` | **201 a las 21:03:22.529 UTC**, PaymentIntent LIVE válido y fase `PRESENCE`; sin error de preparación. |
| Tarjeta | Payment Element cargado, campos visibles; Pagar permanece deshabilitado mientras están vacíos. No se introdujeron tarjetas test en LIVE. |
| Bizum | Formulario cargado y Pagar habilitado al completar el teléfono ficticio. **No se pulsó Pagar**. |
| Cambio estándar→express | Preparación 201 a las 21:05:17.823; importe 42,95→44,95 €, intento anterior cancelado por el flujo existente. |
| Recarga | Dirección y envío sin pago iniciado vuelven a su estado inicial; al completar los datos otra vez, preparación 201 a las 21:05:28.210, formulario cargado y sin error. No se afirma persistencia de dirección/envío antes del pago. |
| Salida al carrito | A las 21:06:00; worker concilia y libera la reserva automáticamente. |

La lectura final a las 21:06:37 verifica los **tres PaymentIntents LIVE de diagnóstico cancelados**, importe recibido cero, sin método de pago asociado, sin cargos ni pedidos, `paymentStartedAt=null` y todas sus reservas liberadas. No se llamó a `payment-start` ni a confirmación. La reserva anterior de la incidencia también aparece `EXPIRED`, sin PI y sin reintento pendiente; su caducidad la gestionó el worker existente, sin intervención manual.

Las capturas `checkout-incident-card-production-after.png` y `checkout-incident-bizum-production-after.png` se revisaron visualmente. El usuario registrado se comprobó en las pruebas locales/fixtures y PostgreSQL; no se accedió a cuentas reales de clientes para repetirlo en producción. Otros proveedores, wallets, 3DS y autorizaciones bancarias LIVE no se presentan como validados por estas comprobaciones de preparación.

Quien tuviera una pestaña abierta con el código anterior debe recargarla para obtener el arreglo y el nuevo botón de reintento.

## Reservas anteriores y recuperación

Un snapshot fallido sin PI no representa un cobro incierto en Stripe. Mientras exista presencia válida se conserva la reserva; tras publicar, el reintento puede completar su reemplazo. Al salir o caducar, el worker existente comprueba el estado y lo libera. Para snapshots con intento proveedor mantiene la conciliación y verificación antes de liberar; no se han cancelado pagos ni liberado stock de forma masiva.

La publicación utiliza exclusivamente Deploy CRONOX y su controlador instalado: CI del SHA exacto, mantenimiento coordinado, respaldo privado restaurado/comparado antes de activar, compilación/Prisma/backend/frontend y reapertura. No hay migraciones nuevas. Si la activación fallara, se consulta el diario del mismo SHA y se usa el procedimiento `recover` existente; no se ejecutan resets ni se revierte el esquema o los datos generales.

Evidencias locales redactadas: `output/checkout-incident-20261027/`, incluidas reproducción HTTP, regresión antes/después, verificaciones Stripe test y resultados de publicación. Las cookies de pruebas y archivos privados no se incluyen en Git.

Pendiente físico: autorización bancaria Bizum LIVE, wallets y 3DS en dispositivos reales. El zoom móvil no reproducido mantiene su estado previo; este incidente no lo modifica.
