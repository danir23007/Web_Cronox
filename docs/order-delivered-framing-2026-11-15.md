# Encuadre de fotos en Pedido entregado

ORDER_DELIVERED utiliza una variante propia del generador de miniaturas, tanto
en los datos de envío como en Preview del administrador. Retira fondo vacío para
aumentar aproximadamente un 15 % la prenda respecto al original completo, con
una escala común para ambos ejes, centrado y margen de seguridad. Si una manga,
un detalle o un fondo incierto impiden ese aumento, lo limita para conservar la
prenda completa. Incluye blancos sobre transparencia en el área protegida.

La imagen del correo sigue ocupando 70 × 70 px dentro del mismo marco; el PNG
generado mide 140 × 140 para su presentación a doble densidad. No cambia el
archivo del catálogo. Se mantiene la prioridad de la foto de la línea comprada;
solo las fotos registradas y admitidas por la política existente se procesan.
Las demás conservan el original proporcional, sin sustituir la foto comprada.

Recurso exclusivo: `/api/email/order-product-image/:id/delivered.png?v=1`, con
caché independiente por encuadre y URL original. Confirmación conserva su ruta
y encuadre previos; Enviado y Reposición mantienen sus datos de imagen actuales.
No se reescriben snapshots, borradores ni publicaciones, ni se añaden migraciones.

Comprobaciones automatizadas: aumento medido sobre píxeles de una prenda negra
en fotos vertical, horizontal y cuadrada, geometría proporcional, mangas y detalles
de borde, blancos sobre transparencia, cachés separadas y cinco versiones activas
simuladas. Las seis suites relacionadas suman 49 casos aprobados. Compilación del
backend y comprobador de contenido privado aprobados. El verificador de PostgreSQL
local comprueba las cinco plantillas existentes en transacción de solo lectura,
la ruta nueva y las dimensiones de marco e imagen; conserva sus estados.
Sin navegador, capturas ni correos reales de prueba.

La publicación utiliza Deploy CRONOX y los controles habituales del servidor.
