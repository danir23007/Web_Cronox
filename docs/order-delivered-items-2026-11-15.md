# Artículos en Pedido entregado

ORDER_DELIVERED incorpora «Artículos de tu pedido» después del estado actual,
con nombre comprado, talla si existe, cantidad y foto opcional por línea. El
renderizador aplica el mismo componente a los cinco círculos, tanto en documentos
HTML importados como de bloques, en el editor y en las versiones publicadas.
Conserva textos, colores, enlaces, estados y snapshots; no publica borradores ni
requiere una migración de datos. También se actualiza el respaldo de envío.

El consumidor compartido de avisos carga las líneas del pedido dentro de la
transacción que ya mantiene bloqueado el pedido, exclusivamente para DELIVERED.
Las entregas manuales del administrador y las de Correos usan este consumidor y
conservan su deduplicación. El catálogo representa las tallas como variantes sin
relación propia de fotos. Se prioriza la URL guardada en la línea comprada y luego
las imágenes activas del producto por prioridad; se selecciona únicamente la URL
de la instantánea privada, sin incluir valores financieros en el correo. Se
conserva el nombre de la compra aunque el catálogo haya cambiado.

Las fotos usan el marco centrado de 70 px de Confirmación y Pedido enviado,
con dimensiones proporcionales cuando hay metadatos y proporción intrínseca en
los originales sin metadatos. No hay recorte, estiramiento ni imagen de respaldo
ficticia. Una línea sin URL HTTPS válida se muestra sin etiqueta img.

Validación sin navegador, capturas ni SMTP: 80 pruebas en ocho suites, compilación
del backend y comprobación de contenido privado aprobadas. Incluye los productores
manual y Correos, ambos orígenes de la cola, envío de respaldo con transporte en
memoria, cinco publicaciones simuladas inmutables, editor, fotos vertical y
horizontal, falta de imagen, cantidades, escape del contenido e idempotencia.

`node cronox-backend/scripts/verify-order-delivered-local.cjs` (desde el directorio
del backend: `node scripts/verify-order-delivered-local.cjs`) comprueba los cinco
documentos existentes y sus versiones en PostgreSQL local mediante una transacción
de solo lectura. La instalación local comprobada conserva cinco borradores y cero
publicaciones de esta finalidad. HTML de prueba e informe quedan excluidos de Git
en `output/playwright/order-delivered/`. No se envía ningún correo ni se consultan
URLs de imágenes al ejecutar estas comprobaciones.

Publicación autorizada mediante el workflow existente Deploy CRONOX, con CI del
commit exacto y los controles normales del servidor. Sin migraciones nuevas,
escrituras de plantillas productivas ni comunicaciones de prueba.
