# Detalles del producto y PLANTILLAS MAILS

## Auditoría del flujo existente

`Product.description` ya se cargaba en `productDescription`, se enviaba como `description` y se persistía en `ProductService.updateProduct`. `api.ts` lo adapta como `desc`. El acordeón público, sin embargo, contenía tres detalles fijos. Ahora `pDetails` recibe las líneas no vacías de `description ?? desc` mediante `textContent`; el párrafo superior no duplica los detalles. Se mantienen el límite de 800 caracteres y el formato libre de los registros existentes. No se crea otro campo ni se modifica la persistencia de productos.

Se auditaron los enums, los dos mapas de enrutamiento, los seis archivos `.hbs`, `EmailService`, el controlador de pruebas, los consumidores de Auth/Newsletter, el webhook de confirmación y las notificaciones del administrador de pedidos. Hay diez propósitos y ocho tipos de transporte. Los dos propósitos adicionales no cambian los tipos existentes: configuración inicial usa `PASSWORD_RESET`; bienvenida usa `GENERIC`.

| Propósito / nombre de biblioteca | Remitente | Archivo existente | Asunto actual |
| --- | --- | --- | --- |
| TEST / Correo de prueba | NOREPLY | test.hbs | [CRONOX] Test email (TEST) |
| ORDER_CONFIRMATION / Confirmación de pedido | ORDERS | order-confirmation.hbs | CRONOX · Confirmación de pedido |
| ORDER_SHIPPED / Pedido enviado | ORDERS | order-shipped.hbs | CRONOX · Pedido #{{orderId}} enviado |
| ORDER_DELIVERED / Pedido entregado | ORDERS | order-delivered.hbs | CRONOX · Pedido #{{orderId}} entregado |
| SUPPORT_TICKET_RECEIVED / Ticket de soporte recibido | SUPPORT | support-ticket-received.hbs | Asunto suministrado por el emisor |
| PASSWORD_RESET / Restablecimiento de contraseña | NOREPLY | generic.hbs | CRONOX · Restablece tu contraseña |
| INITIAL_PASSWORD_SETUP / Configuración inicial de cuenta | NOREPLY | generic.hbs | CRONOX · Tu cuenta ha sido creada |
| NEWSLETTER_CONFIRMATION / Confirmación de newsletter | INFO | generic.hbs | CRONOX newsletter confirmation |
| FIRST_ORDER_DISCOUNT / Descuento de bienvenida | INFO | generic.hbs | CRONOX · Tu descuento de bienvenida |
| GENERIC / Correo genérico | INFO | generic.hbs | Asunto suministrado por el emisor |

Soporte y genérico son propósitos existentes en los enums/plantillas; no se inventa un nuevo consumidor automático. No se encontró un envío de soporte dedicado fuera de la infraestructura de tipos y pruebas. El controlador de pruebas permite elegir otros tipos, pero no se clona esa combinación como un propósito empresarial adicional.

Variables reales y reglas por propósito: `src/email/managed/mail-catalog.ts`. Incluyen `title`, `message`, `customerEmail`, `supportCaseId`, `actionUrl`, `actionLabel`, `orderId`, `orderUrl`, `storeUrl`, `statusLabel`, `shippingCarrier`, `trackingNumber`, totales formateados, contacto y `shippingAddress.*`. Se conserva `{{#each items}}` con nombre, variante, cantidad, imagen y total de línea. Solo se permiten variables conocidas, `if`, `else` y `each items`; no se admiten helpers arbitrarios, parciales ni interpolación sin escape. La publicación comprueba las variables esenciales de cada flujo.

Metadatos observados localmente (sin leer ni imprimir contraseñas): SUPPORT `support@cronox.es`, ORDERS `orders@cronox.es`, NOREPLY `no-reply@cronox.es`, INFO `info@cronox.es`. Las cuatro cuentas devolvieron disponibilidad de envío `false`. Estos datos se consultan dinámicamente; no se guardan credenciales en Prisma ni en el frontend.

## Arquitectura y seguridad

- Ruta protegida: `/api/admin/mail-templates`, con JWT, AdminGuard y RolesGuard; acceso SUPER_ADMIN, incluidas las equivalencias de rol del proyecto. También se conserva la protección CSRF global.
- Modelos nuevos: `EmailSenderProfile`, `EmailTemplateFolder`, `ManagedEmailTemplate`, `EmailTemplateVersion`, `EmailPublication`, `EmailSignature`, `EmailAsset`. Claves foráneas, índices, unicidad de importación y clave compuesta cuenta/propósito para una única publicación activa. La carpeta y la plantilla comparten una FK compuesta de cuenta.
- La primera apertura de cada cuenta ejecuta una inicialización transaccional con bloqueo por cuenta y marca `initializedAt`. Se crean cinco Círculos y cinco copias independientes de cada propósito de esa cuenta: 20 carpetas y 50 plantillas en total. Repetir no sobrescribe ediciones, renombres ni carpetas eliminadas. No envía ni publica nada.
- Cada guardado y acción de plantilla compara `revision`. Una publicación crea una instantánea y actualiza una referencia única. Editar el borrador no modifica la instantánea. Restaurar una versión crea contenido de borrador que requiere publicación explícita.
- Los envíos automáticos consultan la publicación de su remitente/propósito. Ante error de consulta o render vuelven al `.hbs` original. Nunca se reintenta con el respaldo después de llamar a SMTP. Los archivos originales no se han alterado y el build ahora los incluye en `dist`.
- Firmas por cuenta: sin firma, firma seleccionada o predeterminada por referencia. Cambiar la predeterminada afecta a futuros renders sin modificar el cuerpo. No se permiten referencias a firmas de otra cuenta.
- El editor propio solo se carga en `admin.html`. La navegación separa cuenta, círculo y biblioteca; la pantalla de círculos es únicamente de navegación. El lienzo WYSIWYG admite edición directa con caret y selección nativa para títulos, texto y etiquetas de botón; bloques y secciones de flujo; columnas; arrastre únicamente desde el asa; carga por drop; redimensionado de imágenes; controles contextuales; variables visibles; deshacer/rehacer y aviso de cambios pendientes. No usa coordenadas absolutas, autosave ni campañas.
- Las tarjetas de cuenta muestran directamente la dirección, conteos y estado SMTP; el adorno `@` se eliminó y las tarjetas sin icono usan una retícula compacta propia. Los círculos conservan su numeración visual.
- Antes de guardar una plantilla existente, el editor consulta objetivos mediante el `purpose` persistido. Si sólo existe el origen guarda normalmente; si hay coincidencias en otros círculos de la misma cuenta, muestra una selección simple con el círculo actual marcado. El guardado múltiple envía una sola petición con ID y revisión por objetivo.
- El backend vuelve a resolver origen y objetivos dentro de una transacción, exige `senderKey` y `purpose` idénticos, rechaza IDs inexistentes, archivados o revisiones obsoletas y actualiza sólo asunto, preheader, documento, configuración de firma y HTML/texto derivados. Nombres, carpetas e identidades de los objetivos no se copian; el nombre/carpeta del origen conserva el comportamiento del guardado normal. Una URL de imagen se reutiliza dentro del JSON y no genera otra subida.
- El guardado múltiple no crea `EmailTemplateVersion` ni modifica `EmailPublication`. Si cualquier `updateMany` pierde la comparación de revisión, la excepción revierte la transacción completa.
- `renderMail` transforma JSON en HTML completo con tablas, estilos críticos inline, preheader oculto, columnas adaptables, imágenes enlazadas y fondos de sección con color de respaldo. La confirmación, envío y entrega de pedidos usan bloques transaccionales dedicados (`orderItems`, `orderTotals`, `customerDetails`, `trackingDetails` y `statusDetails`) con datos realistas en el lienzo y las variables/condiciones reales al compilar. La vista previa y los envíos usan el mismo renderizador del servidor.
- Saneamiento en servidor con `sanitize-html` **2.17.7**, fijado localmente, sin CDN. Se usa la versión corregida: las anteriores probadas aparecían afectadas en `npm audit`. Referencia del mantenedor: https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html. Lista restringida de etiquetas, atributos, estilos y protocolos; sin scripts, eventos, formularios, SVG, iframes ni URLs JavaScript. Se vuelve a sanear tras expandir datos. El backend requiere **Node >=22.12.0**; Jest transforma únicamente las dependencias ESM del parser para su entorno CJS. Entorno local comprobado: Node 22.21.0.
- La preview usa `sandbox=""` y CSP restrictiva dentro del iframe. No se inserta HTML de correo directamente en el DOM administrador. No se ejecuta JS ni se permiten formularios en la preview.
- Todos los propósitos first-party del catálogo tienen una factoría estructurada determinista. Un registro anterior cuyo borrador contiene únicamente HTML se adapta al leerlo, de forma idempotente, y conserva el documento original en `legacySource`; no hay conversión manual en la interfaz. Esta lectura no escribe en Prisma. El documento estructurado sólo se persiste al guardar explícitamente el borrador y las instantáneas ya publicadas no se leen ni se reescriben por esta adaptación.
- Las imágenes de correo usan `SUPABASE_EMAIL_STORAGE_BUCKET` cuando está definido y, en caso contrario, reutilizan `SUPABASE_GALLERY_STORAGE_BUCKET`. Los fallos de Supabase se registran por estado, bucket y cuenta sin incluir credenciales ni cuerpos sensibles.
- Pruebas de envío: destinatario escrito y confirmado, cuenta disponible, tres solicitudes por minuto por endpoint y por administrador, auditoría sin destinatario ni contenido. Se comunica aceptación SMTP, no entrega garantizada al buzón. Los tests automatizados usan transportes simulados.
- Payload JSON limitado a 256 KB en esta ruta (el resto conserva 100 KB); documento máximo 200 KB, 100 bloques y profundidad limitada. No se realiza ninguna descarga del lado servidor de URLs incluidas en plantillas.

## Imágenes y vídeo

Biblioteca persistente en `SUPABASE_EMAIL_STORAGE_BUCKET`; si no se define, reutiliza `SUPABASE_GALLERY_STORAGE_BUCKET` y finalmente el bucket público `gallery`. La ruta es `{senderKey}/images/...uuid...`. Se reutilizan los validadores de firma binaria y dimensiones de SupabaseStorageService: JPEG, PNG y WebP, máximo 5 MB, 4096 × 4096. No se habilita GIF sin soporte previo seguro. Se almacenan URL HTTPS estable, ruta, nombre, alt, dimensiones, tipo, tamaño y autor.

El nombre del archivo no decide la ruta. Quitar una imagen de un bloque no borra el recurso. «Ver usos» consulta borradores, firmas y versiones. No se ofrece eliminación permanente de activos desde este editor; su gestión queda deliberadamente conservadora para no romper correos históricos. Un fallo de persistencia tras subir un objeto puede dejar un objeto huérfano en el bucket; no se borra automáticamente.

Vídeo: imagen de portada enlazada al vídeo externo, texto/indicador de reproducción y alt. No hay reproducción embebida, autoplay, JavaScript ni dependencia del soporte HTML5 del cliente.

## Despliegue

1. Usar Node >=22.12 y ejecutar `npm ci` en `cronox-backend`.
2. Mantener las migraciones con `npx prisma migrate deploy`. No ejecutar `db push` ni modificar migraciones previas. La base configurada ya informa que sus 31 migraciones están aplicadas.
3. Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y, sólo si se quiere separar los activos, `SUPABASE_EMAIL_STORAGE_BUCKET`. No exponer la clave de servicio al navegador. El fallback `gallery` se comprobó con una subida PNG pública temporal y su limpieza posterior.
4. Para cuentas aún no inicializadas, ejecutar `npm run email:import` o abrir cada cuenta como SUPER_ADMIN. El importador autónomo no inicia la aplicación ni envía correos y repetirlo es seguro. La adaptación de borradores HTML first-party existentes no requiere ejecutar este importador ni ningún script: ocurre al leer y sólo se persiste al guardar.
5. Ejecutar `npm run build` en backend y `npm run admin:build` en la raíz; desplegar backend y assets conjuntamente.
6. Configurar/habilitar SMTP en servidor si procede. Entrar en la biblioteca, revisar desktop/móvil y enviar una prueba **solo** a un destinatario confirmado por el administrador. Publicar únicamente tras revisar el resultado. Ninguna plantilla importada está activa por defecto.

No se publicó ninguna plantilla ni se envió ningún correo real durante esta adaptación.

El navegador del producto no tenía ninguna sesión disponible (`[]`), por lo que siguen pendientes la comprobación visual autenticada, el arrastre táctil en dispositivo y la compatibilidad real Gmail/Outlook. Las pruebas DOM/CSS no sustituyen esa verificación.

## Archivos principales

Backend: `src/email/managed/*`, `email.service.ts`, `email.types.ts`, `email.config.ts`, `email.module.ts`, `common/storage/supabase-storage.service.ts`, CSP, límite JSON específico en `main.ts`, esquema/migración Prisma, `nest-cli.json`, dependencias y configuración Jest.

Frontend: `admin.html`, `assets/admin.js`, `assets/admin-mails.js`, `assets/admin-mails.css`, `src/admin/api.ts`, tipos y bundle `assets/api.js`; para detalles, `producto.html` y `assets/product-page.js`.

Las modificaciones locales anteriores de inventario, tarjetas, stock, favoritos y quick-add se preservan. No se han cambiado reglas de stock, cobros, descuentos ni pedidos.

## Verificación ejecutada (10 de septiembre de 2026)

- Suite Jest completa final: **80 suites aprobadas, 712 pruebas aprobadas, 0 snapshots**, 18,390 s. Incluye las plantillas reales de confirmación, envío y entrega, los diez propósitos estructurados, renderer, ciclo de publicación, guardado multi-círculo y DOM del administrador. Los errores y avisos que aparecen durante la suite corresponden a fallos simulados; no se usan envíos reales.
- `npm run build` en backend: **correcto**, incluida la fase `prisma generate` (Prisma Client 6.19.3) y NestJS. Para liberar la DLL de Windows se detuvieron exclusivamente los procesos Nest locales identificados, no los procesos Node de otras aplicaciones.
- `npm run admin:build`: **correcto**; TypeScript `npx tsc -p tsconfig.admin.json --noEmit`: **correcto**; `node --check` de `admin-mails.js` y `product-page.js`: **correcto**.
- ESLint de `src/email/managed`, servicio/tipos/configuración/módulo de correo, almacenamiento y sus tests, CSP y los dos nuevos tests frontend: **correcto, sin avisos**. La comprobación ampliada que incluyó `main.ts` y `email.service.spec.ts` devuelve **19 errores y 3 avisos**: los errores están en código previo de `main.ts` (tipos `any` de los middleware); un aviso está en el mock previo de `email.service.spec.ts` y otros dos en `main.ts`. La única modificación de esta tarea en `main.ts` es la línea de límite JSON de la nueva ruta. No se presenta el lint global como aprobado.
- `npx prisma validate`: **correcto**. `npx prisma migrate status`: **31 migraciones encontradas y esquema actualizado**.
- `git diff --check`: **correcto**; Git avisa de conversión LF/CRLF del entorno Windows, sin errores de espacios.
- `npm audit`: **16 vulnerabilidades reportadas (3 moderadas, 13 altas)** en el árbol de dependencias. No se realizó un `audit fix` global ni se afirma que el proyecto esté libre de vulnerabilidades.
- El fallo de auditoría posterior a una aceptación SMTP no convierte el envío en un error ni lo reintenta: el intento ya está registrado y el fallo posterior produce un aviso sin datos sensibles. Comprobado con transporte y base simulados.
- Servidor local Nest reiniciado en modo watch al terminar. Comprobación HTTP sin autenticación: `/admin.html` devuelve **200**; `/api/admin/mail-templates` y `/api/admin/mail-templates/catalog` devuelven **401**. Esto comprueba disponibilidad y rechazo anónimo, no sustituye una prueba visual ni una sesión SUPER_ADMIN real.

Pendientes: despliegue de estos cambios, disponibilidad SMTP, revisión autenticada en navegador, interacción táctil y comprobación Gmail/Outlook. No se ha hecho ningún commit ni despliegue.
