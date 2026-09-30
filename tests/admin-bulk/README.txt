EDICIÓN MASIVA CRONOX - revisión local, 30/09/2026

Acceso normal:
http://localhost:3000/admin.html#section-users
http://localhost:3000/admin.html#section-products

Acciones y permisos
- SUPERADMIN: usuarios -> rol USER/FRIEND/ADMIN y círculo 1-5.
  Cuentas SUPERADMIN excluidas; no se concede SUPERADMIN ni se cambia el rol
  propio. Se preservan las reglas individuales y el incremento de sessionVersion
  cuando cambian permisos. ADMIN no puede usar ningún endpoint masivo, conforme
  a los permisos actuales de edición individual. Tampoco se muestra la barra.
- SUPERADMIN: productos -> activar/desactivar y añadir/quitar/sustituir
  categorías. Vaciar tiene acción independiente. Una selección vacía no borra.
- No hay desactivación de cuentas: ACTIVE, PENDING_PASSWORD y PRE_REGISTERED
  son estados de registro, no una función de bloqueo. Círculo no es nullable.
  No hay campos editables independientes Novedad/Destacado; no se inventan.
- No se editan precios, costes, stock, imágenes, variantes ni credenciales.

Selección y garantías
- Máximo 100 registros por operación. Selección de página, parcial, persistente
  entre páginas. Cambiar filtros/búsqueda limpia la selección con aviso.
- Seleccionar todos consulta los filtros reales en el backend y captura IDs
  en una instantánea. Más de 100 devuelve error, no un subconjunto truncado.
- Se comparte el filtro de usuarios y el filtro de productos (incluido el
  agregado de stock). Se ignora la paginación solo para capturar todos los IDs.
- Cada campo empieza en No modificar. Revisión muestra valores distintos,
  resumen por acción, cambios/sin cambios/exclusiones e identificadores.
- Preview firmado de 15 minutos, ligado a autor, campos elegidos y versión de
  registros/categorías/permisos. Execute revalida todo en transacción Serializable.
  Cambios concurrentes o registros eliminados requieren nueva revisión.
- Se reutilizan updateAdminUser y replaceProductCategories con el cliente de
  esa misma transacción. Activación de producto modifica solo isActive/updatedAt.
- Idempotencia mediante UUID, hash de petición y resultado durable en la misma
  transacción. Bloqueo advisory de PostgreSQL entre procesos y reintentos acotados
  de serialización. Un UUID con otra petición se rechaza. No hay bucle HTTP por fila.
- Ante respuesta perdida, modal bloquea nuevos cambios y consulta el resultado.
  Si no está confirmado, permite repetir con el MISMO UUID. No comunica éxito
  ni cierra el modal mientras se desconoce el resultado. La recuperación guiada
  permanece en el modal abierto; recargar toda la página no restaura ese modal.
- Auditoría admin.bulk.update con autor/fecha/IDs/cambios y auditorías individuales
  existentes. Recibos sin nombres/correos/credenciales. Solo autor autorizado
  puede consultar su resultado. Se conservan recibos para no caducar idempotencia.
- Listados recargados desde backend conservando filtros y página válida. La
  clasificación de categorías se recarga al abrirla; APIs públicas leen los
  mismos registros. No hay invalidación de una caché remota ni servicios nuevos.

Migración
20260930160000_admin_bulk_operations crea AdminBulkOperation (resultado/hash/autor)
con RLS y sin permisos PUBLIC/anon/authenticated. Aplicada SOLO a PostgreSQL local
127.0.0.1:5433/cronox_dev. Prisma generado con 6.19.3. Pendiente en producción:
aplicar mediante un despliegue posterior autorizado antes de ejecutar este código.
No se ha modificado producción ni se ha hecho commit/push/despliegue.

Archivos de esta tarea
cronox-backend/src/admin/bulk/admin-bulk.controller.ts
cronox-backend/src/admin/bulk/admin-bulk.dto.ts
cronox-backend/src/admin/bulk/admin-bulk.service.ts
cronox-backend/src/admin/bulk/admin-bulk.spec.ts
cronox-backend/src/admin/admin.module.ts
cronox-backend/src/admin/users/admin-users.service.ts
cronox-backend/src/products/product.service.ts
cronox-backend/prisma/schema.prisma
cronox-backend/prisma/migrations/20260930160000_admin_bulk_operations/migration.sql
cronox-front/admin.html
cronox-front/assets/admin.js
cronox-front/assets/admin-bulk.js
cronox-front/assets/admin-bulk.css
tests/admin-bulk/integration.cjs
tests/admin-bulk/browser.cjs
tests/admin-bulk/README.txt
Los demás cambios previos del árbol se han preservado.

Verificación
- Builds: npm run admin:build; npm run build:compiled --prefix cronox-backend.
- 94 pruebas Jest en 10 suites: bulk DTO/permisos, usuarios, categorías/productos,
  búsquedas, ciclo de vida, interfaz productos, paginación, entrega y Live stats.
- node tests/admin-bulk/integration.cjs (también se ejecuta desde browser.cjs).
- node tests/admin-bulk/browser.cjs: datos temporales locales, sesiones reales,
  54 productos seleccionados entre páginas, selección parcial/cabecera/todos,
  limpieza de filtros, valores distintos, No modificar, categorías reales,
  conflicto concurrente, respuesta perdida tras escritura y consulta del resultado,
  filtros/página tras éxito, exclusiones de roles, ambos modales y temas a
  320/390/768/1366 px. Altura mínima probada 480 px y acciones alcanzables por scroll.
- Integración: 401/403, límites, campos inválidos, categoría inexistente,
  añadir/quitar/sustituir/vaciar, categorías públicas, registros sin cambios,
  cambio/eliminación tras preview, dos envíos simultáneos sin duplicar auditoría,
  recibo persistente, cambio de permiso del autor e invalidación de sesión.
- Sin cobros/correos ni trabajos externos. Fixtures eliminados al finalizar.
- Capturas: test-results/admin-bulk/ (ignoradas). El test genera nuevas capturas
  en test-results/admin-bulk/; no incluir esos archivos generados en un futuro commit.
