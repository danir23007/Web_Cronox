# Publicación de Clientes → Puntos de venta · 12/10/2026

La revisión local autorizada incluye puntos, ventas/gastos, correcciones/devoluciones, archivado/reactivación, costes/precios/comisiones congelados, inventario seleccionable, finanzas por origen y buscador predictivo del historial. Implementación y decisiones en [admin-sale-points.md](admin-sale-points.md).

Antes de publicar código se realizó un backup completo de PostgreSQL de producción, en formato custom, con `pg_dump` 18.6. Se verificó con `pg_restore --list`; archivo de 1.070.172 bytes, SHA-256 `4cc70b95ce99d7a3ea427f1376bb852329f86531334cf38374d134241cbc9065`. El backup está protegido con permisos 600 en `/var/www/cronox/backups/sale-points-2026-10-12T00-59-16-748Z.dump`, con copia adicional local ignorada por Git en `test-results/local-points/production-before-points.dump`.

Se aplicó exclusivamente `20261011215858_external_sale_points` mediante `prisma migrate deploy`, desde una copia temporal del historial de migraciones y antes del push. Finalizó el 12/10/2026 a las 02:59:36 Europe/Madrid. Las comparaciones de conteos y contenido de Order, OrderItem, OrderItemFinancial, Product, ProductVariant, ProductCost, User y StockMovement fueron idénticas antes/después. Las tablas nuevas empezaron vacías: cero puntos, ventas y asientos. No se copiaron datos TEST ni se ejecutó la recuperación de pedidos #19/#20.

El workflow Deploy CRONOX publica main mediante `.github/scripts/deploy-production.sh` y `.github/scripts/deploy-vps-release.sh`: preflight, avance fast-forward, compilación de frontend, Prisma, `migrate deploy`, compilación del backend y reinicio PM2. Al estar registrada la migración, esa fase debe reconocerla como aplicada, sin repetir su SQL. No se utilizó el script antiguo del VPS que hace reset del checkout.

Validaciones finales anteriores al commit: 153 pruebas en 13 suites de puntos/finanzas/mapa/manuales; 59 pruebas de exportación; cinco pruebas del preflight y orden de despliegue; generación Prisma, compilaciones Vite/Nest y smoke de rutas/artefactos aprobados. Las pruebas funcionales locales de navegador de la tarea se conservan como evidencias locales; no se presentan como comprobaciones de producción.

Los respaldos y recibos privados están ignorados por Git. No contienen copias de producción en archivos publicados. La revisión de Git identificó únicamente archivos de esta tarea pendientes; los cambios ajenos del VPS (dependencias generadas y respaldo antiguo de main.ts) se conservan.
