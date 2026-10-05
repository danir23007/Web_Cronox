# Productos y categorías en localhost:3000 — 05/10/2026

## Causa confirmada antes de modificar la base

La ejecución real de `http://localhost:3000` devolvía:

| Petición | Antes | Después |
| --- | --- | --- |
| `/api/products?limit=48` | 500, `Internal server error` | 200, 7 productos |
| `/api/categories?page=1&limit=100&orderBy=name&order=asc` | 500, `Internal server error` | 200, 6 categorías |
| `/api/gallery` | 200 | 200 |

El proceso Node PID 25172 ejecutaba `cronox-backend/dist/main`, iniciado por
`scripts/start-local.cjs --watch`. La compilación de categorías era del mismo
arranque, a las 04:17 del 05/10. El cliente Prisma y el servicio compilado ya
esperaban los nuevos campos, pero PostgreSQL todavía no tenía `Category.group`
ni `Category.showInStoreFilters`.

El registro del servidor PostgreSQL contiene `column Category.group does not
exist`, entre otros a las 04:26:32. Las consultas de categorías y de productos
con sus categorías reprodujeron `PrismaClientKnownRequestError`, código `P2022`,
columna `Category.group`. La galería no ejecuta esas mismas consultas y seguía
funcionando. No se atribuyó el fallo al menú ni a una compilación antigua.

## Destino y reparación

Antes de migrar se comprobó el cargador local, que exige `NODE_ENV=development`
y ambas URL PostgreSQL en el mismo destino loopback. El servidor confirmó
`current_database() = cronox_dev`, dirección `127.0.0.1`, puerto `5433`.
Los puertos cliente de las conexiones del PID 25172 coincidían con las sesiones
de esa base en `pg_stat_activity`.

Se guardó una copia local con `pg_dump` y se ejecutó:

```powershell
npm --prefix cronox-backend run migrate:local
```

El procedimiento habitual aplicó las cuatro migraciones pendientes en orden:

- `20261004150000_mailbox_sent_policy_tracking`
- `20261004190000_mail_account_quota`
- `20261004220000_category_groups`
- `20261005100000_category_filter_visibility`

Las dos últimas reparan las consultas de categorías. Las dos anteriores también
estaban pendientes en el historial local. Ahora no queda ninguna pendiente.
El mismo PID pasó de HTTP 500 a 200 sin recompilar ni reiniciar; esto confirma
que actualizar el esquema resolvió el fallo. No se modificó código de aplicación,
configuración de despliegue ni base de producción.

## Verificación real

Chromium visitó `localhost:3000` a 1366 y 390 px, sin interceptar ni simular
respuestas. Productos, categorías y galería respondieron 200; no hubo errores
JavaScript en la comprobación del catálogo. Las peticiones de sesión del
visitante anónimo devolvieron los 401 esperados, ajenos al fallo del catálogo.

Se verificaron siete productos, seis categorías, casillas visualmente ocultas,
alineación, clic en toda la fila, selección y deselección múltiple, combinación
de grupos, teclado, foco visible y estado accesible. Camisetas muestra cuatro
productos; Camisetas más Chaquetas muestra cinco; al deseleccionar se recuperan
los siete. También funciona quitar la selección inicial de `?categorySlug=`.

Con autenticación normal y CSRF se utilizó el formulario real de administración
para ocultar Camisetas: PATCH 200, persistencia tras recargar, exclusión del
listado público y conservación en administración. Al abrir de nuevo el menú,
se retiró el filtro oculto y se recuperó el catálogo completo. El acceso directo
a sus productos siguió disponible. Se restauró la visibilidad original mediante
el mismo formulario, con PATCH 200, y se repitió selección y deselección.

Se conservan las seis categorías, sus IDs, nombres, slugs, estado activo y las
21 asociaciones con productos. D#01 conserva `d#01` y queda en DROP según la
migración existente; todas las categorías terminan visibles. La comprobación
de la ficha conserva título SEO, canonical y un único grafo JSON-LD. Los cambios
anteriores de SEO y del menú permanecen intactos.

Capturas, resultados saneados, scripts de comprobación y copia previa local:
`output/playwright/localhost-3000-2026-10-05/`, ignorado por Git. Las pruebas
anteriores de los puertos 4177/4178 no se usan como evidencia de esta reparación.

## Implicación para despliegue

La misma causa puede aparecer en cualquier entorno que arranque este código
sin aplicar sus migraciones. Compilar o generar Prisma no crea las columnas en
PostgreSQL. Antes de arrancar la nueva versión en un despliegue autorizado deben
aplicarse las migraciones pendientes contra el destino correcto mediante el
procedimiento de publicación. No se ha comprobado ni migrado producción en
esta intervención; no se afirma que actualmente presente ese desfase.

En esta reparación no se hizo commit, push ni despliegue.

El cierre posterior autorizado para commit conserva esta reparación y repite
la verificación en localhost:3000 con la compilación actual. Véase
[preparación final y publicación](release-preflight-2026-10-05.md), que comprueba
las 78 migraciones locales y no presupone el historial de producción.
