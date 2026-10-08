LIVE STATS - revisión local, 30/09/2026

Actualización 08/10/2026: las reglas de consentimiento y deduplicación de este
informe antiguo han sido sustituidas por docs/live-stats-2026-10-08.md.
La presencia temporal funciona con cualquier elección de cookies; el histórico
diario conserva el consentimiento. Para la revisión actual usa review.cli.js,
capture.cli.js y cronox-backend/scripts/review-live-stats-sql.cjs.

URL: http://localhost:3000/admin.html#section-live-stats

Definiciones
- Visitantes: una cookie aleatoria firmada por navegador, caducidad 24 horas,
  almacenada en PostgreSQL únicamente como hash. Actividad: señal válida hace
  menos de 2 minutos según el reloj de la base. Con sesión / Sin sesión se
  derivan de la sesión validada, nunca de un rol enviado por el navegador.
- Solo se mide con consentimiento analítico. ADMIN/SUPERADMIN y páginas admin
  quedan fuera. La presencia no toca la actividad de autenticación ni refresca
  tokens de sesión. Distintos navegadores/dispositivos cuentan por separado.
- Cestas: visitantes activos con unidades; suma de cantidades por cesta única;
  productos distintos por Product.id, no por variante. Se consulta Cart/CartItem
  existentes, incluyendo la unión de invitado al iniciar sesión.
- Checkout: una cesta con unidades, página checkout comunicada recientemente y
  sin snapshot previo, o último snapshot RESERVED/PAYMENT_INTENT_CREATING/
  PAYMENT_BOUND aún vigente y sin pedido. Una misma cesta cuenta una vez.
- Pagos: snapshots PAYMENT_BOUND sin pedido, con modo real confirmado y estado
  processing o requires_action observado en webhook firmado. requires_action
  caduca con la reserva; processing continúa hasta una señal terminal del
  proveedor, aunque el navegador se cierre. Crear un intento no cuenta.
- Compras: pedidos online con paidAt real en los últimos 30 minutos y modo real
  confirmado por el webhook. Cada pedido cuenta una vez, incluso reembolsado.
  Pedidos manuales y antiguos sin modo verificable quedan fuera; no se infiere.
- Ubicación: última sección visible comunicada; una sección por visitante.
  Productos: hasta 5 Product activos, orden por visitantes descendente e ID.

Arquitectura y límites
- Heartbeat cada 30 segundos visible; se pausa oculto y vuelve al regresar.
  Una consulta compartida cada 15 segundos mientras la pestaña administrativa
  está visible, también fuera de Live stats y en admin-user.html. Indicador REC
  activo si visitors.total > 0; cero lo oculta; error indica estado no disponible.
  Sin temporizador adicional al abrir el panel. Conserva datos
  antiguos ante error, con advertencia y botón de reintento.
- Una consulta SQL ofrece una instantánea y un reloj común. PostgreSQL compartido
  evita mapas separados entre procesos PM2. Se revisó el deploy.sh existente:
  reinicia PM2, pero no se ha reiniciado ni desplegado nada en esta tarea.
- Limpieza al consultar/enviar presencia y cada minuto cuando los trabajos
  están habilitados. En local, con trabajos desactivados, la caducidad sigue
  siendo inmediata en las métricas y el borrado es oportunista al consultar.
- Web Locks serializa las señales entre pestañas. Fallback con lease temporal
  en localStorage para navegadores antiguos; sin almacenamiento compartido se
  omite la señal. Bloqueadores, falta de consentimiento y pérdida de conexión
  pueden reducir el conteo. Esto no identifica personas únicas ni evita bots.
- No se guardan rutas, parámetros, IP, correos ni direcciones en LivePresence.
  Se guardan referencias temporales a sesión/cesta/producto; no historial.
- RLS habilitado en LivePresence, sin permisos PUBLIC/anon/authenticated.
  Acceso a métricas con JwtAuthGuard y AdminGuard. Señales con DTO estricto,
  CSRF, límite de cuerpo 1 KiB y throttle existente de 120/minuto por proceso.
  La limitación HTTP existente no es un límite distribuido entre instancias;
  el upsert limita escrituras repetidas de la misma presencia en la base.

Migración y configuración pendiente para producción
- 20260930140000_live_stats: tabla efímera/RLS/índice; tres columnas opcionales
  en CheckoutSnapshot y dos índices de consulta. Aplicada SOLO a PostgreSQL
  local 127.0.0.1:5433/cronox_dev. Sin backfill ni cambios de datos de producción.
- Generar Prisma y aplicar esta migración antes de desplegar el código, en una
  tarea posterior autorizada. El rol backend necesita acceso a la nueva tabla.
- Verificar la suscripción del endpoint Stripe a payment_intent.processing,
  payment_intent.requires_action, payment_intent.payment_failed,
  payment_intent.canceled y payment_intent.succeeded. No se ha cambiado ni
  comprobado la configuración real de Stripe. Hasta recibir esos eventos,
  el backend no puede conocer esos estados. Sin sondeo del proveedor.
- No se han realizado cobros ni correos reales, ni validación en producción.

Archivos propios de esta funcionalidad (además de cambios previos preservados)
cronox-backend/prisma/schema.prisma
cronox-backend/prisma/migrations/20260930140000_live_stats/migration.sql
cronox-backend/src/live-stats/live-stats.controller.ts
cronox-backend/src/live-stats/live-stats.module.ts
cronox-backend/src/live-stats/live-stats.service.ts
cronox-backend/src/live-stats/live-stats.sql.ts
cronox-backend/src/live-stats/live-payment-observation.ts
cronox-backend/src/live-stats/live-stats.spec.ts
cronox-backend/src/app.module.ts
cronox-backend/src/main.ts
cronox-backend/src/payments/payments.module.ts
cronox-backend/src/payments/stripe-webhook.controller.ts
cronox-backend/src/frontend/live-stats.dom.spec.ts
cronox-backend/src/frontend/cookie-consent.spec.ts
cronox-front/admin.html
cronox-front/admin-user.html
cronox-front/assets/admin-live-stats.js
cronox-front/assets/admin-live-stats.css
cronox-front/assets/live-presence.js
cronox-front/assets/cookie-consent.js
cronox-front/src/admin/session.ts
cronox-front/assets/api.js (generado)
cronox-front/launch.html
cronox-front/newsletter-access.html
tests/live-stats/integration.cjs
tests/live-stats/browser.cjs
tests/live-stats/README.txt

Repetir verificaciones (servidor local normal activo; sin visitantes de prueba
adicionales durante integración, porque se comprueban cantidades exactas):
  npm run admin:build
  cd cronox-backend
  npm run build:compiled
  npm test -- --runInBand --runTestsByPath src/live-stats/live-stats.spec.ts src/frontend/live-stats.dom.spec.ts src/frontend/cookie-consent.spec.ts src/frontend/sliding-session.dom.spec.ts src/payments/stripe-webhook.controller.spec.ts src/frontend/category-pagination.spec.ts src/frontend/product-delivery.dom.spec.ts
  cd ..
  node tests/live-stats/integration.cjs
  node tests/live-stats/browser.cjs

Integración usa HTTP real, PostgreSQL local y fixtures temporales que elimina.
Las observaciones de pago son eventos locales simulados, sin llamar a Stripe.
Chromium verifica login normal, dos pestañas, datos reales, error/reintento,
consulta compartida fuera de sección, pausa al ocultar la pestaña, acceso móvil
y 320/390/768/1366 en claro y oscuro. Menú probado también a 390x400,
con desplazamiento hasta Cerrar sesión, movimiento reducido y caducidad real
de la última presencia local. Live stats está encima del separador de cuenta.
Capturas se generan en test-results/live-stats; las de esta revisión se conservan
en test-results/live-stats (ignorado por Git).
