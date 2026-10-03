# Histórico de visitantes y finanzas

Implementación local en la rama actual. Sin commit, push, despliegue ni migración de una base compartida. Las pruebas usan un PostgreSQL nuevo, efímero y vinculado a loopback; nunca cargan la configuración real de base de datos.

## Qué cuenta como visita

`cookie-consent.js` carga `visitor-history.js` solo fuera del panel. El servicio se activa con el consentimiento existente de Análisis, versión 2. Se registra una entrada visible a una página pública, incluyendo sesiones persistentes. No se registra por llamar a otras API, renovar la sesión, consultar salud, usar exclusivamente el panel ni dejar una pestaña abierta sin interacción. Las visitas sin consentimiento no se miden. No existe una comprobación infalible de que una señal de navegador corresponda a una persona; no es una solución antibots.

Antes de registrar, `GET /api/analytics/visits/session` resuelve la identidad mediante Passport y la política de renovación existente. Credenciales inválidas, una renovación pendiente o errores de servidor/red no se clasifican como anónimos. `POST /api/analytics/visits` vuelve a verificar la sesión y la categoría esperada para evitar carreras con un login/logout. Rechaza campos de identidad enviados por el cliente y páginas de panel/API, también como origen Referer cuando está disponible. El registro no bloquea la navegación y admite hasta tres reintentos por fallo transitorio.

- **Con sesión:** una fila por cuenta USER/FRIEND y día natural de Europe/Madrid, entre dispositivos. Las visitas identificadas de ADMIN/SUPERADMIN se excluyen.
- **Sin sesión:** una fila por navegador/día con prueba HttpOnly emitida por el servidor y consentimiento de Análisis. La prueba cambia a medianoche; no se acepta un UUID del frontend para reclamar visitas.
- **Entrada anónima y posterior login:** conserva los hechos originales, pero el anónimo vinculado deja de sumarse. Logout no añade otro anónimo ese día; un administrador excluye su anónimo identificable sin borrar cuentas legítimas compartidas. El histórico anterior sin pruebas suficientes no se inventa ni se borra. Véanse la nueva migración, fecha de transición, limitaciones y pruebas en [visitor-daily-reconciliation.md](visitor-daily-reconciliation.md).

La clave `(day, category, identity)` y el UPSERT SQL hacen el registro idempotente. Primera/última visita son extremos de las entradas públicas registradas, no duración de sesión ni número de páginas. El servidor fija fecha/hora; el cliente no puede introducir una fecha histórica. Las fechas se calculan con las utilidades financieras de Madrid, respetando jornadas de 23/25 horas.

## Resumen y detalle

Resumen muestra dos barras por día, leyenda, cifras mediante cursor/foco/pulsación, fechas, periodo anterior y últimos 30 días. La gráfica y las tablas permiten desplazamiento horizontal en móvil. Al seleccionar un día aparecen totales, cuenta/ID/nombre/correo disponibles, primera/última visita; los anónimos muestran únicamente un ID opaco del registro. Filtros por categoría, texto/ID y páginas de 25 registros.

`GET /api/admin/visitors` y `/day` aplican `JwtAuthGuard` y el `AdminGuard` existente, igual que finanzas. Los filtros son parametrizados, el conteo y la paginación se realizan en SQL, con índices por día/categoría/fecha/ID y usuario. Cada consulta de gráfica admite hasta 366 días; se pueden consultar años anteriores por intervalos sin cargar todas las visitas.

El detalle mantiene páginas numeradas y OFFSET acotado al día y al filtro elegidos para encajar con el administrador existente. Los índices de ordenación cubren tanto una categoría como todas. Para días individuales con millones de identidades, medir también el coste de COUNT/búsquedas y considerar paginación por cursor; no se ha simulado ese volumen. El archivo financiero sí utiliza cursor por moneda/ID desde esta versión.

**Inicio real:** `VisitorHistoryConfig.startedAt` se fija al aplicar la migración por primera vez. Se expone en la interfaz y nunca se reescribe en reintentos. No hay visitas reales de producción anteriores a activar esta versión y su registro. Los datos de las pruebas son exclusivamente sintéticos. Días anteriores: «Sin datos»; desde el inicio, días sin registros: cero; el primer día puede estar incompleto. Los ceros tampoco prueban ausencia de visitantes sin consentimiento o con bloqueos/fallos de registro.

## Conservación económica

La versión anterior leía directamente `Order`, `OrderItem`, `OrderItemFinancial`, eventos Stripe y movimientos de stock. Sus costes estaban congelados, pero borrar las líneas/pedidos/eventos podía cambiar el informe. Además, la limpieza histórica de pedidos documentada en el repositorio borra entidades de origen. Ahora el informe usa exclusivamente un archivo sin claves foráneas a pedidos, productos o usuarios:

- `FinanceArchive`: venta original, importes/descuentos/envío, moneda, cantidades, títulos/IDs de producto, costes históricos conocidos y fechas. No almacena datos del comprador ni direcciones/notas.
- `FinanceArchiveRevision`: versiones adicionales de estado/anulación/disputa, sin sobrescribir el original. Las cifras originales de venta/coste están congeladas. Los flujos existentes de corrección de ventas presenciales anulan la venta y registran la sustitución como otro pedido; no editan sus importes originales.
- `FinanceEventArchive`: hechos fechados de pagos/reembolsos/disputas procesados, identificados por ID de evento único. Reembolsos acumulados se convierten en incrementos mediante el mismo cálculo financiero existente, evitando doble contabilización incluso con distintos IDs y el mismo acumulado.
- `FinanceStockArchive`: evidencia adicional de unidades repuestas, con ID de movimiento único. Una devolución monetaria por sí sola no revierte costes ni unidades.

Los triggers capturan eventos y stock en la transacción original. La captura de pedidos/líneas/costes es diferida hasta final de transacción, cuando la venta está completa. Antes de borrar una fuente también se captura la evidencia superviviente. Actualizaciones posteriores y borrados de fuentes no reescriben los importes o costes originales. Los eventos de devolución siguen registrándose si su pedido de origen ya ha sido borrado y se conserva su referencia de pago en el archivo.

Se mantienen las definiciones de facturación y beneficio de [admin-finance.md](admin-finance.md), incluyendo desconocidos, IVA incluido, envío excluido, monedas independientes y fecha del evento. No se usa el precio/coste actual ni se inventan datos perdidos. El backfill copia evidencia superviviente, es idempotente y no reconstruye pedidos ya eliminados. Las ventas antiguas sin fecha de cobro continúan usando la creación del pedido con el aviso existente.

Los informes seleccionan archivos candidatos por moneda/fechas y procesan páginas de 200 pedidos con cursor estable y snapshot Repeatable Read. Retienen en memoria únicamente el lote, los intervalos y los agregados por producto; no cargan todos los pedidos/eventos de años anteriores de una vez. La ordenación/paginación de productos sigue el patrón anterior sobre agregados. No se ha medido carga de producción: si el número de productos distintos o de eventos por pedido crece mucho, conviene añadir agregados materializados después de medir consultas reales.

## Protección y referencias personales

Todas las tablas nuevas tienen RLS y acceso revocado a `PUBLIC`, `anon` y `authenticated`; las consulta el rol servidor autorizado, que debe tener el mismo acceso privado que las tablas financieras existentes. DELETE/TRUNCATE se rechazan en el histórico; las revisiones/eventos/stock/configuración también rechazan UPDATE. El panel y los mantenimientos de actividad/login/auditoría no incluyen estas tablas.

Las visitas solo enlazan con la cuenta actual; nunca copian nombre/correo. Un trigger al borrar una cuenta elimina su vínculo y reemplaza la identidad de deduplicación, conservando categoría, fechas y cifras. `ON DELETE SET NULL` refuerza la independencia del registro. Los archivos financieros no contienen referencias personales del comprador. Conservar las estadísticas no requiere conservar nombres/correos. Retirar el consentimiento detiene el registro y elimina almacenamiento de navegador; no borra los hechos estadísticos ya registrados.

Los triggers no protegen contra un administrador de base de datos que deshabilite triggers, borre el esquema, ejecute `migrate reset` o pierda la base. No equivalen a una copia de seguridad.

## Migración y publicación pendientes

`cronox-backend/prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql` crea tablas, índices, protección, captura transaccional y backfill. Se ha aplicado y repetido solo en PostgreSQL aislado. Para publicar:

1. Crear/verificar una copia externa nueva y probar restauración en una base separada. Verificar rol servidor y permisos sobre las nuevas tablas privadas.
2. Revisar las migraciones pendientes en el entorno elegido; aplicar mediante el procedimiento habitual, sin reset. El backfill es transaccional y puede requerir ventana de mantenimiento según volumen; medir en una copia primero. No se ha aplicado aquí a producción.
3. Generar Prisma Client y compilar backend/administración. Publicar backend y assets de forma coordinada, tras la migración. El HTML ya aumenta las versiones de `cookie-consent.js` y `admin.js`; asegurar que CDN/service workers entregan esos HTML y los assets nuevos.
4. Verificar consentimiento, visitas persistentes/anónimas, permisos y gráfica. Contrastar finanzas con un informe previo e inspeccionar `startedAt`; comprobar primera/última visita y seguimiento de errores del servidor.

## Copias y recuperación

Se revisaron los procedimientos `launch-campaign-and-cleanup.md`, `production-order-cleanup-20260924.md` y `newsletter-single-opt-in-2026-09-25.md`. Existen los dos dumps externos allí referenciados en la carpeta local de backups de OneDrive. Son copias anteriores a estas tablas: no contienen este histórico nuevo. No se ha verificado una política vigente de copias automáticas, retención, redundancia o PITR, ni se ha restaurado producción.

Antes de publicar, el operador debe establecer copias automáticas completas que incluyan estas seis tablas, archivos fuera de la base, cifrado/permisos, redundancia y conservación acorde al horizonte del histórico; definir RPO/RTO y probar restauración periódicamente. Si el proveedor ofrece PITR, verificar cobertura y ventana reales; no asumir que está activado. Una copia dentro de la propia base y la sincronización de OneDrive por sí solas no garantizan recuperación permanente.

Ejemplo de recuperación sobre una base **nueva y separada**, con autenticación configurada sin exponer contraseñas en comandos/logs:

```powershell
pg_dump --format=custom --file=cronox-history.dump --dbname=<origen-autorizado>
pg_restore --list cronox-history.dump
pg_restore --exit-on-error --no-owner --dbname=<destino-aislado-vacio> cronox-history.dump
```

Restaurar esquema y datos juntos, sin `--clean` contra la base activa. Verificar tablas, permisos/triggers, `startedAt`, recuentos, extremos de fechas y conciliación de un periodo de finanzas. Aplicar las migraciones posteriores al dump únicamente en la copia. Reanudar escrituras o conmutar a una base recuperada requiere el procedimiento operativo de publicación, fuera del alcance de esta tarea.

## Verificación reproducible

```powershell
npm run admin:build
npm run build --prefix cronox-backend
npm test --prefix cronox-backend -- --runInBand analytics/visitor-history.spec.ts admin/finance/financial-calculations.spec.ts admin/finance/admin-finance-history.spec.ts auth/strategies/session-permission-invalidation.spec.ts admin/manual-purchases/admin-manual-purchases.service.spec.ts admin/audit-logs/audit-log-maintenance.service.spec.ts
node cronox-backend/scripts/review-permanent-history.cjs --serve
node tests/visitor-history/review-browser.cjs
```

El servidor aislado se detiene escribiendo `stop` en su terminal. No contacta proveedores de pago ni SMTP. La prueba de integración comprueba concurrencia, categorías, consentimiento, sesiones, manipulación de identidad, días Madrid/DST, filtros/páginas, borrado de cuentas y entidades económicas, permisos SQL, protección contra limpieza y replay de migración/eventos. También exporta un dump completo y lo restaura en otra base local vacía: concilia tablas, inicio del registro, informe financiero y protección contra borrado. Esto prueba el mecanismo de restauración local, no la existencia de copias automáticas de producción. Las pruebas visuales se realizan contra Nest/PostgreSQL reales en escritorio/móvil.

Resultado local: compilación Nest/Prisma y Vite correctas, schema Prisma válido, 6 suites/37 pruebas correctas (incluida agregación de 401 pedidos en varios lotes), integración PostgreSQL y restauración correctas; Chromium en escritorio/móvil sin errores de página. Se verificó también la primera creación anónima desde pestañas simultáneas, la página pública sin wrapper API y un fallo de resolución de sesión sin registro anónimo. Capturas inspeccionadas en `output/playwright/visitors-desktop.png` y `visitors-mobile.png`.## Migraci?n y publicaci?n

La migraci?n `20261002120000_permanent_visitor_finance_history` crea tablas, ?ndices, protecci?n, captura transaccional y backfill. No elimina los datos de origen ni reinicia la base. Se ha aplicado y repetido en PostgreSQL aislado.

El flujo existente de GitHub Actions verifica compilaciones y exportaciones y ejecuta el script de despliegue de producci?n. Este instala dependencias, genera Prisma Client, ejecuta `prisma migrate deploy`, compila y reinicia el backend. La publicaci?n debe seguir ese mecanismo y verificar despu?s migraciones, salud, recursos, consentimiento, deduplicaci?n, permisos y cifras financieras frente a la evidencia anterior.

Para esta publicaci?n el propietario ha autorizado expresamente proceder sin una nueva copia de producci?n y ha excluido configurar una pol?tica nueva de copias externas. Esa decisi?n sustituye la recomendaci?n previa de realizar una copia antes de publicar. Los triggers conservan hechos frente a las limpiezas de la aplicaci?n, pero no sustituyen la recuperaci?n de la base. La restauraci?n aislada ya verificada prueba el mecanismo local, no una pol?tica de copias de producci?n.
