# Exclusión estadística de compras manuales de clientes

La opción **Excluir de las estadísticas** pertenece exclusivamente a las compras
de Clientes → Usuarios → ficha → Pedidos → Nueva compra. Por defecto están
incluidas. La compra, sus líneas e importes permanecen en el historial operativo;
los pedidos web y las ventas de Puntos de venta no admiten esta excepción.

## Persistencia y cálculo

- `Order.excludedFromStatistics`: booleano, predeterminado `false`; la restricción
  SQL `manual_statistics_only` impide excluir un pedido de origen `ONLINE`.
- `statistics-eligibility.ts` centraliza la regla y su filtro Prisma. Se aplica al
  resumen, finanzas/calendario/rankings, mapa y agregados de clientes/productos.
- El archivo financiero conserva la marca en sus revisiones, incluso si después
  se elimina el pedido operativo. Las revisiones anteriores, precios y costes
  congelados se conservan. Una marca ausente en archivos antiguos significa inclusión.
- Se omite todo el ciclo de una compra excluida: venta, devolución y reposición de
  coste; ningún reembolso posterior deja un saldo residual en otro periodo.
- Los listados, detalles y exportaciones operativas de pedidos conservan las
  compras excluidas, identificadas expresamente. Las exportaciones existentes
  de pedidos son operativas, no informes financieros; sus líneas no se eliminan.
- La ficha del cliente usa los agregados del servidor, sin sumarlos de nuevo a
  partir de una página del historial. Las reglas de fidelización permanecen
  operativas: una exclusión analítica no elimina la compra de la cuenta ni cambia
  el progreso de membresía.

## Cambiar una compra existente

`POST /api/admin/orders/:id/statistics-exclusion`, cuerpo
`{ "excludedFromStatistics": true | false }`, cabecera `Idempotency-Key`.
Requiere los mismos permisos SUPERADMIN que la creación manual y rechaza
pedidos web; los DTO de checkout y ventas de puntos rechazan este campo.

La interfaz solicita confirmación. La transacción bloquea la compra y registra
actor, fecha, valor anterior/nuevo y clave de reintento en `AuditLog`. Un reintento
no registra otra compra ni otro cambio; tampoco sobrescribe una elección posterior.
No toca precios, cantidades, costes, estado, pagos, emails ni movimientos de stock.

## Revisión local

Migración: `20261012140000_manual_statistics_exclusion`. Todas las compras
existentes siguen incluidas. Ejecutar **solo con el perfil local verificado**:

```powershell
npm run migrate:local --prefix cronox-backend
node cronox-backend/scripts/test-manual-statistics-db.cjs
```

El segundo comando crea una base única en PostgreSQL loopback, usa datos
sintéticos y elimina únicamente esa base al terminar. `--serve` permite revisar
el navegador en `http://127.0.0.1:43122/__review/admin`; escribir `stop` cierra el
servidor y limpia esa base. El escenario Playwright está en
`tests/admin-review/manual-statistics-browser.cjs` y genera capturas en
`output/playwright/`.

El localhost habitual conserva su base `cronox_dev` y los datos previamente
revisados. Su protección sigue bloqueando pagos, emails y operaciones de ciclo
de los pedidos importados; permite crear compras manuales locales y cambiar
esta marca estadística para revisar la funcionalidad.

No ejecutar recuperación de costes de #19/#20, copiar datos de prueba a
producción ni realizar migraciones de producción durante esta tarea local.

## Archivos de implementación

- Prisma: `cronox-backend/prisma/schema.prisma` y la migración indicada.
- Regla común: `src/common/statistics-eligibility.ts`.
- Registro/acción auditada: `src/admin/manual-purchases/` (servicio,
  controladores y DTO).
- Agregados: servicios `admin/dashboard`, `admin/finance`, `admin/map`,
  `admin/users`, `analytics/admin-customer-analytics.service.ts` e
  `historial/historial.service.ts`. `membership/membership.service.ts` conserva
  expresamente el criterio operativo para la fidelización.
- Historial, detalles y exportación operativa: servicios `admin/orders`,
  `admin/exports`, `orders` y `me`.
- Validación de operaciones no elegibles: `orders/dto/create-checkout-session.dto.ts`
  y `admin/points/point.dto.ts`.
- Interfaz: `cronox-front/admin-user.html`, `src/admin/admin-user.ts`,
  `src/admin/api.ts`, `src/admin/globals.d.ts`; recursos compilados
  `assets/admin-user.js`, `assets/api.js`, `assets/admin-orders.js`,
  `assets/profile.js` y versiones de recursos en `admin.html` y `profile.html`.
- Perfil local y pruebas: `common/config/local-review-safety*`, pruebas de
  cálculos/HTTP/DOM, integración PostgreSQL y escenario del navegador indicado.

Verificado con PostgreSQL y Nest reales en loopback, compilaciones de backend y
administrador y pruebas automatizadas. En el navegador se registraron compras
sintéticas desde los formularios reales a 1440 px y 390 px, se recargó, se cambió
la elección con confirmación y se comprobó un incremento exacto de 51 € de
facturación y 21 € de beneficio al incluirlas, y cero contribución al excluirlas.
Sin modificaciones de producción ni publicación.
