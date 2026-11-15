# Cabeceras oficiales de correo

La cabecera compartida usa el logo largo oficial exportado a PNG para correo, a 148 px y con proporción natural. El recurso blanco se usa sobre oscuro y el negro sobre claro. Las tablas conservan el número de pedido a la derecha también en móvil. La cabecera de «Confirmación de pedido» no utiliza esta transformación.

`mail-logo-header.ts` modifica una copia del documento y conserva el resto de bloques, HTML, variables, enlaces y estilos. Sustituye la antigua marca textual de las cabeceras de pedido; reutiliza las imágenes oficiales existentes para evitar duplicarlas. El diseño inicial de No-reply y los respaldos de No-reply/Pedidos comparten esta lógica. El respaldo de Soporte no cambia.

La excepción de bienvenida es exclusivamente la identidad de producción `cmvf0j8780001l296e24fam0c`; no depende del nombre ni de excluir toda la finalidad NEWSLETTER_WELCOME. El ID de la antigua copia local no identifica esta excepción en producción.

## Actualización de registros existentes

`mail-header-rollout.ts` prepara un plan a partir de un inventario leído de producción. No importa ni crea tarjetas. Incluye No-reply y Pedidos en sus círculos, excepto la bienvenida aprobada y las confirmaciones de pedido. En Soporte solo selecciona las tarjetas de Ticket recibido que ya tienen una publicación activa. El archivo/restauración y la clasificación visual no se modifican.

La operación debe ejecutarse dentro de una transacción serializable, después de bloquear las tarjetas y publicaciones y contrastar la huella del inventario revisado. Si los datos cambiaron, falla antes de escribir. La actualización del borrador cambia únicamente documento/HTML y su revisión. La publicación genera una versión inmutable **desde su snapshot activo anterior**, más la cabecera, y cambia solo el puntero ya existente, condicionado al ID de versión anterior. No publica contenido pendiente del borrador, no crea publicaciones nuevas y conserva los slots globales heredados y por círculo. Las versiones históricas permanecen intactas. Cada intervención deja auditoría EMAIL_HEADER_UPDATE.

La verificación posterior compara número/IDs, datos fuera de alcance, campos del borrador, versiones históricas y claves de publicación; comprueba los estados/contadores por cuenta y círculo y resuelve las publicaciones mediante el servicio real con transporte en memoria. No se crean pedidos ni se envía correo para verificar.

Las pruebas cubren identidad estable, ambos fondos, idempotencia, sustitución de marca textual, número de pedido, alcance de Soporte, conservación de firma/texto/enlaces, borradores distintos de la publicación y rechazo de inventarios obsoletos. Gmail/Outlook reales requieren una comprobación aparte de sus transformaciones de color; las pruebas de navegador no equivalen a esos clientes.
