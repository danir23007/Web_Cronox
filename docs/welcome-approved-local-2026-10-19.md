# Bienvenida aprobada y beneficio personal: revisión local

Esta revisión sustituye las indicaciones anteriores de carpeta romana y bienvenida sin código. Las secciones siguientes conservan la cronología de integración y pruebas autorizadas.

**Estado visual al cerrar la fase: el titular confirmó que la última prueba v7 sigue mostrando el marco blanco en Gmail para iPhone. Es un fallo conocido, confirmado y pospuesto para una corrección futura. No está resuelto ni pendiente de una primera comprobación visual. Se acepta la entrega con esta limitación, sin nuevas modificaciones de diseño ni envíos de investigación.**

La relación con `light only` sigue siendo una hipótesis, no una causa demostrada. Quedan aplicados el fondo optimizado, el marco único, las dos metas `light only` para conservar los colores y `page.canvas: 'body'` (html transparente y fondo gris propagado desde body, sin override de raíz ni paleta oscura alternativa). Los ensayos y sus resultados históricos se detallan abajo; ninguno acredita la eliminación del marco. La entrega de aplicación y el traslado seguro del borrador se documentan en [la entrega de esta fase](mail-release-2026-10-19.md).

## Abrir y revisar

`http://localhost:3000/admin.html#section-mails` → **No-reply** → **Círculo 1** → **Bienvenida · Diseño aprobado** → **Editar plantilla**.

Identidad conservada: `cmuh06mt00007l2xxtzbl2ri8`, importación `NOREPLY:1:NEWSLETTER_WELCOME`. Buzón NOREPLY (`no-reply@cronox.es`), finalidad NEWSLETTER_WELCOME, asunto **CRONOX · Te damos la bienvenida**, azul **Única**, **Sin firma** porque el pie forma parte del diseño. Es un borrador local, con cero publicaciones activas de este diseño y sin copias automáticas en otros círculos.

La vista previa tiene una única variante completa con `VISTA-PREVIA-NO-VALIDO`; no existe selector «sin código». Permite escritorio/móvil y editar HTML; guardar/cerrar/reabrir conserva documento y variables. En **Opciones avanzadas**, al final del editor, están **Ver texto plano**, la vista final y **Probar localmente**. Este perfil devuelve un render ficticio sin SMTP. Con envío configurado el botón se llama **Enviar prueba**: exige confirmación y código real disponible del destinatario, y bloquea destinatarios sin código. Nunca envía un sustituto ficticio.

## Cinco carpetas canónicas

| Buzón | Carpetas |
|---|---|
| NOREPLY / No-reply | Círculo 1, Círculo 2, Círculo 3, Círculo 4, Círculo 5 |
| ORDERS / Pedidos | Círculo 1, Círculo 2, Círculo 3, Círculo 4, Círculo 5 |
| SUPPORT / Soporte | Círculo 1, Círculo 2, Círculo 3, Círculo 4, Círculo 5 |
| INFO / Info | Círculo 1, Círculo 2, Círculo 3, Círculo 4, Círculo 5 |

La migración `20261019120000_mail_canonical_circle_folders` mueve referencias de plantillas, incluidas archivadas, desde alias a las identidades numéricas originales. Conserva contenido, revisiones, versiones, publicaciones y entidades independientes. Audita y elimina el alias tras resolver referencias. Si falta la identidad canónica, aborta: no inventa una sustituta. En local encontró el duplicado NOREPLY «Círculo I»; los demás buzones ya tenían las cinco carpetas correctas.

El resolver compartido reconoce números, I–V, acentos, mayúsculas y espacios. Inicialización, importación, guardado de carpetas e integración reutilizan la misma identidad bajo bloqueo por buzón. Solo el inicializador legítimo crea canónicas ausentes. El servicio no renombra ni elimina círculos canónicos. Un CHECK de PostgreSQL rechaza nombres equivalentes no canónicos; la unicidad existente protege inserciones concurrentes.

## Beneficio y evento de envío

La migración aditiva `20261019110000_account_welcome_purchase_context` añade `AccountWelcomeBenefit`, privada con RLS y sin acceso PUBLIC/anon/authenticated. Vincula de forma única cuenta, email, promoción y trabajo. Solo las nuevas altas que generan su bienvenida reciben este contexto. No hay reparto retroactivo, regeneración de códigos, reactivación de consumidos ni reenvío histórico. Las migraciones anteriores, incluida `20261019100000_mail_template_private_metadata`, no se modifican.

En una compra invitada, el flujo de pago autoritativo pasa la identidad del checkout al crear la cuenta. La misma transacción persiste su pedido de origen A. A no lleva descuento retroactivo ni consume el beneficio.

Tras aceptar el transporte el envío, el worker persiste atómicamente SENT, fecha y `messageId` del proveedor, ligados al trabajo y código. **Es aceptación SMTP registrada; no acredita entrega al buzón, recepción física ni lectura.** Un resultado encolado o incierto no activa el beneficio ni permite reenvío automático por suposición.

Checkout verifica ese evento y la disponibilidad de la primera compra online posterior. Excluye el pedido de origen explícito y los pagos anteriores al evento en este contexto prospectivo. Registra la primera compra online posterior incluso sin código: otra compra arbitraria no puede aprovecharlo después. Los códigos históricos sin contexto conservan la regla anterior; no se infiere su origen por antigüedad o recuentos.

Reserva, finalización y aceptación de envío se coordinan con el mismo bloqueo por email. Hay validación fresca al reservar, una reserva activa por código y consumo atómico al pagar. Se mantienen propietario, política de identificación existente, contador, canje único y consumo legacy. No se exige newsletter para las altas que ya tenían bienvenida independiente. Las compras manuales no bloquean el beneficio online. Pendientes, fallidos y abandonados no consumen; cancelar/expirar libera reserva. Webhooks repetidos no duplican pedidos/canjes y los reembolsos no reactivan consumos.

Si falta el código o propietario/consumo son incoherentes, no se envía: el trabajo queda FAILED con `WELCOME_PERSONAL_CODE_UNAVAILABLE`, sin reintentos ilimitados. Fallos seguros de transporte mantienen reintentos acotados; resultado incierto queda UNCERTAIN. Renderizar un envío sin código también falla antes de SMTP. No hay respaldo sin el bloque del 10 %.

La auditoría local encontró cero trabajos pendientes y cero registros de entrega: no había trabajos que reparar o reencolar. No se ha reparado en bloque ningún dato histórico.

## Diseño y recursos

Se conservan los seis PNG originales de `cronox-front/assets/mail/welcome/`, con URLs HTTPS públicas estables, hashes y dimensiones en `manifest.json`. No se regeneran ni se vuelven a subir. Continúan el fondo único, cortinas, proporciones, textos y espacios. El constructor de recursos elimina la condición sin código para no reintroducirla al ejecutarse.

El formato `html-email` versión 3 mantiene el sanitizador y la validación de expresiones. `message` obligatorio solo dice «Aquí empieza tu recorrido dentro de los círculos de CRONOX.»; «Tu cuenta está lista.» aparece una vez. El 10 %, código y condiciones son siempre visibles en un envío válido. Los tres códigos de ejemplo prohibidos se bloquean antes de enviar. Los datos continúan escapados y los códigos largos envuelven sin desbordar.

Logo y botón: `https://cronox.es/`. Instagram y texto `cronox.es`: `https://www.instagram.com/cronox.es/`. Soporte: `mailto:support@cronox.es`. El texto plano conserva código, condiciones, textos alternativos y destinos. Iframe aislado, CSS responsive fijo, fondo compartido y adaptación segura se mantienen.

## Verificaciones

```powershell
npm run test:welcome-business:db --prefix cronox-backend
npm run test:account-welcome:db --prefix cronox-backend
npm run test:welcome-design:db --prefix cronox-backend
npm run test:mail-template-cards:db --prefix cronox-backend
npm test --prefix cronox-backend -- --runInBand
npm run admin:typecheck
npm run build:compiled --prefix cronox-backend
node cronox-backend/scripts/integrate-welcome-draft-local.cjs
```

Los runners usan PostgreSQL real desechable en loopback y transporte en memoria/prohibido. La prueba de negocio utiliza carrito, precios, checkout, reserva y finalización reales: **A invitado → cuenta/código → aceptación simulada persistida → B de 100 € con 10 € de descuento y total 90 € → siguiente uso rechazado**. B sigue la política de compra invitada existente, sin autenticar artificialmente el navegador de A. Se prueban reservas y finalizaciones concurrentes, reintentos, cancelación, expiración, fallo, compra sin código que agota la oportunidad y ausencia de código bloqueada.

La migración de carpetas se prueba con alias reales y conserva identidad/metadatos. Inicializar, importar y resolver concurrentemente no crea equivalentes. La integración local serializa procesos y compara documentos sin depender del orden de claves JSON. Los otros runners conservan las regresiones de histórico, publicaciones, colores y papelera.

Verificados guardar/cerrar/reabrir en el panel real, texto plano, escritorio 600 px/móvil 390 px, editor 1440/390 px, códigos largos/escapados, imágenes bloqueadas, proporciones y fondo único sin desbordamiento. Es revisión de render en Chromium, **no prueba de recepción en Gmail, Outlook ni Apple Mail**.

Evidencia local: `test-results/welcome-business/database.json`, `test-results/account-welcome/results.json`, `test-results/welcome-approved/`, `test-results/mail-template-cards/` y `output/playwright/welcome-*.png`. Correo y trabajos desactivados; ningún correo/pago real, publicación o despliegue en producción.

## Prueba real autorizada posterior

El 19/10/2026 el titular autorizó expresamente una única prueba SMTP con código ficticio a `danir23.007@gmail.com`. Esta acción es posterior a la integración local descrita arriba; sus afirmaciones de cero envíos corresponden a aquella fase.

Se utilizó `ManagedMailService.test`, con una capacidad interna explícita de prueba controlada (no expuesta en el DTO HTTP), el borrador actual de revisión 10 y el transporte legítimo de `no-reply@cronox.es`. Asunto: `[PRUEBA] CRONOX · Te damos la bienvenida`; código visible: `VISTA-PREVIA-NO-VALIDO`. La capacidad exige proceso local aislado, SUPERADMIN existente, trabajadores desactivados, identidad/revisión del borrador y una clave de intento única persistida antes de SMTP. Se conservan cuotas, auditoría, TLS y transporte con plazo acotado. No modifica la regla de código personal de las bienvenidas de clientes.

Resultado: **un intento, SMTP_ACCEPTED, sin error**, con Message-ID `<3a81da03-d375-d365-7405-523235e2aa2b@cronox.es>`. Esto confirma aceptación SMTP, no recepción física ni lectura en Gmail. No hubo reintento. La clave persistida y el registro local impiden repetir el mismo intento, también si su resultado fuese incierto.

Se verificó por hash que usuarios, pedidos, promociones, códigos, beneficios, suscripciones, trabajos de bienvenida, plantillas, versiones y publicaciones permanecieron intactos. El servidor local siguió con correo/trabajos desactivados; solo el proceso aislado habilitó el transporte para esta operación y después terminó. No se cambió ningún archivo de credenciales ni se publicó en producción.

La prueba controlada se cubrió primero con PostgreSQL desechable y transporte simulado: concurrencia, repetición, resultado incierto, trabajadores activos y revisión incorrecta. Evidencia del envío real: `test-results/welcome-real-test/20261019-danir23-approved-welcome-once/result.json`, sin credenciales.

## Ajustes solicitados tras recibir la prueba

Se conservan el borrador NOREPLY → Círculo 1, su identidad y el azul Única. Instagram usa ahora una variante blanca del SVG original (solo cambia la pintura; mismo trazado), con PNG transparente y URL HTTPS estable. Los seis PNG originales permanecen intactos. El icono y `cronox.es` están en celdas con alineación vertical común; `cronox.es`, el separador y `support@cronox.es` tienen blanco explícito en escritorio y móvil.

El titular eligió copiar mediante pulsación larga. En esta fase se añadió una indicación de copia que el titular rechazó posteriormente: queda eliminada en la corrección descrita al final. El código continúa como texto seleccionable dentro de su recuadro, sin scripts, enlaces ni promesas de copia automática.

En móvil, una clase responsive cerrada ajusta únicamente la escala del fondo original a `560px 100%` por debajo de 480 px. Permite ver algo más de las cortinas y mantiene el fondo único, los textos, sus posiciones y los bloques. En escritorio se conserva `cover`. Se descartó una escala porcentual más abierta porque invadía la zona del texto en determinadas anchuras.

Verificación en Chromium: 318, 320, 360, 375, 390, 414, 430, 480 y 600 px, sin desbordamiento; icono/texto alineados (diferencia de centros 0 px); enlaces de contacto blancos; zona de texto sobre el centro gris. También se revisaron códigos cortos, de vista previa y largos. Pasan 38 pruebas focalizadas y el runner PostgreSQL de guardar/reabrir. La integración repetida conserva las otras 84 plantillas, las carpetas y las publicaciones. No se ha enviado una segunda prueba ni publicado en producción; el único intento SMTP existente sigue siendo el autorizado anteriormente.

## Segunda prueba autorizada del borrador actualizado

El 19/10/2026 el titular solicitó expresamente otra prueba al mismo destinatario. Se envió una única prueba nueva de la revisión 15 a `danir23.007@gmail.com`, desde `no-reply@cronox.es`, con asunto `[PRUEBA] CRONOX · Te damos la bienvenida` y código ficticio `VISTA-PREVIA-NO-VALIDO`. Incluye los contactos blancos, el icono alineado, la indicación de pulsación larga y el ajuste móvil de cortinas.

Resultado: un intento nuevo **SMTP_ACCEPTED**, sin error ni reintentos; Message-ID `<79e14133-3975-3c10-3d64-965a025e05f4@cronox.es>`. Los datos de negocio y el borrador permanecieron intactos y los trabajadores siguieron pausados. No se publicó en producción. Evidencia: `test-results/welcome-real-test/20261019-danir23-welcome-mobile-white-v2/result.json`. La aceptación SMTP no acredita recepción en la bandeja de entrada.

## Corrección de colores y alineación tras la captura de Gmail móvil

La captura recibida muestra inversión de colores en el cliente móvil pese a los colores explícitos del HTML. La revisión anterior en Chromium no reproducía esa transformación y no acreditaba el resultado de Gmail. Se elimina la frase «Mantén pulsado el código para copiarlo.» del HTML aprobado, del generador, del respaldo y del texto plano; se recuperan los 29 px originales entre código y condiciones. El recuadro mantiene texto seleccionable.

El documento incorpora una preferencia cerrada `page.colorScheme: "light-only"`. El renderizador genera en su cabecera real `color-scheme: light only`, la metainformación equivalente y la propiedad en raíz/cuerpo. No se permite importar cabeceras ni CSS arbitrarios; el sanitizador y la validación de variables siguen activos. Correo conserva únicamente esa preferencia reconocida al reconstruir una cabecera con CSS fijo. Los documentos sin la preferencia conservan su comportamiento. [WebKit documenta el uso de light only para evitar la transformación de correos claros](https://webkit.org/blog/8840/dark-mode-support-in-webkit/). La [observación publicada por Email Markup Consortium sobre Gmail en septiembre de 2026](https://emailmarkup.org/en/blog/2026/gmail-app-dark-mode-update/) describe el mismo opt-out para cuentas Gmail/Workspace en aplicaciones actualizadas; el resultado depende del cliente y de su versión y no se ha verificado aún en el dispositivo del titular para este nuevo mensaje.

El texto principal sigue negro `#080808`; solo los contactos y su separador llevan blanco, con el icono blanco original ya preparado. El botón conserva su diseño aprobado. El pie usa una sola tabla/fila con seis celdas y alineación vertical central común para ambos logos, icono, Instagram, separador y soporte. Los enlaces comparten tipografía, tamaño y altura de línea. El icono mide como la tipografía: 11 px escritorio / 9 px móvil. Se conservan las cortinas y su escala móvil anterior, sin nuevos recursos ni publicaciones.

Validación: compilación correcta, 40 pruebas en tres suites, seis grupos del runner PostgreSQL desechable y guardar/cerrar/reabrir mediante el panel real. Chromium en preferencias clara y oscura, 318–600 px: texto principal negro, contactos blancos, cero desbordamiento, diferencias de centros verticales y horizontal inferiores a 0,01 px. Se revisaron capturas con imágenes cargadas, código ficticio y texto plano. La comprobación del fondo mantiene todo el texto sobre el centro gris. Estas verificaciones **no simulan la inversión automática de Gmail** ni acreditan recepción/renderizado en clientes de correo.

Se preparó y revisó el HTML exacto de la revisión 17 antes del único envío nuevo autorizado a `danir23.007@gmail.com`. Remitente: `CRONOX <no-reply@cronox.es>`; asunto: `[PRUEBA] CRONOX · Te damos la bienvenida`; código ficticio: `VISTA-PREVIA-NO-VALIDO`. Resultado: **un intento, SMTP_ACCEPTED**, sin error ni reintento. Message-ID `<13e5ac26-42fe-31e1-5917-2e1b33c7fac9@cronox.es>`. Evidencia: `test-results/welcome-real-test/20261019-danir23-welcome-colors-v3/result.json` y `preview.html`/`preview.txt`. La aceptación SMTP no confirma la bandeja de entrada ni el aspecto en el móvil.

El envío pasó por la función existente de pruebas y el transporte legítimo en proceso aislado. Los trabajadores y las colas automáticas permanecieron desactivados. Se verificaron por hash los datos de negocio, plantillas y publicaciones, sin cambios durante el envío. No se crearon usuarios, pedidos o promociones, no se consumieron códigos reales, no se reencolaron bienvenidas y no se publicó en producción. La migración de metadatos privados y todos los cambios locales previos se conservan.

## Coma y ajuste del espacio exterior tras confirmar los colores

El titular confirmó que el contenido y los colores de la tercera prueba eran correctos en móvil y escritorio. Solicitó «Como privilegio de iniciación,» con coma y eliminar el marco blanco de la captura móvil. Se incorpora esa única modificación de texto al generador, HTML aprobado y respaldo, conservándola también en texto plano.

La fuente enviada no contiene un borde blanco ni relleno exterior explícito. La captura es coherente con el espacio de la aplicación que queda claro al activar el esquema claro; es una inferencia, no una inspección del DOM de Gmail. Hay [observaciones directas de márgenes y reescalado de Gmail móvil](https://github.com/hteumeuleu/email-bugs/issues/57) y de su [fondo de body blanco por defecto](https://github.com/JayOram/email-css-resets/issues/2). No se asume que un navegador reproduzca ese comportamiento.

Se refuerza únicamente la envoltura del documento HTML claro: margen y relleno cero con prioridad explícita, anchura al 100 %, fondo de página declarado en raíz, body y tablas, atributos `bgcolor` y `border="0"` en la envoltura. Una clase fija permite conservar el reset si el cliente transforma body. Correo conserva el fondo validado de la envoltura al reconstruirla y rechaza cualquier valor CSS introducido en lugar del color. No hay márgenes negativos, anchuras superiores a la pantalla, cambios de escala de contenido, reglas sobre la interfaz externa de Gmail ni relajación del sanitizador. El esquema claro, los colores y el fondo original de cortinas se conservan.

En la revisión local, el fondo ocupa x=0, y=0 y toda la anchura disponible de 318 a 600 px, en preferencias clara y oscura, sin desbordamiento. Se añadió como comprobación sintética un estilo de cliente con fondo blanco, margen y relleno de 16 px: el reset propio mantiene cero márgenes y relleno. Esto prueba la cascada CSS del documento, **no la eliminación del margen que la aplicación pueda imponer fuera del documento del mensaje**. No se promete control sobre ese espacio externo; la desaparición completa del marco de la captura sigue pendiente de una nueva recepción en el dispositivo.

Compilación, 40 pruebas focalizadas y seis grupos de PostgreSQL desechable correctos. Guardar/cerrar/reabrir en el panel conserva el documento. La comprobación de cortinas sigue sin detectar texto sobre zonas oscuras; la integración repetida preserva las 85 plantillas, 20 carpetas y ocho recursos y no cambia publicaciones. Evidencia local: `output/playwright/welcome-no-frame-393.png`, `welcome-no-frame-600.png` y `welcome-no-frame-review.js`. El borrador permanece en NOREPLY → Círculo 1 → Bienvenida · Diseño aprobado. No hubo nuevo envío SMTP en este ajuste: siguen existiendo únicamente los tres intentos autorizados anteriores, y continúan pausados los trabajos automáticos.

## Cuarta prueba autorizada: coma y espacio exterior

Tras solicitar expresamente el titular otra prueba al mismo correo, se preparó y comprobó el HTML exacto del borrador de revisión 19, con coma, reset exterior, esquema claro, enlaces aprobados y código ficticio `VISTA-PREVIA-NO-VALIDO`. Se envió un único mensaje mediante la función existente de pruebas y el transporte legítimo: de `CRONOX <no-reply@cronox.es>` a `danir23.007@gmail.com`, asunto `[PRUEBA] CRONOX · Te damos la bienvenida`.

Resultado persistido y consultado después en modo de solo lectura: **un intento, SMTP_ACCEPTED**, sin error ni reintento. Message-ID `<1c6f3da2-7eb6-f9d9-4b4d-a20b62164769@cronox.es>`. Evidencia: `test-results/welcome-real-test/20261019-danir23-welcome-no-frame-v4/result.json`, `preview.html` y `preview.txt`. Los datos de negocio, borrador y publicaciones permanecieron intactos; trabajadores y colas automáticas pausados. No hubo publicación ni despliegue en producción. Aceptación SMTP confirmada; recepción y desaparición del marco en Gmail móvil pendientes de comprobación en el dispositivo.

## Revisión del vídeo: carga incompleta y marco persistente

Se revisó el vídeo aportado `WhatsApp Video 2026-10-19 at 08.50.47.mp4` (35,57 s, 384 × 848), extrayendo fotogramas cada dos segundos. Es evidencia aportada por el titular, sin instrucciones adicionales tratadas como órdenes. Se observan dos hechos: las primeras pruebas invierten colores y no muestran el marco blanco; las siguientes conservan el contenido negro pero muestran el marco. Hacia los 28 s, el último mensaje aparece inicialmente sin el logo ni el fondo completos y posteriormente se completa. Esto acredita el síntoma en Gmail, sin demostrar por sí solo si la causa es descarga, redimensionado o un fallo de pintado de la aplicación.

El fondo PNG original pesaba 2.354.684 bytes. Se crea una copia JPEG de 261.330 bytes, manteniendo 1024 × 1536, encuadre y proporciones, calidad 92 y muestreo 4:4:4. No se regenera arte ni se modifica el PNG original. El error medio absoluto por canal respecto al original es 1,33 sobre 255. Se revisó visualmente y se comprueban hash, dimensiones y proximidad de píxeles en la verificación de recursos. La nueva copia tiene URL HTTPS pública estable, sin parámetros temporales, y está registrada separadamente en `manifest.derivatives`. La carga usa el servicio existente de validación/Storage, crea un objeto nuevo y no modifica los recursos usados por los mensajes ya recibidos. [Supabase recomienda objetos nuevos para evitar propagación de contenido antiguo en CDN](https://supabase.com/docs/guides/storage/uploads/standard-uploads).

Los cinco logos/imágenes en línea conservan sus PNG, tamaños y proporciones y ahora declaran ambas dimensiones HTML. Se mantiene `height:auto` responsive. La reserva de aspecto evita que el contenido cambie sustancialmente de altura al completar las descargas. En Chromium, con respuestas de imágenes retenidas y desplazamiento rápido arriba/abajo antes de liberarlas, la versión anterior cambia 106,23 px de altura frente a 0,80 px de la nueva. La geometría final de ambas versiones coincide. Esta es una reproducción local de la carga tardía, no una simulación de la aplicación de Gmail ni prueba de que desaparezca todo corte de pintado.

Peso medido del HTML: 8.882 bytes; seis recursos de imagen únicos: 347.992 bytes en total frente a 2.441.346, reducción del 85,75 %. Son bytes de los objetos originales y no una promesa de latencia ni del tamaño que pueda servir el proxy de Gmail. No se han introducido fuentes remotas, scripts, adjuntos, imágenes de todo el correo ni otra automatización.

Para los márgenes se conserva el opt-out nativo de Gmail en la metainformación, que ya había resuelto los colores. Se retira la imposición redundante de esquema claro en raíz/cuerpo y se permite esquema claro/oscuro en raíz con un estilo oscuro específico solo para el lienzo exterior (`#111111`); el arte, sus fondos internos y todos los colores de texto siguen explícitos e idénticos. Se añaden atributos de margen cero y se mantienen anchura al 100 %, tablas sin borde y reset de márgenes. La combinación de opt-out de Gmail y esquema de raíz para estilos oscuros propios está [documentada de primera mano por Email Markup Consortium](https://emailmarkup.org/en/blog/2026/gmail-app-dark-mode-update/). El CSS no actúa sobre la interfaz externa de Gmail. **No se acredita que esta combinación elimine el marco impuesto por esa aplicación**: la prueba anterior mostró que el reset del documento por sí solo no bastaba, y este ajuste necesita nueva recepción para comprobarlo. No se recupera la inversión de colores para ocultar el marco.

Validación final: compilación correcta; 40 pruebas en tres suites; seis grupos de PostgreSQL desechable; guardar/cerrar/reabrir el borrador desde el panel. En Chromium, 318–600 px y preferencias clara/oscura, el contenido empieza en x=0/y=0, ocupa el ancho disponible sin desbordamiento, conserva texto principal negro, contactos blancos y el pie alineado. La comprobación del fondo comprimido mantiene los textos en la zona gris y las cortinas originales. Los ensayos de márgenes añadidos son sintéticos y no pruebas de Gmail. Evidencias: `output/playwright/welcome-video-contact-sheet.png`, `welcome-slow-images-review.js`, `welcome-optimized-after-fast-scroll.png`, `test-results/welcome-approved/performance.json` y los renders `welcome-*.png`.

La integración permanece como borrador NOREPLY → Círculo 1 → Bienvenida · Diseño aprobado, solo esa plantilla. Se conservan los otros 84 documentos y todos los cambios locales de clasificación/papelera y migraciones, incluida `20261019100000_mail_template_private_metadata`. No se enviaron nuevas pruebas en esta revisión; siguen existiendo los cuatro intentos autorizados anteriores. Trabajadores y colas automáticas desactivados, sin publicación ni despliegue en producción.

## Quinta prueba autorizada del borrador optimizado

El titular solicitó expresamente una nueva prueba al mismo destinatario. Se preparó y revisó el HTML exacto de la revisión 21: fondo JPEG optimizado en URL HTTPS pública estable, dimensiones de imágenes reservadas, coma y código ficticio `VISTA-PREVIA-NO-VALIDO`. Mediante la función existente de pruebas se envió un único mensaje de `CRONOX <no-reply@cronox.es>` a `danir23.007@gmail.com`, asunto `[PRUEBA] CRONOX · Te damos la bienvenida`.

Resultado persistido y consultado después en modo de solo lectura: **un intento, SMTP_ACCEPTED**, sin error ni reintentos. Message-ID `<53bb0359-1586-3ae0-d3db-f71a61430c9b@cronox.es>`. Evidencia: `test-results/welcome-real-test/20261019-danir23-welcome-optimized-v5/result.json`, `preview.html` y `preview.txt`. Los datos de negocio, el borrador y las publicaciones permanecieron intactos; trabajadores pausados y sin despliegue en producción. La aceptación SMTP no confirma el aspecto ni la recepción en Gmail; siguen pendientes de comprobar en el dispositivo la carga al deslizar y el marco exterior.

## Auditoría de presentación y sexta prueba final autorizada

La petición adjunta `dc0b57c8-6118-438e-9d99-fbf019fa310b/Pasted text.txt` autoriza arreglar toda la composición y exactamente una prueba final con asunto único. La revisión se hizo sobre el mismo borrador y sin publicar.

### Evidencia recuperada de Gmail y diagnóstico

Se verificó que el conector legítimo corresponde a `danir23.007@gmail.com` y se buscaron únicamente las pruebas enviadas por `no-reply@cronox.es`. Gmail devolvió cinco mensajes en el mismo hilo `1a152976b830e3f1`, todos con asunto `[PRUEBA] CRONOX · Te damos la bienvenida`. Las cabeceras de los cinco contienen Message-ID distintos, sin `In-Reply-To` ni `References`. Ningún cuerpo contiene `blockquote`, `type="cite"` o `gmail_quote`; hay un documento HTML y un body por mensaje. Se recuperaron además los MIME originales del primer y último mensaje para verificar los cuerpos decodificados, sin depender de una previsualización ni del texto transformado del conector.

El primer HTML original tiene 7.555 bytes UTF-8 y el quinto 8.882; ninguno está cerca del objetivo de 80 KB. No se observa un recorte por tamaño en esas fuentes. El plegado descrito es coherente con contenido repetido en el mismo hilo, no con marcado de respuesta añadido por CRONOX. El asunto repetido favorecía esa agrupación; [Google documenta el uso de asuntos distintos para separar mensajes automáticos](https://support.google.com/mail/answer/5900).

En las cinco fuentes no hay fondos exteriores blancos ni estructuras de cita. Todas tenían dos marcos de lectura de 600 px anidados: uno del renderer y otro del fragmento aprobado. Se compararon las cabeceras, fondos y envoltorios anteriores: el marco observado por el titular aparece tras el opt-out de esquema claro, pero esa correlación **no demuestra qué nodo o superficie de Gmail pinta el blanco o la línea fina**. No hay evidencia suficiente para atribuir esa línea a una cita ni al contenedor duplicado. No se tuvo acceso a una sesión de interfaz del Gmail del titular ni al DOM de su aplicación iPhone; el límite se documenta expresamente. Los documentos recuperados y el resumen están en `test-results/welcome-approved/received-sources.json`, `received-audit.json` y los dos `.base64` originales, todos artefactos locales ignorados.

### Cambios de composición y transporte

- El fragmento aprobado contiene ahora solo su tabla de fondo/contenido; la página y el único marco de lectura de 600 px pertenecen al renderer. La página es del 100 %, sin separación entre celdas ni bordes, márgenes o relleno exterior. Los espacios interiores aprobados se conservan.
- Las ocho superficies exteriores HTML/body/tabla/celda declaran el gris `#aaa9a6`. Se elimina la excepción que pintaba el lienzo exterior oscuro: el respaldo queda gris también en modo oscuro y con imágenes bloqueadas. El opt-out de Gmail que había corregido los colores se mantiene. No se modificó el sanitizador ni se añadieron anchuras superiores a la pantalla, márgenes negativos, zoom o recortes.
- Se elimina el preheader oculto vacío de los documentos importados. No se añade texto aleatorio, firma diferente ni caracteres invisibles para alterar la detección de repetidos.
- Se limita el HTML final de `NEWSLETTER_WELCOME` a menos de 80 × 1024 bytes UTF-8 después de compilar variables y envolver. Una prueba de regresión usa datos expandidos que exceden el límite y verifica el rechazo; otros correos no heredan esa restricción específica.
- El operador de pruebas acepta un identificador de asunto validado como capacidad interna, sin exponerlo en el DTO HTTP ni cambiar el asunto de producción. Se conservan revisión, SUPERADMIN, cuotas, clave única de intento, auditoría, plazo y pausa de trabajadores.
- La composición MIME se comparte entre el transporte y la inspección local en `src/email/mail-message.ts`, con accesos a archivos/URLs desactivados y el mismo límite de mensaje. Se inspeccionan y conservan pasivamente los bytes reales antes de SMTP, sin reescribirlos ni sustituir la ruta de entrega.
- Se detectó una discrepancia de auditoría: al entregar MIME precompilado, el envoltorio de Nodemailer devolvía un ID generado diferente del Message-ID que iba dentro del MIME. Los cinco mensajes recibidos tenían IDs únicos correctos, pero no coincidían con los IDs devueltos en las auditorías locales anteriores. El transporte ahora conserva el ID del MIME también para el resultado, incluidos mensajes diferidos. La nueva recepción confirma la igualdad entre los tres. No se reescribieron registros históricos ni se atribuyó a esto el plegado de Gmail. [Nodemailer distingue las opciones de mensaje y la entrada MIME raw](https://nodemailer.com/message).

### Verificación antes del único envío

Compilación correcta. 270 suites y 2.901 pruebas pasaron, incluidas otros tipos de correo, transporte compartido, mensajes diferidos, IDs únicos y ausencia de cabeceras de respuesta. El log contiene un `NativeCommandError` de PowerShell al redirigir el stderr de Jest (sus líneas PASS); el resumen de Jest contiene cero suites/pruebas fallidas. Los seis grupos PostgreSQL del diseño y ocho del negocio se completaron sin envíos/pagos reales. Se añadió comparación entre la bienvenida por `EmailService.sendNewsletterWelcome` y la resolución publicada real en la base desechable: HTML, texto y asunto idénticos a la salida del renderer gestionado. La falta de código se rechaza antes del transporte, queda registrada por el worker y conserva la regla del beneficio posterior al pedido invitado inicial.

En el panel se guardó, cerró y reabrió el borrador sin cambios de documento. Se ejecutaron 72 combinaciones con la salida que la inspección MIME verifica como idéntica: 320/375/390/430 px y escritorio 600/1200, claro/oscuro, imágenes cargadas/bloqueadas, código de muestra/normal/largo. Sin desbordamiento ni superficies exteriores blancas, con gris de respaldo, ocho niveles exteriores grises, un solo marco, enlaces aprobados, contraste y pie conservados. Las capturas `output/playwright/welcome-final-mime-*.png` son pruebas locales de Chromium, **no recepción visual de Gmail**. La integración repetida preservó los 85 documentos, 20 carpetas y nueve recursos; las cuatro migraciones conservan sus checksums y RLS. El borrador sigue azul Única en su carpeta original.

### Resultado de la sexta prueba

Se revisó primero `preview.eml` y luego se guardó `sent.eml`, el MIME exacto que recorrió la función existente de pruebas y el transporte legítimo. El HTML decodificado final pesa **8.667 bytes UTF-8** y el MIME saliente completo **10.653 bytes**. Contiene cero estructuras de cita, cero cabeceras de respuesta, un documento, un marco de lectura y ocho superficies exteriores grises. Se conserva el código ficticio `VISTA-PREVIA-NO-VALIDO` sin tocar promociones reales.

- Remitente: `CRONOX <no-reply@cronox.es>`.
- Destinatario: `danir23.007@gmail.com`.
- Asunto de prueba: `[PRUEBA 20261019-073004Z-v6] CRONOX · Te damos la bienvenida`.
- Revisión del borrador: 23. Asunto de producción: `CRONOX · Te damos la bienvenida`.
- Un intento: **SMTP_ACCEPTED**, sin error ni reintento. Message-ID real `<4c6eb478-c83f-c9bb-17cd-f10869bde8e3@cronox.es>`.

Después se verificó por la API legítima de Gmail que ese Message-ID está en **INBOX**, con un **hilo nuevo** `1a1531261d24af04`, distinto de las cinco pruebas anteriores. Se recuperó el MIME recibido y se comparó: Message-ID idéntico al enviado y auditado, asunto idéntico, HTML y texto sin cambios (normalizando únicamente los finales de línea), cero cabeceras de respuesta y 8.667 bytes de HTML. Esto **confirma recepción en Gmail y separación del hilo**, pero no acredita el aspecto del marco en iPhone ni si su interfaz vuelve a plegar alguna parte. No se modificaron preferencias del buzón.

Evidencia: `test-results/welcome-real-test/20261019-danir23-final-presentation-v6/`: `result.json`, `sent.eml`, `sent-mime.json`, `received.base64` y `gmail-receipt.json`. Ningún correo intermedio real se envió en esta revisión. Los datos de negocio, borrador y publicaciones permanecieron intactos durante el envío. Trabajadores y colas automáticas pausados, cero trabajos de bienvenida, seis entregas de prueba autorizadas acumuladas, cero publicaciones activas del diseño y ningún despliegue.

## Marco blanco en Gmail para iPhone: revisión posterior y prueba v7

**Estado final confirmado por el titular: v7 también sigue mostrando el marco blanco en Gmail para iPhone. La corrección queda pospuesta.** El titular ya había confirmado el mismo defecto en v6. Separar el hilo, eliminar la tabla duplicada y recuperar el lienzo de body no lo han resuelto. No se presenta Chromium ni la recepción por API como prueba de que haya desaparecido.

### Comparación de las dos fuentes realmente recibidas

Antes de editar se conservaron los 58 archivos locales modificados/no rastreados, el diff completo, los 85 registros de plantilla, las carpetas y las publicaciones en `test-results/welcome-canvas-v7/before/`, excluyendo credenciales. No se restauró el repositorio. Se decodificaron los MIME originales ya recuperados de Gmail, sin reenvíos:

| Propiedad | Primera prueba, 07:16 Madrid | v6, 09:31 Madrid |
| --- | --- | --- |
| Message-ID real | `636c5354-a901-3444-ffa0-57889c1b8b52@cronox.es` | `4c6eb478-c83f-c9bb-17cd-f10869bde8e3@cronox.es` |
| HTML UTF-8 | 7.555 bytes | 8.667 bytes |
| DOCTYPE / idioma | `<!doctype html>` / `es` | Igual |
| Metas de esquema de color | Ausentes | `color-scheme` y `supported-color-schemes`: `light only` |
| CSS de esquema | Ausente | `:root{color-scheme:light dark;}` |
| Fondo de html | Transparente, sin estilo | Gris explícito inline y en regla CSS |
| Estilo de body | `margin:0;background:#aaa9a6;color:#080808;` | Gris mediante `background-color`, resets y atributos adicionales |
| Exterior en las fuentes | Tabla 100 %, gris; dos marcos 600 px | Tabla 100 %, gris en tablas/celdas; un marco 600 px |

El cuerpo HTML de v6 recibido coincide con `sent.eml`. Ninguna de las dos fuentes contiene un exterior blanco, un borde blanco ni relleno exterior que explique las cuatro franjas. El ancho aparente similar descrito por el titular refuerza la hipótesis de una superficie que cambió de color, pero **no identifica el elemento exacto de Gmail**.

- A, tablas propias blancas: no se encontró esa causa en las fuentes recibidas.
- B, cambio del esquema del área del mensaje: principal hipótesis, porque coincide temporalmente con `light only` y la corrección de los colores interiores.
- C, envoltorio de Gmail: posible superficie visible; no se ha obtenido su DOM ni una captura de un cliente iPhone controlable en esta sesión.

El [informe de Email Markup Consortium](https://emailmarkup.org/en/blog/2026/gmail-app-dark-mode-update) documenta que `light only` desactiva la conversión automática de Gmail y que el override CSS de `:root` solo se necesita al ofrecer estilos oscuros propios. El diseño actual no ofrece una paleta oscura alternativa. [Nicole Merlin documenta que la opción afecta también al área del mensaje](https://www.linkedin.com/pulse/gmail-finally-adds-ability-opt-out-forced-dark-mode-nicole-merlin-klhme). Estas fuentes apoyan la hipótesis; no prueban por sí solas la causa del marco en el dispositivo del titular.

### Cambio acotado y alternativas descartadas

Se incorpora `page.canvas: 'body'` como opción cerrada y validada, activada únicamente en este documento aprobado. Recupera el `html` sin fondo propio y el estilo de fondo del body de la primera prueba; mantiene el gris de las tablas/celdas exteriores actuales y el único marco de lectura. Retira de este modo la regla que pintaba simultáneamente html/body y el override `:root{color-scheme:light dark;}`. No introduce anchuras mayores que el área disponible, recortes, transformaciones ni margen negativo. La [propagación del fondo de body al lienzo con html transparente está definida por CSS](https://www.w3.org/TR/css-backgrounds-3/#body-background); esto explica la diferencia estructural elegida, **no garantiza cómo Gmail la integra en su interfaz**.

Se conservan las dos metas `light only`: retirarlas sin una alternativa validada expondría de nuevo los textos y el botón a la inversión que el titular rechazó. No se afirma haber resuelto esa interacción simplemente manteniéndolas. La persistencia del marco en v7 está confirmada por el titular; es una limitación conocida pendiente, no una limitación declarada inevitable.

Los experimentos locales variaron por separado las metas, el shorthand del body, el fondo de html y el override de raíz. Sus salidas están aisladas en `test-results/welcome-canvas-v7/`; ninguno se envió ni quedó publicado. El navegador no reproduce la inversión de Gmail, por lo que no se usó para justificar retirar el opt-out. No se añadió degradado: no se observó inversión dentro de una superficie gris propia que demostrara la necesidad de ese parche. Tampoco se añadieron mezclas de color o texto transparente.

El fragmento interior guardado, el HTML dentro del body, el texto plano y el asunto de producción son idénticos a v6. Logos, recursos optimizados, cortinas, coma tras «iniciación», recuadro seleccionable, colores, pie y espaciados no se editaron. El cambio de documento es únicamente la propiedad de canvas. `effectiveMailHtml` conserva esta preferencia mediante una clase conocida y un color validado; sigue descartando CSS/head arbitrarios. El sanitizador no se amplió ni desactivó. Los documentos sin esta opción conservan el renderer anterior.

### Verificaciones de v7

- Compilación correcta, cuatro suites/65 pruebas correctas, seis grupos PostgreSQL correctos. Las pruebas cubren adaptación, persistencia, colores, límite de tamaño, código obligatorio, transporte y protección de reintentos.
- Comparación del renderer anterior y nuevo para los 85 documentos existentes sin activar la nueva opción: mismo resultado, con 80 renders idénticos y cinco rechazos de validación preexistentes idénticos.
- Guardar, cerrar y reabrir desde el panel real conserva el documento y la clasificación Única. El borrador queda en revisión 25, NOREPLY → Círculo 1 → Bienvenida · Diseño aprobado.
- 128 casos de diagnóstico local y 72 combinaciones de la salida final: 320/375/390/430 y 600/1200 px, claro/oscuro, imágenes disponibles/bloqueadas, códigos de muestra/normal/largo. Fondo gris sin desbordamiento, contactos blancos alineados y texto principal negro. La ausencia de código sigue bloqueada antes del transporte.
- Dieciséis comparaciones de capturas entre v6 y el nuevo envoltorio: quince idénticas píxel a píxel; la restante difiere como máximo un nivel RGB de 255, media 0,00251, sin cambio de geometría ni bytes de contenido. No es evidencia de Gmail para iPhone.
- Los otros 84 borradores, carpetas, publicaciones, recursos y cambios locales permanecen intactos. Las cuatro migraciones conservan sus checksums y RLS. El servidor local sigue con correo y trabajadores automáticos desactivados.

### Único envío autorizado en esta revisión

- Remitente: `CRONOX <no-reply@cronox.es>`.
- Destinatario: `danir23.007@gmail.com`.
- Asunto: `[PRUEBA 20261019-075746Z-v7] CRONOX · Te damos la bienvenida`.
- Código ficticio: `VISTA-PREVIA-NO-VALIDO`; ninguna promoción creada/consumida.
- Un intento a las **09:58:55 Madrid**, resultado **SMTP_ACCEPTED**, sin error ni reintento.
- Message-ID enviado, auditado y recibido: `<b93cfa04-63d7-8ab1-1d84-621d4162e218@cronox.es>`.
- HTML final **8.369 bytes**, MIME saliente **10.333 bytes**, cero citas/cabeceras de respuesta. Siete superficies explícitas grises y html transparente cuyo lienzo recibe el gris de body. SHA-256 HTML `c2f2ce9e902fe1df2850efdfc3cb1a45033404af10e0715530a0f9ae426aace9`.

Gmail confirma **INBOX** y un hilo nuevo `1a1532bd00bd351e`. El MIME recibido contiene exactamente el HTML/texto enviados, normalizando solo finales de línea. Esta comprobación no observa la presentación del cliente iPhone. Evidencia privada local: `test-results/welcome-real-test/20261019-danir23-canvas-v7/` (`sent.eml`, `sent-mime.json`, `result.json`, `received.base64`, `gmail-receipt.json`). Siete pruebas autorizadas acumuladas; exactamente una en esta revisión, cero bienvenidas reencoladas, cero trabajos automáticos, ninguna publicación ni despliegue.
