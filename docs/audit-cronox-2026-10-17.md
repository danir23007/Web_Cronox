# Auditoría de CRONOX — 17 de octubre de 2026

**Fase: investigación y diagnóstico. No se han aplicado correcciones funcionales.**

Los problemas prioritarios son la reclamación de determinadas cuentas sin acreditar el correo y dos fallos de recuperación de pagos: compensar un pedido que ya se ha guardado y reconocer como duplicado un webhook cuyo procesamiento quedó interrumpido. Se han reproducido con datos ficticios. No se han realizado cobros, devoluciones, envíos ni comunicaciones reales.

Este informe distingue ejecución real de código/SQL local, respuestas externas simuladas, lectura estática y comprobaciones pendientes. «Confirmado» describe el caso y las condiciones indicadas; no significa que se haya observado una incidencia en producción. No hay evidencia de explotación real ni se ha cuantificado a clientes afectados.

## 1. Estado y preservación del trabajo

- Referencia: `main`, HEAD `102a1b9111d91e8fb94a5b5bb91d71f3b0933d8f`, más los cambios de rendimiento que ya estaban pendientes. `git ls-remote origin refs/heads/main` devolvió ese mismo SHA durante esta auditoría.
- Producción se consultó únicamente con GET normales a portada, health, ready y tres assets conocidos, el 17/10 a las **09:40 CEST**. Los tres JS publicados coincidían byte a byte con HEAD y con el último commit de aplicación `5e5e1e7fd761e71ddef84e1aaeef70f454d849b6`; diferían del trabajo local de rendimiento. La portada publicaba `app.js?v=94`; local usa la versión siguiente. Health y ready respondieron 200. Esto verifica esos recursos, **no certifica el SHA del proceso backend, sus variables o su esquema de producción**.
- La base habitual `cronox_dev` se inspeccionó con una transacción `READ ONLY`: 95 migraciones en disco y 95 terminadas, ninguna pendiente/fallida/desconocida; 289 restricciones. Cero variantes con stock negativo, pedidos con total negativo o usuarios con círculo fuera de 1–5. Son comprobaciones acotadas, no una conciliación de todos los datos reales.
- Se clonó sólo el esquema local a cuatro bases `cronox_audit_20261017_*_04c4a5`, sin copiar clientes ni aplicar migraciones. Las pruebas inicializaron metadatos y datos ficticios necesarios. Se usaron puertos propios 3002 y 3005, separados de la web habitual en 3000.
- Correo y trabajos externos desactivados, claves ficticias, `.env` de auditoría vacío y guardia de red que rechaza conexiones fuera de loopback. En el navegador se bloqueó cualquier otro origen y se configuró el override de API existente para el puerto aislado. Los fallos causados por ese bloqueo no se atribuyen a producción.
- Los fuentes, tests previos, dependencias, migraciones, imágenes y configuraciones anteriores se preservan. La comprobación final de hashes figura al final. Sólo se añaden este diagnóstico, anexos y artefactos de auditoría ignorados por Git. Sin commit, push ni despliegue.

Evidencias: `output/playwright/audit-20261017/{integrity-before.json,published-check.json,schema-review.json,environment-manifest.json}`. La metadata incremental del backend compilado coincide por hash con sus 359 archivos fuente: `compiled-source-check.json`; esta comprobación no sustituye las pruebas de comportamiento.

## 2. Mapa y cobertura

El [mapa detallado](audit-cronox-2026-10-17-mapa.md) enumera 30 entradas HTML, 62 archivos de controladores, 333 declaraciones de métodos HTTP y 14 archivos con temporizadores. Las declaraciones no equivalen a 333 rutas únicas: hay prefijos múltiples, alias y un GET `/api/me` solapado. Se contrastó el inventario con el arranque de Nest.

| Superficie | Recorrido y componentes | Revisión realizada |
|---|---|---|
| Web pública | `/`, `/tienda`, `/producto/:slug`, categorías, búsqueda, galería, favoritos, footer y páginas legales | Navegador, red, consola, enlaces, DTOs y consultas. Catálogo y fotos de prueba locales; no se juzga el encuadre del producto ficticio como diseño real. |
| Compra | Cesta → resumen/portes/cupón → snapshot/reserva → PaymentIntent → webhook → pedido/finanzas/stock | Servicios y PostgreSQL reales; firma local; proveedor, correo y fallos sustituidos de forma explícita. Navegador hasta checkout y estados de error. |
| Cuenta | Registro/login/refresh/logout, recuperación, enlaces de acceso, perfil/direcciones/pedidos | HTTP y navegador en aislamiento, revisión de JWT/sesiones/ACL/DTOs y pruebas focales. Sin entrega de correo real. |
| Círculos e identidad | Promociones I→II y II→III; revisión III→IV; UUID, número visible, acreditación y QR | SQL/servicios reales, concurrencia, respuestas HTTP y previews de libro/META con fixtures. |
| Administración | Home, productos/categorías/stock, usuarios, pedidos, círculos, POS, dinero, mapa, favoritos, códigos, eventos QR, multimedia, footer | 22 secciones recorridas con SUPERADMIN, acceso inicial como ADMIN, matriz HTTP USER/ADMIN/SUPERADMIN; tests de edición/anulación/estadísticas. No se simula una visita al panel como prueba de cada mutación existente. |
| Comunicaciones | Newsletter, bienvenida, waitlist, plantillas, buzones/campañas, outbox, cuotas, push | Concurrencia y fallos locales; validadores reales; revisión de leases, reintentos, permisos y configuración. IMAP/SMTP/push externos no ejecutados. |
| Logística | Correos, tracking, notificaciones, etiquetas PDF privadas | Lectura de ciclo/revisión/lease y controles HTTP/validadores. Sin crear envíos, consultar tracking real ni descargar etiquetas de clientes. |
| Infraestructura | Nest/Express, Prisma/PostgreSQL, Supabase Storage, Stripe, jobs, cachés, build y Git | Esquema local en lectura; comparación de assets publicados; avisos actuales de dependencias; escaneo redactado de fuentes e historial. VPS, RLS/buckets y configuración externa quedan sin comprobar en vivo. |

Arquitectura: frontend HTML/JS público y panel TypeScript compilado con Vite; backend Nest/Express; Prisma sobre PostgreSQL; autenticación propia con JWT y `AuthSession` (no Supabase Auth); Supabase para almacenamiento; Stripe para pagos, incluida la vía PayPal; correo transaccional/colas y cliente IMAP/SMTP separados; Correos y almacenamiento privado de etiquetas.

## 3. Hallazgos de seguridad

### SEC-01 — Se puede reclamar una cuenta sin contraseña que ya tiene compras

**Categoría:** seguridad. **Gravedad:** alta, por acceso a una identidad y su historial sin acreditar titularidad. **Estado:** confirmado mediante HTTP y PostgreSQL reales con datos ficticios. **Entorno/versión:** backend local compilado de la revisión indicada; el camino también se comprobó en los fuentes actuales. No probado contra clientes reales.

**Afecta:** `POST /api/auth/register`; `newsletter/newsletter-user.ts:14`; `users/account-state.ts:11`; `auth/auth.service.ts:80`; `users/users.service.ts:174`; `orders/guest-order-account.service.ts:36`; `orders/orders.service.ts:1286`.

**Esperado/observado:** completar credenciales de una cuenta existente con historial debe acreditar su titularidad. Una cuenta ACTIVE USER/FRIEND, `password=null` y `registrationClaimable=true`, acepta nombre/email/contraseña nueva, crea sesión y conserva el ID. El resolver de comprador invitado puede asociar pedidos a ese mismo usuario por email sin retirar la marca.

**Reproducción/evidencia:** se creó una cuenta reclamable y un pedido PAID ficticio con dirección ficticia, sin proveedor. Registro normal con el mismo email y sin token de verificación → 201, mismo ID, contraseña establecida; `/api/me/orders` → 200 y el pedido previo. Otro usuario devolvió una lista vacía y recibió 403 al pedir ese pedido por ID. El control de propiedad del pedido funciona; el fallo está en adquirir la cuenta. `account-regression-result.json` y `account-regression-second.cjs`. La creación de la cuenta/pedido es fixture; la asociación desde checkout invitado está corroborada en código, no se efectuó otro pago para demostrarla.

**Actor/condición:** visitante que conoce el correo de una cuenta con esas marcas. No afecta por este camino a cuentas con contraseña, inactivas, administradores ni invitados no reclamables. No se sabe cuántas cuentas de producción reúnen las condiciones.

**Causa/propuesta:** la marca técnica de reclamación se acepta como autorización suficiente. Exigir token de setup de un solo uso o sesión verificada para completar una cuenta existente; conservar registro nuevo y compra invitada. Revisar la política de cuentas existentes sin abrir automáticamente invitados/administradores. Coordinar con DOM-02: restaurar `registrationClaimable=true` indiscriminadamente reintroduciría el riesgo.

**Riesgo y validación:** evitar bloquear el acceso legítimo newsletter→registro. Probar reclamación sin prueba, token legítimo/caducado/usado, registro concurrente, compra invitada, bienvenida única y conservación del historial. Migración sólo si se añade un modelo de token o se decide una reclasificación de datos; no se ha preparado ni aplicado.

### SEC-02 — El guard CSRF omite variantes de mayúsculas que el router acepta

**Categoría:** seguridad. **Gravedad:** media; inconsistencia confirmada en un control preventivo, con impacto de navegador todavía acotado. **Estado:** confirmado en Nest/Express aislado con guard real; pendiente el efecto de una operación autenticada real en navegador aislado. **Entorno/versión:** controlador temporal de prueba, dependencias y guard actuales, sin DB.

**Afecta:** `common/guards/csrf-protection.guard.ts:60`, especialmente el prefijo literal de `originalUrl`; `main.ts` no activa routing sensible a mayúsculas. Express instalado construye un router insensible por defecto.

**Esperado/observado:** rutas equivalentes deben exigir el mismo origen/token. Ocho casos: `/api/auth/login` con origen ajeno y sin CSRF → 403; `/API/auth/login` y `/Api/Auth/Login` → handler temporal alcanzado (201). `/api/AUTH/LOGIN` sigue protegido. Origen permitido sin token falla en minúsculas; origen permitido con cookie/header correctos pasa. Evidencia `security/csrf-case-isolated.json` y su arnés. No se ejecutó un login real ni se cambió una sesión real con esta técnica.

**Actor/condición/impacto:** quien pueda provocar la variante de URL evita ese guard. SameSite=Lax limita el envío de cookies en acciones autenticadas cross-site; Secure y HttpOnly protegen transporte y acceso desde JavaScript, pero por sí solos no impiden CSRF. El caso de login y los orígenes same-site necesitan verificación aparte. No se presenta esta omisión como una toma de cuenta demostrada.

**Causa/propuesta:** interpretación distinta de la ruta entre guard y router. Aplicar la protección por metadatos/ruta registrada o normalización coherente, preservando únicamente excepciones explícitas de webhooks firmados. Endurecer el router exige revisar compatibilidad.

**Validación/riesgo:** matriz de mayúsculas, barras finales, rutas/alias de webhook, origen y tokens; comprobar formularios legítimos y semántica real de cookies. Sin migración. No ampliar exclusiones por coincidencias parciales.

### SEC-03 — Un enlace de acceso previo sigue válido tras cambiar la contraseña

**Categoría:** seguridad. **Gravedad:** media; permite recuperar acceso a quien ya posea un enlace vigente. **Estado:** confirmado por HTTP para newsletter tras cambio de contraseña; reset y enlace de lanzamiento corroborados estáticamente, sin repetir su consumo. **Entorno:** DB y app aisladas actuales.

**Afecta:** `auth/auth.service.ts:147` y `:512`/`:531`; `POST /api/auth/change-password`, `newsletter-login`, reset y consumo de enlace de lanzamiento.

**Esperado/observado:** revocar capacidades anteriores de acceso al sustituir credenciales. Se preparó un ACCESS ficticio SENT válido durante 20 minutos, se cambió la contraseña (201), y una sesión nueva consumió el enlace anterior (200) y accedió a `/api/me` (200). Segundo consumo → 401: la protección de uso único sí funciona. No se envió el enlace por correo. Evidencia `account-regression-result.json`.

**Actor/condición:** posesión previa de un enlace no usado ni caducado; conocer el email no basta. Los consumidores verifican cuenta/rol/estado, pero emiten una sesión con la versión actual. El cambio/reset incrementa `sessionVersion` sin invalidar esas familias de enlaces; el cambio de email sí las revoca.

**Propuesta/riesgo/validación:** revocar o versionar los enlaces al cambiar/restablecer contraseña y mantener consumo atómico. Los enlaces legítimos pendientes dejarán de servir: explicar cómo solicitar otro. Probar cambio, reset, email change, desactivación, caducidad, doble consumo y concurrencia. Puede resolverse con campos existentes; migración sólo si se opta por versionar capacidades.

### SEC-04 — El historial Git conserva credenciales antiguas

**Categoría:** seguridad/mantenimiento. **Gravedad:** media provisional: exposición histórica confirmada, validez remota desconocida. **Estado:** confirmado el contenido recuperable; pendiente comprobar revocación fuera de esta auditoría. **Entorno:** objetos Git locales alcanzables con `--all`.

**Afecta:** cuatro versiones históricas de `cronox-backend/.env`, anteriores a su retirada en `7bb3d76` del 04/11/2025; contienen contraseña de conexión PostgreSQL y, en algunas, `JWT_SECRET`. No se reproducen valores en este informe ni se intentó autenticar con ellos.

**Esperado/observado:** ignorar/borrar `.env` del árbol actual no elimina objetos ya publicados. Se revisaron 8.691 objetos candidatos de texto; 36 coincidencias de patrones se clasificaron. Las coincidencias actuales resultaron ejemplos/tests o datos de prueba de una dependencia. Las históricas de `.env` contienen valores que no parecen marcadores; no coinciden con las variables equivalentes de la configuración local actual. Esa diferencia no demuestra revocación en todos los entornos.

**Actor/impacto/causa:** acceso a una copia con ese historial; impacto de acceso a DB o firma de JWT sólo si las credenciales siguen aceptándose en algún sistema. El secreto antiguo `JWT_SECRET` tampoco es el contrato actual de access/refresh. Evidencia redactada: `secret-history-review.json`, fechas/commits/huellas sin valores.

**Propuesta/riesgo/validación:** verificar administrativamente su revocación, rotar donde aún existan y evaluar saneamiento coordinado del historial. Primero revocar; reescribir Git no invalida secretos y afecta clones/ramas. Necesita intervención externa si algún proveedor sigue aceptándolos. No cambiar historial ni secretos como parte de esta fase.

## 4. Compras, pagos y stock

Los siguientes hallazgos se verificaron con los servicios TypeScript actuales y PostgreSQL real aislado. Stripe, reembolso, email y errores de red se sustituyeron explícitamente; ninguna devolución real fue enviada. Las firmas de los eventos de prueba se calcularon localmente y se validaron con el servicio real. El [anexo técnico de comercio](audit-cronox-2026-10-17-comercio.md) contiene escenarios, comandos y controles completos.

### COM-01 — Un fallo posterior al commit solicita reembolso de un pedido ya válido

**Categoría:** funcionalidad/datos. **Entorno/versión:** servicios TS actuales sobre HEAD 102a1b9 más cambios locales previos, PostgreSQL desechable; proveedor simulado.

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

**Categoría:** funcionalidad/datos. **Entorno/versión:** servicios TS actuales sobre HEAD 102a1b9 más cambios locales previos, PostgreSQL desechable; proveedor simulado.

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

**Categoría:** funcionalidad/datos. **Entorno/versión:** servicios TS actuales sobre HEAD 102a1b9 más cambios locales previos, PostgreSQL desechable; proveedor simulado.

**Estado:** confirmado; requiere catálogo configurado con varias monedas. **Severidad:** media condicionada; importe/moneda incorrectos para líneas posteriores. No se afirma que el catálogo actual tenga productos USD.

**Actor y condición:** administrador configura productos en monedas distintas (DTO lo permite) y un comprador los añade a la misma cesta. El comprador no envía precios arbitrarios ni modifica la configuración.

**Archivos:** `cronox-backend/src/products/dto/create-product.dto.ts:74` (currency sólo String/max3), `cronox-backend/src/products/product.service.ts:1289`, `:1449`, `cronox-backend/src/orders/orders.service.ts:2983` (no comprueba moneda por línea), `:3049` (usa primera moneda), `:3026` (suma céntimos), `cronox-backend/src/cart/cart.service.ts:144` (adición admite ambas).

**Esperado:** si la tienda opera sólo en EUR, validar esa restricción al configurar y comprar; si acepta varias monedas, rechazar cesta mixta o aplicar una política explícita con conversión fiable.

**Observado:** producto EUR 1000 + producto USD 1000 se acepta, reserva dos líneas y crea snapshot EUR subtotal2000 + envío500 = total2500. No se aplicó cambio ni se rechazó la combinación. El caso inverso dependería de qué línea aparezca primero.

**Repro/evidencia:** escenario `mixed product currencies...`, `commerce-probes.json`.

**Causa/propuesta:** falta de invariante de moneda homogénea; validar en límites de administración y checkout. Riesgo: productos antiguos no EUR podrían dejar de estar disponibles; revisar catálogo y definir la regla antes de cambiarla. Prueba: EUR único, otra moneda soportada única, mezcla en ambos órdenes y edición de moneda con cesta existente.

### COM-04 — Reintento simultáneo de alta manual puede devolver error técnico tras guardar

**Categoría:** funcionalidad/datos. **Entorno/versión:** servicios TS actuales sobre HEAD 102a1b9 más cambios locales previos, PostgreSQL desechable; proveedor simulado.

**Estado:** confirmado repetidamente con concurrencia PostgreSQL. **Severidad:** media de fiabilidad; respuesta ambigua para el operador pese a una compra guardada. No se observó duplicación de pedido, importe o descuento de stock.

**Actor y condición:** dos solicitudes simultáneas con la misma clave/payload del mismo administrador, por reintento de transporte o clientes simultáneos. El formulario actual impide doble clic local, por lo que no se atribuye al doble clic de una única pestaña normal.

**Archivos:** `cronox-backend/src/admin/manual-purchases/admin-manual-purchases.service.ts:135` (consulta fuera de tx), `:142` (tx Serializable), `:166` (conflicto de stock), `:251` (sólo trata P2002); `cronox-backend/src/common/filters/database-availability.filter.ts:22` (P2034 no se traduce); `cronox-front/src/admin/admin-user.ts:569` (guard local).

**Esperado:** ambos reintentos del mismo alta reciben la compra existente o una indicación de conflicto recuperable, sin un error interno genérico.

**Observado:** una solicitud crea, la otra rechaza con `P2034` (write conflict/deadlock); queda exactamente 1 pedido y stock 4→3. El siguiente reintento idéntico devuelve `created:false` con el mismo pedido. La respuesta HTTP 500 se deduce del filtro/base Nest; no se afirma haber medido esta ruta HTTP real. El P2034 apareció en las dos primeras ejecuciones; en la tercera, ambas llamadas terminaron correctamente (created true/false) y el replay posterior devolvió false. El error depende del intercalado y no ocurre en todas las carreras.

**Repro/evidencia:** escenario `manual same-key concurrent create...`; `commerce-probes.json` y repetición focal `manual-race-retry.json` mediante `--manual-race`.

**Propuesta/riesgo:** serializar la clave antes de leer o recuperar/reintentar P2034 de manera acotada, devolviendo el recibo comprometido si coincide. No reintentar efectos externos ni aceptar payload distinto. Prueba: misma clave/payload concurrente, clave igual/payload distinto, última unidad de dos compras diferentes y fallo después de commit.

### COM-05 — Hash de alta manual omite excludedFromStatistics

**Categoría:** funcionalidad/datos. **Entorno/versión:** servicios TS actuales sobre HEAD 102a1b9 más cambios locales previos, PostgreSQL desechable; proveedor simulado.

**Estado:** confirmado. **Severidad:** baja; defecto de contrato de idempotencia, mitigado en el formulario actual porque éste genera otra clave al cambiar cualquier payload.

**Actor y condición:** cliente administrador reutiliza clave con exactamente los mismos campos salvo `excludedFromStatistics`. No es un bypass de permisos: las rutas exigen SUPERADMIN.

**Archivos:** `cronox-backend/src/admin/manual-purchases/admin-manual-purchases.service.ts:123` (normalización/hash), `:186` (campo guardado), `:289` (resolveReplay); `cronox-front/src/admin/admin-user.ts:549` (mitigación UI).

**Esperado:** rechazar reutilización con payload distinto con409, igual que para cantidad/precio y que en el editor.

**Observado:** primera alta con false; reintento misma key con true responde `created:false`, mismo pedido y flag false. No se crea ni se cambia nada, pero se acepta silenciosamente una petición cuyo contenido difiere.

**Repro/evidencia:** escenario `manual idempotency hash omits statistics flag`, `commerce-probes.json`.

**Propuesta/riesgo:** incluir el flag normalizado en la identidad del payload, manteniendo compatibilidad explícita para claves históricas existentes. Prueba: flag omitido/false equivalentes si ésa es la regla; true distinto; replay de recibos previos sin duplicar.



## 5. Círculos, comunicaciones y recuperación

Los cuatro casos siguientes usan servicios TS actuales, PostgreSQL aislado y los mismos fuentes/HEAD identificados arriba. Las barreras de concurrencia sólo ordenan consultas reales; SMTP se sustituye explícitamente. No son observaciones de producción.

### DOM-01 — Revisiones simultáneas de ascenso no se excluyen ni revalidan

**Categoría:** funcionalidad/datos. **Gravedad: media. Estado: confirmado.** Requiere dos revisiones administrativas concurrentes; no se ha demostrado una escalada de privilegios de un cliente ni efecto sobre un cobro. Puede dejar pertenencia y decisión incoherentes o saltarse la regla de exclusividad de identidad social.

**Ubicación:** `cronox-backend/src/membership/circle-upgrade.service.ts:55` (`findRequestForReview`), `:521` (`approveRequest`), `:529`, `:534`, `:554`, `:566`, `:611` (`denyRequest`), `:619`, `:625`; `cronox-backend/prisma/schema.prisma:1265` y `:1289`. Lo utilizan las rutas de revisión nuevas y legacy.

**Esperado:** una revisión debe ganar y la otra detectar que la solicitud ya cambió. La comprobación de usuario social aprobado para otro miembro debe permanecer verdadera hasta completar la aprobación.

**Observado, dos manifestaciones de la misma causa:**

1. Ambos revisores leen PENDING. Se completa approve; después deny escribe basándose en su lectura anterior. Ambas promesas se resuelven con éxito. Estado final: solicitud **DENIED**, usuario **círculo IV**, **dos** registros de auditoría.
2. Dos solicitudes de miembros distintos con el mismo Instagram normalizado comprueban simultáneamente que no hay otro aprobado; ambas terminan **APPROVED**. Persisten dos aprobaciones de la identidad social que el código prohíbe compartir.

**Reproducción:** `node output/playwright/audit-20261017/domain/domain-probes.cjs`, bloques `DOMAIN-RACE-REVIEW` y `DOMAIN-RACE-SOCIAL`. [Resultado](../output/playwright/audit-20261017/domain/domain-probes-result.json). PostgreSQL y servicios reales; intercalado determinista mediante barreras después de lecturas reales. No son dos duplicados de un mismo hallazgo.

**Causa demostrada:** transacciones por defecto, lectura y `assertPending` sin bloqueo/CAS; actualizaciones posteriores incondicionales por id. La exclusividad social se comprueba con `findFirst`; existe índice de búsqueda, no una restricción única que proteja las aprobaciones concurrentes.

**Propuesta pendiente:** serializar revisión de la solicitud y revalidar su estado al escribir; proteger también la clave `(red social, username normalizado)` entre usuarios (lock transaccional estable o unicidad parcial con manejo de conflicto). Actualizar decisión, círculo y auditoría de forma atómica.

**Riesgos / validación:** evitar deadlocks al fijar orden de locks, no rebajar círculos superiores y definir manejo de aprobaciones históricas duplicadas antes de una restricción. Repetir las dos sondas: exactamente una revisión válida por solicitud y una aprobación por identidad social; la perdedora devuelve conflicto. Una restricción nueva requeriría migración y revisión de datos previa; no se aplicó ninguna.

### DOM-02 — Rechazar el correo ACCESS revierte la contraseña, pero no la capacidad previa de completar registro

**Categoría:** funcionalidad/datos. **Gravedad: media. Estado: confirmado.** Afecta a cuenta activa USER/FRIEND sin contraseña, `registrationClaimable=true`, cuyo correo de acceso recibe un rechazo definitivo. No es bloqueo irreversible: otro acceso entregado correctamente o recuperación por correo puede resolverlo.

**Ubicación:** `cronox-backend/src/newsletter/newsletter-delivery.service.ts:142`, `:164`, `:166`, `:170`; `src/users/account-state.ts:14`; `src/users/users.service.ts:194`. La consecuencia se aplica al registro público que usa esos controles.

**Esperado:** un intento de entrega fallido no debe dejar una transición parcial de credenciales/capacidad de acceso. La recuperación debe estar definida y conservar la política de prueba de titularidad del email.

**Observado:** preparación ACCESS escribe hash de contraseña y `registrationClaimable=false`; rechazo SMTP definitivo en el último intento devuelve `password=null` y job FAILED/SMTP_REJECTED, pero deja el flag false. `canCompletePublicRegistration` pasa a false y `completePasswordlessRegistration` devuelve null, aunque antes del intento la cuenta podía completar el registro según la política vigente. Un usuario puede ver «email ya registrado» sin haber recibido las credenciales.

**Reproducción:** bloque `DOMAIN-NEWSLETTER-ROLLBACK` del [resultado](../output/playwright/audit-20261017/domain/domain-probes-result.json): servicio/DB reales, únicamente el transporte se sustituye por rechazo inequívoco EENVELOPE/550, con `attempts=3`. No se envió ningún correo.

**Causa demostrada:** el rollback CAS compara el hash generado, pero sólo restaura `password`; no conserva/restituye el estado previo relacionado con el registro.

**Propuesta pendiente y dependencia de seguridad:** resolverlo junto con la auditoría de apropiación de cuentas por registro público. **No restaurar `registrationClaimable=true` indiscriminadamente.** La opción preferible puede ser una recuperación verificada por email con estado explícito; si se conserva la política de claim actual, sólo restaurar el estado previo bajo CAS después de rechazo inequívoco y con prueba de titularidad adecuada. No abrir cuentas guest/admin ni sobrescribir una contraseña posterior.

**Riesgos / validación:** una restauración ingenua puede reabrir la apropiación de cuentas identificada en el informe de autenticación. Mantener el control probado `CONTROL-NEWSLETTER-UNKNOWN`: resultado SMTP ambiguo deja UNCERTAIN y conserva token/hash, sin reintento o claim público. Añadir casos rechazo definitivo, cuota, cambio de contraseña concurrente y rechazo en último intento. No se requiere migración necesariamente; reparar filas históricas exigiría evidencia del resultado SMTP y política de identidad acordada.

### DOM-03 — El administrador ve pendiente/caducado un ascenso II→III ya completado

**Categoría:** datos/funcionalidad/experiencia administrativa. **Gravedad: media. Estado: confirmado.** Ocurre con una solicitud normal II→III completada por el procesador; confunde el control de pendientes y caducadas. No se demostró pérdida del ascenso del miembro.

**Ubicación:** `cronox-backend/src/membership/circle.service.ts:81` crea el espejo y `:35` completa sólo `CirclePromotionRequest`; `src/membership/circle-upgrade.service.ts:240`, `:387`, `:398`, `:420`, `:497`. Endpoint afectado: GET `/api/admin/requests/2-3`; exportaciones que leen la solicitud principal pueden diferir de este listado.

**Esperado:** el estado administrativo debe corresponder al ascenso completado y dejar de figurar en pendientes/caducadas.

**Observado:** tras solicitud real y ejecución de `maybePromoteRequestedCircle`, usuario círculo III y `CirclePromotionRequest.status=completed`. Su `CircleUpgradeRequest` permanece PENDING y el listado PENDING lo devuelve. Al superar 72 horas desde su creación, el listado EXPIRED lo devuelve como EXPIRED aunque el ascenso sigue completado.

**Reproducción:** `DOMAIN-PROMOTION-MIRROR` en [resultado](../output/playwright/audit-20261017/domain/domain-probes-result.json). Se ajustaron exclusivamente las fechas de fixtures para simular vencimiento, sin esperar 72 horas. El alta de solicitud, procesador y listados son código/SQL reales.

**Causa demostrada:** dos representaciones deliberadas de una solicitud no sincronizan la transición terminal. El listado calcula caducidad únicamente desde el espejo, sin consultar el estado autoritativo.

**Propuesta pendiente:** definir una correspondencia estable entre ambas filas y actualizar el espejo en la misma transacción del ascenso, o construir el estado administrativo desde la solicitud autoritativa. No se propone eliminar tablas por mera duplicación.

**Riesgos / validación:** no asociar por coincidencias débiles de fecha; conservar intentos históricos, numeración, auditoría y promociones manuales posteriores. La reparación histórica puede necesitar operación de datos/migración según diseño. Prueba: petición II→III completada no aparece en pendientes/caducadas antes ni después de 72h; el historial final coincide con el miembro y exportación.

**Límite adicional:** sólo se localizaron llamadas al procesador II→III desde acreditación, estadísticas y escaneo QR; el worker de gasto procesa I→II. Esto describe ejecución perezosa, pero no se eleva como otro fallo sin confirmar si el negocio exige materializar III sin ninguna visita/lectura tras el plazo.

### DOM-04 — Dos correos diferidos que requieren revisión bloquean los correos válidos posteriores

**Categoría:** funcionalidad/mantenimiento. **Gravedad: media. Estado: confirmado.** Requiere al menos dos outbox WAITING_QUOTA antiguos que no puedan procesarse, por ejemplo tras cambiar la cuenta remitente. Impide avisos posteriores de confirmación/envío/entrega; no altera el pedido ni su pago. El fallo es latente si la integración permanece desactivada.

**Ubicación:** `cronox-backend/src/email/mail-transport.factory.ts:141` (take 2 ordenado por antigüedad), `:147`, `:150`, `:154`, `:155`. Creación del outbox en `:57`.

**Esperado:** jobs que necesitan revisión deben conservarse y señalarse sin impedir procesar otros jobs válidos.

**Observado:** con tres jobs vencidos, los dos primeros tienen `envelope.from` anterior a la cuenta configurada y el tercero coincide con la actual. Dos ticks del worker siempre seleccionan los primeros dos; sólo les añade `EMAIL_ACCOUNT_CHANGED_REVIEW`, manteniendo WAITING_QUOTA y readyAt vencido. El tercero no llega al transporte. Al retirar sólo los dos fixtures bloqueantes de WAITING_QUOTA, el mismo tercer job alcanza el transporte en el siguiente tick.

**Reproducción:** `node output/playwright/audit-20261017/domain/deferred-mail-probe.cjs`; [resultado](../output/playwright/audit-20261017/domain/deferred-mail-result.json). DB y worker reales. Configuración de cuenta ficticia sólo en memoria, cifrado con clave efímera de prueba, transporte sustituido por contador. No se activó ningún servicio externo. El arnés deja sus jobs ficticios terminales después de la observación.

**Causa demostrada:** filas no recuperables permanecen dentro del mismo conjunto prioritario y consumen todo el lote. El mismo patrón existe ante clave no disponible/límites inválidos, pero la reproducción concreta usa cambio de remitente.

**Propuesta pendiente:** separar estado «requiere revisión» del conjunto procesable, o excluir/aplazar explícitamente esos jobs con visibilidad administrativa; conservar payload y auditoría para recuperación segura. No reenviar automáticamente mensajes de resultado ambiguo.

**Riesgos / validación:** no perder correos ni convertir errores permanentes en reintentos infinitos; revisar retención de claves y acceso a payload cifrado. Repetir sonda: tercero avanza sin borrar los primeros; éstos siguen visibles para intervención. Puede implementarse con filtros/estado existentes o requerir migración si se añade un estado persistente tipado. La recuperación de una cuenta remitente real requiere intervención/configuración del operador, no se ejecutó.



## 6. Interfaz y contratos entre frontend/backend

### UX-01 — El rechazo de un cupón desaparece de la pantalla

**Categoría:** experiencia de usuario/funcionalidad. **Gravedad:** media; el cliente no puede saber por qué no se aplica el descuento y puede repetir una acción inútil. **Estado:** confirmado en navegador y HTTP reales. **Entorno:** checkout aislado, cesta de 50 €, código ficticio `AUDITINVALIDO`.

**Afecta:** `cronox-front/assets/checkout.js:2522` (`applyPromoCode`), `:2567` y `:1553` (`renderPromoUI`).

**Esperado/observado:** API → 400, `PROMO_NOT_FOUND`, «Este código de descuento no existe»; al terminar, `#promo-message.textContent` está vacío aunque el nodo está visible. Evidencia `invalid-promo-evidence.txt` y captura `invalid-promo-no-feedback.png`. El SDK externo estaba bloqueado, pero este rechazo y borrado se producen en el recorrido propio del cupón sin depender de Stripe.

**Causa/propuesta:** el catch escribe el mensaje y llama a `renderPromoUI`, que lo limpia cuando no hay cupón. Separar estado de aplicación del estado de validación y conservar el error hasta cambio/reintento pertinente. Sin migración.

**Riesgo/validación:** no conservar mensajes de errores antiguos tras aplicar/eliminar un cupón válido. Probar inexistente, caducado, ya usado, propietario incorrecto, fallo de red, corrección y éxito; comprobar mensaje accesible y total del servidor.

### UX-02 — La cesta muestra portes y métodos fijos distintos de los del checkout

**Categoría:** duplicación/experiencia de usuario. **Gravedad:** media condicionada a tarifas/métodos diferentes del seed. **Estado:** confirmado; no se afirma que la configuración publicada sea distinta. **Entorno:** fixture con sólo STANDARD activo, precio 490 céntimos.

**Afecta:** `cronox-front/assets/cart.js:33`, `:55`, `:83`; `cart.html:120`; `shipping-methods/shipping-methods.service.ts:46` y `:151`.

**Esperado/observado:** misma disponibilidad y tarifa autorizada. Cesta: estándar 2,95 €, express 4,95 €, total 52,95 €. Checkout: sólo estándar ficticio 4,90 €, total 54,90 €. La cesta los llama «Envío» y «Total», sin indicación de estimación. Backend conserva autoridad sobre el cobro: no se ha alterado ningún pago desde el navegador.

**Causa:** tarifas y dos opciones hardcodeadas coinciden sólo con el seed; checkout consulta filas activas 1/2. Además el servicio guarda una caché sin TTL; `clearCache()` no tiene consumidores actuales. No hay ruta administrativa de escritura de `ShippingMethod`, por lo que el caso requiere cambio de configuración/BD o despliegue distinto, no un botón ordinario del panel.

**Propuesta/riesgo/validación:** obtener el resumen de la misma fuente y definir invalidación de configuración; conservar gratuidad sobre neto después de descuentos. Probar cambios de precio, express desactivado, ausencia de métodos, umbral 65 € y reintento de red. Sin migración necesariamente; coordinar cambios de configuración. Revisión independiente: `commerce/shipping-independent-review.md`.

### UX-03 — El formulario de perfil acepta nombres que el servidor rechaza

**Categoría:** funcionalidad/experiencia de usuario. **Gravedad:** baja; bloqueo comprensible pero evitable al guardar ciertos nombres. **Estado:** confirmado con navegador y PUT real en la base domain.

**Afecta:** `cronox-front/assets/profile.js:267`; `cronox-backend/src/me/dto/update-me.dto.ts:6` y `:14`/`:21`; `/api/me` PUT.

**Esperado/observado:** validación coherente. `Ana-María` pasa la validación del navegador, pero PUT → 400 «El nombre solo puede contener letras y espacios». `Ana` → 200. Apóstrofos también están admitidos por el patrón del frontend y excluidos por el DTO; ese segundo nombre no se presenta como otra prueba dinámica. Evidencia `domain/profile-save-result.txt`, `profile-name-rejected.png`.

**Causa/propuesta:** patrones repetidos divergentes. Acordar el criterio de nombres y compartir o comprobar el contrato; no asumir sin decisión si el negocio pretende permitir guiones/apóstrofos. Riesgo: rechazar nombres históricos o debilitar escape/longitudes. Validar guion, apóstrofo, acentos, espacios, longitudes y conservación de nombres previos. Sin migración salvo normalización posterior expresamente decidida.

### UX-04 — Guardar el perfil sustituye el contexto de usuario por una respuesta incompleta

**Categoría:** funcionalidad/duplicación. **Gravedad:** baja con impacto adicional pendiente de reproducir. **Estado:** confirmada la pérdida de campos en navegador; efectos de persistencia/renovación deducidos del código.

**Afecta:** GET `/api/me` en `users/users.controller.ts:52`, PUT en `me/me.controller.ts`; respuesta `MeProfile` de `me/me.service.ts`; sustitución de `CRONOX_USER` en `cronox-front/assets/profile.js:1423`; `session.ts:316` y `:359`; claves de modales en `profile.js:151`/`:168`. Ubicaciones completas en `security/profile-contract-static-notes.md`.

**Esperado/observado:** tras guardar debería conservarse la identidad del contexto. GET inicial contiene `identityUid` y `role`; PUT válido devuelve id/email/nombres/hasPassword/memberCode/circleLevel/createdAt, y el frontend reemplaza el objeto completo. Ambos campos desaparecen de `window.CRONOX_USER`. Evidencia dinámica: [guardado del perfil](../output/playwright/audit-20261017/domain/profile-save-result.txt). El número visible sigue presente por `memberCode`: **no se observó desaparición del ID, del QR ni pérdida de autorización del servidor**.

**Impacto/causa:** consumidores de `identityUid` dejan de obtener clave de persistencia; el observador de sesión clasifica cliente mediante `role`, ausente en el PUT. El efecto completo sobre una visita posterior sigue pendiente. Hay dos GET solapados; ambos autorizan correctamente y su mera duplicación no es otro fallo de seguridad.

**Propuesta/riesgo/validación:** estabilizar la respuesta de sesión/perfil o actualizar sólo campos de perfil sin destruir contexto. Evitar conservar roles obsoletos si un cambio real de permisos debe invalidarlos. Probar guardar, recargar, abrir/cerrar modales, renovación de visita y cambio de permisos; comprobar `identityUid` estable. No necesita migración.

## 7. Dependencias y mantenimiento

### MNT-01 — Avisos actuales pendientes de actualización, sin exploit público demostrado

**Categoría:** mantenimiento/seguridad de dependencias. **Gravedad de la tarea:** media; no se trasladan automáticamente las etiquetas CVSS a CRONOX. **Estado:** versiones afectadas confirmadas; aplicabilidad de explotación remota no demostrada en los caminos revisados. **Entorno:** ambos lockfiles y paquetes instalados locales actuales.

`npm audit` backend devuelve 50 entradas (7 moderadas, 41 altas, 2 críticas), que se reducen a **18 avisos distintos en 10 paquetes causales**. La raíz añade una entrada alta de `source-map-js`, ya contada entre esos avisos. No son 51 vulnerabilidades independientes de la web.

| Paquete | Versión observada | Alcance comprobado |
|---|---|---|
| Handlebars | 4.7.9 | Runtime de correo; las llamadas revisadas compilan strings, no AST no fiable; no se permite acceso a prototipos ni se incrusta el JS de precompile. Parche 4.7.10. |
| proxy-addr | 2.0.7 | Express runtime; CRONOX usa confianza numérica de saltos, que evita el comparador de subred IPv6 afectado. Topología real no auditada. Parche 2.0.8. |
| source-map-js | 1.2.1 | Runtime vía sanitize-html/PostCSS con `map:false`; raíz vía Vite de build. No se identificó entrada pública de sourcemaps. Parche 1.2.2. |
| deepmerge-ts | 7.1.5 | Prisma/config; sin ruta HTTP identificada. El lock no lo clasifica exclusivamente dev. La propuesta automática implica Prisma major: requiere revisión propia. |
| fast-uri | 3.1.5 | Seis avisos, herramientas AJV/build. Sin uso localizado para decidir destinos de red del servidor. |
| browserslist / baseline-browser-mapping | 4.28.1 / 2.9.19 | Configuración y consultas de herramientas, no API pública localizada. |
| braces / sprintf-js | 3.0.3 / 1.0.3 | Patrones/formato de tooling. Los avisos consultados no publican parche del paquete causal pese a `fixAvailable`. |
| @humanfs/node | 0.16.7 | ESLint; copiar symlinks no fiables es la condición, no la mera instalación. |

**Propuesta/riesgo/validación:** actualizar primero dependencias de ejecución con cambios revisables y pruebas de plantillas/sanitización/proxy; después tooling; estudiar Prisma por separado. No ejecutar `audit fix --force` ni prometer parches inexistentes. Comprobar árboles instalados de despliegue en una fase autorizada. No hay cambios de versiones en esta auditoría.

El [anexo de dependencias](audit-cronox-2026-10-17-dependencias.md) contiene condiciones, llamadas, versiones, huellas de lockfiles y las 18 fuentes oficiales actuales. Entre ellas: [Handlebars AST](https://github.com/advisories/GHSA-8r5x-fm3f-whwj), [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). La ausencia de un camino identificado no prueba seguridad total de una biblioteca.

## 8. Lo que funcionó y lo que no debe confundirse con un fallo

### 8.1. Pruebas de esta auditoría

| Bloque | Ejecución y resultado | Evidencia bajo `output/playwright/audit-20261017/` |
|---|---|---|
| Comercio | 13 escenarios con servicios y PostgreSQL reales, más repetición focal de concurrencia manual. Confirmaron los cinco casos COM y los controles descritos abajo. | `commerce/commerce-probes.json`, `commerce-probes-extension.json`, `manual-race-retry.json` |
| Regresión de compra/frontend | 10 suites existentes, **161/161 pruebas pasadas**, con JSDOM y dobles de API/proveedor. El resultado Jest indica `success:true`; el comando envolvente devolvió 1 y el log de PowerShell registró NativeCommandError sobre stderr `PASS`. No se capturó por separado el exit code nativo de Jest; se conserva esta discrepancia en el anexo. | `commerce/commerce-regressions.json`, `commerce-regressions.log` |
| Cuentas y permisos | Registro de cuenta reclamable, lectura de su pedido, aislamiento entre usuarios, revocación mediante sessionVersion, enlace anterior al cambio de contraseña y matriz USER/ADMIN/SUPERADMIN por HTTP. | `account-regression-result.json` |
| Guard CSRF | Ocho combinaciones de ruta/origen/token con guard real y controlador temporal Nest; no equivale a un ataque completo desde navegador. | `security/csrf-case-isolated.json` |
| Círculos, QR y comunicaciones | Carreras de aprobación, espejo II→III, rollback de ACCESS y resultado SMTP ambiguo; 16 escaneos QR concurrentes; suscripción/acceso/waitlist concurrentes; bloqueo de outbox; validadores de contenido/archivos. | `domain/domain-probes-result.json`, `communication-controls-result.json`, `deferred-mail-result.json` |
| Autorización adicional | 22 comprobaciones HTTP de acceso anónimo, USER, ADMIN, SUPERADMIN, permisos de buzón revocables, etiquetas y previews. | `domain/http-controls-result.json` |
| Web pública | 28 combinaciones de siete rutas y cuatro ventanas: **2560×1440**, 390×844, 320×568 y 1280×360. Ningún desbordamiento horizontal ni excepción JS no capturada en esos recorridos. 16 enlaces internos devolvieron 200. | `public-ux.json` y capturas |
| Navegación y estado | Login, favorito que persiste al recargar, búsqueda con flechas/Enter, recomendación con doble clic que emite una sola adición y devuelve el foco, talla agotada, cesta/checkout y error de cupón. | Capturas y registros CLI; `invalid-promo-evidence.txt` |
| Recuperación de catálogo | Se sustituyó sólo la respuesta de productos por 503; apareció Reintentar y, al retirar el fallo y pulsarlo, volvieron las tres tarjetas. El campo de texto capturado del grid estaba vacío: no se usa como prueba del texto exacto del error. | `catalog-retry.txt` |
| Panel | 22 secciones con SUPERADMIN a 1440×900: carga de secciones, red y consola; menú móvil a 390 px. No implica que se haya ejecutado cada acción administrativa. | `admin-ux.json`, `admin-mobile-keyboard.txt` |
| Teclado y pantalla baja | Modal de recomendación en 1280×360: 14 Tab permanecieron dentro, contenido con scroll interno, Escape cerró y restituyó foco. Menú admin móvil: Escape cerró y devolvió foco al botón de apertura. | `short-viewport-keyboard.txt`, `admin-mobile-keyboard.txt` |
| Perfil y acreditaciones | Perfil en 1440×900, 390×844 y 1280×600; guardado y rechazo de nombre; cinco círculos META y preview libro con fixtures. Selección/configuración de acreditaciones idénticas antes/después. | `domain/profile-layout-result.txt`, `profile-save-result.txt`, `preview-layout-result.txt`, `final-state.json` |
| Esquema, publicación e historial | Lectura local de migraciones/restricciones y comprobaciones acotadas de integridad; GET públicos; escaneo redactado de Git; ambos lockfiles y 18 avisos oficiales de dependencias. | `schema-review.json`, `published-check.json`, `secret-history-review.json`; anexos |

Las pruebas que reproducen un fallo también pueden terminar satisfactoriamente: significa que se observó el caso esperado, **no que la aplicación lo haya corregido**. Las cifras de validación del informe de rendimiento anterior no se reutilizan como pruebas ejecutadas en esta auditoría.

### 8.2. Controles que funcionaron bajo las condiciones probadas

- **Precio, pago y stock:** alterar `priceAtAdd` no cambió el precio del servidor; un descuento que baja el neto por debajo del umbral vuelve a aplicar portes. Importe cobrado, moneda y referencia de PaymentIntent incongruentes se rechazaron. Una firma de webhook incorrecta no creó ledger ni pedido. Dos reservas de la última unidad dieron un solo ganador; reintentar reutilizó su snapshot. Dos fulfillments concurrentes crearon un pedido.
- **Devoluciones y operaciones manuales:** reembolsos parciales acumulados, repetidos y desordenados conservaron el neto; el completo repuso una sola vez y un éxito tardío no revivió el pedido devuelto. Editar una compra conservó su coste histórico; anularla dos veces repuso una vez. POS conservó ingresos, costes, comisión y stock del caso parcial. Importes negativos, fraccionarios o fuera de límite se rechazaron. Todos los resultados del proveedor eran ficticios.
- **Cesta y frontend de compra:** una unidad añadida mientras se pagaba otra se conservó después del webhook repetido. La adición desde recomendaciones cerró el modal al éxito, evitó la segunda petición y restituyó el foco. La talla sin stock estaba bloqueada para comprar en la ficha; poder seleccionarla en la interfaz de aviso de reposición es deliberado. Las pruebas existentes de Express/PayPal comprobaron exclusión mutua y recuperación con dobles, sin acreditar una wallet real.
- **Identidad y autorización:** un usuario no leyó el pedido de otro; aumentar sessionVersion invalidó su JWT; el enlace ACCESS no pudo consumirse dos veces. USER recibió 403 en recursos administrativos y financieros. ADMIN y SUPERADMIN pudieron leer finanzas según la política vigente. Etiquetas exigieron SUPERADMIN; un ADMIN sin permiso de buzón recibió 403, con permiso 200 y, tras revocarlo, 403.
- **Círculos, QR y comunicaciones:** 16 escaneos simultáneos produjeron un registro y 15 respuestas de ya registrado; un miembro inactivo recibió 422. Doce suscripciones concurrentes produjeron un usuario, un WELCOME y un cupón; doce peticiones de acceso produjeron un ACCESS por ventana. Doce altas de waitlist produjeron una inscripción; cancelar la retiró y una variante disponible rechazó el aviso con 409. Un resultado SMTP ambiguo conservó token/credenciales y quedó UNCERTAIN, sin reenvío a ciegas.
- **Contenido y archivos:** los validadores/sanitizadores reales rechazaron o eliminaron scripts, eventos, iframe, SVG e imágenes remotas por defecto en el correo; se ejercitaron cabeceras, hosts y cinco destinos privados. Las funciones de etiquetas rechazaron un PDF falso, traversal en el nombre y directorios públicos. No es una validación completa del parser, disco o almacenamiento externo.

La revisión estática adicional encontró hashes de refresh/reset, caducidad, consumo condicional y lectura del estado/rol actual; comprobación de propiedad en direcciones y borradores; límites por operación; CORS con orígenes exactos; CSP; imagen con límites de tamaño/píxeles y decodificación; etiquetas privadas con hash/no-store; tracking con revisión y lease para descartar respuestas tardías. **Estos controles leídos no se presentan como nuevos recorridos completos ejecutados.** Logout, carreras de refresh/reset, todos los tipos de archivo, cabeceras de proxy reales y agotamiento de cada limitador quedan fuera de la cobertura dinámica.

### 8.3. Duplicaciones deliberadas, ambigüedades y mejoras opcionales

| Caso | Diagnóstico |
|---|---|
| Varios accesos a PayPal | Sirven flujos distintos; las pruebas de exclusión mutua pasaron. No se propone borrarlos por repetición visual. |
| Libro y METACRILATOS | Diseños coexistentes válidos. Se conservaron configuración y selección. El arte remoto exacto del libro no se comprobó. |
| Gasto personal frente a finanzas generales | Una compra manual de 87,50 € excluida de estadísticas siguió contando en gasto personal. Diferencia deliberada, no doble contabilidad defectuosa. |
| Identificadores | ID interno, UUID de identidad, número visible de miembro y número de pedido tienen fines distintos. No se propone sustituirlos unos por otros. |
| Precio/coste histórico frente al producto actual | El snapshot conserva lo comprado; modificar el producto no debe reescribir el pasado. Las ediciones probadas respetaron ese coste. |
| ADMIN/SUPERADMIN | El helper genérico de roles permite ambos roles administrativos; las operaciones estrictas usan SuperAdminGuard. Una anotación `Roles(SUPERADMIN)` aislada no demuestra exclusividad. Revisar la matriz como decisión de negocio antes de modificarla; no se inventa un bypass donde la política admite ambos. |
| Ascenso II→III | Se materializa al pasar por ciertas lecturas; no se encontró un worker propio para ese ascenso. Si se requiere ejecución sin actividad del miembro, hay que concretar esa regla. DOM-03 sí demuestra una inconsistencia administrativa independiente de esa decisión. |
| GET `/api/me` solapado | Deuda de contrato/routing que conviene aclarar al abordar UX-04; ambas rutas tienen autorización. No se propone una eliminación sin revisar dependencias. |
| Portes y nombres repetidos | Divergencias demostradas en UX-02 y UX-03; aquí sí hay un problema concreto que resuelve compartir el contrato. |
| Error posterior al alta manual | La lectura de `admin-user.ts:578` muestra un catch compartido para POST y recargas posteriores. Falta reproducir el fallo de recarga en navegador; queda como observación para validar, sin añadir otro hallazgo confirmado. |
| Datos y funciones aparentemente sin referencia | No se propone borrar archivos/listeners/rutas sólo por una búsqueda negativa. El mapa incluye alias y jobs. No se detectó una segunda petición en la adición de recomendados probada. |
| Rendimiento | Se conserva la optimización previa. No se atribuye un nuevo problema de lentitud sin medición causal; esta ejecución no incluye carga, percentiles de producción ni un benchmark equivalente antes/después. |

### 8.4. Incidencias del entorno que se descartaron como defectos

La clonación de esquema no incluyó `VisitorHistoryConfig`, selección de acreditación ni otros datos iniciales; algunos endpoints administrativos devolvieron 500 antes de preparar sus fixtures. Se completaron sólo datos de prueba necesarios, sin cambiar aplicación. Dos pedidos PAID insertados directamente para probar identidad no tenían archivo financiero: el desfase con finanzas de ese fixture no demuestra un fallo contable. Los dos errores iniciales del arnés comercial también se conservaron y corrigieron únicamente en el arnés.

La imagen remota de newsletter y el SDK de Stripe fueron bloqueados deliberadamente: la falta de imagen y el aviso de pago no disponible no describen producción. La navegación automatizada rápida produjo respuestas 429 del registro de consentimiento; no se deduce que ocurra a un comprador normal. El bloqueo inicial de una URL de API por CSP se resolvió configurando el override de API de la sesión de prueba; no se cambió el frontend.

## 9. Prioridades y requisitos de corrección

Son **18 entradas** entre fallos reproducidos, riesgos condicionados y observaciones pendientes. La prioridad siguiente responde a impacto y dependencias entre cambios, no a sumar avisos automáticos. «Confirmado» conserva siempre el alcance descrito en cada ficha.

| Orden | ID | Gravedad / estado | Acción propuesta y motivo | Migración, configuración o intervención externa |
|---|---|---|---|---|
| 1 | SEC-01 | Alta; confirmado | Exigir prueba de titularidad al completar una cuenta existente, preservando compra invitada y registro legítimo. | Posible modelo/versión de token; revisión de cuentas afectadas sólo con acceso autorizado. Coordinar DOM-02. |
| 2 | COM-01 | Alta; confirmado con fallo inyectado | Separar pedido comprometido de efectos posteriores antes de decidir una compensación. | No necesariamente migración; revisar recibos históricos si se investiga incidencia real. Proveedor simulado aquí. |
| 3 | COM-02 | Alta condicionada; confirmado en servicio/controller | Garantizar recuperación de eventos PROCESSING interrumpidos y semántica de respuesta reintentable. | Posible outbox/payload y migración; configuración de worker/replay. Stripe externo sólo para validar integración posteriormente. |
| 4 | SEC-04 | Media provisional; exposición confirmada, revocación pendiente | Verificar revocación histórica; actuar en paralelo al desarrollo por su posible impacto externo. | Revisión/rotación por operador si procede; saneamiento Git coordinado, nunca sustituto de revocar. |
| 5 | SEC-03 | Media; confirmado para ACCESS tras cambio | Invalidar capacidades de acceso anteriores al sustituir credenciales. | Sin migración si se usan campos existentes; posible versión de token según diseño. |
| 6 | SEC-02 | Media; guard confirmado, impacto navegador pendiente | Unificar interpretación de rutas y validar la operación real en navegador aislado. | Sin migración; comprobar compatibilidad de rutas/webhooks y cookies. |
| 7 | DOM-02 | Media; confirmado | Resolver recuperación tras rechazo SMTP junto con SEC-01, sin abrir cuentas por un flag. | Política de recuperación; posibles datos históricos, nunca restauración masiva sin evidencia. |
| 8 | DOM-01 | Media; confirmado | Hacer atómicas decisiones y exclusividad de identidad social. | Posible índice parcial/migración tras revisar duplicados; preservar historial. |
| 9 | DOM-04 | Media; confirmado | Apartar jobs que necesitan revisión del lote procesable para no bloquear avisos válidos. | Posible estado/migración; intervención en cuenta/clave de correo si procede. |
| 10 | COM-04 | Media; confirmado en servicio | Recuperar conflictos de la misma clave de alta manual sin resultado ambiguo. | Normalmente sin migración; no repetir efectos externos. |
| 11 | COM-03 | Media condicionada; confirmado con catálogo mixto | Definir EUR exclusivo o monedas admitidas; imponer homogeneidad y revisar catálogo. | Regla/configuración y posible saneamiento de datos; no implica migración por sí solo. |
| 12 | DOM-03 | Media; confirmado | Hacer corresponder solicitud administrativa y ascenso completado. | Posible vínculo/migración y reparación histórica con correspondencia demostrable. |
| 13 | MNT-01 | Media como tarea; versiones confirmadas, explotación no demostrada | Actualizar runtime y tooling por bloques; separar Prisma major y paquetes sin parche publicado. | Dependencias/lockfiles, validación y despliegue posteriores; no `audit fix --force`. |
| 14 | UX-01 | Media; confirmado | Conservar y anunciar el error de cupón hasta resolución. | Sin migración ni servicio externo. |
| 15 | UX-02 | Media condicionada; confirmado | Mostrar tarifas/métodos de la fuente autorizada y resolver invalidación de caché. | Configuración de portes; normalmente sin migración. |
| 16 | COM-05 | Baja; confirmado, mitigado en UI | Incluir exclusión estadística en el contrato de idempotencia sin invalidar replays históricos. | Sin migración necesariamente; compatibilidad de hashes antiguos. |
| 17 | UX-03 | Baja; confirmado | Acordar y aplicar la misma regla de nombres en formulario/DTO/servicio. | Decisión de negocio; sin migración salvo normalización expresamente acordada. |
| Investigar | UX-04 | Baja provisional; pérdida de campos confirmada, impacto funcional pendiente | Reproducir persistencia/renovación antes de corregir el contrato de perfil/sesión. | Sin migración; conservar actualización real de permisos. |

Primero conviene cerrar identidad y recuperación de dinero, con pruebas de fallos y concurrencia. SEC-04 puede verificarse en paralelo mediante el operador. SEC-01 y DOM-02 deben diseñarse conjuntamente; después siguen integridad de decisiones, colas y recuperación administrativa. Las actualizaciones de dependencias pueden prepararse en un bloque separado. Interfaz y mantenimiento de contratos se abordan con regresiones focales, sin rediseñar CRONOX ni cambiar reglas de negocio por inferencia. **Este orden no autoriza ni ejecuta las correcciones: quedan pendientes de la siguiente instrucción.**

## 10. Cierre y límites

El diagnóstico cubre las superficies accesibles con el código y entorno disponibles. No se ha probado un pago externo con tarjeta, PayPal o transferencia, un reembolso, entrega SMTP, IMAP, push, envío/seguimiento Correos real ni archivos de clientes. No se consultaron credenciales antiguas contra proveedores. Tampoco se auditó en vivo el VPS, sus secretos/topología/proxy, los webhooks registrados, los buckets/RLS de Supabase o el esquema/datos de producción. Los GET publicados no permiten afirmar que todos los hallazgos estén desplegados ni contar afectados reales.

En UI se comprobaron las ventanas y recorridos indicados, no todos los navegadores, dispositivos, lectores de pantalla o niveles de zoom. El intento de zoom con atajo del navegador automatizado no modificó viewport, DPR ni escala (`zoom-attempt.txt`); por tanto, **zoom real queda sin validar**, y las ventanas pequeñas no se presentan como sustituto. Tampoco se verificó el arte remoto exacto del libro ni cada operación del panel. Los estados difíciles se probaron con fallos controlados; no se fingió disponibilidad de proveedores.

El escaneo de secretos fue por patrones sobre archivos y objetos de texto elegibles, con exclusiones de binarios, dependencias/compilados históricos y límite de tamaño; no demuestra ausencia absoluta de secretos. Los 18 avisos de dependencias fueron contrastados con fuentes actuales, pero la falta de un camino explotable identificado no equivale a garantía de seguridad. No se ejecutó una prueba de carga o un pentest exhaustivo de todos los endpoints.

**Cierre verificado:** HEAD sigue en `102a1b9111d91e8fb94a5b5bb91d71f3b0933d8f`; el SHA-256 del diff de los archivos ya modificados sigue siendo `9e6cd6959538ed6308d105146b6d541103680e5049311dfb63319cfb26732379`, idéntico al inicial. Los seis archivos no versionados que existían antes también conservan exactamente sus hashes. Los únicos archivos nuevos no ignorados son los cuatro documentos de esta auditoría. Evidencia: `integrity-before.json` e `integrity-after.json`.

Se cerraron los navegadores de prueba y los dos servidores aislados. Se eliminaron exclusivamente las cuatro bases ficticias de la lista validada; `cronox_dev` permanece y la web local original en 3000 respondió ready 200. Evidencia: `server-cleanup.json`, `database-cleanup.json` y `domain/final-state.json`. No se aplicaron migraciones ni se cambiaron diseños de acreditaciones, configuración de producción, dependencias o código funcional. Los arneses conservados documentan la ejecución; para repetirlos hay que recrear antes su entorno aislado y fixtures, ya retirados.

Entregables: este informe con diagnóstico y prioridades, el [anexo de comercio](audit-cronox-2026-10-17-comercio.md), el [anexo de dependencias](audit-cronox-2026-10-17-dependencias.md) y el [mapa de superficies](audit-cronox-2026-10-17-mapa.md). Los resultados, arneses y capturas se conservan en `output/playwright/audit-20261017/`, ignorado por Git. Los estados finales de este informe prevalecen sobre notas preliminares de los agentes conservadas allí por trazabilidad.

## 11. Fase de corrección local — 17/10/2026

**Esta sección actualiza el estado del diagnóstico anterior.** Las secciones 1–10 y sus evidencias se conservan como referencia previa; sus frases «sin cambios de código» y «pendiente de corrección» describen aquella fase. Esta intervención sí implementa correcciones, exclusivamente en el árbol local. No hubo commit, push, despliegue, cobro, reembolso, correo ni envío real, ni cambios de producción.

### 11.1. Referencia inicial y aislamiento

La referencia se tomó **antes de editar**: HEAD `102a1b9111d91e8fb94a5b5bb91d71f3b0933d8f`, rama `main`, 49 archivos versionados modificados y 10 nuevos: 59 trabajos pendientes. `output/playwright/audit-fixes-20261017/integrity-before.json`, `initial.diff` y `initial-work/` conservan estado, hashes y copias. `baseline-backend/` conserva el código anterior usado en las reproducciones. No se restauró HEAD sobre el trabajo pendiente.

Se clonó sólo el **esquema**, sin datos, de PostgreSQL local a cuatro bases ficticias con nombres `cronox_fix_20261017_{security,commerce,domain,browser}_d560ad`. Cada arnés comprueba su destino; las conexiones están limitadas a loopback. SMTP/Stripe se simulan, las claves son ficticias y los trabajadores externos están desactivados. La aplicación compilada se valida con el mismo aislamiento. No se aplicaron las nuevas migraciones a `cronox_dev` ni a producción.

Se conservaron las optimizaciones de imágenes/preloader, los marcos iniciales de tienda, la carga diferida de acreditación, la paginación y la cola de conciliación. También se conservaron tamaños, posiciones, separación de recomendados, zoom, ambos diseños de acreditación y sus configuraciones. Las versiones de assets modificados pasan a `app=97`, `api=24`, `cart=10`, `checkout=31`, `profile=32`; los cambios de URL evitan reutilizar los scripts anteriores tras una futura publicación.

### 11.2. Clasificación y resolución de los 18 puntos

«Corregido» significa código y pruebas locales; no significa desplegado ni reparación histórica aplicada. Las referencias de evidencia siguientes son relativas a `output/playwright/audit-fixes-20261017/`.

| ID | Clasificación comprobada | Estado y corrección o justificación | Pruebas y pendientes |
|---|---|---|---|
| SEC-01 | Fallo confirmado | **Corregido.** Cuenta existente exige prueba del buzón; registro y fallback interno ya no establecen contraseña/nombres ni entregan sesión por conocer el correo. | `security/red-green-{before,after}.json`, 15 bloques DB, 10 HTTP. Mismo ID, identidad, círculo, QR e historial. No se investigaron afectados reales. |
| SEC-02 | Fallo confirmado; impacto HTTP comprobado | **Corregido.** El guard normaliza mayúsculas como Express y mantiene sólo las dos excepciones exactas de webhook. | 5 fallos antes → 16/16 después; HTTP real `/API/auth/login`, `/Api/Auth/Login/`, `/API/me`: 403 sin CSRF/origen ajeno; login válido 200. Proxy de producción fuera de alcance. |
| SEC-03 | Fallo confirmado | **Corregido.** Emisión/consumo/revocación se ordenan por cuenta; cambiar/restablecer contraseña revoca reset/setup, ACCESS, launch y ACCESS antiguos aún en cola. | SQL real: caducidad, familias de token, ocho consumos simultáneos con un ganador, carrera emisión/cambio, versiones de sesión. Sin migración auth. |
| SEC-04 | Exposición confirmada; revocación sin comprobar | **Pendiente externo.** Inventario seguro de Git y procedimiento del operador; no se probaron credenciales ni se reescribió historial. | Cinco blobs, cuatro con secretos, tres valores distintos; ninguno coincide con los perfiles locales consultados. Falta evidencia de revocación en todos los sistemas afectados; comparación local no la demuestra. |
| COM-01 | Fallo confirmado por inyección | **Corregido.** Pedido/stock/reservas y recibos auxiliares se confirman juntos; errores posteriores no autorizan refund. Error persistido y recuperación sin repetir compra. | Antes REFUNDED indebido; después PAID único, consumo único, cero refund indebido. Fallo postcommit, pérdida de conexión/respuesta y replay en PostgreSQL. Proveedores simulados. |
| COM-02 | Fallo confirmado, incluida caída real | **Corregido.** Payload firmado persistido, lease renovable con token, comprobación del token dentro de cada transacción, worker y revisión explícita. | Kill/reinicio en fronteras relevantes, duplicados/concurrencia/desorden, SMTP incierto, firma inválida y eventos antiguos. Una compra/consumo; incertidumbre visible y sin reenvío ciego. Migración obligatoria. |
| COM-03 | Fallo confirmado con catálogo mixto | **Corregido.** Rechazo de cesta con monedas distintas antes del snapshot/pago. No se impone EUR exclusivo ni se inventa una política de catálogo. | Antes EUR/USD aceptado; después rechazado. Una moneda admitida sigue funcionando. Revisar catálogo real si hay datos mezclados; no se tocó. |
| COM-04 | Fallo confirmado | **Corregido.** Reintento serializable acotado y lectura del recibo al inicio de cada intento; orden estable de bloqueo de variantes. | Misma clave concurrente → mismo pedido, un movimiento/archivo financiero/auditoría. Última unidad con claves distintas → una venta y 409. Replay tras pérdida de respuesta. |
| COM-05 | Fallo confirmado | **Corregido.** Hash versionado incluye exclusión estadística; hashes antiguos se contrastan con la auditoría original inmutable. | Flag distinto → 409; omisión=false; replay histórico funciona aunque el flag actual cambió. Evidencia histórica ausente/ambigua exige revisión, no nueva compra. |
| DOM-01 | Fallo confirmado | **Corregido.** Relectura bajo bloqueo, exclusión por identidad social y cambio condicional del círculo. | Tres carreras approve/deny → un ganador y auditoría coherente; dos miembros/misma red-usuario → una aprobación; ascenso concurrente a V conservado. |
| DOM-02 | Fallo confirmado | **Corregido junto a SEC-01.** ACCESS ya no cambia contraseña ni flag antes de probar titularidad. | Rechazo, cuota, aceptación e incertidumbre simulados con persistencia real. Titular puede recuperar cuenta con flag histórico false sin restauración masiva. |
| DOM-03 | Fallo confirmado | **Corregido para nuevos ciclos.** Vínculo explícito único entre promoción y revisión, creación/finalización atómicas. | Dos procesadores, replay estable, segundo ciclo, >72 h sin espejo PENDING/EXPIRED, rollback por vínculo inválido y V intacto. Histórico pendiente de mapa probado; dry-run e idempotencia verificados con fixtures. |
| DOM-04 | Fallo confirmado | **Corregido.** Jobs que requieren revisión pasan a REVIEW_REQUIRED, conservan payload/motivo y salen del lote procesable. | Cinco inválidos no bloquean al sexto válido; reactivación exige SUPERADMIN, versión y configuración válida; una auditoría bajo concurrencia. SMTP simulado, sin entrega real. |
| UX-01 | Fallo confirmado | **Corregido.** Renderizar ausencia de cupón ya no borra el error de aplicación. | Cuatro rechazos perdían mensaje antes; cinco pruebas DOM pasan después, incluidos error de red, edición, aplicación válida y retirada. `aria-live` conservado. |
| UX-02 | Fallo confirmado | **Corregido.** Cesta cotiza con resumen autorizado; HTML inicial usa métodos activos reales; se elimina caché indefinida de portes. Respuestas antiguas no pisan cotizaciones nuevas. | Servicio rojo→verde; PostgreSQL real cambia precio/desactiva express sin reinicio; umbral neto; DOM con fallo/retry/respuesta tardía. Seis comparaciones visuales antes/después, controles de 116 px en ambas versiones. |
| UX-03 | Fallo confirmado | **Corregido conservando la política existente.** Formulario usa letras/espacios como DTO; no amplía la regla de negocio. Nombres históricos sin cambios se omiten del PUT. | Cinco nombres contrastados contra DTO real, límites existentes y nombre legado intacto. Sin normalización masiva. |
| UX-04 | Fallo confirmado tras investigar el efecto | **Corregido.** PUT devuelve representación segura completa, con identidad/rol autoritativos. Se retira sólo el GET sombreado del mismo endpoint. | Dos tests fallan antes y pasan después; GET→PUT→GET HTTP real mantiene ID/identityUid/rol/memberCode/QR y no expone hash. DOM confirma persistencia del modal tras guardar y adopción del rol actualizado. |
| MNT-01 | Sospecha de explotabilidad; versiones afectadas confirmadas | **Mitigación parcial aplicada.** Parches compatibles de runtime y herramientas; sin upgrade mayor de Prisma ni `audit fix --force`. | Backend 50→43 entradas npm audit, críticas 2→0; raíz 1→0. 69 tests y tres comprobaciones directas tras instalar. Quedan tres causas: braces, sprintf-js y deepmerge-ts/Prisma; ver anexo. No se afirma explotación ni cierre total. |

Las observaciones fuera de esos 18 se trataron según evidencia. La supuesta duplicación de compra manual tras fallar un GET **se refutó** ejecutando el TS del panel: un POST, confirmación cerrada y retry que sólo hace GET. Perder el banner de éxito es una mejora opcional; no se modificó esa interfaz. Se mantienen deliberadamente los varios accesos PayPal, libro/METACRILATOS, gasto personal frente a exclusión financiera, identificadores distintos, snapshots históricos y matriz administrativa vigente. Materializar II→III sin actividad del miembro sigue siendo una decisión de negocio no asumida.

### 11.3. SEC-01: prueba de titularidad antes de completar una cuenta

**Causa.** El registro aceptaba como autorización un estado interno de cuenta sin contraseña. También `UsersService.createUser` tenía un fallback que reclamaba la cuenta si aparecía durante una carrera. Conocer el correo permitía sustituir nombres/contraseña y obtener sesión sobre identidad e historial existentes.

**Cambio.** Ambas entradas se cierran. La cuenta ya existente devuelve un desafío `verificationRequired`, sin sesión ni modificaciones protegidas. Se reutiliza el enlace de reset/setup almacenado como hash, ligado al usuario, con una hora de vigencia y uso condicional único. Setup y reset autorizan establecer credenciales; ACCESS/launch usan sus propios endpoints y no son tokens de reset. La sesión verificada por ACCESS permite el cambio autenticado. Los datos no verificados enviados con el registro no se aplican: el titular puede actualizarlos después desde perfil.

Emisión, consumo y revocación comparten bloqueo por cuenta. El cambio de contraseña invalida las capacidades anteriores y los jobs ACCESS pendientes, además de incrementar versión de sesión. No se elimina ni recrea ningún usuario. Los tokens no pueden redirigirse mediante campos email/userId forjados. Se mantienen límites existentes; se observó 429 al sexto intento HTTP de reset.

**Prueba antes/después.** `security/red-green-before.json` reproduce apropiación, supervivencia del enlace y flag alterado; `red-green-after.json` pasa las mismas comprobaciones. `credential-controls-result.json` ejercita 15 bloques en DB real, incluidos caducidad, operaciones distintas y ocho consumos concurrentes por familia con un ganador. `http-controls-result.json` ejecuta DTOs, guards y controladores reales, ausencia de cookies/acceso privado en el atacante y recuperación legítima del mismo pedido/miembro. Los 98 tests focales pasan. El correo se captura en memoria: no demuestra entrega al proveedor ni un flujo por un buzón real. Detalle: [resolución de autenticación](../output/playwright/audit-fixes-20261017/security/README.md).

### 11.4. COM-01: el error auxiliar no revierte una compra válida

**Causa.** Un catch envolvía tanto la operación principal como pasos que podían fallar después del commit. Compensaba genéricamente con refund aunque ya existieran pedido PAID y stock consumido.

**Cambio.** El commit conserva pedido, reservas/stock y recibos `CheckoutEffect` únicos por snapshot/tipo. Confirmación, setup y analítica se tramitan aparte con resultado persistente. Un error de comunicación no prueba ausencia de commit; el replay consulta el resultado existente. Errores auxiliares se registran y recuperan sin volver a comprar. Una entrega SMTP ambigua se aparta para revisión, porque SMTP no permite demostrar exactamente una entrega si el proceso cae después de la aceptación y antes de registrar el recibo.

**Prueba antes/después.** Con el código original, inyectar un fallo postcommit termina en REFUNDED y falla el criterio de aceptación. Corregido, conserva PAID, un pedido, una reserva consumida y cero reembolso indebido; el retry completa el evento y sus tareas sin repetir stock. Se ejercitan también pérdida real de conexión HTTP después de confirmar y repetición tras respuesta perdida. Los transportes persisten recibos ficticios para contar intentos. Véanse `commerce/before-acceptance.json` y `after-acceptance.json`.

**Compensaciones legítimas.** Se conserva conciliación de reembolsos/disputas firmados y devolución única de stock. Cambia deliberadamente la respuesta a contradicciones no resolubles: REVIEW y verificación del operador, en lugar de refund automático por una excepción genérica. Si procede reembolsar, el operador lo realiza explícitamente en Stripe; su webhook concilia y el endpoint de resolución exige prueba firmada del reembolso completo, snapshot coherente y ninguna reserva retenida. No se añadió un endpoint que cobre/reembolse por inferencia. Esta operación y su supervisión deben incorporarse antes de publicar; no se ejecutó un reembolso externo en estas pruebas.

### 11.5. COM-02: recuperación tras interrupciones reales

**Causa.** Registrar PROCESSING sin payload recuperable ni lease dejaba una ejecución muerta indefinidamente. Un duplicado recibía 200 aunque no existiera pedido.

**Cambio.** Tras verificar firma/modo, el evento se guarda con su payload inmutable. El worker reclama con token y vencimiento, renueva la reclamación y recupera PENDING/FAILED o leases vencidos. Cada transacción comercial comprueba y bloquea el token vigente: una ejecución reemplazada no puede confirmar efectos. PROCESSED se registra sólo después de los efectos obligatorios. Todo se apoya en PostgreSQL existente; no se introduce broker ni servicio externo nuevo.

Se matan **procesos reales** después de persistir payload, reclamar evento, dentro de la transacción, tras commit, tras PROCESSED antes de responder y después de la aceptación SMTP simulada. La recuperación arranca en otro proceso; las pruebas adelantan explícitamente el vencimiento del lease para no esperar un minuto, sin fingir el kill. También se prueban duplicados simultáneos, distintos eventos del mismo pago, reembolso antes de éxito, firma inválida, token de worker reemplazado e incidencia no cumplible con reparación/reintento explícitos. Antes, el kill tras reclamar deja PROCESSING y ningún pedido incluso con reentrega. Después, el resultado comercial converge una vez; SMTP incierto queda REVIEW y no vuelve a enviarse automáticamente.

Los eventos históricos sin payload requieren redelivery firmada; no se fabrican desde una cesta actual. El endpoint administrativo expone metadatos de incidencias sin payload personal. La tabla nueva y el ledger tienen RLS y permisos públicos retirados. El worker y los POST de recuperación permanecen bloqueados en el perfil de revisión local. Procedimiento y requisitos: [recuperación Stripe](stripe-webhook-recovery.md). Los eventos y firma son ficticios; la persistencia, transacciones, procesos, conexiones y bloqueos PostgreSQL son reales. No se presenta esto como validación contra Stripe sandbox.

### 11.6. Contratos, regresiones y presentación

Para UX-04 se revisaron consumidores antes de eliminar el duplicado: `UsersController.GET me` ya era el handler registrado que sirve `/api/me`; el GET de `MeController` quedaba sombreado bajo la misma URL y guard. Los clientes `getMe` y `updateMe` usan esa URL, sin poder seleccionar el handler oculto. Se retira únicamente ese GET; permanecen direcciones/pedidos y el método de servicio. El PUT usa `UsersService.toSafeUser`, por lo que no se conserva un rol viejo mediante un merge en el navegador ni se entrega el hash de contraseña.

La cesta utiliza `getCheckoutSummary` para métodos/totales del carrito autorizado; no duplica tarifas en JavaScript. Conserva el comportamiento existente de aplicar el cupón durante checkout, donde se vuelve a cotizar tras descuento. HTML inicial y cliente usan las mismas filas de envío; no se oculta contenido ni se modifica distribución para bajar CLS. Se deshabilita pagar mientras no exista cotización válida y se muestra retry ante error. Si falla sólo la consulta inicial de portes, la página sigue devolviendo su HTML con mensaje de carga, registra el fallo y permite cotizar/reintentar desde el cliente: no bloquea toda la cesta con 503 ni inventa precios. La revisión final añadió este caso y 45 tests focales pasan. La comprobación de PostgreSQL demuestra actualización de precio y desactivación de express sin restart.

Se hicieron tres ejecuciones por viewport, 2560×1440 y 390×844, con la misma configuración de Chromium, assets/cesta ficticia y bloqueo equivalente de JavaScript inicial para comparar geometría. El HTML corregido lee métodos de PostgreSQL real; resumen/cesta HTTP están simulados. Los controles de envío miden **116 px antes y después** en las 12 navegaciones. Se registran los cambios de layout y sus nodos en `shipping-layout-*.json`: incluyen textos de subtotal/envío/total y, en una muestra, `.ci-info`/`.ci-price`, además de nodos sin identificador. No se atribuyen todos a un único elemento.

| Viewport | CLS observado antes: mediana [mín–máx] | Después: mediana [mín–máx] |
|---|---|---|
| 2560×1440 | 0,000377 [0,000377–0,000504] | 0,000132 [0,000132–0,000997] |
| 390×844 | 0,005620 [0,005620–0,006305] | 0,002843 [0,002843–0,005620] |

Ambas medianas bajan; una muestra de escritorio supera el rango anterior. Con tres ejecuciones y valores tan pequeños no se concluye una mejora general de CLS. Sí queda comprobada la altura estable de las filas de envío. Estos ensayos verifican la regresión visual de UX-02; **no constituyen una nueva comparación de velocidad** ni sustituyen las mediciones anteriores de rendimiento.

Navegador: seis casos seleccionados de cesta/recomendados, cierre del popup, persistencia y cambio de propietario; seis casos de acreditaciones en escritorio y móvil (libro y METACRILATOS); seis comparaciones de envío, cada una con antes/después; y un registro que recibe el desafío de correo, conserva el modal abierto, la cesta y el estado anónimo. **19 casos aprobados.** El último usa API simulada y el bundle definitivo; el backend de registro se comprueba separadamente mediante HTTP/DB real. Las pruebas DOM y de framing de la suite general conservan candidatos de imagen/zoom y configuración. No se afirma haber validado zoom real del navegador ni dispositivos no ejecutados.

### 11.7. Migraciones, históricos y requisitos posteriores

Migraciones nuevas, probadas únicamente en bases desechables:

1. `20261017160000_recover_stripe_webhooks`: payload/resultados, leases/intent/reintento, índices, tabla CheckoutEffect privada y clasificación de eventos antiguos no procesados como REVIEW. También sustituye `cronox_order_paid_push()` para conservar un aviso único cuando el primer PAID llega tras DISPUTED. No inventa payload ni marca compras como cumplidas. El SQL completo final se ejecutó desde la forma previa dentro de una transacción, incluyendo triggers diferidos, y se revirtió conservando 132 recibos ficticios. El UPDATE de eventos históricos se sitúa después del DDL para evitar eventos diferidos pendientes.
2. `20261017160100_link_circle_promotion_review`: FK nullable y única de promoción a la revisión de su ciclo. Sin backfill heurístico ni alteración de fechas de clientes.

Preparar backup y aplicar migraciones antes de arrancar el código nuevo en un entorno de publicación. Mantener el rol backend con permisos adecuados sobre tablas privadas; no otorgar acceso a `anon`/`authenticated`. Habilitar el worker en el servicio que reciba pagos y supervisar REVIEW/FAILED y tareas de correo. El perfil normal de revisión local sigue desactivándolo. No ejecutar las reparaciones históricas como parte automática del despliegue.

Procedimientos revisables, sin aplicación real:

- `scripts/review-promotion-links-local.cjs`: dry-run por defecto, mapa explícito con IDs, huellas de ambos registros y referencia de evidencia independiente; aplicación local exige actor SUPERADMIN, valida estados y deja auditoría idempotente. No empareja por proximidad de fechas ni cambia círculos/QR.
- `scripts/review-deferred-email-local.cjs`: lista jobs de revisión sin cuerpo/destinatarios; reactivación local por ID/versión/actor y validación de configuración/cifrado. No envía ni reactiva resultados UNKNOWN.
- `scripts/review-stripe-recovery.cjs`: inventario READ ONLY de base local exacta. Eventos sin payload necesitan una reentrega firmada o conciliación del operador; el retry exige autenticación/auditoría y causa reparada.
- SEC-01/DOM-02: la recuperación verificada resuelve cuentas sin contraseña aunque el flag histórico sea false. No se restauraron flags ni se alteraron posibles cuentas afectadas por la vulnerabilidad anterior.
- SEC-04: [checklist del operador](../output/playwright/audit-fixes-20261017/security/SEC-04-operator-checklist.md). La ausencia de evidencia externa de revocación sigue siendo un pendiente concreto.

Los cambios se agrupan en autenticación/usuarios/newsletter; pagos/pedidos/worker y esquema; decisiones de círculos; cola de correo; compras manuales y retry serializable; CSRF; contratos de perfil/portes/SEO; frontend de registro, cupón, cesta y perfil; pruebas; manifests/locks y documentación. Los anexos por área enumeran archivos y pruebas. No se hizo limpieza general de diseños, listeners o métodos de pago.

### 11.8. Verificación conjunta y límites de publicación

La suite conjunta de pruebas automatizadas ejecutó **258 suites / 2732 pruebas**, todas aprobadas. Tras los ajustes finales de aislamiento/recuperación y parches de dependencias se ejecutaron las pruebas focales correspondientes, sin repetir indiscriminadamente la suite completa. `full-jest.json`, las evidencias focales, los resultados de navegador y los artefactos de compilación quedan en `output/playwright/audit-fixes-20261017/`.

Verificación posterior focal: pagos/pedidos/aislamiento **13 suites / 184 tests**, dependencias **7 / 69**, envío SSR/cliente **2 / 45**, versión de assets **1 / 4**, además de los 19 casos de navegador. Typecheck backend y frontend aprobados. Vite produce los bundles; Nest compila en una salida aislada con las mismas **363 fuentes de producción y cero specs** del build normal y copia las plantillas. Su `main` real pasa ocho controles HTTP, incluyendo ready, cesta/tienda, cabeceras/CSRF y rechazo de accesos privados; el proceso de prueba se cierra. No se sobrescribe `dist` del servidor habitual.

Integridad: los 59 archivos inicialmente pendientes siguen presentes; 32 conservan exactamente el hash y 27 reciben cambios acotados de esta fase. Se verifican once archivos especialmente sensibles de las optimizaciones, incluido el informe de rendimiento, con hashes idénticos. Los tres informes originales ampliados conservan íntegramente su texto previo. El índice y HEAD no cambian. Durante la instalación npm se detectó que el repositorio versiona dependencias raíz: se restauraron exactamente los 6.043 archivos versionados que npm había retirado como extraneous, sin tocar parches/manifests. El lock interno conserva las 170 entradas anteriores y sólo actualiza los tres campos de source-map-js 1.2.2. Evidencias: `integrity-after.json`, `tracked-install-restoration.json` y `tracked-install-metadata-final.json`.

Los fallos prioritarios tienen reproducciones que fallan con la referencia inicial y pasan con la corrección; no se basan sólo en mocks de Prisma. Las pruebas de proveedor son **simuladas**. No se reutiliza como prueba de este código el pago sandbox de la fase anterior de rendimiento. No hubo cobros ni comunicaciones reales durante esta intervención.

No se han observado regresiones en las comprobaciones ejecutadas. **No equivale a autorización para publicar:** quedan por verificar la revocación histórica de SEC-04, tratar/aceptar el riesgo residual de MNT-01, aplicar las dos migraciones en el entorno autorizado y preparar la supervisión/revisión de pagos y cola de correo. Las reparaciones históricas reales necesitan evidencia y revisión independiente. Estos pendientes proceden del diagnóstico previo o de la puesta en servicio del mecanismo corregido; no se presentan como fallos nuevos de la optimización visual.

Se conservan las cuatro bases ficticias de esta fase para revisar las evidencias; sus destinos exactos figuran en `environment-manifest.json`. Los servidores de prueba se han cerrado, incluido el compilado final en 3026. `compiled-final-validation.json` y `compiled-build-inputs.json` vinculan la última compilación y las ocho comprobaciones HTTP con los hashes de las fuentes finales.

El informe de rendimiento anterior permanece conservado. El backend del servidor habitual en 3000 no se ha sustituido ni su base migrado: las pruebas del código nuevo se ejecutan en los entornos aislados descritos. La revisión de código/artefactos locales no debe confundirse con tener ya publicadas las correcciones en esa instancia o en cronox.es.

## 12. Cierre previo a publicar — actualización posterior del 17/10/2026

El [procedimiento de prepublicación](audit-prepublication-2026-10-17.md) concreta secretos, dependencias, orden de publicación, recuperación y supervisión. Conserva íntegra la evidencia anterior. **Ahora localhost:3000 sí ejecuta las correcciones actuales**, sobre `cronox_dev` migrada y con Prisma regenerado; esta actualización sustituye sólo la situación local descrita al final de la sección 11.

Cambios adicionales acotados: transacción explícita en cada una de las dos migraciones; estado operativo del worker en el GET protegido de recuperación, con fecha del último sondeo y código de fallo sin datos privados; desactivación del opt-in SMTP exclusivamente en `.env.local`. No se modifican diseño, configuración de acreditaciones, catálogo, tarifas ni el informe de rendimiento. Los parches de dependencias anteriores se conservan; no hay un parche compatible adicional que cierre las tres causas residuales.

Se restauró el respaldo local en otra base y se verificó rollback ante un fallo al final de cada migración antes de aplicarlas mediante Prisma. AppModule compilado arranca el worker en el ensayo aislado y recupera automáticamente un fallo después de 15 segundos reales; el resultado queda registrado y las incidencias REVIEW son visibles. El perfil normal mantiene ese worker desactivado deliberadamente y bloquea operaciones externas. Pruebas nuevas: 24 focales, seis de aislamiento/mantenimiento, 14 controles HTTP, recorrido real de cesta/recomendados/persistencia y backend compilado/typecheck correctos. Proveedores simulados; sin pagos/comunicaciones externos.

SEC-04 sigue abierto: faltan evidencias de revocación de `DB-a706e1d8959d` (Supabase PostgreSQL) y `JWT-030067abdc90` / `JWT-bd9c066e8f8d` (CRONOX). Son identificadores por hash, no valores de secretos. MNT-01 mantiene decisión expresa pendiente sobre braces 3.0.3, sprintf-js 1.0.3 y deepmerge-ts 7.1.5 de Prisma. La consulta de sólo lectura al VPS confirma esas versiones en disco y los parches runtime aún sin publicar, sin importar esos tres paquetes directamente desde las fuentes/compilados revisados. No se consultó su entorno PM2 ni su base de datos. La falta de portes de la base local es previa y no constituye un bloqueo nuevo del código preparado. La publicación requiere además ventana y operador para mantenimiento/backup/recuperación y supervisión del worker.

Evidencias: `output/playwright/prepublish-20261017/`. Sin commit, push, despliegue, modificación de producción, rotación de claves ni reparación histórica real.

**Confirmación posterior del propietario, 17/10/2026:** declara que `DB-a706e1d8959d`, `JWT-030067abdc90` y `JWT-bd9c066e8f8d` ya no son válidas y que la sustitución coordinada está preparada. Es confirmación del propietario, no comprobación independiente del agente; no se afirma que la sustitución esté ejecutada. Se conserva la evidencia anterior y su alcance. La decisión sobre braces, sprintf-js y deepmerge-ts continúa pendiente, sin aceptación implícita de riesgo ni autorización para publicar.
