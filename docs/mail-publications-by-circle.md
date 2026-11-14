# Publicación independiente por círculo

La causa era la única fila activa por (senderKey, purpose). Excepto Confirmación de pedido, publicar otro círculo sustituía versionId y dejaba sin puntero activo la versión anterior. Las versiones históricas y las tarjetas se conservaban.

## Corrección

- Se generaliza la clave ya usada por pedidos: FINALIDAD:CIRCLE_1 … FINALIDAD:CIRCLE_5 dentro de cada buzón. El catálogo y el transporte conservan la finalidad base.

- Publicar crea una versión inmutable con publicationCircle. Republicar o retirar solo afecta a la tarjeta/círculo correspondiente. Guardar el borrador no modifica publicaciones. Las clasificaciones visuales y los vínculos entre tarjetas no participan en la selección.

- No requiere cambios de esquema ni reactivaciones de datos. Las claves globales antiguas siguen siendo compatibles solo en su círculo demostrable: metadata inmutable o ID de carpeta canónica guardado en el snapshot. No se consulta la carpeta actual del borrador para inferir la publicación histórica. Sin prueba suficiente se usa el respaldo y se deja el registro intacto.

- Al publicar de nuevo un círculo se retira únicamente su antiguo puntero global, si está identificado con certeza, y se escribe el puntero por círculo. Nunca se recuperan automáticamente versiones desplazadas ni se borran versiones.

## Envío y colas

EmailService resuelve centralmente el círculo válido facilitado por el flujo o consulta el usuario por el email destinatario. Las notificaciones de contraseña, newsletter, soporte, logística y pedidos que pasan por send comparten esa resolución; reposición utiliza el mismo procedimiento. Los invitados sin círculo utilizan el respaldo de su finalidad. El mapper de pedido ya no convierte la ausencia de usuario en un miembro del círculo I.

Se conservan las validaciones de variables y enlaces obligatorios. La compatibilidad con Configuración inicial de contraseña también queda limitada al círculo propio.

Newsletter y reposición resuelven el círculo cuando procesan sus trabajos. La cola diferida de transporte ya congela el MIME cifrado; se ha probado que una republicación posterior no cambia el correo encolado ni su círculo. Las campañas de Información y novedades usan su mecanismo separado de versiones por círculo y destinatario, con contenido congelado; no consultan la clave global de EmailPublication y se conservan. Los correos de cambio de email mantienen su diseño de seguridad de reserva, fuera del catálogo editable.

La consulta de metadatos de producción no encontró mensajes en WAITING_QUOTA ni QUEUE_PROCESSING. No se han leído ni modificado cuerpos de mensajes productivos. Los MIME creados antes del arreglo no se reescriben ni reenvían automáticamente.

## Comprobaciones locales

El reproductor anterior publicaba las cinco tarjetas reales de Soporte y obtenía solo una activa. La prueba se revirtió. Con el arreglo, test-mail-circle-publications-db.cjs usa las tarjetas existentes en una transacción que se revierte por completo:

- Cinco publicaciones simultáneas; republicación de III y retirada de II sin cambiar I, IV o V.

- Edición sin publicar en I: el envío continúa con la versión anterior.

- Se repite para Soporte con Para todo, Confirmación de pedido y todas las demás finalidades locales con cinco tarjetas: 16 casos en total.

- Quince mensajes automáticos capturados en memoria para Soporte y pedidos; II usa el respaldo y los demás su versión propia.

- Compatibilidad con la publicación global antigua en su propio círculo, retirada segura de su puntero al republicarlo y conservación de la versión histórica.

- Contadores de todas las cuentas y carpetas comparados con listados recargados después de las operaciones. Hashes de tarjetas, versiones y publicaciones y número de auditorías iguales antes y después de revertir.

- Pruebas de destinatarios resueltos por email, invitados, evidencia insuficiente, metadata contradictoria y cola MIME real con SMTP simulado.

El administrador local queda en http://localhost:3000/admin.html, Mails → Plantillas mails → buzón → Círculo → tarjeta. Las publicaciones de prueba no se dejan activas; se conserva el estado local previo para que la revisión decida qué publicar. Correos y workers locales permanecen desactivados.

## Versiones recuperables encontradas en producción

Consulta exclusivamente de lectura del 14 de noviembre de 2026. No se ha modificado producción. Estas tarjetas tienen una versión histórica de publicación y no tienen publicación activa ni retirada explícita posterior registrada. Esto es compatible con el desplazamiento por la clave global; la ausencia de auditoría no demuestra por sí sola la intención del administrador. Se ofrecen para revisión, nunca para activación automática.

| Buzón | Tarjeta | Círculo | ID conservado | Versión recuperable |
| --- | --- | --- | --- | --- |
| ORDERS | Incidencia en el envío | Círculo 1 | `cmveh5fkz0007l2javwog45ac` | `cmwgp7u4r0015l2dwrdxaspwe` |
| ORDERS | Incidencia en el envío | Círculo 2 | `cmveh5g16000nl2jat08wcjon` | `cmwgp8ucf0017l2dwvwo7g8rz` |
| ORDERS | Incidencia en el envío | Círculo 4 | `cmveh5gup001jl2jalq65djrv` | `cmwgp9c3v001bl2dwjey167di` |
| ORDERS | Incidencia en el envío | Círculo 5 | `cmveh5h9c001zl2jat9hf9kw8` | `cmwgp9lae001dl2dwfckap3bz` |
| SUPPORT | Ticket de soporte recibido | Círculo 2 | `cmttv0hqw003nf8ckp477fw9d` | `cmwgmmi5e000xl2dwe2lrv4d1` |
| SUPPORT | Ticket de soporte recibido | Círculo 3 | `cmttv0i36003rf8cklqqzwoqf` | `cmwgmmv7z000zl2dwj0q33ne5` |
| SUPPORT | Ticket de soporte recibido | Círculo 4 | `cmttv0ifo003vf8ckga81gm74` | `cmwgryo4y0001l2ig61lzti92` |
| SUPPORT | Ticket de soporte recibido | Círculo 5 | `cmttv0irz003zf8ckrvxjeusn` | `cmwgmw3bn0013l2dwzj3b93ws` |

En esa consulta seguían activas Soporte I e Incidencia III. Las cinco Confirmaciones de pedido seguían activas independientemente; la bienvenida aprobada seguía activa en No-reply I. No hay que republicarlas para conservarlas con el arreglo.

Cuando se apruebe y despliegue el código, puedes elegir individualmente las ocho tarjetas anteriores. Para recuperar exactamente el contenido histórico: abrir tarjeta → Opciones avanzadas → Versiones publicadas → Restaurar como borrador (la versión indicada) → revisar → Publicar. Si prefieres el borrador actual, revisarlo y publicar directamente. Publica cada círculo por separado. El código conserva los IDs y no decide qué versiones reactivar.
