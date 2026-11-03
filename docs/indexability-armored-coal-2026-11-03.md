# ARMORED COAL y revisión de indexabilidad — 03/11/2026

Trabajo realizado en el checkout y PostgreSQL local. **Sin push, despliegue ni
escrituras en producción.** La consulta pública fue anónima y de solo lectura.

## Identidad y cambio

La API pública `/api/products/shielded-coal` devuelve el producto **ID 4,
ARMORED COAL**, precio base 6500 céntimos, seis variantes (31–36), cuatro
imágenes y tres categorías. La descripción identifica una bermuda vaquera
negra de algodón, corte amplio y largo por debajo de la rodilla. El nombre no
genera automáticamente un cambio de slug: `Product.slug` es único y persistido;
la edición administrativa solo lo cambia cuando recibe un slug explícito.

La base local contenía esa misma identidad y el slug nuevo estaba libre. Se
aplicó `20261103090000_armored_coal_slug/migration.sql` exclusivamente en local:
actualiza `Product.slug` y `updatedAt`, sin eliminar ni recrear el producto.
Comparaciones por hash verificaron que los demás campos, variantes, stock,
imágenes, categorías y relaciones permanecen iguales. La copia local no tiene
líneas históricas de pedido/checkout para este producto: no se afirma haber
probado una migración sobre pedidos reales existentes. El SQL no modifica sus
tablas ni sus instantáneas; los enlaces históricos siguen resolviéndose por 301.

La migración comprueba ambos slugs contra **todos** los productos, incluidos
inactivos, bajo bloqueo transaccional. Ante colisión o identidad diferente,
aborta. Se puede repetir sin cambiar de nuevo el producto. Reserva el slug
antiguo para impedir su restauración y el nuevo para el ID 4. El seed no crea
productos; el importador local de contenido aprobado normaliza únicamente la
fila ID 4/nombre ARMORED COAL de exportaciones antiguas. La restricción también
impide que una escritura directa o cliente antiguo restaure el slug previo.
No se cambian SKUs históricos ni textos/URLs guardados en pedidos.

Nest/Express sirve el HTML público detrás de Nginx. El middleware
`productSlugRedirect`, registrado antes de normalización de hostname, gate y
archivos estáticos, devuelve **301** para GET/HEAD de la URL antigua y sus
entradas históricas de producto. Conserva talla y parámetros auxiliares. El
destino canónico devuelve **200**, sin cadenas ni bucles en el escaparate abierto.
Las visitas www nuevas convergen al apex en el mismo salto; las sesiones www
históricas conservan su origen, siguiendo la política existente del repositorio.

Catálogo, búsqueda/sugerencias, recomendaciones, favoritos, carrito, productos
vinculados desde galería, sitemap, canonical, Open Graph y datos estructurados
obtienen el slug del producto actual. No había URLs antiguas codificadas en
esas superficies. La API de producto y las operaciones por slug de favoritos
también aceptan el alias antiguo para clientes con datos cacheados y devuelven
la identidad actual. Las instantáneas antiguas no se reescriben.

## Diagnóstico publicado

Se contrastaron GET del HTML, cabeceras, robots.txt, sitemap, APIs públicas y
renderizado Chromium sin sesión. Las cinco URLs recibidas responden 200,
sin redirecciones ni `noindex` en su HTML o X-Robots-Tag, con título,
descripción, canonical propio e inclusión en sitemap. Robots permite las páginas
y las APIs públicas necesarias para renderizarlas. El `noindex` de las respuestas
JSON de API es independiente del documento HTML y no se interpreta como bloqueo
de la ficha pública.

| Página | Resultado y decisión |
| --- | --- |
| `/devoluciones` | 200; política presente en HTML inicial, título/description/canonical correctos, enlace desde el pie de inicio. Sin fallo técnico demostrado; se conserva. |
| `/envios` | 200; política presente en HTML inicial, título/description/canonical correctos y enlace desde inicio. Sin fallo técnico demostrado; se conserva. |
| `/galeria` | 200; imágenes dependientes de JavaScript. La API y el carrusel funcionan: cinco fotos activas, todas cargadas y con alt descriptivo existente. No se inventan ni sustituyen alts. Se confirmó ausencia de enlaces a esta ruta desde las páginas públicas (solo existía uno en admin); se añade un enlace HTML en el pie de inicio, con la clase y tipografía existentes. |
| `/producto/shielded-coal` | 200 y contenido correcto bajo el slug anterior en producción. No se ha demostrado que la diferencia nombre/slug cause el aviso. Cambio solicitado preparado y aplicado en local: 301 a `/producto/armored-coal`, que devuelve 200. |
| `/sobre-cronox` | 200; artículo completo en HTML inicial, metadata y canonical correctos, enlace real desde el menú renderizado. Sin fallo técnico demostrado; se conserva. |

En producción, `/producto/armored-coal` sigue devolviendo **404** y la API pública
para ese slug no devuelve producto activo. Esto no descarta un producto inactivo
con ese slug: la comprobación definitiva de colisiones se hace sobre la base
durante la migración, antes de cualquier UPDATE.

No se dispone de la inspección interna de Search Console: última visita de
Google, HTML rastreado, canonical elegido ni motivos de selección. La dependencia
de JavaScript de galería y la falta previa de enlaces internos son observaciones;
no se demuestra que expliquen «Descubierta: actualmente sin indexar». Cargar o
pasar estas pruebas no acredita indexación ni permite prometer posicionamiento.

## Verificación reproducible

Desde la raíz, con dependencias instaladas:

```powershell
npm.cmd run build:compiled --prefix cronox-backend
npm.cmd test --prefix cronox-backend -- --runInBand product-slug public-seo.spec.ts public-pages.spec.ts product-admin-lifecycle product-search.service gallery-carousel.dom
node cronox-backend/scripts/armored-coal-local.cjs --test
node cronox-backend/scripts/armored-coal-local.cjs
node cronox-backend/scripts/armored-coal-local.cjs --apply
npx.cmd playwright test --config playwright.indexability.config.cjs
npx.cmd playwright test --config playwright.seo.config.cjs --project chromium
node tests/seo/audit-indexability.cjs
$env:LIVE_SEO_AUDIT='true'
npx.cmd playwright test --config playwright.indexability.config.cjs
Remove-Item Env:LIVE_SEO_AUDIT
git diff --check
```

`armored-coal-local.cjs` sin flags solo comprueba y muestra hashes; `--apply`
ejecuta solo este SQL sobre el perfil local validado, sin aplicar otras
migraciones pendientes. **No registra la migración en `_prisma_migrations`**:
el futuro `prisma migrate deploy` local la repetirá de forma segura y la
registrará. `--test` crea y elimina un esquema temporal local y verifica
repetición, colisiones, identidad, rollback y base vacía.

Resultados: compilación correcta; **127 pruebas Jest en siete suites**;
regresión PostgreSQL correcta; **tres pruebas de navegador local**, **seis SEO
Chromium existentes** y **una auditoría de navegador publicada** aprobadas.
Se actualizaron patrones de petición y un selector obsoletos de la suite SEO
existente para que comprobara el comportamiento actual en lugar de omitirlo.

La prueba local usa la aplicación y PostgreSQL reales para producto, catálogo,
búsqueda, favoritos persistidos, acceso directo, recarga, GET/HEAD, sitemap y
metadata. Ordena el catálogo solo en el navegador para situar el producto en la
ventana de recomendaciones. El favorito creado se elimina al terminar; se
respetan favoritos anteriores. Las seis tallas locales ya estaban a cero antes
del cambio: se comprueba la disponibilidad real y **solo la prueba de adición al
carrito usa respuestas simuladas de stock y un carrito en memoria**, con el ID 4
y variante 33. No se cambia stock para hacer pasar la prueba ni se inicia checkout.
No se ejecutan pagos, compras ni envíos reales. El servidor temporal desactiva
pagos, correos y trabajadores y se detiene al terminar las pruebas.

Evidencias locales ignoradas por Git: `test-results/indexability/live-http.json`,
`local-migration.json`, `local-browser/` y `live-browser/`. El JSON HTTP conserva
los resultados de producción antes de desplegar. El informe de migración conserva
hashes y conteos, no datos de pedidos ni secretos.

## Pendiente para producción y Search Console

1. Revisar esta revisión y el estado de migraciones del despliegue. No ejecutar
   `migrate deploy` a ciegas si hay otras migraciones pendientes. Conservar copia
   recuperable de la fila y relaciones. Comprobar ID 4/nombre y que ninguno de los
   dos slugs pertenece a otro producto, también inactivo; el SQL repite esta
   comprobación bajo bloqueo. Una discrepancia exige resolverla, no recrear filas.
2. Coordinar código y migración en la ventana de mantenimiento del despliegue:
   instalar/compilar, aplicar mediante el flujo normal
   `npm.cmd run prisma:migrate:deploy --prefix cronox-backend` en el entorno de
   producción y arrancar esta revisión antes de reabrir tráfico. Evitar una
   ventana con slug nuevo y backend anterior, o redirección nueva y datos antiguos.
   No ejecutar el launcher local contra producción. Si se usa SQL acotado fuera
   de Prisma, registrar después su aplicación por el procedimiento de migraciones
   de operaciones; no editar ni marcar como aplicadas migraciones ajenas.
3. Repetir sobre HTTPS público los GET y HEAD sin seguir redirecciones:
   antiguo **301** con Location nueva; nueva **200** sin Location. Comprobar
   acceso directo, recarga y parámetros de talla; sitemap sin URL antigua;
   canonical, Open Graph, JSON-LD y enlaces públicos nuevos. Revisar también
   catálogo, búsqueda, favoritos, carrito y vínculos desde galería sin comprar.
   Conservar la redirección permanente y los SKUs/instantáneas históricos.
4. En Search Console, inspeccionar las cinco páginas y usar «Probar URL publicada»
   tras desplegar. Comparar HTML renderizado, recursos, canonical declarada/elegida
   y último rastreo. Enviar de nuevo `https://cronox.es/sitemap.xml`; solicitar
   indexación de la URL nueva y, si procede, de las cuatro informativas. No pedir
   indexar el alias antiguo. Observar la evolución sin prometer plazos ni indexación.
