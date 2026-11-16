# Ascenso de círculo: fondo negro y ventajas sin filas vacías

No-reply / CIRCLE_PROMOTION, círculos II–V: un único fondo #000000 en cuerpo,
superficies, logo y texto. Se mantiene el logo, la alineación izquierda, el color
del título de cada círculo y el botón blanco Ver mi acreditación. La introducción
es «Enhorabuena por subir al Círculo {{circleRoman}}. Has dado un paso más dentro
de CRONOX.»; tras las ventajas y justo antes del botón figura «Pásate por tu cuenta
y echa un vistazo a tu nueva acreditación {{accreditationColor}}. Ya está disponible.».

La proyección específica de esta finalidad actualiza el diseño base, documentos
por bloques y HTML importado, editor, Preview y renderizado de versiones publicadas.
No sobrescribe los snapshots ni cambia qué versión está publicada. El fondo
exterior y las firmas también se proyectan a negro. Otros correos conservan sus
fondos y su comportamiento previo de condiciones.

Solo se ajustan los seis campos de ventaja al renderizar: una cadena válida se
recorta y un valor ausente, vacío, de espacios o no textual se trata como vacío.
La condición rodea la fila completa, incluidos viñeta, celda y padding. El orden,
contenido de las ventajas realmente desbloqueadas, diferencias entre círculos y
ascensos que saltan niveles conservan la lógica existente de circlePromotionData.
El enlace de cuenta/acreditación se conserva y se valida leyendo el atributo href,
evitando descartar una publicación por la normalización de entidades HTML.

Comprobación: 59 casos relacionados en seis suites aprobadas, incluidos II con una
viñeta, IV con tres, ausencia de huecos, valores de espacios, los cuatro destinos,
saltos de círculo, documento importado, idempotencia, marcadores del editor y carga
de envío con transporte en memoria. Tipos y compilación del backend aprobados.

La copia PostgreSQL local no contiene las cuatro publicaciones productivas. Se
leyeron exclusivamente las cuatro publicaciones y snapshots CIRCLE_PROMOTION de
producción con BEGIN READ ONLY / COMMIT, mediante la conexión Supabase existente.
No se consultaron clientes, destinatarios ni colas. La exportación de esas cuatro
versiones se comprobó localmente con el mismo servicio de Preview/publicación y
datos simulados: II=1, III=2, IV=3, V=3 ventajas. Se mantuvieron todas las referencias
de publicación, documentos y enlaces. No se enviaron correos reales.

Reproducción con una exportación de publicaciones existente:
`node scripts/verify-circle-promotion-redesign-local.cjs --snapshots <archivo.json>`
desde cronox-backend. Sin argumento, el script verifica publicaciones en la base
local en transacción de solo lectura. Los artefactos HTML, la exportación y el
informe permanecen ignorados en output/playwright/circle-promotion-redesign/.

Publicación mediante el workflow Deploy CRONOX, sin migraciones ni cambios de
disparador automático. El despliegue debe confirmar el SHA exacto y la salud pública.
