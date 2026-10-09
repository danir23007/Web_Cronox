# Verificación del precio pagado en compras presenciales

Fecha: 10/10/2026.

## Integración real con PostgreSQL

Comando: `npm run test:manual-purchases:db --prefix cronox-backend`.
Script: `cronox-backend/scripts/test-manual-purchases-db.cjs`.
Resultado: aprobado en PostgreSQL 17 local, `127.0.0.1:5433`.

La ejecución crea una base vacía con nombre aleatorio `cronox_manual_test_<UUID>` y aplica el esquema Prisma actual mediante `db push`, con `pg_trgm`. No copia datos de negocio. Los servicios `AdminManualPurchasesService`, `HistorialService`, `AdminUsersService` y `PrismaService` son reales, sin mocks ni dobles. Las comprobaciones se hacen con nuevas consultas después de las transacciones confirmadas.
La base se elimina en `finally`; el informe confirma `cleanedUp: true`. No se escribe en la base de desarrollo ni se utiliza producción.

Comprobaciones:

- Dos líneas de la misma variante: 25,50 EUR × 2 = 51,00 EUR y 31,00 EUR × 1 = 31,00 EUR. Se leen ambas líneas independientes, subtotal y total de 82,00 EUR, tipo IVA 0,2100 e IVA incluido de 14,23 EUR. Se comprueba la instantánea financiera existente.
- `DEDUCT_NOW`: stock 10 → 7, un movimiento agregado de -3, historial de un pedido y tres artículos, gasto del cliente 82 EUR.
- Dos reintentos conservan el mismo pedido y no generan movimientos ni estadísticas adicionales. Reutilizar la clave con otro precio se rechaza. Reintentar una compra anulada conserva su estado CANCELLED.
- Stock insuficiente: ninguna escritura persistente. También se provoca un fallo real de FK del administrador tras el descuento de stock: la transacción revierte el descuento y no guarda pedido, movimientos ni cambios de historial.
- `ALREADY_ADJUSTED`: 10 EUR × 2 más 0 EUR explícitos, total 20 EUR e IVA 3,47 EUR; stock intacto y sin movimientos. Historial acumulado: dos pedidos, seis artículos; gasto 102 EUR. El reintento tampoco duplica.
- Cambiar el producto a 99 EUR y la variante a 70 EUR conserva las líneas históricas, total, IVA y gasto. Una solicitud antigua que omite el precio utiliza los nuevos 70 EUR del catálogo.
- Anular el primer pedido devuelve las tres unidades una sola vez; repetir la anulación no devuelve más stock. Anular la compra ya ajustada, incluso dos veces, no modifica stock. Historial y gasto se recalculan en cada caso; las líneas históricas permanecen guardadas.

Evidencia local ignorada por Git: `test-results/manual-purchases-db/results.json`.
Esta prueba verifica servicios, transacciones y persistencia con el esquema final. No verifica la ejecución del historial completo de migraciones ni un recorrido HTTP/navegador contra esa base; esos aspectos son distintos de esta integración.

## Auditoría de los cinco errores TypeScript

Comando actual: `npx tsc --noEmit -p tsconfig.admin.json`.
Se repitió con una copia de los archivos originales obtenidos de `git show 2555490:<archivo>` y se confirmó su igualdad byte a byte con ese commit base. El resultado es idéntico: los cinco errores ya existen antes del cambio.

Todos están en `cronox-front/src/admin/api.ts`:

| Línea | Error | Causa y relación con la compra presencial |
| --- | --- | --- |
| 1200 | TS18048: `g.CRONOX_STOCK` posiblemente undefined | `Window.CRONOX_STOCK` es opcional en `globals.d.ts`; la llamada está en el decorador de tarjetas de producto, fuera del formulario de compras. |
| 1225 | TS2339: `getPendingCounts` no existe en `CronoxAdminApi` | Falta la declaración del método de contadores del panel en `globals.d.ts`; la función ya existe en tiempo de ejecución. |
| 1396 | TS2339: `createAdminCategory` no existe en `CronoxAdminApi` | Falta la declaración del método de categorías en `globals.d.ts`, sin relación con compras. |
| 1397 | TS2339: `updateAdminCategory` no existe en `CronoxAdminApi` | Falta la declaración del método de categorías en `globals.d.ts`, sin relación con compras. |
| 1432 | TS2339: `clearActivity` no existe en `CronoxAdminApi` | Falta la declaración del método de auditoría en `globals.d.ts`, sin relación con compras. |

Ninguno se introduce por `ManualPurchasePayload`, `unitPriceCents`, el parser o el formulario modificado. El chequeo global sigue fallando por estos errores preexistentes; no se han corregido partes ajenas al alcance solicitado. Evidencias: `test-results/manual-purchases-db/typescript-current.txt` y `typescript-baseline.txt`.

## Preflight de publicación autorizado

El 10/10/2026 se autorizan commit, push y despliegue por el workflow normal de `main`.
El cambio de precio no modifica `schema.prisma` ni añade migraciones; reutiliza las columnas Decimal existentes.

La inspección de solo lectura del VPS confirmó como revisión instalada `b5a2b66bebc40e95661e5f486d45271bad21bc3f`, anterior a la rama `main` actual. Se conserva el archivo ajeno `cronox-backend/src/main.ts.cronox-before-stripe` y las diferencias existentes de `node_modules` en ese checkout.
Los workflows previos `37862768150` y `37868079760` aprobaron `verify-release` pero fallaron en `deploy`: faltaba `pg` al ejecutar la comprobación previa de numeración.
Una transacción PostgreSQL `BEGIN READ ONLY` confirmó que `UserNumberingState` no existe y que ninguna de las cinco migraciones de numeración pendientes está aplicada.
El SSH disponible solo permite `pm2 restart cronox` y `pm2 save`; no permite detener escritores ni administrar el proxy para la operación controlada de `docs/user-numbering-2026-10-08.md`.

Por tanto, esa operación ajena al precio editable sigue bloqueando el despliegue normal del conjunto de `main`. No se omite el guard, no se aplica una renumeración con escritores activos y no se ejecuta un reset. El resultado final es el siguiente.

## Resultado de publicación

- Commit del cambio: [`6f76870467434baac749935bbe015d7c604793ff`](https://github.com/danir23007/Web_Cronox/commit/6f76870467434baac749935bbe015d7c604793ff), publicado en `main`. Incluye exclusivamente los 18 archivos de código, bundle generado, pruebas e informe relacionados con esta tarea.
- [Deploy CRONOX 38003020828](https://github.com/danir23007/Web_Cronox/actions/runs/38003020828): terminado con `failure`. `verify-release` terminó con `success`: instalación exacta, generación Prisma, builds frontend/backend y comprobaciones de exportaciones/artefactos/rutas compiladas. `deploy` falló antes de actualizar el checkout por `Cannot find module 'pg'` en `check-user-numbering-release.cjs`.
- [Pages 38003020031](https://github.com/danir23007/Web_Cronox/actions/runs/38003020031): terminado con `success`. Este resultado del workflow secundario no significa que se haya desplegado la aplicación de `cronox.es`.
- VPS después del workflow: sigue en `b5a2b66bebc40e95661e5f486d45271bad21bc3f`. El archivo ajeno se conserva. No se ejecutaron migraciones ni reinicios en este intento.
- Comprobaciones HTTP de producción antes y después: `/api/health`, `/api/ready` y `/api/products` devuelven 200; health/ready indican `ok: true`. `/api/admin/users/1/in-person-purchase-options` devuelve 401 sin sesión.
- `/admin-user.html` y `/assets/admin-user.js?v=6` devuelven 200, pero el HTML no referencia v6 y el contenido del JS no contiene `data-manual-price` ni coincide con el bundle del cambio. El formulario nuevo **no está publicado** en producción.
- No se crearon pedidos, cobraron importes ni modificó stock real. La comprobación de numeración en la base fue READ ONLY.

El chequeo TypeScript global sigue fallando por los cinco errores preexistentes descritos arriba; no se declara aprobado. La integración local real y las pruebas del cambio mantienen sus resultados anteriores.

Para completar el despliegue normal hace falta resolver primero la operación controlada de numeración pendiente, con el operador que pueda activar mantenimiento, detener todos los escritores y verificar/restaurar respaldos según `docs/user-numbering-2026-10-08.md`. Instalar `pg` y omitir esa comprobación no resuelve la precondición de integridad. No se ha aplicado una renumeración ajena a esta tarea ni eludido el guard.

Evidencias HTTP locales: `test-results/manual-purchases-release/production-before.json` y `production-after.json`.
