# Reservas de checkout — implementación local, 27/10/2026

**Actualización de revisión final:** la tarjeta se ha completado desde Payment Element real en modo test, con pedido local 9, webhook original y consumo único de stock. El hCaptcha 429 previo no bloqueó este intento; wallets/3DS físicos siguen pendientes. Se añade la migración de privacidad de presencia y el control de arranque compatible con migraciones. El estado vigente de publicación está en [revisión final conjunta](release-final-2026-10-27.md); los apartados siguientes conservan la evidencia cronológica anterior.

La cesta no reserva. Entrar en checkout adquiere stock por variante y cantidad; la presencia mantiene esa reserva. Después de validar y justo antes de confirmar el pago, el servidor fija una única ventana de **360 segundos**. Se reutilizan `CheckoutSnapshot` y `CheckoutStockReservation`; no se añade otra contabilidad de inventario.

## Mecánica implementada

| Situación | Resultado |
|---|---|
| Cesta fuera de checkout | No descuenta disponibilidad. |
| Entrada confirmada por servidor | Transacción con decrementos condicionados a stock suficiente; índice único de checkout activo por cesta. Si falta stock, devuelve los artículos afectados. |
| Checkout abierto | Heartbeat cada 20 s; presencia por pestaña válida durante 90 s desde la última señal aceptada. Puede mantenerse más de seis minutos mientras se rellenan datos. |
| Navegación explícita fuera del checkout | Marca esa pestaña como salida. Si no quedan otras, concilia el intento preparado, confirma su cancelación y libera. Conserva la cesta. |
| `pagehide` sin navegación explícita | Margen máximo de 15 s, útil para recarga o retorno. Si no llega ningún aviso, caduca por el margen de presencia de 90 s. |
| Pestaña oculta, teclado, orientación | No provocan salida. Al volver a visible se comprueba presencia. Una suspensión prolongada que impida toda señal puede alcanzar los 90 s; esto es pérdida de presencia, no una reserva protegida. |
| Preparar Stripe, seleccionar método o validación fallida | No inicia la protección. |
| Confirmación real | Se espera la respuesta de `/api/checkout/payment-start` antes de `confirmPayment`, también en el flujo exprés y PayPal. Transferencia realiza la transición antes de solicitar instrucciones mediante confirmación. |
| Pago iniciado, rechazo, recarga, reintento, 3DS o salida al banco | Mismo snapshot, intento y vencimiento. Nunca vuelve a presencia ni reinicia los 360 s. |
| Cantidades/envío antes del pago | Cancelación verificada del intento anterior y sustitución de la reserva en una transacción: liberar y adquirir se confirman juntos. Si falta stock, se revierte la sustitución. |
| Cesta modificada después de iniciar pago | La compra mantiene los artículos e importes congelados. Al cobrar, se descuentan de la cesta las cantidades compradas, conservando las añadidas después. |
| Vencimiento | Bloquea nuevas confirmaciones desde el checkout y pasa a conciliación. Una nueva reserva requiere una acción explícita; el heartbeat no la recrea. |

Las pestañas tienen identidades distintas incluso tras recarga/BFCache. Salidas tardías no reabren presencias cerradas ni alteran pagos protegidos. También se serializa la primera entrada con una salida recibida antes de su respuesta. Un inicio de sesión conserva la reserva al combinar una cesta invitada con una cuenta; si ambas tienen compras activas, se rechaza esa combinación con un conflicto explícito, sin cancelar silenciosamente ninguna.

El resumen recuperado usa los artículos congelados; dirección, contacto, envío y promoción quedan bloqueados durante el intento protegido. Se corrigieron además el formato del resumen y la recuperación de `postalCode` encontrados en la comprobación de recarga.

## Conciliación y límites del proveedor

El proceso de limpieza arranca al iniciar el servidor y revisa cada **1 segundo**, con lotes de 100 y hasta 8 conciliaciones simultáneas. Los estados inciertos se reintentan tras 5 s sin renovar el vencimiento. No depende del navegador. Debe estar activo: `BACKGROUND_JOBS_ENABLED=false` lo desactiva salvo la activaci?n expl?cita y protegida del checkout local test descrita abajo; `CHECKOUT_RESERVATION_WORKER_ENABLED=false` y el modo de pruebas de rutas tambi?n lo desactivan.

- `succeeded`: completa el pedido mediante el flujo idempotente existente. Consume la reserva sin volver a descontar stock, también si la confirmación se conoce después del vencimiento mientras las unidades siguen retenidas.
- Estado cancelable: verifica cuenta, modo, snapshot, importe y moneda; solicita cancelación y comprueba el resultado antes de liberar.
- Carrera entre éxito y cancelación: vuelve a consultar el intento y concilia el estado real.
- `processing`, error de red o resultado incierto: mantiene unidades fuera de la venta. No afirma que estén disponibles ni introduce reembolsos automáticos.
- Caída después de crear el intento pero antes de guardarlo: conserva la petición original y la clave idempotente para recuperar el mismo intento. Si han pasado 23 h o falta esa petición histórica, mantiene la reserva para revisión; no arriesga una creación con una clave que Stripe pudiera haber eliminado.

**360 s es el vencimiento del intento, no una promesa de devolver unidades exactamente en ese milisegundo.** La disponibilidad exige cancelación confirmada o resolución del pago; depende de la latencia, carga y disponibilidad de Stripe. Los pagos asíncronos en procesamiento pueden superar ese límite y se retienen en conciliación, sin prolongar el plazo del cliente.

**Transferencia bancaria:** no puede garantizar llegada de fondos en seis minutos. Ahora el nuevo intento tiene ese plazo; se cancela antes de devolver stock. La prueba real de sandbox confirmó que fondos enviados después de cancelar quedan como saldo en Stripe y no reviven el intento. Esos fondos necesitan atención operativa y decisión de devolución o nueva compra; no se automatiza un reembolso ni se consume inventario liberado. El aviso del checkout explica este caso. Para ofrecer garantía comercial estricta de pago completo dentro de seis minutos habría que decidir expresamente si mantener este método; no se ha deshabilitado silenciosamente.

Se mantiene la selección dinámica de métodos del proyecto. Apple Pay, Google Pay, Link, Bizum y otros métodos disponibles dependen de cuenta, navegador y dispositivo. La protección se aplica al punto común de confirmación, pero no se ha validado físicamente la autorización de cada uno.

Documentación consultada: [cancelación de PaymentIntents](https://docs.stripe.com/api/payment_intents/cancel), [ciclo de vida](https://docs.stripe.com/payments/paymentintents/lifecycle) y [transferencias con PaymentIntents](https://docs.stripe.com/payments/bank-transfers/accept-a-payment?payment-ui=direct-api). Se conserva el SDK y la versión API ya utilizados por CRONOX; no se mezcla esta corrección con una migración de integración.

## Migración y puesta en marcha pendiente

Nueva migración: `cronox-backend/prisma/migrations/20261027190000_checkout_presence_and_payment_window/migration.sql`.

Añade `reservationPhase`, `paymentStartedAt`, `stripeCreateRequest`, `reservationRetryAt` y la tabla `CheckoutPresence`, con identidad compuesta cesta/pestaña. El índice parcial de checkout activo existente sigue siendo necesario.

La migración **solo se ha aplicado en una base desechable de pruebas**, no en la base habitual. Antes de arrancar esta versión sobre otra base hay que aplicar las migraciones, regenerar Prisma y reiniciar los procesos correspondientes. No se ha desplegado ni reiniciado el servidor del usuario.

Los intentos históricos ya vinculados se convierten en protegidos conservando su vencimiento anterior: incluye las transferencias antiguas de hasta 72 h. Es una excepción de migración deliberada para no reinterpretar pagos en curso; hay que revisar esa cohorte al activar la versión. Ningún intento nuevo obtiene ese plazo. Las reservas históricas sin intento vinculado vencen para que el trabajador las concilie; una creación antigua incierta sin petición durable queda retenida para revisión.

En Windows, `npm run prisma:generate` sobre la carpeta habitual encuentra `EPERM` al reemplazar una DLL usada por un proceso abierto. La generación del mismo esquema **sí pasó en una carpeta aislada**, y el cliente local pudo ejecutar las pruebas de base de datos y el chequeo TypeScript. Al reiniciar el entorno habitual habrá que repetir la generación normal con la DLL libre. No se mató ese proceso.

## Verificación ejecutada

| Capa | Resultado |
|---|---|
| TypeScript | `npm run typecheck`, correcto. |
| Servicios y DOM | **230 pruebas, 16 suites**, correctas. Incluyen pedidos, carrito, factory, transferencia, recuperación de webhooks, Stripe, presencia, pago exprés y regresiones de interfaz. |
| PostgreSQL aislado + reloj controlado | **16 grupos de comprobaciones**, correctos; migración SQL real aplicada y base eliminada al terminar. Proveedor con estados simulados para controlar carreras y fallos. |
| API real de Stripe en modo test | **5 escenarios**, correctos: cancelación de preparación, rechazo/reintento de tarjeta, éxito reconocido, cancelación de 3DS pendiente, redirección PayPal pendiente y transferencia con fondos sintéticos tardíos. Algunos comportamientos se agrupan en un escenario. Ningún cobro real. |
| Navegador | Chromium y WebKit, 390 y 1366 px, invitado y cuenta: **8 combinaciones**. Validación previa, preparación sin protección, espera de confirmación del servidor, doble clic, rechazo/reintento, recarga sin renovar plazo, dirección y resumen congelados, ausencia de desbordamiento horizontal. Stripe/UI de pago simulados en estas pruebas. |
| Trabajo anterior | Hashes de 63 archivos: ninguno perdido; solo `checkout.html` cambia para incorporar este flujo, conservando sus ajustes previos. Footer y compatibilidad móvil no se reescribieron. |
| Diff | `git diff --check`, correcto. |

La prueba PostgreSQL cubre invitados/registrados, presencia superior a seis minutos, dos pestañas, salida explícita, desaparición a 90 s, margen de 15 s, instantes 359999/360000/360001 ms, disputa por la última unidad, sustitución fallida con rollback, propiedad y vinculación de intento, éxito durante cancelación, duplicados/eventos tardíos y desordenados, proveedor caído/procesando, reinicio del trabajador y pérdida de la respuesta de creación.

Los eventos del test PostgreSQL se firman con un secreto de pruebas y recorren el controlador y la recuperación durable; no son entregas desde Internet. La prueba Stripe real verifica el contrato del proveedor, separada de esa base de datos. No se afirma una validación extremo a extremo con webhook público, aprobación PayPal, wallets físicos, app bancaria o 3DS en un teléfono real. Esas comprobaciones quedan pendientes antes de publicar. Los objetos Stripe creados llevan identidades exclusivas de test; quedan como evidencia un cobro sintético y saldo bancario de test, sin dinero real ni reembolso automático.

Evidencias: `output/stock-reservations/database-results.json`, `stripe-contract.json`, `browser-chromium.json`, `browser-webkit.json`, `final-tests.log` y `preservation-result.json`; capturas en `output/playwright/stock-reservations-*.png`.

## Archivos de esta implementación

- Persistencia: `cronox-backend/prisma/schema.prisma` y la migración indicada.
- Inventario y pedidos: `src/cart/cart.service.ts`, `src/orders/orders.service.ts`, `src/orders/bank-transfer-policy.ts`, nuevo `src/orders/checkout-reservation-policy.ts`.
- Pagos: nuevo `src/payments/checkout-presence.controller.ts`, `checkout-reservation-cleanup.service.ts`, `payment-intent.factory.ts`, `stripe.service.ts`, `bank-transfer.service.ts`, `payments.module.ts` y `dto/create-payment-intent.dto.ts`.
- Interfaz: `cronox-front/checkout.html`, `assets/checkout.js`, `assets/checkout-lifecycle.js` y nuevo `assets/checkout-presence.js`.
- Pruebas: specs de carrito, pedidos, factory, transferencia y limpieza; nuevo `src/frontend/checkout-presence.spec.ts`; adaptación de cuatro fixtures DOM de checkout y nuevo `test/checkout-presence-fixture.cjs`.
- Ejecuciones reproducibles: nuevos `cronox-backend/scripts/test-checkout-reservations-db.cjs`, `test-reservation-stripe-contract.cjs` y `tests/stock-reservations/checkout-browser.cli.js`.

Para repetir las pruebas de base de datos: `node scripts/test-checkout-reservations-db.cjs` desde `cronox-backend`. La prueba de contrato Stripe se ejecuta con `node scripts/test-reservation-stripe-contract.cjs`, exige la configuración local de sandbox existente y rechaza claves que no sean `sk_test_`. El script de navegador usa el servidor local de fixtures en `127.0.0.1:4173` e intercepta las API y conexiones externas; puede ejecutarse con `playwright-cli run-code --filename tests/stock-reservations/checkout-browser.cli.js` en una sesión Chromium o WebKit.

Todo el código queda local, sin commit, push ni despliegue.


## Activaci?n de la instalaci?n habitual ? comprobada el 27/10

**Operativo:** http://localhost:3000, base de desarrollo cronox_dev, Prisma generado en su ubicaci?n habitual y Nest en modo watch. La base sigue sin exposici?n remota. No se ha modificado producci?n, hecho un reset ni ejecutado pagos reales.

### Respaldo y conservaci?n

Antes de migrar se verificaron por conexi?n SQL la direcci?n del servidor, puerto y nombre de base. Hab?a un usuario, un pedido, diez productos y ning?n checkout; tampoco hab?a eventos Stripe ni efectos pendientes que pudieran activarse con el trabajador.

Respaldo completo en formato pg_dump custom: output/checkout-local-activation/cronox_dev-before.dump (581829 bytes; SHA-256 00287572929af67e53c9bd518ac2e0b44a95be6fc40449089d1ca20a19309f70). Se comprob? el cat?logo y **se restaur? ?ntegramente** en una base temporal con nombre exclusivo, eliminada despu?s; cronox_dev no se resete?. El respaldo, la copia privada de .env.local y los estados privados del navegador est?n excluidos de Git.

migrate:local aplic? las dos migraciones pendientes; migrate status informa **Database schema is up to date**. El script de verificaci?n comprob? finished_at y el checksum real de ambas. Se mantienen las reservas de identidades permanentes y no se han renumerado usuarios.

Los productos, variantes y pedidos previos a la prueba se compararon completos al finalizar: permanecen id?nticos. Se a?adieron los m?todos de env?o ficticios 1 y 2 porque no exist?an; no se sustituy? ninguna tarifa existente. Permanecen como evidencia el pedido test **7**, la cuenta ficticia creada por ese pago, sus registros de reserva/pago y los productos ficticios inactivos de la prueba y de los intentos de preparaci?n fallidos. No se borr? ni reembols? historial. El producto usado en la prueba completa es **11961**, variante **2155**: de 20 unidades solo se consumi? la unidad pagada.

### Arranque protegido y trabajos

El perfil privado .env.local contiene LOCAL_CHECKOUT_STRIPE_TEST=true. El lanzador obtiene exclusivamente las claves test y el secreto de webhook de .env.stripe-sandbox, sin copiar esas claves al c?digo ni cambiar el destino PostgreSQL por la base separada del sandbox. Rechaza claves live y la activaci?n no puede heredarse accidentalmente de la terminal. No importa SANDBOX_PUBLIC_URL ni abre un t?nel.

La excepci?n activa solo el conciliador de reservas (cada segundo, lotes de 100, hasta ocho consultas simult?neas) y la recuperaci?n de webhooks (cada cinco segundos, lease de 60 segundos, reintento de 15 segundos). Correo, campa?as, log?stica y trabajos generales permanecen desactivados. Las rutas locales permitidas son las de presencia, preparaci?n/inicio de pago, transferencia y recepci?n firmada de webhooks; los reembolsos y modificaciones de pedidos hist?ricos siguen bloqueados.

Para futuros arranques, desde la ra?z:

```powershell
# Primero: escucha Stripe TEST y actualiza el secreto privado de webhook.
node cronox-backend/scripts/checkout-sandbox.cjs listen
# En otra terminal: usa la base habitual local y el modo watch.
npm run start:dev --prefix cronox-backend
```

La escucha y el servidor iniciados para esta comprobaci?n quedan activos en local. Si la CLI renueva el secreto de escucha, reiniciar el backend para cargarlo. Desactivar LOCAL_CHECKOUT_STRIPE_TEST y reiniciar devuelve el perfil al modo de revisi?n sin operaciones de pago. No sustituir este arranque por start:prod ni activar BACKGROUND_JOBS_ENABLED globalmente.

### Resultado de la prueba adicional

Ejecutable: cronox-backend/scripts/verify-checkout-local-activation.cjs. Exige expl?citamente cronox_dev en 127.0.0.1:5433 y la activaci?n test; crea referencias ?nicas y usa HTTP real, PostgreSQL real, Stripe test real y **reloj de pared real**, sin acortar vencimientos.

- Cesta: stock intacto; entrada: una unidad reservada; preparaci?n Stripe: paymentStartedAt nulo.
- Salida sin pagar: intento test cancelado antes de devolver stock; cesta conservada.
- Pago: ventana exacta desde **14:27:23.384Z hasta 14:33:23.384Z**, 360000 ms. Recarga, nueva pesta?a, preparaci?n y llamada repetida de inicio conservan la fecha.
- Pago confirmado: pm_card_visa en la API test, evento original payment_intent.succeeded entregado por Stripe CLI con firma verificada y HTTP 200. Un ?nico pedido PAID y una reserva CONSUMED, sin segundo descuento de stock. No se firm? un evento ficticio para hacer pasar esta prueba.
- Caducidad: sin navegador en checkout, el trabajador cancel? el intento y liber?; Stripe rechaz? confirmar despu?s ese intento cancelado.
- Incertidumbre controlada: ?nicamente en una reserva nueva se sustituy? temporalmente la cuenta Stripe asociada por una referencia ficticia incompatible. Al vencer no liber? stock; se observaron reintentos posteriores separados por unos cinco segundos. Restaurada la identidad correcta, se cancel? y liber? autom?ticamente. No se simul? un succeeded ni se alter? el reloj.
- Estado final: **cero reservas vencidas con stock retenido**, ambos trabajadores activos y sin error de escaneo.

Navegador Chromium contra localhost: recarga del checkout protegido a 390 y 1366 px, fecha inalterada, direcci?n congelada conservada y sin scroll horizontal. El administrador real mostr? la reserva incierta, una unidad retenida, vencimiento y pr?xima revisi?n; despu?s mostr? cero pendientes. Los campos/iframes Stripe fueron reales, pero **hCaptcha respondi? HTTP 429** en la automatizaci?n y dej? incompleta la interfaz de tarjeta. Por ello no se afirma una autorizaci?n de tarjeta desde el formulario: el ?xito de pago verificado aqu? es por API test y webhook original.

Verificaciones adicionales, sin repetir la bater?a previa: compilaci?n Nest y typecheck; **68 pruebas Jest en ocho suites** (trabajadores, webhook, protecci?n local y vista administrativa) y **cuatro pruebas Node** del lanzador. Diff sin errores de espacios. La DLL qued? libre durante la regeneraci?n y est? cargada de nuevo por el backend reiniciado, como corresponde durante su ejecuci?n.

### Incertidumbre, visibilidad y recuperaci?n operativa

Administrador ? Clientes ? Pedidos ? **Reservas de checkout pendientes de conciliaci?n**, solo accesible a SUPERADMIN mediante el endpoint protegido GET /api/admin/payments/recovery. La vista muestra el total, hasta 100 reservas m?s antiguas, unidades retenidas, intento, vencimiento y siguiente revisi?n. Permite actualizar, **no forzar una liberaci?n**. Un error de consulta aparece como ?No disponible?, nunca como cero reservas. La respuesta excluye direcciones, emails, client_secret y petici?n original Stripe.

Los seis minutos limitan nuevas confirmaciones del checkout, no la duraci?n m?xima de un pago as?ncrono ni la disponibilidad del proveedor. Pueden superarse por processing, respuestas inciertas, red ca?da, credenciales/cuenta que no coinciden, errores de persistencia, carga o reinicio del servidor. No se renueva expiresAt. Al recuperarse la conexi?n, el trabajador vuelve a consultar: succeeded genera el pedido idempotente; canceled libera; un estado cancelable se cancela y se verifica; processing sigue retenido.

Una creaci?n sin respuesta se recupera con la petici?n durable y la misma clave idempotente. Si falta esa petici?n o tiene 23 horas o m?s, exige revisi?n del intento original en la cuenta correcta: no se crea otro intento ni se libera por antig?edad. La reserva contin?a visible y con reintentos controlados. El operador debe corregir conexi?n/configuraci?n o reconstruir la vinculaci?n **solo con evidencia verificable del proveedor**; no cambiar stock, estado o fechas a mano para ocultarla. No se a?ade una recuperaci?n autom?tica peligrosa para esos casos. Los reembolsos y fondos bancarios tard?os requieren decisi?n operativa independiente.

El plazo de reintento de cinco segundos se programa despu?s de la respuesta incierta y no es un SLA: depende de latencia y de que el servidor est? funcionando. Una ejecuci?n del trabajador no se solapa consigo misma. La prueba local cubri? una incompatibilidad temporal de cuenta; processing real de un medio as?ncrono y un fallo real de red prolongado no se provocaron en esta instalaci?n. Las pruebas previas con proveedor controlado siguen siendo la evidencia para esos estados.

### Validaciones f?sicas a?n pendientes

- Introducir y autorizar la tarjeta desde Payment Element en un navegador sin el bloqueo observado de hCaptcha; completar 3DS en un dispositivo f?sico.
- Apple Pay, Google Pay, Link, Bizum, aprobaci?n PayPal y vuelta desde la app bancaria, con sus navegadores/dispositivos compatibles y entorno HTTPS de test.
- Suspensi?n prolongada del m?vil, cierre forzado, p?rdida de red y recuperaci?n; distinguir reserva de presencia de pago ya protegido.
- Entrega por un endpoint p?blico de webhook y condiciones de producci?n: no desplegadas ni probadas en esta tarea.

Evidencias nuevas: output/checkout-local-activation/installation-results.json, installation.log, migration-status.log, backup.json, backup-restore-verification.json, final-worker-status.log, browser-uncertain.log y logs de pruebas. Capturas output/playwright/checkout-local-*.png. Las claves, cookies y archivos privados no deben adjuntarse ni publicarse.

Cambios de activaci?n: scripts/start-local.cjs y su prueba; nuevo payments/local-checkout-test.ts; common/config/local-review-safety.ts y prueba; estado operativo del conciliador, listado de reservas en stripe-webhook-recovery.service.ts y controlador; admin.html y assets/admin-orders.js; pruebas DOM y script de verificaci?n local; exclusiones privadas en .gitignore. Se conservan los cambios anteriores de checkout, usuarios, footer y compatibilidad m?vil.

Preservaci?n final: 116 archivos con cambios previos comprobados por SHA-256, ninguno ausente. Solo difieren el propio informe, checkout-reservation-cleanup.service.ts y admin.html por las ampliaciones descritas. Footer, compatibilidad m?vil y borrado de usuarios conservan su contenido previo. La sesi?n administrativa de prueba se cerr? y el endpoint de recuperaci?n rechaz? el acceso an?nimo con HTTP 401.

Comprobaci?n posterior a la activaci?n de usuarios: ambas migraciones siguen aplicadas con sus checksums originales. El borrado fue bloqueado por un checkout real reservado sin liberar su unidad; la salida expl?cita restaur? el stock. Pasaron los 16 grupos PostgreSQL de reservas con el cliente regenerado. No se repitieron pagos ni la espera Stripe de seis minutos. V?ase [eliminaci?n de usuarios](admin-user-deletion-2026-10-27.md#verificaci?n-de-la-activaci?n-habitual--27102026) para el detalle y la correcci?n de estado newsletter, que no requiere otra migraci?n.
