# CRONOX: categorías y visibilidad pública

## Corrección

El selector añadido sobre el catálogo por `0218742` se elimina, junto con sus estilos y código exclusivo. Las categorías públicas proceden de la API y se integran en el panel negro lateral existente, conservando sus enlaces y destinos. En el catálogo, las casillas permiten combinar grupos: varias categorías del mismo grupo se combinan con OR y grupos distintos con AND. Novedades conserva su grupo independiente. El panel no se abre al cargar o actualizar categorías.

El catálogo del panel vuelve a comprobarse cuando se abre. Descarta respuestas antiguas, no reconstruye el panel si su catálogo no ha cambiado, y conserva las selecciones aún visibles. Si desaparece una selección, se retira del filtro; si era el destino `categorySlug` con el que se cargó un subconjunto de productos, elimina ese parámetro y vuelve a cargar el catálogo general. Un fallo muestra un aviso y Reintentar, conservando los controles ya cargados. La API se consulta sin caché.

`Category.showInStoreFilters` es independiente de `isActive` y de las asociaciones con productos. Su valor inicial es true tanto para categorías antiguas como nuevas. GET público `/api/categories` filtra por categoría activa y visible antes de contar y paginar. El listado administrativo incluye categorías ocultas para asignación y gestión. Ocultar en filtros no invalida enlaces directos ni desactiva productos.

El botón verde «+ Crear categorías» está en la esquina derecha de la cabecera de la tarjeta. Abre un dialog nativo, con nombre, grupo y «Mostrar en filtros de la tienda». Cancelar o Escape no crea registros; guardar valida y persiste, y actualiza la clasificación conservando selecciones pendientes. «Gestionar categorías» permite editar nombre, grupo y visibilidad. La edición no envía cambios de slug.

Las superficies de asignación comparten únicamente tres columnas: Novedades, Tipo de prenda y Drop/colección. Las categorías pendientes de clasificación se gestionan en el listado administrativo, conservando sus asociaciones aunque no tengan control en una cuarta columna. El editor individual conserva esos IDs; Bulk Edit también los conserva al sustituir selecciones. «Dejar sin categorías» mantiene su comportamiento de vaciado explícito.

## Migraciones

Se ha consultado en solo lectura la base configurada como **local** mediante el cargador que exige PostgreSQL en loopback. No tenía registros de migraciones de categorías en `_prisma_migrations`; contenía D#01 con ID 2 y slug `d#01`. No se ha consultado ni modificado la base de producción.

Se conserva intacta `20261004220000_category_groups`. La migración nueva `20261005100000_category_filter_visibility` añade `showInStoreFilters` con default true y clasifica como DROP la categoría cuyo nombre exacto es D#01, por indicación explícita del usuario. Solo actualiza el grupo; no cambia ID, nombre, slug ni ProductCategory. No clasifica otras categorías por su nombre.

Ambas migraciones deben aplicarse en orden donde sigan pendientes mediante el procedimiento habitual de publicación, seguido de generación del cliente Prisma. Esta entrega no ejecuta migraciones contra la base de trabajo ni producción. La restauración aislada de prueba aplica primero la migración anterior y después la nueva. Los slugs históricos con `#` se conservan y admiten en la consulta pública; los enlaces los codifican correctamente como `%23`.

## Verificación

- Compilación `admin:build`, compilación de backend `build:compiled` y comprobación de sintaxis de JavaScript.
- 137 pruebas Jest en 17 suites, incluidas regresiones de categorías, productos, Bulk Edit, Mails, Buzones, Actividad, promociones, usuarios, búsqueda y recuperación del catálogo.
- `review-admin-categories-activity.cjs`: PostgreSQL temporal aislado, las dos migraciones, defaults de visibilidad, D#01 con slug histórico y asociaciones intactas, persistencia de ocultar/mostrar, categorías ocultas en administración, creación en ambos grupos y validación de booleanos. Servidor Nest aislado con HTTP real para POST/PATCH y listados públicos/administrativos. Plan real de Bulk Edit sobre esa base conserva asociaciones sin clasificar. No carga AppModule ni trabajadores.
- `categories-activity.browser.js`: Chromium local con APIs simuladas, escritorio/móvil y claro/oscuro. Comprueba botón/modal, teclado y táctil, cancelar sin creación, ambos grupos, visibilidad al crear y editar y tras recarga, categoría oculta asignable, clasificación explícita de una categoría desconocida, D#01 seleccionada en Drop/colección, tres columnas, editor individual, Bulk Edit, guard de cambios pendientes, filtros combinados, panel cerrado, desaparición de selecciones y recarga de enlaces filtrados. Sin errores de consola en los contextos simulados; capturas revisadas en `output/playwright`, ignorado por Git.

Se conserva el servidor estático y el procedimiento CLI documentados en la entrega anterior. Las pruebas no acreditan el administrador publicado. No se han enviado correos, lanzado campañas ni cambiado categorías reales de producción. Entrega en commit local, sin push ni despliegue, conservando `0218742` y `3e35792`.
