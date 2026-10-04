# CRONOX: categorías, Actividad y bienvenida

## Comportamiento

Actividad permite borrar todo `AuditLog`, independientemente de sus filtros, tras una confirmación explícita. El botón solo aparece para SUPERADMIN. El endpoint `DELETE /api/admin/audit-logs` exige `{ "confirmation": "DELETE_ALL_ACTIVITY" }` y el guard estricto `SuperAdminGuard`: el guard genérico de roles acepta otros roles administrativos incluso ante una restricción declarada con `@Roles`. No se han cambiado los permisos globales. La operación no borra pedidos, stock, estadísticas, usuarios, campañas ni registros de cuotas. Comparte la operación concurrente, muestra errores y permite reintentar; las respuestas antiguas del listado se descartan y un fallo de recarga no se sustituye por un aviso de éxito.

Las categorías tienen un grupo persistido: NEW, GARMENT, DROP o UNCLASSIFIED. La creación exige nombre y GARMENT/DROP; genera el slug cuando no se proporciona. Se rechazan nombres vacíos y duplicados normalizados por espacios, mayúsculas y acentos, incluso entre grupos. Un bloqueo de transacción serializa creación y edición para evitar duplicados concurrentes. La ruta y el ID de una categoría existente se conservan salvo una edición explícita de su slug.

La clasificación, el editor individual y Bulk Edit comparten `category-controls.js`: Novedades independiente y desplegables con selección múltiple de tipo y drop. Se admite dejar las selecciones vacías y se conservan asociaciones de categorías antiguas sin clasificar. La creación de una categoría refresca las opciones conservando las selecciones pendientes. La edición individual guarda categorías y producto en una misma transacción; Bulk Edit conserva sus modos existentes de añadir, quitar, sustituir y vaciar. La tienda carga los grupos del mismo catálogo y combina sus filtros; no incluye productos inactivos ni costes privados.

Atrás de Productos y Categorías apunta a Home, también al entrar mediante enlace directo. La protección ante cambios pendientes incluye las asignaciones sin guardar. Home mantiene su ausencia de Atrás.

El listado administrativo de promociones excluye los códigos relacionados con una suscripción de newsletter y los códigos personales de primer pedido con propietario. Estas asociaciones son las usadas por el generador de bienvenida; no se identifican por porcentaje, texto ni patrón del código. La misma condición se aplica al listado, búsqueda, filtros y recuento antes de paginar. No se modifican los códigos ni sus reglas de canje.

El detalle administrativo de usuario muestra el código original más antiguo, ordenado por fecha e ID, entre los códigos FIRST_ORDER vinculados al usuario y las promociones de bienvenida vinculadas por propietario o suscripción. En caso de empate entre ambos sistemas se prioriza el registro FIRST_ORDER. La lectura no genera códigos. Sin asociación muestra «Sin código asignado». No se añade el campo al perfil público.

## Migración pendiente de publicación

`20261004220000_category_groups` añade el enum y la columna con UNCLASSIFIED como valor compatible por defecto. Solo clasifica los slugs documentados por el seed y el menú actual: novedades como NEW; camisetas, chaquetas, pantalones y complementos como GARMENT. No infiere drops a partir de nombres ambiguos ni cambia `ProductCategory`. Las categorías propias requieren clasificación explícita mediante la edición administrativa de categoría si deben aparecer en otro grupo.

La migración se ha probado en PostgreSQL temporal local sobre un esquema anterior con asociaciones existentes. **No se ha ejecutado en producción.** Antes de usar este código en otro entorno deben aplicarse las migraciones pendientes mediante el procedimiento habitual (`prisma migrate deploy`) y generar el cliente Prisma. No ejecutar el seed para reclasificar categorías históricas.

## Verificación local

- `npm run admin:build` en cronox-front y `npm run build:compiled` en cronox-backend.
- 118 pruebas Jest en 15 suites: Actividad, promociones, usuarios, categorías, productos, Bulk Edit, interfaz, Mails y estabilidad de Buzones.
- `node cronox-backend/scripts/review-admin-categories-activity.cjs`: PostgreSQL temporal en loopback, migración, conservación de IDs/asociaciones, creación y duplicado concurrente, validación, actualización individual, filtros públicos, código histórico original y borrado de Actividad. Un servidor Nest aislado prueba los guards reales: ADMIN/USER/FRIEND reciben 403, SUPERADMIN sin confirmación recibe 400 y la petición confirmada recibe 200. No carga AppModule ni trabajadores de correo.
- Navegador Chromium local con APIs simuladas, escritorio y móvil, claro y oscuro: cancelar/confirmar borrado, doble clic, permiso de botón, creación, tres columnas, selección múltiple, conservación de cambios pendientes, teclado/táctil, guard de salida, guardado individual, controles de Bulk Edit, Atrás hacia Home, bienvenida de solo lectura y filtros públicos combinados. Sin errores de consola en los contextos simulados y sin desbordamiento horizontal.
- Regresión `mails-navigation.browser.js`: navegación, entrada directa a campañas, cambios sin guardar, Galería y movimiento real del puntero en escritorio, además de táctil y variantes de detalle de usuario.

Para reproducir la prueba de navegador desde la raíz, ejecutar `node tests/admin-review/serve-static.cjs` en una terminal. En otra:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=categories-review open http://127.0.0.1:4173/admin.html
npx --yes --package @playwright/cli playwright-cli -s=categories-review run-code --filename tests/admin-review/categories-activity.browser.js
npx --yes --package @playwright/cli playwright-cli -s=categories-review close
```

El script de PostgreSQL requiere binarios locales en `C:/Program Files/PostgreSQL/17/bin` o `CRONOX_REVIEW_PG_BIN`. Cierra su servidor en el bloque finally; sus archivos sintéticos quedan en el directorio temporal del sistema. Las capturas quedan en `output/playwright`, ignorado por Git.

Estas comprobaciones no acreditan el administrador publicado, una entrega de correo ni campañas reales. No se ha conectado al proveedor ni modificado producción; entrega únicamente en commit local, sin push ni despliegue.
