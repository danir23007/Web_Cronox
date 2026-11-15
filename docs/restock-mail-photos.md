# Fotos en el aviso de reposición

El bloque de fotos se incorpora debajo del título y antes del producto/talla,
sin sustituir textos personalizados, botones, firmas o fondos. La proyección
`prepareRestockDocument` es idempotente y sirve al editor, a Preview y al
renderizado de versiones publicadas de RESTOCK. No crea tarjetas ni publicaciones.
El diseño inicial y el respaldo Handlebars incluyen el mismo bloque.

La selección reproduce `CRONOX_IMAGES.productRecords` y su preset `quick`:
primaria primero, después `sortOrder`, sin duplicados, imágenes inactivas,
archivadas o placeholders. La prueba compara el resultado con el código real de
Quick Add. Las variantes actuales representan tallas y no tienen galería propia:
se usa la galería de `row.variant.product`, nunca la de un producto aleatorio.

El recurso público `/api/email/restock-product-image/:id.png?v=2` utiliza el preset
quick o el original del mismo registro si falla. Solo lee el bucket público
permitido, sin redirecciones, con límites de descarga y píxeles. Genera un PNG
560 x 736 con contain y relleno transparente; conserva toda la imagen. La tabla
mantiene dos columnas y 2 px de separación también en móvil, sin object-fit ni
dependencia de imágenes de fondo. Una foto se centra; sin fotos no queda fila.
En producción la URL usa el origen HTTPS configurado. El perfil local protegido
permite exclusivamente la ruta de imagen equivalente en localhost:3000 por HTTP.

Preview prefiere productos del catálogo local con dos imágenes y conserva los
IDs de producto y variante durante la sesión. Editar muestra las mismas fotos de
ejemplo pero conserva los marcadores de texto, sin copiarlos al borrador. El
trabajador de reposición carga la galería al despachar cada solicitud existente;
WAITING/QUEUED no contienen snapshots de fotos que haya que migrar. Las esperas
por cuota de RESTOCK continúan en esa cola, con el mismo enlace y controles de stock.

Las cinco tarjetas existentes conservan IDs, versiones, publicaciones y contenido
personalizado. La proyección también añade el bloque a las tarjetas online sin
importar registros locales ni volver a publicar borradores. El respaldo se actualiza
con el código. Evidencias de revisión y simulaciones sin correo real:
`output/playwright/restock-photos/` (ignorado por Git).
