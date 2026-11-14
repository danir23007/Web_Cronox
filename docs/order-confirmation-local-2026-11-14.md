# Confirmación de pedido: diseño aprobado y publicación

## Acceso

Administrador: http://localhost:3000/admin.html

Mails → Plantillas mails → Pedidos → Círculo 1, 2, 3, 4 o 5 → Confirmación de pedido → Editar plantilla. Dentro están Editar, Preview, Escritorio y Móvil.

Se han actualizado los cinco borradores existentes en la base local, conservando sus IDs, carpetas, clasificación, textos y particularidades. No se han creado tarjetas nuevas.

| Círculo | ID | Revisión local |
| --- | --- | --- |
| I | `cmttuz66n0007f8ckkev5upx7` | 4 |
| II | `cmttuz6xe000ff8ckdhqxn9w5` | 3 |
| III | `cmttuz7n0000nf8ck6wunowye` | 3 |
| IV | `cmttuz8cc000vf8cki0bs3sh8` | 3 |
| V | `cmttuz91v0013f8ck3dcdf9zb` | 3 |

## Cambios

- Cabecera con el arte exacto de `logo-topbar.webp`, recortando solamente el margen transparente: PNG de 522 × 135, sin deformar el logo. La luna queda alineada con el título y el cuerpo. Negro con fondo claro incorporado para clientes que fuerzan el oscurecimiento; blanco transparente para clientes con cambio de tema compatible. Solo una versión visible, ambas con texto alternativo CRONOX.
- Recursos HTTPS de la entrega: `https://cronox.es/assets/mail/order-confirmation/logo-light.png` y `logo-dark.png`. En local, exclusivamente dentro del iframe del administrador, se usan los archivos locales equivalentes; ni los borradores ni el renderizador de envío reciben enlaces locales.
- Impuestos (ya incluidos), en una sola etiqueta, importe a la derecha, peso normal y color suave con contraste AA. La fila y los valores conservan sus condiciones y cálculo.
- Dos botones en una fila compacta alineada con el texto. «o» independiente fuera de las áreas clicables. Los enlaces conservan sus destinos; los botones miden 46 px de alto también en móvil.
- Cinco anillos concéntricos detrás del contenido, con centro desplazado a la derecha a la altura del resumen, radios equidistantes y recorte lateral. De fuera hacia dentro: I, II, III, IV, V, con radios 268, 220, 172, 124 y 76. Solo el activo usa su color: I/II `#000000`, III `#7C7C7C`, IV `#FFFFFF`, V `#FFFFFF`. Los otros cuatro son neutros y tenues. El negro conserva su trazo puro en oscuro con un halo neutro suave; el blanco usa un apoyo neutro en claro para que siga distinguiéndose. El V sustituye al rojo anterior por instrucción final del titular: trazo de 2 px, opacidad 1 y centro RGBA (255,255,255,255) en ambos PNG. Los recursos de I–IV y los logos se mantienen idénticos byte a byte respecto a la revisión anterior.
- El fondo usa el atributo HTML `background` y CSS, con color base explícito. Si se bloquean las imágenes de fondo, desaparece la marca de agua y se conservan el contenido y los botones. No se depende de SVG, posición absoluta ni filtros para el cliente de correo.
- La preparación de elementos reconocidos conserva el documento de cada tarjeta; no sustituye sus personalizaciones por una plantilla genérica. El círculo se obtiene de la carpeta validada por el servidor. Al guardar expresamente en varios círculos, cada copia conserva su propio anillo incluso si la clasificación es «Para todo». Cambiar solo la clasificación sigue sin copiar contenido.

## Productos en Preview

La elección aleatoria se realiza exclusivamente en el endpoint autenticado de Preview. Se escoge un producto activo con imagen HTTPS pública y una variante activa con existencias; la cantidad de ejemplo no supera sus existencias. Nombre, imagen, talla y precio pertenecen al mismo producto. Se reutiliza `resolveWebPrice`, incluidas las ofertas vigentes, y se calculan subtotal, descuento, envío, IVA incluido y total coherentes en céntimos.

La selección queda en memoria del editor y se reutiliza al alternar tema, Escritorio/Móvil, Editar/Preview o cambiar el contenido. Sus IDs no se guardan en el documento. Los datos personales y destinos de acciones de Preview siguen siendo ficticios. Se excluye la prenda de prueba local cuya imagen apunta a un endpoint HTTP de revisión que ya no existe. Si desaparece una selección o falta catálogo utilizable, se muestra un aviso.

El envío automático no llama a este catálogo de ejemplos: conserva los artículos, imágenes, precios, cantidades e importes del pedido o evento real.

## Qué usa el envío automático

La consulta de solo lectura anterior del 14/11/2026 no encontró publicación activa para `ORDERS / ORDER_CONFIRMATION`. La revisión de este cambio se ha realizado exclusivamente en local. Al terminar sigue sin haber publicaciones de confirmación en la base local.

El mapper del envío incorpora el `circleLevel` de la cuenta asociada al pedido, leído cuando se prepara la confirmación. Para invitados sin cuenta se utiliza I. No se ha añadido una captura histórica del círculo al checkout: si una cuenta cambia de círculo antes de preparar un envío aplazado, se usa el círculo que tenga entonces.

La limitación global se ha resuelto solo para Confirmación de pedido, sin migración de esquema. Publicar desde una carpeta genera una versión inmutable vinculada a `ORDERS / ORDER_CONFIRMATION:CIRCLE_1` … `CIRCLE_5`. El envío consulta el círculo de sus datos reales y selecciona únicamente esa versión. Guardar posteriormente no cambia la versión activa. Una publicación global antigua solo es elegible para el círculo de su propio documento/carpeta; nunca se aplica a los cinco destinatarios.

Si no existe publicación compatible se conserva `order-confirmation.hbs`, preparado con el mismo logo, botones, impuestos y anillo del círculo del destinatario. Las demás finalidades mantienen su selección actual.

Después de aprobar y desplegar el código y los recursos HTTPS, abrir cada una de las cinco tarjetas, revisar y guardar su borrador y pulsar Publicar para activar sus personalizaciones. Cada publicación afecta únicamente a su círculo. El despliegue del código por sí solo actualiza la reserva usada donde no haya publicación. Antes de hacerlo hay que volver a consultar el estado real de producción; no se han subido estos recursos ni publicado plantillas ahora.

## Corrección del fondo de anillos

Los recursos anteriores ya contenían cinco círculos, pero los inactivos tenían diferencias de solo 1–4 niveles RGB respecto al fondo y apenas se distinguían. La causa era su opacidad/color en el PNG, no la pérdida de geometría por el recorte o la selección de plantilla. Se sustituyen los colores de los inactivos por un único neutro según tema y se aumenta su visibilidad. También se invierte la asignación de radios para que I sea exterior y V interior.

Se mantienen exactamente el lienzo de 640 × 1400, el centro (450, 700), el conjunto de radios y el renderizado `background-size:640px 1400px;background-position:70% center`. Las URL incorporan `?v=2` en I–IV y `?v=3` en V para invalidar su fondo rojo anterior. No cambian logos, botones, textos, productos, importes ni selección de plantilla por círculo.

Verificación de esta corrección:

- Los diez PNG (cinco círculos y dos temas) tienen cinco trazos distinguibles en el raster compuesto. Los inactivos pasan a diferencias de 13 niveles RGB en oscuro y 16 en claro. Se comprueban los cinco radios, el color exclusivo del activo y que su trazo destaca sobre los otros cuatro.
- 20 casos de Preview en el administrador real: cinco tarjetas × claro/oscuro × escritorio/móvil. Se cuenta el recurso cargado realmente por el navegador, con cinco trazos en todos los casos, el radio activo correcto, la misma posición/escala y sin variables pendientes ni desbordamiento. Capturas: `output/playwright/rings-v2-*.png`.
- Diez envíos simulados con transporte en memoria: cinco sobre los documentos existentes mediante versiones de prueba exclusivamente en memoria y cinco mediante la reserva automática. Se verifican el fondo claro/oscuro de cada destinatario y la conservación de sus datos de pedido. No se ejecuta Publicar ni se escriben versiones o publicaciones, ni siquiera temporalmente en la base.
- La inspección de base se ejecuta en una transacción de solo lectura. Los cinco IDs, carpetas, revisiones y documentos mantienen la misma huella SHA-256. La corrección aparece en las cinco tarjetas porque todas consumen el recurso del renderizador compartido, sin necesidad de guardar borradores.

## Comprobaciones y límites

- `git diff --check`, typecheck del backend, compilación Nest y `admin:typecheck`: correctos.
- 245 pruebas de correo y administrador en 23 suites: renderizado por bloques y HTML heredado, preparación idempotente, contenido personalizado, variables de todas las finalidades, publicaciones independientes, copia entre círculos sin propagar el énfasis, comprobación de los cinco trazos y centro blanco opaco del V en ambos PNG finales. Los doce recursos concretos se incorporan a la lista de imágenes aprobadas del comprobador del proyecto; otras imágenes siguen rechazándose.
- Base local y cinco tarjetas reales: publicación de prueba dentro de una transacción que termina siempre en rollback, mapper → EmailService → transporte en memoria. Se comprueban los cinco círculos, los importes y productos del pedido ficticio, los enlaces finales y una edición posterior que no altera la versión activa. Ninguna publicación de prueba queda persistida, ni se abre una conexión SMTP.
- Revisión funcional anterior: 40 casos en el administrador real, cinco círculos × claro/oscuro × escritorio/móvil × Editar/Preview. Una versión visible del logo con proporción correcta, número de pedido a la derecha, botones en fila de 46 px, impuestos alineados y ningún desbordamiento horizontal. Contraste de impuestos contra el color base: 5,35:1 en claro y 8,68:1 en oscuro. La corrección actual del fondo añade los 20 casos de Preview descritos arriba.
- Cambio pendiente introducido desde Editar, visto con datos resueltos en Preview y recuperado en Editar con su marcador original, sin guardar. Selección del producto estable entre renderizados. Bloqueo de imágenes de fondo simulado sin perder contenido ni enlaces.
- Los 15 borradores guardados con productos (Confirmación, Envío y Reposición, cinco círculos) pasan sin variables pendientes y conservan el producto elegido. 60 renderizados visuales adicionales en claro/oscuro y escritorio/móvil: todas las imágenes cargadas, sin desbordamientos. Capturas y resultados en `output/playwright/`, ignorados por Git.
- Pendiente de una autorización posterior: recepción real en Gmail móvil, Outlook, Apple Mail u otras apps. La emulación del navegador no reproduce todas las inversiones automáticas, bloqueo de imágenes ni tratamiento de CSS de esas aplicaciones.

## Activación autorizada

La revisión inicial se realizó sin publicar ni enviar correos. El titular aprobó después la entrega completa, el ajuste blanco del V, su integración en main, Deploy CRONOX con publish=true y la activación separada de las cinco tarjetas existentes.

La comparación de solo lectura previa al despliegue confirma que las cinco personalizaciones productivas, preparadas por el mismo editor, coinciden con los documentos aprobados locales. La activación conserva IDs y carpetas y ejecuta Guardar y Publicar por tarjeta mediante el servicio de la aplicación. Se verifican las cinco publicaciones y el flujo automático con un transporte exclusivamente en memoria, sin crear pedidos ni enviar correos reales. Las evidencias y los identificadores finales de versiones quedan en los registros privados de la entrega y se comunican en el cierre.
