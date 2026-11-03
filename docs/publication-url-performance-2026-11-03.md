# Publicación acotada de URL y rendimiento — 03/11/2026

**Publicado y verificado:** versión funcional `87efb903fe6a1dc3bfa5146fd2b683d9b43735d0`, reabierta a las 05:00:09 UTC del 03/11/2026 (06:00:09 en Madrid). [CI aprobado](https://github.com/danir23007/Web_Cronox/actions/runs/41580029296) y [publicación habitual completada](https://github.com/danir23007/Web_Cronox/actions/runs/41580596583). Los apartados de preparación siguientes explican el alcance; los resultados finales están al final.

Autorización: publicar exclusivamente ARMORED COAL/SEO y rendimiento. Se conserva el trabajo local completo en `work/cronox-url-performance-20261103`. La rama `release/cronox-url-performance-20261103` avanza el historial sin force-push, con compensaciones explícitas para que los cambios anteriores no autorizados no lleguen al cliente.

## Alcance previo al despliegue

La base funcional productiva comprobada es `18260856c805916eede0136a6e7334198eae4a8a`. Main contenía seis commits posteriores. Permanecen en el historial, pero sus diferencias se excluyen de esta publicación: documentación de la incidencia, exclusión de artefactos, eliminación administrativa con participaciones QR, ajuste de espacios del pie, regresión del checkout y retirada del aviso de presencia. El código administrativo, pie compartido y checkout de la revisión candidata se comparan contra la base productiva, no solo contra el último main.

`720afaf5` oculta únicamente «Artículos reservados mientras permanezcas en el checkout» cuando la reserva está lista, y actualiza la versión del script. No altera la adquisición de reserva, los plazos ni los mensajes de pago iniciado/caducidad/error. Se conserva en local; en esta publicación sigue el aviso actual de producción. `0ef19ea7` añade una regresión y documentación, sin comportamiento de cliente. Tampoco se incorpora su archivo nuevo a la revisión publicada.

Los commits de URL/rendimiento son `d50bfe30` y `e655d256`. Los recursos minificados de publicación se regeneran desde las fuentes acotadas: por ejemplo, el CSS no incorpora el ajuste anterior de espacios del pie. No se modifica el controlador privilegiado ni el workflow. Push ejecuta CI; después se solicita un único `workflow_dispatch publish=true` sobre el SHA exacto verificado de main.

## Datos e imágenes

Preflight de producción: producto 4 = ARMORED COAL, slug anterior, 6500 céntimos; slug nuevo libre. Historial íntegro de 109 migraciones y solo `20261103090000_armored_coal_slug` pendiente. El controlador habitual exige detener escritores y crear/restaurar/comparar un respaldo recuperable antes de instalar y migrar.

Plan de Storage preparado sin mutaciones: ocho galerías sin preview y 125 WebP públicos con rutas hash y cabecera incompleta, 51.967.138 bytes. Copia privada en el VPS, fuera del checkout: `/home/deploy/cronox-images-backup-20261103`, permisos 700/600, bytes originales y metadatos, manifiesto SHA-256 `c91f61824e59a6315a7bad6557c8f4814c5fafaf5f9d5e72c115e634c0387a09`. No se incluyen esos archivos en Git.

`scripts/maintain-storefront-images.cjs` admite plan/execute/verify/restore-cache, límites de 30 galerías/200 objetos, proyecto fijo, comprobación de copias y estado concurrente. Repara caché por PUT soportado conservando bytes, MIME, encoding y metadatos propios; no modifica tablas internas de Storage por SQL. Solo añade preview a los JSON de galería mediante comparación del valor anterior; conserva grid/large, URL original, dimensiones y demás campos. La restauración de caché usa las copias; para revertir preview, el plan conserva el JSON anterior y el esperado, que deben compararse antes de restaurar la fila. Los nuevos objetos pueden quedar sin referencias sin borrar originales ni ampliar el alcance de la operación.

Fuentes: [actualización de Storage](https://supabase.com/docs/reference/javascript/storage-from-update) y [caché de CDN y navegador](https://supabase.com/docs/guides/storage/cdn/smart-cdn). La propagación de CDN puede tardar; verificar tanto metadatos como GET/HEAD públicos después.

## Verificación preparada

Compilación equivalente a producción y tipos correctos. 185 pruebas Jest focales en 12 suites; tres pruebas del mantenimiento acotado. Las comprobaciones anteriores de navegador/checkout simulado constan en los informes de cada trabajo. El CI obligatorio ejecutará además su batería completa sobre la revisión exacta. Las mediciones públicas y comprobaciones finales se documentarán tras publicar, sin crear pedidos, pagos, suscripciones ni alterar stock.

## Resultado del despliegue y los datos

- Commits funcionales publicados: `d50bfe30` (URL, alias y enlace de galería), `e655d256` (rendimiento). `1c0a0541` y `d5407f9f` acotan la revisión a los cambios autorizados sin reescribir el historial; `87efb903` actualiza las regresiones. La comparación del árbol final contra la base productiva excluye las modificaciones anteriores de administración, checkout y espacios del pie.
- El primer CI se detuvo en 12 expectativas anteriores de nombres de recursos, enlaces del pie y carga inmediata de galería. Se actualizaron conservando comprobaciones de comportamiento y se añadió igualdad entre el bundle generado y la fuente, con hash de URL. El CI final y su repetición en el dispatch aprobaron **287 suites / 3.106 pruebas**, más 59 pruebas de exportaciones, tipos, compilaciones y control de credenciales. No se omitió ningún control del workflow.
- El controlador detuvo escritores, creó un respaldo privado de aplicación/configuración y PostgreSQL, lo restauró en aislamiento y comparó **305 objetos sin diferencias** antes de instalar o migrar. Evidencias y sumas están bajo `/var/lib/cronox-release/87efb903fe6a1dc3bfa5146fd2b683d9b43735d0/`. No se restauró sobre producción.
- Migración `20261103090000_armored_coal_slug` terminada: **110 migraciones, ninguna pendiente**. Las huellas antes/después coinciden para todos los campos restantes del producto, seis variantes y stock, cuatro imágenes, tres categorías, tres líneas históricas de pedido y tres instantáneas de checkout. Solo cambiaron slug y fecha de actualización del producto. Precio: 6.500 céntimos. Cero compras, pagos, suscripciones o cambios de stock de prueba.
- El código y versión del checkout, el CSS fuente y el controlador del pie, y el código administrativo excluido se contrastaron con la base productiva. El aviso de artículos reservados sigue visible. Los commits originales y el trabajo completo permanecen en la rama local indicada; no se hizo force-push.

## Storage completado

- Se revisó el plan y se verificaron todas sus copias antes de escribir. **125 objetos antiguos** recibieron la directiva correcta mediante la API soportada, conservando exactamente sus bytes y metadatos propios, tipo y codificación. Se generaron y publicaron **ocho previews**; solo se añadió esa clave a la metadata de galería mediante comparación del valor anterior. Originales, grid/large, relaciones y demás campos permanecen iguales.
- Una segunda ejecución en modo `verify` acreditó contenido y metadatos. **133 GET públicos** adicionales comprobaron SHA-256 de los bytes y `Cache-Control: public, max-age=31536000`. En este servicio HEAD responde `private, no-cache` aunque GET sea cacheable: el contador `publicHeaders:0` del comprobador HEAD no representa el comportamiento de descarga del navegador. Se contrastaron ambos métodos y se usó GET para acreditar la caché efectiva.
- Se limitó la operación a WebP públicos con rutas de contenido hash de productos y galería. No se alargó la caché de las URLs fijas reemplazables de newsletter ni de otros objetos fuera del plan. No se actualizaron tablas internas de Storage por SQL. Los metadatos operativos derivados de una sustitución (fecha/versionado de Storage) pueden cambiar; contenido y metadatos propios se verificaron.
- El proceso real de subida usado por administración se comprobó con procesamiento de imagen real y Storage simulado: genera preview/grid/large, conserva el original, establece caché larga, reutiliza la URL para bytes idénticos y entrega URL nueva para contenido distinto. No se subió una foto ficticia desde el administrador productivo.
- Para repetir/revertir: conservar el directorio privado y su manifiesto; `node scripts/maintain-storefront-images.cjs verify /home/deploy/cronox-images-backup-20261103` revisa bytes/metadatos sin mutaciones remotas. `restore-cache` restaura la cabecera anterior usando los mismos bytes y guardias. El JSON anterior de cada galería y el preview esperado permiten restaurar únicamente esa metadata tras comparación; no se borran originales. Para verificar caché de navegador, descargar por GET las URLs del plan y comparar con sus hashes, en lugar de inferir el TTL desde HEAD.

## Verificación pública

GET y HEAD del alias antiguo devuelven **301 directo** a `/producto/armored-coal`; GET y HEAD del destino devuelven **200** sin Location. Acceso directo y recarga, producto, seis tallas, precio, canonical, Open Graph y JSON-LD correctos. Sitemap sin la URL antigua y catálogo con la nueva. La API antigua resuelve el mismo ID con el slug actual para conservar clientes históricos.

`/envios`, `/devoluciones`, `/galeria` y `/sobre-cronox` responden 200, con canonical propio y sin bloqueo robots/noindex del documento. Las tres informativas conservan su contenido inicial. Galería funciona con JavaScript, alts existentes y enlace HTML rastreable desde el pie. No hay prueba de indexación ni diagnóstico interno de Search Console.

Los cuatro recursos minificados responden 200 y sus hashes coinciden con la versión de sus URLs: CSS 67.049 bytes, app 78.546, productos 30.478 y galería 21.942. Sin compresión HTTP, como antes. El CSS de esta publicación se generó desde la fuente productiva, excluyendo el ajuste previo de espacios del pie. `/api/health` y `/api/ready` responden 200.

Pasaron tres pruebas de imágenes/checkout sobre el frontend exacto de publicación, 69 casos de carrito/favoritos/newsletter/interacción, y auditoría de navegador anónima publicada de las cinco páginas. Las operaciones de escritura y Stripe se simulan en pruebas. Las comprobaciones públicas bloquean escrituras y simulan el carrito: se revisan consentimiento, primer toque, newsletter sin enviar, catálogo, quick add, ficha, talla M, recarga y galería ampliada. Los resultados/capturas locales quedan fuera de Git.

La comprobación visual pública adicional pasó en ambos dispositivos, con cero errores de JavaScript. En móvil (412 CSS px, DPR 1,75), las siete tarjetas seleccionan `small.webp`; la galería selecciona `preview.webp` de 720 px para unos 297 CSS px (`sizes=305px`). En escritorio se observan small/card según la imagen y preview en galería (`sizes=393px`). La ampliación solicita `large.webp`. Se vieron la newsletter sin enviarla, quick add, seis tallas y selección M, y se recargó directamente la ficha con 200. Las capturas finales de producto, catálogo y galería se compararon con la evidencia anterior; las de entrada móvil conservan exactamente la composición, fuente y aviso de cookies.

## Mediciones públicas finales

24 navegaciones Lighthouse: tres pares fría/repetida por dispositivo y versión, con el mismo Chromium 153/Lighthouse 13.6, CPU/red/viewport del laboratorio descrito en el informe local. Ahora las respuestas proceden directamente de HTTPS/CDN/backend publicados. El PSI histórico 66/99 y el laboratorio local 89→95 / 100→100 son series diferentes, no extremos de esta comparación. No hay datos de campo.

Segundos para FCP/LCP/SI; milisegundos para TBT; transferencia en KiB. Medianas de tres ejecuciones por fila.

| Dispositivo / visita | Versión | Rendimiento | FCP | LCP | SI | TBT | CLS | KiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Móvil / fría | Antes | 87 | 2,78 | 2,95 | 4,61 | 119 | 0 | 3.338 |
| Móvil / fría | Después | 90 | 2,43 | 2,87 | 3,96 | 82 | 0 | 1.156 |
| Móvil / repetida | Antes | 100 | 0,69 | 0,78 | 1,17 | 23 | 0 | 162 |
| Móvil / repetida | Después | 100 | 0,70 | 0,77 | 1,17 | 8 | 0 | 158 |
| Escritorio / fría | Antes | 98 | 0,71 | 0,88 | 1,30 | 0 | 0 | 4.029 |
| Escritorio / fría | Después | 99 | 0,73 | 0,73 | 1,19 | 0 | 0 | 1.012 |
| Escritorio / repetida | Antes | 100 | 0,34 | 0,34 | 0,58 | 0 | 0 | 163 |
| Escritorio / repetida | Después | 100 | 0,39 | 0,39 | 0,65 | 0 | 0 | 158 |

Descarga fría: **65,4 % menos en móvil y 74,9 % menos en escritorio**. No todos los tiempos mejoran; las diferencias pequeñas y las tres muestras no acreditan mejora universal. Una repetición de escritorio posterior descargó candidatos card adicionales (~940 KiB frente a ~158 en las otras dos); la mediana no elimina esa variabilidad. Lighthouse restaura la emulación entre auditorías y puede recargar: sus observaciones DOM posteriores no se emplean para acreditar el momento real de entrada ni sustituyen la traza.

LCP final de la traza: en las seis visitas móviles frías es el párrafo de cookies; en las seis móviles repetidas, `IMG.preloader__logo` (confirmado en eventos `largestContentfulPaint::Candidate`, también cuando Lighthouse omite el desglose por ser rápido). En escritorio es la imagen principal. Las imágenes grandes/originales del hero no se redujeron. Que un logo o texto pinte pronto no demuestra por sí solo que la tienda ya esté descubierta.

La serie separada de interacción, tres visitas frías por dispositivo sobre HTTPS con las mismas condiciones antes/después, da **6,55→5,30 s** hasta retirar completamente la entrada móvil (**1,25 s / 19 % menos**), y **1,73→1,47 s** en escritorio. El manejador del menú está preparado a **5,82→4,58 s** en móvil y **1,10→0,83 s** en escritorio; abrió al primer toque tras rechazar cookies. En esta serie la interceptación de APIs desactiva la caché HTTP de Playwright en ambas versiones; los tiempos de recarga sirven para comportamiento/consentimiento, no como medida de caché caliente. Las visitas repetidas con caché se representan en la tabla Lighthouse.

Limitación corregida y conciliada: la serie Lighthouse anterior permitió `GET /api/cart`, que crea filas anónimas vacías. Se detectaron **seis** mediante cookies capturadas, se comprobaron tiempos, ausencia de usuario, artículos y relaciones, se guardó copia privada y se retiraron exclusivamente esas seis. Se liberó una transacción de lectura propia que había quedado abierta durante esa conciliación. La serie posterior simula también ese GET, conservando el resto de condiciones; supone una pequeña diferencia de una respuesta de cesta vacía y evita atribuir precisión absoluta a la comparación. No se generaron pedidos, pagos, suscripciones ni reservas/stock de prueba. La corrección está publicada en `6ca641d2`, [CI correcto](https://github.com/danir23007/Web_Cronox/actions/runs/41582376928); solo cambia el medidor, no el código funcional del VPS, que permanece en `87efb903`.

Evidencias privadas/locales: `output/release-20261103/` y `output/performance-20261103/public-{before,after}/`, con trazas, red, LHR, capturas, comprobaciones de producto, Storage, migración y diario. No se versionan volcados, cookies ni informes pesados. La comparación visual local previa y la comprobación publicada conservan fuentes, marca, movimiento y ampliaciones; las capturas tomadas durante una transición de newsletter o con fotos aún en carga no se usan para comparar nitidez.

## Cierre y Search Console

No quedan pasos técnicos obligatorios para activar ambos cambios. Gzip/Brotli queda fuera de esta publicación: se evaluó la respuesta real y no se atribuye a compresión ningún ahorro; la mejora está verificada con el alojamiento actual. La prioridad alta del preloader no aportó ventaja y la preconexión no tuvo evidencia remota controlada. No se eliminó ninguna función por cobertura inicial.

Inspeccionar y probar las URLs publicadas siguientes, contrastando recursos, HTML renderizado y canonical elegida por Google. Solicitar indexación si procede, sin prometer aceptación ni plazos:

- https://cronox.es/producto/armored-coal
- https://cronox.es/galeria
- https://cronox.es/envios
- https://cronox.es/devoluciones
- https://cronox.es/sobre-cronox

Enviar **https://cronox.es/sitemap.xml**. El alias **https://cronox.es/producto/shielded-coal** se puede inspeccionar para comprobar el 301; no solicitar su indexación como página independiente. El acceso interno de Search Console queda para su titular; no se afirma que las páginas estén indexadas.
