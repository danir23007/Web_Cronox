# Auditoría de comercio — 17 octubre 2026

Investigación únicamente. Fuentes actuales sobre HEAD `102a1b9111d91e8fb94a5b5bb91d71f3b0933d8f`, incluyendo los cambios de rendimiento pendientes del workspace. No se modificaron fuentes, tests existentes, configuración, dependencias ni migraciones. No se realizaron commits, despliegues, operaciones en producción ni escrituras en `cronox_dev`.

## Método y límites

- Base PostgreSQL desechable asignada por coordinación, clonada exclusivamente del esquema actual. Datos creados ficticios, correos `example.test`. El runner comprueba el nombre de la base antes de escribir.
- Servicios TS actuales mediante `ts-node`, Prisma real, restricciones, índices, triggers y transacciones reales. No se usó `dist` antiguo. Se inicializó únicamente la fila de coordinación `UserNumberingState` que necesita el esquema vacío.
- Firma de eventos ficticios mediante SDK Stripe y secreto ficticio. `StripeService.constructEventFromPayload` es real. Las solicitudes de reembolso son sustitutos inertes que registran intención y estado persistido, sin contacto con Stripe. Email y contraseña inicial son sustitutos sin envío.
- `installNetworkGuard()` antes de imports impide conexiones externas del proceso. Ningún cobro, reembolso, pedido, correo, cuenta o envío real. Las consultas externas adicionales fueron documentación pública oficial de Stripe y metadatos públicos de versión de su CLI; no se consultó ninguna cuenta Stripe.
- 13 escenarios diferentes con PostgreSQL: 9 principales y 4 ampliaciones. Todos completados. La concurrencia de alta manual se repitió una tercera vez para verificar recuperación posterior con la misma clave.
- 10 suites existentes, 161 pruebas unitarias/DOM, 0 fallos. JSDOM y dobles de API/proveedor no equivalen a un pago real ni a un navegador con iframe de Stripe/PayPal. No se ha ejercitado un pago externo ni se afirma disponibilidad de wallets en producción.
- El comando envolvente de PowerShell devolvió 1 y su log registró NativeCommandError sobre el stderr `PASS`. No se capturó por separado el exit code nativo de Jest; su informe final tiene `success: true`, 10 suites y 161 pruebas pasadas. El log contiene errores de consola esperados/simulados, incluido un stub de favoritos sin `json()` en la suite móvil; no son evidencia de un fallo real del backend.
- Dos errores iniciales del arnés (código de cupón ficticio no normalizado a mayúsculas y fecha POS sin hora) se corrigieron sólo en el artefacto de auditoría. La ejecución inicial se conserva separada y no se presenta como fallo de aplicación.

## Hallazgos

### COM-01 — Un fallo posterior al commit solicita reembolso de un pedido ya válido

**Estado:** confirmado con inyección focal y PostgreSQL real. **Severidad:** alta; pérdida de una venta ya persistida, cambio a devuelto y reposición de stock por un fallo transitorio posterior, sin que haya fallado la creación/fulfillment. No se ha emitido reembolso real.

**Actor y condición:** comprador normal cuyo PaymentIntent fue cobrado; la primera transacción local completa correctamente y falla la reconciliación o consulta posterior. No requiere manipulación del comprador. La prueba lanza sólo al iniciar la segunda transacción de OrdersService, no dentro de la que crea el pedido.

**Archivos:** `cronox-backend/src/orders/orders.service.ts:1215` (transacción), `:1437` (reconcile después del commit), `:1438` (lectura posterior), `cronox-backend/src/payments/stripe-webhook.controller.ts:235` (try/catch amplio), `:247` (compensación), `:251` (estado REFUNDED).

**Esperado:** conservar el pedido comprometido y permitir reintentar/reconciliar los pasos posteriores; compensar sólo cuando se haya establecido que no es posible cumplir el pago.

**Observado:** el stub de refund fue llamado cuando el pedido #6 ya existía con `status: PAID`; respuesta `{received:true, refunded:true}`; estado final `REFUNDED`; stock vuelve de 3 a 4. El evento queda procesado. La transacción de creación había conservado el precio y consumido reserva correctamente.

**Reproducción:** `node output/playwright/audit-20261017/commerce/probe-commerce.cjs`; escenario `post-commit database failure...`, evidencia `commerce-probes.json`. La instancia Prisma proxy conserva todos los modelos reales y falla exclusivamente la segunda llamada a `$transaction`.

**Causa:** se mezcla el fallo de creación/fulfillment con el fallo de reconciliación después del commit bajo una única compensación automática.

**Propuesta, sin implementar:** separar resultado comprometido y efectos posteriores; verificar resultado persistido por la referencia única antes de compensar y mantener reintento duradero cuando el resultado sea incierto. Riesgo: una separación incompleta podría dejar cobros realmente no cumplibles sin compensar; debe conservarse la compensación idempotente de invariantes realmente rotas.

**Prueba de corrección requerida:** fallar antes del commit, después del commit, durante la reconciliación y después de solicitar refund; repetir la entrega y hacer concurrir dos entregas. Sólo el fallo no cumplible debe solicitar refund; cada caso termina en un pedido o compensación coherente y sin doble stock.

### COM-02 — PROCESSING huérfano se confirma como duplicado sin recuperación duradera

**Estado:** confirmado en servicio/controller con eventos firmados y PostgreSQL real. **Severidad:** alta condicionada; un pago válido puede quedar sin pedido ni recuperación automática si una nueva entrega llega durante el lease huérfano.

**Actor y condición:** caída/interrupción del proceso después de persistir el claim del evento y antes de ejecutar su handler. Si una reentrega llega antes de los 5 minutos del lease, recibe respuesta de duplicado satisfactoria. No se afirma que todas las caídas ni todos los intervalos de reintento de Stripe produzcan el fallo.

**Archivos:** `cronox-backend/src/orders/orders.service.ts:1133` (claim), `:1163` (PROCESSING reciente no se reclama), `:1182` (devuelve booleano), `cronox-backend/src/payments/stripe-webhook.controller.ts:71` (`@HttpCode(200)`, también en alias `:86`), `:138` (duplicate), `cronox-backend/src/payments/checkout-reservation-cleanup.service.ts:59` (intenta cancelar), `:70` (catch sin recuperación de succeeded), `cronox-backend/src/orders/orders.service.ts:1809` (status consulta sólo persistencia).

**Esperado:** distinguir PROCESSED de PROCESSING; responder éxito sólo si la aplicación asume recuperación duradera, o devolver una respuesta reintentable mientras el procesamiento no esté garantizado.

**Observado:** tras claim real se omite el handler para representar el crash. Reentrega firmada devuelve `{received:true,duplicate:true}` mientras el ledger sigue `PROCESSING`, no hay pedido, y status devuelve `found:false,isProcessed:false`. Al caducar la reserva, cleanup intenta cancelar el PaymentIntent succeeded (stub de la negativa del proveedor), conserva `PAYMENT_BOUND` y no crea el pedido. Envejecer el lease por sí solo no ejecuta nada; una reentrega explícita después de envejecerlo sí crea el pedido. No hay worker de replay de StripeWebhookEvent en las referencias actuales de `src`. La sonda invoca el controller directamente: el HTTP 200 se deduce de su decorador, no se midió mediante una petición HTTP en este escenario.

**Fundamento del impacto:** Stripe documenta que devolver 200 para un evento ya procesado detiene posteriores reintentos. [Documentación oficial de recuperación](https://docs.stripe.com/events/manage-webhook-endpoints#process-undelivered-events). No se supone un intervalo exacto de reintento.

**Reproducción:** escenario `interrupted PROCESSING event...` en runner principal y `commerce-probes.json`. No se mató ningún servidor de usuario ni se alteró su reloj; se simularon los límites de ejecución y fechas sólo en la base desechable.

**Causa:** el booleano de claim une evento completo y evento aún en curso; el timeout del lease habilita una futura entrega pero no la programa ni conserva payload suficiente para ejecución autónoma del éxito.

**Propuesta, sin implementar:** recibo duradero/replay con payload validado y reclamación recuperable, o respuesta reintentable cuando otro intento aún no está completado. Riesgo: reprocesamiento concurrente si el lease se recupera sin conservar fencing/idempotencia de fulfillment. Deben mantenerse las claves únicas y reservas existentes.

**Prueba requerida:** caída en cada frontera, reentregas a <5 min y >5 min, concurrencia, evento PROCESSED repetido, terminales desordenados; todos los pagos deben terminar sin depender de otra visita del comprador o de intervención manual.

### COM-03 — Checkout combina productos de distintas monedas bajo la primera

**Estado:** confirmado; requiere catálogo configurado con varias monedas. **Severidad:** media condicionada; importe/moneda incorrectos para líneas posteriores. No se afirma que el catálogo actual tenga productos USD.

**Actor y condición:** administrador configura productos en monedas distintas (DTO lo permite) y un comprador los añade a la misma cesta. El comprador no envía precios arbitrarios ni modifica la configuración.

**Archivos:** `cronox-backend/src/products/dto/create-product.dto.ts:74` (currency sólo String/max3), `cronox-backend/src/products/product.service.ts:1289`, `:1449`, `cronox-backend/src/orders/orders.service.ts:2983` (no comprueba moneda por línea), `:3049` (usa primera moneda), `:3026` (suma céntimos), `cronox-backend/src/cart/cart.service.ts:144` (adición admite ambas).

**Esperado:** si la tienda opera sólo en EUR, validar esa restricción al configurar y comprar; si acepta varias monedas, rechazar cesta mixta o aplicar una política explícita con conversión fiable.

**Observado:** producto EUR 1000 + producto USD 1000 se acepta, reserva dos líneas y crea snapshot EUR subtotal2000 + envío500 = total2500. No se aplicó cambio ni se rechazó la combinación. El caso inverso dependería de qué línea aparezca primero.

**Repro/evidencia:** escenario `mixed product currencies...`, `commerce-probes.json`.

**Causa/propuesta:** falta de invariante de moneda homogénea; validar en límites de administración y checkout. Riesgo: productos antiguos no EUR podrían dejar de estar disponibles; revisar catálogo y definir la regla antes de cambiarla. Prueba: EUR único, otra moneda soportada única, mezcla en ambos órdenes y edición de moneda con cesta existente.

### COM-04 — Reintento simultáneo de alta manual puede devolver error técnico tras guardar

**Estado:** confirmado repetidamente con concurrencia PostgreSQL. **Severidad:** media de fiabilidad; respuesta ambigua para el operador pese a una compra guardada. No se observó duplicación de pedido, importe o descuento de stock.

**Actor y condición:** dos solicitudes simultáneas con la misma clave/payload del mismo administrador, por reintento de transporte o clientes simultáneos. El formulario actual impide doble clic local, por lo que no se atribuye al doble clic de una única pestaña normal.

**Archivos:** `cronox-backend/src/admin/manual-purchases/admin-manual-purchases.service.ts:135` (consulta fuera de tx), `:142` (tx Serializable), `:166` (conflicto de stock), `:251` (sólo trata P2002); `cronox-backend/src/common/filters/database-availability.filter.ts:22` (P2034 no se traduce); `cronox-front/src/admin/admin-user.ts:569` (guard local).

**Esperado:** ambos reintentos del mismo alta reciben la compra existente o una indicación de conflicto recuperable, sin un error interno genérico.

**Observado:** una solicitud crea, la otra rechaza con `P2034` (write conflict/deadlock); queda exactamente 1 pedido y stock 4→3. El siguiente reintento idéntico devuelve `created:false` con el mismo pedido. La respuesta HTTP 500 se deduce del filtro/base Nest; no se afirma haber medido esta ruta HTTP real. El P2034 apareció en las dos primeras ejecuciones; en la tercera, ambas llamadas terminaron correctamente (created true/false) y el replay posterior devolvió false. El error depende del intercalado y no ocurre en todas las carreras.

**Repro/evidencia:** escenario `manual same-key concurrent create...`; `commerce-probes.json` y repetición focal `manual-race-retry.json` mediante `--manual-race`.

**Propuesta/riesgo:** serializar la clave antes de leer o recuperar/reintentar P2034 de manera acotada, devolviendo el recibo comprometido si coincide. No reintentar efectos externos ni aceptar payload distinto. Prueba: misma clave/payload concurrente, clave igual/payload distinto, última unidad de dos compras diferentes y fallo después de commit.

### COM-05 — Hash de alta manual omite excludedFromStatistics

**Estado:** confirmado. **Severidad:** baja; defecto de contrato de idempotencia, mitigado en el formulario actual porque éste genera otra clave al cambiar cualquier payload.

**Actor y condición:** cliente administrador reutiliza clave con exactamente los mismos campos salvo `excludedFromStatistics`. No es un bypass de permisos: las rutas exigen SUPERADMIN.

**Archivos:** `cronox-backend/src/admin/manual-purchases/admin-manual-purchases.service.ts:123` (normalización/hash), `:186` (campo guardado), `:289` (resolveReplay); `cronox-front/src/admin/admin-user.ts:549` (mitigación UI).

**Esperado:** rechazar reutilización con payload distinto con409, igual que para cantidad/precio y que en el editor.

**Observado:** primera alta con false; reintento misma key con true responde `created:false`, mismo pedido y flag false. No se crea ni se cambia nada, pero se acepta silenciosamente una petición cuyo contenido difiere.

**Repro/evidencia:** escenario `manual idempotency hash omits statistics flag`, `commerce-probes.json`.

**Propuesta/riesgo:** incluir el flag normalizado en la identidad del payload, manteniendo compatibilidad explícita para claves históricas existentes. Prueba: flag omitido/false equivalentes si ésa es la regla; true distinto; replay de recibos previos sin duplicar.

## Comprobaciones satisfactorias con datos reales aislados

| Área | Evidencia actual |
|---|---|
| Firma | Firma incorrecta rechazada sin crear ledger ni pedido. |
| Autoridad de importes | `priceAtAdd=1` no cambia subtotal6500; descuento100 reduce mercancía a6400 y vuelve a cobrar envío500, total6900. |
| Pago verificado | Cantidad cobrada, moneda y referencia PI que no coinciden con snapshot se rechazan. |
| Última unidad | Dos reservas concurrentes: una ganadora; reintento de su dueño reutiliza snapshot. |
| Fulfillment | Dos ejecuciones concurrentes producen un solo pedido. |
| Devolución completa | Reconciliaciones concurrentes y éxito tardío no duplican reposición ni reviven REFUNDED. |
| Devolución parcial | Cumulativos500/1000 entregados desordenados y repetidos resultan neto4500 sobre pago5500. Estado PAID y stock consumido hasta devolución completa. Final neto0 y una sola reposición. |
| Cambios de cesta durante pago | Añadir otra unidad mientras se paga1 conserva la unidad adicional y subtotal2500 después de webhook repetido. |
| Exclusión de estadísticas | Compra manual8750 excluida no aparece en finanzas generales, pero gasto personal8750. Regla deliberada conservada. |
| Edición manual histórica | Cambiar coste actual500→2000 y editar dos unidades conserva coste histórico total1000 y facturación8800. |
| Anulación manual | Dos llamadas void reponen una vez; gasto personal0. |
| POS | Alta/replay único, devolución parcial con reposición y comisión recuperada: ingreso2500, coste500, comisión250, beneficio1750, stock10→8→9. |
| Límites manuales | Precios negativos, fraccionarios y superiores al máximo se rechazan sin pedido ni stock. |

## Cobertura de lectura y pruebas existentes

Lectura de CartService, OrdersService (snapshots, precios, promo, reservas, ownership, fulfillment, lifecycle, historial, limpieza de cesta), PaymentIntentFactory (creación/reutilización/recovery), StripeService (firma, idempotencia de creación/refund/cancelación y flujo bancario), StripeWebhookController, cleanup, GuestOrderAccountService, controladores de checkout/order/manual/finance, AdminManualPurchasesService, ManualPurchaseEditor, AdminPointsService, cálculos y lectura de finanzas, user-purchase-metrics y DTOs relevantes. Revisión focal de guards/rutas y formulario manual; la auditoría de autenticación/permisos la realiza el agente responsable.

Las pruebas existentes ejecutadas cubren Express/PayPal (exclusión mutua de confirmaciones y recuperación tras cancelación), transferencia pendiente, quick add con disponibilidad y stock, mobile cart, recomendaciones, transacciones de cesta y webhooks. Son dobles de proveedor/red. No se etiqueta como defecto que existan varios CTA PayPal si comparten la exclusión mutua y sirven flujos distintos; la suite actual pasa.

La protección de firmas y los casos anteriores no demuestran toda la configuración desplegada: quedan fuera de esta ejecución la configuración externa de webhooks/Stripe, métodos de pago habilitados, respuesta real de PayPal, cobros/reembolsos reales, colas de correo y Correos. Tampoco se realizó una nueva navegación completa de compra en navegador en este bloque; las capturas del trabajo anterior no se usan como prueba actual.

## Observaciones pendientes compartidas, no duplicadas como hallazgos

- Seguridad investiga reclamación de cuenta passwordless `registrationClaimable=true`. Comercio confirmó estáticamente que `GuestOrderAccountService:41–47` reutiliza usuario por email sin cambiar la marca/password; OrdersService enlaza el pedido. El agente de seguridad posee la reproducción y el hallazgo consolidado.
- `cronox-front/src/admin/admin-user.ts:578–586` captura con el mismo mensaje un fallo de POST y un fallo de recargas posteriores, después de limpiar el formulario. Reproducción UX delegada al agente de interfaz; no se cuenta aquí como confirmada en navegador.
- No se señala como error la facturación `null` cuando un reembolso parcial no tiene reparto fiable entre varios productos/envío: evita inventar un reparto; el gasto personal usa el total efectivamente pagado menos el reembolso acumulado.

## Artefactos / comandos

- `node output/playwright/audit-20261017/commerce/probe-commerce.cjs`
- `node output/playwright/audit-20261017/commerce/probe-commerce.cjs --extension`
- `node output/playwright/audit-20261017/commerce/probe-commerce.cjs --manual-race`
- `node output/playwright/audit-20261017/commerce/run-commerce-regressions.cjs`
- `commerce-probes.json`, `commerce-probes-extension.json`, `manual-race-retry.json`: resultados DB reales aislados.
- `commerce-regressions.json`, `commerce-regressions.log`: 161/161 pruebas existentes.
- `commerce-probes-initial-fixture-errors.json`: primera ejecución con dos errores del arnés, conservada por trazabilidad.

No quedan servidores ni procesos de navegador creados por este bloque. Al cerrar la auditoría consolidada se eliminó la base desechable junto con las otras tres bases de prueba, mediante la lista exacta validada; se preservó la base habitual. Evidencia: `output/playwright/audit-20261017/database-cleanup.json` e `integrity-after.json`. Para repetir los comandos anteriores debe recrearse previamente el entorno aislado y sus fixtures.

## Resolución posterior — fase de corrección local

El texto anterior conserva el diagnóstico. COM-01 a COM-05 están implementados y verificados localmente en la fase posterior; no se han publicado. El [informe principal, sección 11](audit-cronox-2026-10-17.md#11-fase-de-corrección-local--17102026) contiene la tabla de los 18 puntos y los límites conjuntos.

- **COM-01/02:** payload verificado persistente, leases con comprobación transaccional, recuperación tras reinicio y recibos auxiliares independientes del éxito comercial. Una excepción postcommit ya no implica refund. Seis caídas de procesos reales se recuperan desde procesos nuevos; también se prueba desconexión HTTP real tras commit, duplicados/concurrencia/desorden y SMTP incierto. Este último queda en revisión sin reenvío automático. La prueba HTTP de pérdida usa un adaptador de prueba que llama al controlador, no se presenta como cierre de socket del bootstrap Nest de producción.
- **COM-03:** cesta multimoneda rechazada antes de crear pago/snapshot; una moneda admitida mantiene su flujo. No se impuso exclusividad EUR.
- **COM-04/05:** reintento serializable acotado de compra manual con lectura del recibo, y hash que incluye la exclusión estadística. Los hashes antiguos se verifican contra la auditoría inicial, sin confundir cambios posteriores con la petición original.
- **Hallazgo relacionado adicional:** un pedido creado en DISPUTED y luego restituido a PAID perdía el aviso administrativo porque el trigger exigía `OLD.paidAt IS NULL`. La función ahora detecta la transición de estado y conserva la clave única del outbox. PostgreSQL reproduce cero avisos antes y uno después; nuevas disputas, restituciones y reembolso no duplican ni resucitan la compra reembolsada. No se emitió push externo.

Evidencia: [comercio corregido](../output/playwright/audit-fixes-20261017/commerce/README.md) y [compras manuales/dominio](../output/playwright/audit-fixes-20261017/domain/README.md). Tres fallos esperados en referencia anterior; 15 escenarios de recuperación y dos de ciclo de vida pasan con PostgreSQL real. Trece suites focales y 184 tests pasan después de los últimos ajustes. Transportes y eventos del proveedor son ficticios; no hubo pagos/reembolsos/correos reales ni validación sandbox en esta fase.

Se preservan reembolsos/disputas legítimos y la devolución única de stock. Una contradicción no cumplible pasa a revisión explícita: el operador contrasta pago/pedido/reservas y decide reparación o compensación legítima en Stripe. El endpoint de resolución sólo cierra después de acreditar un reembolso completo firmado y conciliado; no llama al proveedor ni fabrica pedidos. Este cambio operativo y los históricos sin payload requieren el [procedimiento de recuperación](stripe-webhook-recovery.md), supervisión y la migración `20261017160000_recover_stripe_webhooks`, probada con su SQL final exclusivamente en la base ficticia de comercio.

La sospecha de que una recarga fallida del panel repitiese el POST manual se refutó: el reintento ejecuta GET, no otra venta. El borrado del banner de éxito durante una recarga fallida queda como mejora de mensaje opcional; no se cambió ese frontend.
