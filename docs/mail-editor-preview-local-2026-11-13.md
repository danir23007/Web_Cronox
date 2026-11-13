# Editor completo y Preview de plantillas de correo

Trabajo preparado exclusivamente para revisión local. Sin commit, push, publicación de plantillas ni despliegue.

## Uso

Abrir el administrador local, Mails → Plantillas mails → cuenta → círculo → Editar plantilla. Las pestañas Editar y Preview están encima del correo, fuera de Opciones avanzadas. Escritorio y Móvil se conservan en ambas vistas.

Editar muestra el diseño producido por el renderizador de envío, incluidos los bloques HTML importados y la firma seleccionada. El texto se edita directamente en el correo. Diseño por bloques conserva el constructor existente. Los bloques HTML también ofrecen su fuente para editar imágenes, fondos, enlaces y estilos. Cambiar de pestaña no guarda el borrador ni publica ni envía mensajes.

## Conservación del contenido

El GET del editor proyecta una copia de los textos fijos conocidos por finalidad. No escribe la base de datos ni transforma las versiones publicadas. Solo expande marcadores exactos de contenido fijo; respeta texto personalizado, HTML, estilos, imágenes, identidad de cuenta y círculo. Las lecturas internas del servicio siguen devolviendo el documento almacenado. Las comparaciones para cambios exclusivos de clasificación normalizan esa proyección en ambos lados sin escribir el contenido de las otras copias.

Se conserva el HTML guardado, incluso en documentos antiguos de un único bloque sin formato explícito. Antes, el GET podía sustituir ese HTML por un diseño genérico. Las plantillas de contraseña para cuenta nueva y existente usan sus respectivos textos. Newsletter Access conserva sus dos frases mediante `accountEligible` y su contraseña opcional mediante `initialPassword`; el selector de caso permite revisar y editar cada rama sin eliminar la otra.

La vista Editar utiliza marcadores temporales y rangos del texto fuente para dirigir las ediciones a su bloque original. Estos marcadores se añaden a una copia para renderizar, nunca al borrador. Los cambios en HTML fuente desactivan la edición visual hasta pulsar Actualizar, evitando aplicar rangos obsoletos. Los if/each, variables y resto del diseño se conservan.

## Preview y envío

Preview envía el borrador actual al endpoint existente de renderizado, incluyendo cambios sin guardar. Muestra asunto, texto previo y cuerpo, con ejemplos por finalidad (Lucía Martín, CRX-1042, talla M, seguimiento y descuento no válidos). Los enlaces de acciones utilizan example.test; además, los enlaces de todos los iframes se desactivan. Los iframes no permiten scripts, formularios ni navegación superior y tienen una CSP restrictiva.

El catálogo de ejemplos cubre también las variables de bucles y condiciones. Un dato admitido que falte se comunica por nombre. No se consultan destinatarios, SMTP ni colas para generar Preview.

Se corrigieron tres incompatibilidades del envío con el contenido editable: la comprobación de contraseña exigía las frases originales completas; algunos flujos descartaban el asunto publicado; y Newsletter Access duplicaba la contraseña si cambiaba la frase que la acompañaba. Se conservan la selección de versión publicada, los datos reales del evento, las comprobaciones de enlaces y pedido y los respaldos de seguridad. Los ejemplos siguen limitados a los endpoints de vista previa.

## Verificación

- Tipos de backend y administrador y compilaciones de ambos.
- Pruebas de correo/editor, newsletter, acceso y seguimiento: 270 casos en 27 suites.
- Las 15 finalidades del catálogo: bloques visuales, HTML heredado, documentos explícitos de bienvenida y todas las variables ofrecidas; sin variables pendientes en Preview.
- 55 plantillas almacenadas en PostgreSQL local verificadas en transacción de solo lectura, sin fallos. Incluyen once finalidades en Pedidos, No-reply y Soporte; las restantes se verifican mediante el catálogo de pruebas.
- Navegador a 1440 y 390 px: contraseña de cuenta existente y nueva, bienvenida con fondo/logos, confirmación, envío con seguimiento, reposición y HTML personalizado guardado. Ediciones pendientes conservadas entre pestañas, asunto y texto previo con variables originales, enlaces desactivados y sin desbordamiento horizontal de la página.
- Regresiones de publicación inmutable, clasificación por círculos, guardado y envío con datos reales y transporte simulado.

La revisión visual usa datos locales de ejemplo. No se ha verificado recepción en clientes de correo reales ni se ha solicitado un envío para este trabajo.
