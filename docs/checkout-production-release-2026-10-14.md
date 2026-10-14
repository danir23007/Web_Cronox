# Checkout CRONOX · preparación de publicación del 14 de octubre de 2026

Este informe corresponde a la publicación anterior `aeb3e38`. La entrega posterior `91d41e1` incorpora PayPal inferior y los estados Activo/Inactivo; la transferencia bancaria propia está actualmente deshabilitada por Dashboard. Ver [informe vigente de publicación conjunta](joint-checkout-account-release-2026-10-14.md).

Publicación autorizada por el usuario. Se mantienen un solo Express Checkout oficial, PayPal → Google Pay → Apple Pay según disponibilidad, layout adaptable y personalización de Google `plain` aceptados. La secuencia española de envío y el pago completo de Google Pay, Apple Pay físico y devolución bancaria efectiva permanecen pendientes aceptados; no se presentan como validados.

## Alcance seleccionado

Se revisó el diff frente a `6c6d00d3e5b7a94f9fc427ff33fb9b5a97222960`. La entrega incluye checkout, transferencia/stock/pedidos/webhooks, sus pruebas y controles de seguridad de entrega. No se encontraron cambios ajenos en esos hunks. Permanecen locales y sin publicar `src/main.ts`, `src/common/config/local-review-safety.ts` y su spec: sus cambios habilitan únicamente el entorno aislado del sandbox y no son necesarios en producción. Los helpers, claves y evidencias del sandbox están ignorados y no son dependencias del build ni del arranque productivo. El SDK/API se conservan; no hay cambio de selección de métodos del Dashboard.

## Comprobaciones LIVE sin cobros

- Clave secreta LIVE del servidor y clave publicable servida pertenecen a la misma cuenta: se recuperó en modo solo lectura un PaymentIntent existente con la clave publicable y su secreto obtenido del servidor, sin imprimirlo ni crear otro intento. La ausencia de `STRIPE_PUBLISHABLE_KEY` en el entorno del VPS no supone desacoplamiento: el frontend usa su configuración publicable existente y se verificó esa pareja.
- `cronox.es` está registrado y sus tres carteras activas. Se comprobó que `www.cronox.es` sirve también checkout y faltaba en dominios de pago; se registró ese dominio LIVE, quedando enabled con Apple/Google/PayPal active. No se cambiaron métodos de pago.
- Al endpoint productivo `https://www.cronox.es/api/webhooks/stripe` se añadieron únicamente `payment_intent.partially_funded` y `cash_balance.funds_available`, conservando todos los eventos anteriores y API `2025-10-29.clover`. Se guardó la configuración anterior junto al respaldo. El endpoint antiguo de desarrollo existente se dejó intacto por ser ajeno a esta publicación.
- Transferencias están disponibles en la configuración predeterminada LIVE. Bizum sigue con preferencia on y no disponible: no se simula aprobación. Los métodos regionales se muestran solo si Stripe los considera habilitados/elegibles; no se activó ni desactivó ninguno.
- Flags de sandbox/revisión local desactivados; trabajos activos y secreto HMAC apto. Node es accesible por su origen público y Nginx sobrescribe `X-Real-IP` por loopback. Se corrigió solo la identificación de red de reservas bancarias: confiar en esa cabecera exclusivamente desde loopback, usar el peer real para conexiones directas y no ampliar globalmente `trust proxy`. Cinco casos adicionales cubren IPv4/IPv6, cabecera falsificada e inválida.

## Respaldo, ensayo de migraciones y recuperación

Respaldo privado del esquema completo de aplicación `public` y copia privada del entorno: `/home/deploy/cronox-release-backups/checkout-20261014-zg7PPz`. SHA-256 del dump: `27005fe41777406eac6d5ac5507bd21569c15a14975468f536aa4008f64b904f`. Fuera de Git/webroot, permisos privados del operador. No incluye esquemas gestionados por el proveedor, objetos de almacenamiento ni archivos de correo.

El dump se obtuvo con snapshot PostgreSQL consistente y se restauró realmente en un clúster temporal separado, accesible solo por socket Unix y sin iniciar aplicación/trabajos. Coinciden los recuentos de las 100 tablas. Se aplicaron sobre esa restauración las dos migraciones y se verificaron las tres columnas nuevas, el índice activo válido y los mismos recuentos de filas. Manifiesto y `recovery-verified.json` permanecen junto al dump. La instancia de restauración se detuvo.

Migraciones revisadas: `20261013160000_bank_transfer_pending_reservation` reemplaza el índice de carrito activo para incluir el pedido bancario pendiente; `20261014000000_bank_transfer_abuse_protection` añade tres campos de admisión e índices, sin eliminar datos ni cambiar tablas de pedidos. El preflight de numeración productivo pasa.

Recuperación: preferir corrección hacia delante; las columnas e índices nuevos son compatibles con el esquema anterior y no deben eliminarse precipitadamente. Si hay que retroceder aplicación, impedir nuevas instrucciones bancarias desde la aplicación durante la intervención, inventariar pendientes/fondos/reservas y mantener una vía compatible para conciliarlos; no desactivar los métodos elegidos en el Dashboard. No revertir ciegamente el esquema mientras existan pedidos bancarios pendientes. La recuperación íntegra desde dump requiere mantenimiento, detener escritores/trabajos, preservar otro respaldo del estado averiado y conciliar pedidos/pagos posteriores al snapshot antes de restaurar; no sobrescribir producción automáticamente ni perder los nuevos eventos de Stripe. Ensayar siempre en base aislada antes de cualquier restauración real.

## Controles

La entrega se ensaya en un worktree separado con solo los archivos seleccionados, sin `.env` local y sin las modificaciones exclusivas del sandbox. Los resultados definitivos y el despliegue se documentarán tras terminar CI y verificar producción. No se harán cobros reales ni comunicaciones de prueba.

Prepublicación: worktree aislado aprobado con 2.266 pruebas en 230 suites, ocho controles Node, typecheck de admin/backend, builds de admin/backend, control de artefactos y smoke de rutas compiladas. No se usaron claves ni base del sandbox en esa entrega. La diferencia con el recuento local anterior corresponde a las pruebas de habilitación del sandbox que se conservan fuera de la publicación.

## Resultado de publicación

Código publicado en `aeb3e38a679a2d69236bd0c09e650beaa4c62140` mediante el flujo existente de `main`. [GitHub Actions 38489754886](https://github.com/danir23007/Web_Cronox/actions/runs/38489754886): `verify-release` y `deploy` concluyen success. El VPS confirma ese mismo commit; no se ejecutó un segundo despliegue manual. Se aplicaron ambas migraciones y no quedan migraciones fallidas.

Verificaciones posteriores:

- `/api/health` y `/api/ready`: HTTP 200. Catálogo público: siete productos. Checkout apex y dominio www disponibles. Los cinco JS/CSS de checkout revisados coinciden con el commit; el cuerpo HTML coincide y la cabecera recibe únicamente la transformación SEO existente.
- Navegador Chromium anónimo, 390 y 1440 px: un único Express Checkout, PayPal y Google Pay visibles, Apple Pay no disponible en ese navegador; ningún desbordamiento horizontal. Link, Amazon Pay, Klarna y Revolut Pay elegibles en Payment Element; transferencia propia visible y endpoint de disponibilidad true. No se tocó el Dashboard para alterar esas elegibilidades.
- Carrito anónimo temporal de una unidad del producto público, sin datos de comprador ni dirección. Total del servidor 4295 céntimos y visible 42,95 EUR. Cero solicitudes de crear PaymentIntent o iniciar transferencia, ninguna apertura de carteras LIVE ni confirmación de pago. Se vació el carrito al terminar. Stock de la variante: 12 antes y 12 después.
- Endpoint webhook rechaza una petición sin firma con HTTP 400. Stripe reenvió el evento LIVE original `evt_3UQ5mZCGnUu9AYNr0SkZI1rQ` (`payment_intent.canceled`), previamente PROCESSED, al único endpoint habilitado suscrito a ese tipo. Comando de reenvío aceptado y `pending_webhooks=0`, sin entregas pendientes. El registro PROCESSED y sus fechas permanecen idénticos; cero pedidos asociados y los mismos dos movimientos históricos de reserva/liberación, sin nuevos movimientos ni emails. Es un reenvío original firmado de Stripe, no una firma fabricada localmente y tampoco un pago nuevo. Informe privado `webhook-resend-verified.json` junto al respaldo.
- Capturas privadas en `output/playwright/checkout-express/production-express-{390,1440}.png` y `production-payment-visible-mobile.png`; no se versionan. El renderizado no acredita pagos físicos de carteras.

El túnel Cloudflare, los listeners Stripe y el servidor/gateway del sandbox se detuvieron; puertos locales 3000/3001 sin escucha y sin proceso cloudflared. El worktree temporal se eliminó verificando antes su ruta y desvinculando la junction de dependencias, sin borrar las dependencias originales. Las tres modificaciones locales de habilitación del sandbox, su `.env`, herramientas y evidencias permanecen conservadas y no publicadas. El archivo ajeno `main.ts.cronox-before-stripe` del VPS se preservó; no se descartaron cambios preexistentes de dependencias en ese servidor.

Pendientes aceptados tras publicar: secuencia de envío española y pago completo de Google Pay; Apple Pay físico; devolución bancaria efectiva. No se consideran aprobados por estas comprobaciones. No se hicieron cobros reales ni comunicaciones de prueba a clientes.
