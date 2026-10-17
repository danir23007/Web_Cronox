# Mapa de CRONOX para la auditoría del 17/10/2026

Inventario del código actual, HEAD `102a1b9111d91e8fb94a5b5bb91d71f3b0933d8f` más trabajo local previo. Sirve como índice de revisión; no afirma haber ejecutado cada operación ni autoriza integraciones externas. Los endpoints tienen prefijo global `/api`; expresiones/prefijos múltiples se conservan para no inventar rutas.

## Páginas HTML

- `cronox-front/admin-launch.html`
- `cronox-front/admin-login.html`
- `cronox-front/admin-user.html`
- `cronox-front/admin.html`
- `cronox-front/auth-modal.html`
- `cronox-front/aviso-legal.html`
- `cronox-front/cart.html`
- `cronox-front/checkout-success.html`
- `cronox-front/checkout.html`
- `cronox-front/cookie-policy.html`
- `cronox-front/develop.html`
- `cronox-front/email-change.html`
- `cronox-front/events.html`
- `cronox-front/faqs.html`
- `cronox-front/favorites.html`
- `cronox-front/forgot-password.html`
- `cronox-front/gallery.html`
- `cronox-front/index.html`
- `cronox-front/key-screen.html`
- `cronox-front/launch.html`
- `cronox-front/metacrilatos-preview.html`
- `cronox-front/newsletter-access.html`
- `cronox-front/privacy-policy.html`
- `cronox-front/producto.html`
- `cronox-front/profile.html`
- `cronox-front/reset-password.html`
- `cronox-front/returns-exchanges.html`
- `cronox-front/shipping-policy.html`
- `cronox-front/sobre-cronox.html`
- `cronox-front/terms-of-service.html`

Rutas limpias y redirecciones: `cronox-backend/src/common/routing/public-pages.ts`. Las páginas legacy conservan usos de compatibilidad o estado de retirada; no se declaran sobrantes por una búsqueda de referencias.

## Controladores y operaciones

### cronox-backend/src/accreditations/accreditations.controller.ts

Prefijo(s) declarados: `'accreditations'; 'admin/accreditations'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'active'` | 19 |
| GET | `(vacío)` | 28 |
| GET | `':id/preview-data'` | 30 |
| GET | `':id/preview'` | 36 |
| POST | `':id/activate'` | 57 |
| PATCH | `':id'` | 61 |

### cronox-backend/src/addresses/addresses.controller.ts

Prefijo(s) declarados: `'me/addresses'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 25 |
| POST | `(vacío)` | 30 |
| PATCH | `':id'` | 38 |
| DELETE | `':id'` | 47 |
| PATCH | `':id/default'` | 56 |

### cronox-backend/src/admin/audit-logs/admin-audit-logs.controller.ts

Prefijo(s) declarados: `'admin/audit-logs'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 23 |
| DELETE | `(vacío)` | 28 |
| GET | `'users/:id'` | 35 |

### cronox-backend/src/admin/bulk/admin-bulk.controller.ts

Prefijo(s) declarados: `'admin/bulk'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'users/selection'` | 22 |
| GET | `'products/selection'` | 28 |
| POST | `'preview'` | 34 |
| POST | `'execute'` | 40 |
| GET | `'operations/:id'` | 46 |

### cronox-backend/src/admin/categories/admin-categories.controller.ts

Prefijo(s) declarados: `'admin/categories'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 30 |
| POST | `(vacío)` | 36 |
| PATCH | `':id'` | 41 |
| DELETE | `':id'` | 49 |

### cronox-backend/src/admin/circle-upgrades/admin-circle-promotions.controller.ts

Prefijo(s) declarados: `'admin/requests/2-3'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 16 |

### cronox-backend/src/admin/circle-upgrades/admin-circle-upgrades.controller.ts

Prefijo(s) declarados: `'admin/circle-upgrades/3-4'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 18 |
| PATCH | `':id/approve'` | 24 |
| PATCH | `':id/deny'` | 33 |

### cronox-backend/src/admin/dashboard/admin-dashboard.controller.ts

Prefijo(s) declarados: `'admin/dashboard'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'pending-counts'` | 11 |
| GET | `(vacío)` | 16 |

### cronox-backend/src/admin/exports/admin-exports.controller.ts

Prefijo(s) declarados: `'admin/exports'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'users'` | 32 |
| GET | `'orders'` | 42 |
| GET | `'products'` | 52 |
| GET | `'inventory'` | 62 |
| GET | `'circles'` | 72 |
| GET | `'promo-codes'` | 82 |
| GET | `'audit'` | 92 |
| GET | `':module'` | 104 |

### cronox-backend/src/admin/favorites/admin-favorites.controller.ts

Prefijo(s) declarados: `'admin/favorites'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 31 |

### cronox-backend/src/admin/finance/admin-finance.controller.ts

Prefijo(s) declarados: `'admin/finance'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 25 |

### cronox-backend/src/admin/inventory/admin-inventory.controller.ts

Prefijo(s) declarados: `'admin/inventory'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 30 |
| GET | `'summary'` | 35 |
| GET | `':productId/history'` | 40 |
| GET | `':productId'` | 48 |
| PATCH | `':productId'` | 53 |

### cronox-backend/src/admin/manual-purchases/admin-manual-purchases.controller.ts

Prefijo(s) declarados: `'admin/users'; 'admin/orders'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':id/in-person-purchase-options'` | 22 |
| GET | `':id/in-person-purchases/:orderId'` | 27 |
| PATCH | `':id/in-person-purchases/:orderId'` | 32 |
| POST | `':id/in-person-purchases'` | 41 |
| POST | `':id/statistics-exclusion'` | 58 |
| POST | `':id/void-manual'` | 68 |

### cronox-backend/src/admin/map/admin-map.controller.ts

Prefijo(s) declarados: `'admin/map'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 32 |

### cronox-backend/src/admin/notes/admin-notes.controller.ts

Prefijo(s) declarados: `'admin/notes'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 20 |
| POST | `(vacío)` | 25 |
| PATCH | `':id'` | 33 |
| DELETE | `':id'` | 43 |

### cronox-backend/src/admin/orders/admin-orders.controller.ts

Prefijo(s) declarados: `'admin/orders'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 41 |
| GET | `'export.csv'` | 46 |
| GET | `':id'` | 62 |
| PATCH | `':id/status'` | 67 |
| PATCH | `':id/fulfillment'` | 75 |
| POST | `':id/label'` | 84 |
| GET | `':id/label'` | 99 |
| POST | `':id/mark-shipped'` | 115 |
| POST | `':id/mark-delivered'` | 120 |
| POST | `':id/refund'` | 125 |

### cronox-backend/src/admin/points/admin-points.controller.ts

Prefijo(s) declarados: `'admin/sale-points'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'options'` | 23 |
| GET | `(vacío)` | 26 |
| GET | `':id'` | 29 |
| POST | `(vacío)` | 38 |
| POST | `':id'` | 45 |
| POST | `':id/sales'` | 53 |
| POST | `':id/sales/:saleId/correct'` | 61 |
| POST | `':id/sales/:saleId/returns'` | 70 |
| POST | `':id/sales/:saleId/date'` | 79 |
| POST | `':id/expenses'` | 88 |

### cronox-backend/src/admin/products/admin-products.controller.ts

Prefijo(s) declarados: `'admin/products'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 73 |
| GET | `'order'` | 78 |
| PATCH | `'order'` | 83 |
| GET | `':id'` | 91 |
| POST | `(vacío)` | 96 |
| POST | `'upload-images'` | 105 |
| PATCH | `':id'` | 122 |
| PATCH | `':productId/categories'` | 131 |
| DELETE | `':id'` | 150 |
| DELETE | `':productId/images/:imageId'` | 158 |
| POST | `':productId/variants'` | 173 |
| PATCH | `':productId/variants/:variantId'` | 181 |
| DELETE | `':productId/variants/:variantId'` | 190 |
| PATCH | `':productId/variants/:variantId/adjust-stock'` | 198 |

### cronox-backend/src/admin/promo-codes/admin-promo-codes.controller.ts

Prefijo(s) declarados: `'admin/promo-codes'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 21 |
| POST | `(vacío)` | 26 |
| PATCH | `':id'` | 31 |
| DELETE | `':id'` | 40 |

### cronox-backend/src/admin/qr-events/qr-events.controller.ts

Prefijo(s) declarados: `'admin/qr-events'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 30 |
| POST | `(vacío)` | 35 |
| GET | `':id'` | 40 |
| GET | `':id/participants'` | 45 |
| POST | `':id/scan'` | 53 |

### cronox-backend/src/admin/stock/admin-stock.controller.ts

Prefijo(s) declarados: `'admin/stock/movements'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 12 |

### cronox-backend/src/admin/users/admin-users.controller.ts

Prefijo(s) declarados: `'admin/users'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 33 |
| GET | `'edit-options'` | 38 |
| GET | `':id'` | 44 |
| PATCH | `':id/role'` | 50 |
| PATCH | `':id'` | 66 |
| GET | `':id/audit-logs'` | 82 |
| GET | `':id/requests'` | 88 |
| GET | `':id/orders'` | 97 |

### cronox-backend/src/analytics/admin-customer-analytics.controller.ts

Prefijo(s) declarados: `'admin/users'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':id/analytics/summary'` | 23 |
| GET | `':id/analytics/products'` | 28 |
| GET | `':id/analytics/timeline'` | 33 |
| GET | `':id/login-history'` | 41 |

### cronox-backend/src/analytics/analytics.controller.ts

Prefijo(s) declarados: `'analytics'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'config'` | 15 |
| POST | `'consent'` | 20 |
| POST | `'events'` | 31 |

### cronox-backend/src/analytics/visitor-history.controller.ts

Prefijo(s) declarados: `'analytics/visits'; 'admin/visitors'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'consent-revoked'` | 70 |
| GET | `'session'` | 80 |
| POST | `(vacío)` | 91 |
| GET | `(vacío)` | 130 |
| GET | `'day'` | 133 |

### cronox-backend/src/app.controller.ts

Prefijo(s) declarados: `(raíz)`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'health'` | 10 |
| GET | `'ready'` | 16 |

### cronox-backend/src/auth/auth.controller.ts

Prefijo(s) declarados: `'auth'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'register'` | 57 |
| POST | `'launch-login'` | 94 |
| POST | `'newsletter-login'` | 109 |
| POST | `'login'` | 124 |
| POST | `'logout'` | 162 |
| GET | `'csrf'` | 182 |
| GET | `'me'` | 192 |
| GET | `'profile'` | 202 |
| POST | `'refresh'` | 208 |
| POST | `'activity'` | 237 |
| POST | `'visit'` | 247 |
| POST | `'change-password'` | 273 |
| POST | `'forgot-password'` | 283 |
| POST | `'reset-password'` | 290 |

### cronox-backend/src/auth/launch-campaign.controller.ts

Prefijo(s) declarados: `'admin/launch'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 14 |
| POST | `'arm'` | 17 |
| POST | `'disarm'` | 19 |
| POST | `'resume'` | 21 |

### cronox-backend/src/cart/cart.controller.ts

Prefijo(s) declarados: `'cart'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 44 |
| POST | `'items'` | 63 |
| PATCH | `'items/:id'` | 83 |
| DELETE | `'items/:id'` | 107 |
| DELETE | `(vacío)` | 129 |

### cronox-backend/src/categories/categories.controller.ts

Prefijo(s) declarados: `'categories'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 16 |
| GET | `':slug/products'` | 23 |

### cronox-backend/src/email/email.controller.ts

Prefijo(s) declarados: `'dev/email'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'test'` | 26 |

### cronox-backend/src/email/managed/managed-mail.controller.ts

Prefijo(s) declarados: `'admin/mail-templates'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':key/families'` | 52 |
| POST | `':key/families'` | 55 |
| PATCH | `':key/families/:id'` | 61 |
| PATCH | `':key/families/:id/versions/:circle'` | 68 |
| POST | `':key/signatures/preview'` | 76 |
| GET | `(vacío)` | 91 |
| GET | `'catalog'` | 94 |
| GET | `'deliveries'` | 97 |
| POST | `':key/initialize'` | 118 |
| GET | `':key/folders'` | 124 |
| POST | `':key/folders'` | 129 |
| PATCH | `':key/folders/order'` | 136 |
| PATCH | `':key/folders/:id'` | 143 |
| DELETE | `':key/folders/:id'` | 151 |
| GET | `':key/templates'` | 159 |
| GET | `':key/templates/:id'` | 165 |
| GET | `':key/templates/:id/draft-targets'` | 171 |
| POST | `':key/templates'` | 177 |
| PATCH | `':key/templates/:id'` | 184 |
| PATCH | `':key/templates/:id/drafts'` | 192 |
| POST | `':key/templates/:id/actions'` | 200 |
| GET | `':key/templates/:id/versions'` | 208 |
| POST | `':key/preview'` | 214 |
| POST | `':key/templates/:id/test'` | 220 |
| GET | `':key/signatures'` | 230 |
| POST | `':key/signatures'` | 235 |
| PATCH | `':key/signatures/:id'` | 242 |
| GET | `':key/assets'` | 250 |
| POST | `':key/assets'` | 265 |
| GET | `':key/assets/:id/usage'` | 303 |

### cronox-backend/src/favorites/favorites.controller.ts

Prefijo(s) declarados: `'favorites'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 18 |
| GET | `'products'` | 24 |
| POST | `(vacío)` | 30 |
| POST | `'toggle'` | 39 |
| DELETE | `':productId'` | 51 |

### cronox-backend/src/footer/admin-footer.controller.ts

Prefijo(s) declarados: `'admin/footer'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 18 |
| PATCH | `(vacío)` | 23 |
| GET | `'pages/:slug'` | 31 |
| PATCH | `'pages/:slug'` | 36 |

### cronox-backend/src/footer/footer.controller.ts

Prefijo(s) declarados: `'footer'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 8 |
| GET | `'pages/:slug'` | 13 |

### cronox-backend/src/gallery/admin-gallery.controller.ts

Prefijo(s) declarados: `'admin/gallery'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'slots'` | 51 |
| GET | `'configuration'` | 56 |
| GET | `'assets'` | 61 |
| GET | `'assets/:id'` | 66 |
| GET | `'products'` | 71 |
| POST | `'assets'` | 76 |
| PATCH | `'slots/reorder'` | 93 |
| PATCH | `'slots/:key'` | 101 |
| PATCH | `'mode'` | 110 |
| PATCH | `'carousel/reorder'` | 118 |
| PATCH | `'carousel/:position'` | 126 |

### cronox-backend/src/gallery/gallery.controller.ts

Prefijo(s) declarados: `'gallery'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 10 |

### cronox-backend/src/key-screen/key-screen.controller.ts

Prefijo(s) declarados: `'key-screen'; 'admin/key-screens'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 38 |
| POST | `'preregister'` | 44 |
| GET | `(vacío)` | 57 |
| POST | `(vacío)` | 60 |
| PATCH | `'master'` | 66 |
| PATCH | `'expiration'` | 72 |
| PATCH | `'active'` | 78 |
| PATCH | `':id'` | 84 |
| DELETE | `':id'` | 91 |
| POST | `'media'` | 94 |

### cronox-backend/src/live-stats/live-stats.controller.ts

Prefijo(s) declarados: `(raíz)`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'live-stats/presence'` | 18 |
| GET | `'admin/live-stats'` | 25 |

### cronox-backend/src/mailbox/mailbox-tracking.controller.ts

Prefijo(s) declarados: `'mailbox-access'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':token'` | 23 |
| POST | `'arrival'` | 28 |

### cronox-backend/src/mailbox/mailbox-unsubscribe.controller.ts

Prefijo(s) declarados: `'mailbox-unsubscribe'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':token'` | 9 |
| POST | `':token'` | 26 |

### cronox-backend/src/mailbox/mailbox.controller.ts

Prefijo(s) declarados: `'admin/mailbox'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'overview'` | 265 |
| GET | `'schedule-preview'` | 268 |
| GET | `'administrators'` | 274 |
| POST | `'suppressions'` | 283 |
| GET | `'messages'` | 289 |
| GET | `'messages/:id'` | 292 |
| GET | `'messages/:id/status'` | 295 |
| POST | `'messages/:id/action'` | 300 |
| POST | `'boxes'` | 307 |
| PATCH | `'boxes/:id'` | 313 |
| POST | `'boxes/:id/test'` | 320 |
| POST | `'boxes/:id/refresh'` | 326 |
| GET | `'drafts'` | 331 |
| DELETE | `'drafts/:id'` | 334 |
| GET | `'boxes/:id/campaign-audience'` | 343 |
| GET | `'boxes/:id/campaign-recipients.xlsx'` | 346 |
| POST | `'boxes/:id/campaign-draft'` | 352 |
| POST | `'boxes/:id/campaign'` | 356 |
| GET | `'boxes/:id/campaign-options'` | 363 |
| GET | `'boxes/:id/templates'` | 367 |
| POST | `'boxes/:id/template'` | 373 |
| GET | `'drafts/:id/recipients'` | 385 |
| POST | `'drafts/:id/campaign'` | 391 |
| GET | `'campaigns/:id'` | 400 |
| POST | `'campaigns/:id/cancel'` | 406 |
| POST | `'campaigns/:id/edit'` | 412 |
| POST | `'drafts'` | 415 |
| GET | `'drafts/:id'` | 418 |
| PATCH | `'drafts/:id'` | 421 |
| POST | `'drafts/:id/send'` | 428 |
| POST | `'drafts/:id/clone'` | 433 |
| DELETE | `'files/:id'` | 440 |
| POST | `'drafts/:id/files'` | 443 |
| GET | `'files/:id'` | 467 |
| GET | `'push/config'` | 508 |
| GET | `'push/devices'` | 512 |
| POST | `'push/devices'` | 515 |
| DELETE | `'push/devices/:id'` | 518 |
| PATCH | `'push/devices/:id'` | 524 |
| POST | `'push/logout'` | 531 |
| GET | `'notices'` | 534 |
| GET | `'audit'` | 537 |

### cronox-backend/src/me/email-change.controller.ts

Prefijo(s) declarados: `'me/email-change'; 'email-change'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 20 |
| POST | `(vacío)` | 21 |
| POST | `'resend'` | 23 |
| POST | `'cancel'` | 25 |
| POST | `'inspect'` | 31 |
| POST | `'confirm'` | 33 |

### cronox-backend/src/me/me.controller.ts

Prefijo(s) declarados: `'me'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 14 |
| PUT | `(vacío)` | 19 |
| GET | `'address'` | 24 |
| PUT | `'address'` | 29 |
| GET | `'orders'` | 34 |

### cronox-backend/src/media-framing/media-framing.controller.ts

Prefijo(s) declarados: `'media-framing'; 'admin/media'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 45 |
| GET | `'placements'` | 58 |
| GET | `'placements/:key'` | 63 |
| GET | `'library'` | 68 |
| POST | `'placements/:key/assets'` | 73 |
| PATCH | `'placements/:key/asset'` | 88 |
| PATCH | `'placements/:key'` | 97 |
| POST | `'placements/:key/reset'` | 106 |

### cronox-backend/src/membership/circle-upgrade.controller.ts

Prefijo(s) declarados: `'upgrade/3-4'; 'admin/upgrade/3-4'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'status'` | 13 |
| POST | `(vacío)` | 18 |
| PATCH | `':id'` | 29 |

### cronox-backend/src/membership/circle.controller.ts

Prefijo(s) declarados: `'account/circle'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'request'` | 11 |

### cronox-backend/src/membership/membership.controller.ts

Prefijo(s) declarados: `'membership'; 'm'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'me/accreditation'` | 11 |
| GET | `'me/qr'` | 18 |
| GET | `'me/stats'` | 28 |
| GET | `':publicMemberToken'` | 39 |

### cronox-backend/src/newsletter/admin-newsletter.controller.ts

Prefijo(s) declarados: `'admin/newsletter'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 31 |
| GET | `'assets'` | 36 |
| POST | `'assets'` | 41 |
| PATCH | `(vacío)` | 55 |

### cronox-backend/src/newsletter/newsletter.controller.ts

Prefijo(s) declarados: `'newsletter'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'config'` | 20 |
| POST | `'subscribe'` | 26 |
| POST | `'request-access'` | 33 |
| GET | `'confirm'` | 40 |

### cronox-backend/src/orders/checkout-summary.controller.ts

Prefijo(s) declarados: `'checkout'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'express-quote'` | 36 |
| GET | `'summary'` | 59 |
| POST | `'apply-promo'` | 92 |

### cronox-backend/src/orders/orders.controller.ts

Prefijo(s) declarados: `(raíz)`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'checkout/session'` | 37 |
| GET | `'orders/payment-status'` | 96 |
| GET | `'orders/current-checkout-payment-status'` | 123 |
| GET | `'orders'` | 137 |
| GET | `'orders/:id'` | 161 |

### cronox-backend/src/payments/bank-transfer.controller.ts

Prefijo(s) declarados: `'payments/bank-transfer'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'availability'` | 33 |
| POST | `(vacío)` | 40 |
| GET | `(vacío)` | 52 |
| POST | `'cancel'` | 60 |
| POST | `'resume'` | 68 |

### cronox-backend/src/payments/payments-api.controller.ts

Prefijo(s) declarados: `'payments'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'create-payment-intent'` | 21 |

### cronox-backend/src/payments/payments.controller.ts

Prefijo(s) declarados: `'checkout'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'payment-intent'` | 21 |

### cronox-backend/src/payments/stripe-webhook.controller.ts

Prefijo(s) declarados: `(raíz)`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `'admin/orders/:id/confirmation-email'` | 52 |
| POST | `'webhooks/stripe'` | 70 |
| POST | `'payments/webhook'` | 85 |

### cronox-backend/src/products/product.controller.ts

Prefijo(s) declarados: `'products'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 36 |
| GET | `'suggestions'` | 44 |
| GET | `':slug'` | 56 |
| POST | `(vacío)` | 65 |
| PUT | `':id'` | 79 |
| PATCH | `':id'` | 90 |
| DELETE | `':id'` | 101 |
| DELETE | `':id/images/:imageId'` | 112 |

### cronox-backend/src/products/variant.controller.ts

Prefijo(s) declarados: `'products/:productId/variants'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| POST | `(vacío)` | 26 |
| PATCH | `':variantId'` | 37 |
| PATCH | `':variantId/adjust-stock'` | 53 |
| DELETE | `':variantId'` | 71 |

### cronox-backend/src/shipping-methods/shipping-methods.controller.ts

Prefijo(s) declarados: `'shipping-methods'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `(vacío)` | 10 |

### cronox-backend/src/shipping-tracking/tracking-admin.controller.ts

Prefijo(s) declarados: `'admin/orders'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':id/tracking'` | 16 |
| POST | `':id/tracking/sync'` | 18 |

### cronox-backend/src/users/users.controller.ts

Prefijo(s) declarados: `(raíz)`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `'users/admin/ping'` | 45 |
| GET | `'me'` | 52 |
| PATCH | `'me'` | 64 |

### cronox-backend/src/waitlist/waitlist.controller.ts

Prefijo(s) declarados: `'waitlist'; 'admin/waitlist'`.

| Método | Argumento de ruta | Línea |
|---|---|---|
| GET | `':variantId'` | 52 |
| POST | `':variantId'` | 58 |
| DELETE | `':variantId'` | 64 |
| GET | `(vacío)` | 77 |

## Automatismos y temporizadores

| Archivo | Flags encontrados |
|---|---|
| `cronox-backend/src/admin/audit-logs/audit-log-maintenance.service.ts` | `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/analytics/analytics-maintenance.service.ts` | `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/common/guards/expiring-throttler.storage.ts` | Sin flag local; ver consumidor |
| `cronox-backend/src/email/mail-transport.factory.ts` | `MAILBOX_WORKER_ENABLED`, `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/live-stats/live-stats.service.ts` | `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/mailbox/mailbox-leases.service.ts` | Sin flag local; ver consumidor |
| `cronox-backend/src/mailbox/mailbox-sync.service.ts` | Sin flag local; ver consumidor |
| `cronox-backend/src/mailbox/mailbox-worker.service.ts` | `MAILBOX_WORKER_ENABLED`, `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE`, `MAILBOX_SEND_ENABLED` |
| `cronox-backend/src/mailbox/mailbox.controller.ts` | Sin flag local; ver consumidor |
| `cronox-backend/src/membership/circle-reconciliation.service.ts` | `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/newsletter/newsletter-delivery.service.ts` | `BACKGROUND_JOBS_ENABLED`, `NEWSLETTER_EMAIL_WORKER_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/payments/checkout-reservation-cleanup.service.ts` | `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/shipping-tracking/tracking-worker.service.ts` | `BACKGROUND_JOBS_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE` |
| `cronox-backend/src/waitlist/waitlist.service.ts` | `WAITLIST_EMAIL_WORKER_ENABLED`, `CRONOX_ROUTE_SMOKE_MODE`, `BACKGROUND_JOBS_ENABLED` |

Incluye mantenimientos, workers, heartbeats de leases y limpieza de rate limits, no sólo cron. Reconciliación de círculo interna deliberadamente independiente de BACKGROUND_JOBS_ENABLED. Las condiciones concretas de arranque se revisan en cada servicio; este inventario de nombres no sustituye esa lectura.
