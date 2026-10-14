# Checkout CRONOX · preparación de publicación del 14 de octubre de 2026

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
