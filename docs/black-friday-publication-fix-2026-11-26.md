# Publicación manual y programación de Black Friday

## Estado productivo inicial, sin escrituras

Antes de cambiar código se revisaron todas las campañas SCHEDULED/PROCESSING: **cero**. La familia Black Friday mantiene un único borrador DRAFT, cinco círculos seleccionados y 100 destinatarios. Tiene cinco tarjetas de INFO con purpose=null, familia y carpeta/círculo coherentes; revisiones 5, 8, 5, 5 y 5. No hay versiones publicadas ni MailboxCampaign asociados. Ningún intento anterior dejó una programación persistida.

La huella de contenido/plantillas/versiones es `bb4999ebfe49c420eb940009a5adcd9be03de83813d592e156831c9c7cdb61a5`; la del borrador es `76ee4ac0f4820790c78da2fa214628cc0f39ecda277a67f93a3b089d65af9e0e`. Los respaldos privados de lectura y los resúmenes quedan fuera de Git y del frontend servido.

## Dos causas distintas

**Publicar.** El editor llama a `POST /api/admin/mail-templates/INFO/templates/:templateId/actions` con `{action:'publish', revision, confirmed:true}` después de un diálogo. El ID corresponde a la tarjeta guardada; el servidor crea el ID de la nueva versión. No faltaba confirmed. ManagedMailService.action rechazaba toda tarjeta sin t.purpose, con el mensaje «Confirma la activación de una plantilla válida de esta cuenta.». Esa condición solo contemplaba las finalidades automáticas. Las cinco tarjetas manuales tienen legítimamente purpose=null: no se les asigna GENERIC ni otra automatización.

**Guardar/programar.** El borrador existente utiliza `campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026`. Tanto SaveCampaignSelectionDto como SendCampaignSelectionDto exigían IsUUID para draftId. Se reprodujo su rechazo con el payload del borrador, antes de entrar en enqueue. MailboxErrorFilter convertía los errores de validación en el genérico MAILBOX_INVALID_INPUT. La programación de una campaña equivalente con UUID sí funcionó en PostgreSQL aislado con el código anterior: este bloqueo no procedía de la validación automática de publicación.

## Corrección

- Publicación manual separada: INFO, familia existente, identidad del círculo concordante con la carpeta, tarjeta no archivada, revisión vigente, confirmación explícita y contenido válido propio. El pie corporativo por sí solo no permite publicar una tarjeta vacía. Se mantienen los guardias de autorización existentes y las validaciones comunes del renderer. No se altera la publicación automática.
- Cada familia/círculo tiene una referencia independiente a EmailTemplateVersion. El espacio CAMPAIGN_FAMILY no coincide con las finalidades automáticas. Publicar o despublicar un círculo no cambia otros círculos, familias o históricos. La publicación no cambia document, asunto, preheader, HTML/texto, enlaces, firma ni ajustes de la tarjeta.
- La preparación de campaña exige las versiones publicadas válidas de todos los círculos seleccionados y utiliza sus snapshots, no una edición posterior del borrador. Valida plantilla, familia, senderKey, círculo y revisión del snapshot. Una versión ausente o incoherente produce un motivo concreto por círculo y bloquea la confirmación; no hay sustituciones. Se incorpora publicationVersionId al manifiesto y al contenido congelado para mantener la trazabilidad.
- draftId acepta identificadores persistentes acotados a 100 caracteres y a letras, números, guion, guion bajo y dos puntos. requestKey sigue siendo UUID. Siguen comprobándose buzón, permisos, propietario, revisión, estado DRAFT, audiencia/hash, horario e idempotencia. Un ID mal formado conserva el código específico MAILBOX_INVALID_DRAFT_ID, que el frontend traduce sin mostrar valores privados.
- El editor explica que la tarjeta pertenece a una campaña manual y no necesita finalidad automática. El diálogo pide publicar solo su círculo y aclara que no envía ni programa. Los errores de publicaciones faltantes se presentan por círculo. Se actualizan las versiones de caché de los dos módulos del panel.

No se necesitan migraciones ni modificaciones de datos productivos. El despliegue solo instala código; no publica tarjetas ni programa campañas.

## Comprobación aislada

`node scripts/test-manual-campaign-publication-db.cjs` crea y elimina una base PostgreSQL de loopback. Usa HTTP real con ValidationPipe y los guardias reales de rol/administración, con autenticación de identidad simulada únicamente dentro de la prueba. No inicia el AppModule, trabajadores ni proveedores; el transporte de correo lanza una excepción si se intenta utilizar.

Comprueba las cinco publicaciones y su independencia, conservación de contenido, otra familia intacta, confirmación rechazada/cancelada, permisos, buzón equivocado, archivo/círculo incorrectos, tarjeta vacía, revisión obsoleta, publicación incoherente y selección de snapshots publicados frente a ediciones no publicadas. Guarda/programa el ID estable mediante los endpoints reales, mantiene el control de propietario y crea una única campaña futura con 100 destinatarios incluso con solicitudes repetidas/concurrentes. El recuento y el Excel coinciden. Termina con cero MailboxSend, cero trabajos de newsletter y todas las entregas sin intentos; **no llama a SMTP**.

Las pruebas de DOM verifican el mensaje de uso manual, cancelación del diálogo sin petición y envío de confirmed=true al aceptar. Las pruebas unitarias cubren el contrato y los ámbitos de publicación. La suite completa, tipos, compilaciones y guardia de publicación se ejecutan antes del commit. El revisor histórico de buzones se adapta a tarjetas publicadas; su recorrido de SMTP loopback no se ejecuta en esta tarea.

Resultado local: **348 suites y 3.744 pruebas aprobadas**, tipos y compilaciones de frontend/backend correctos, cinco grupos de comprobaciones HTTP/PostgreSQL aprobados, sintaxis/diff y guardia de seguridad de publicación correctos. Las comprobaciones de publicación y programación son locales; en producción solo se consulta y se despliega código.

## Pasos del operador después del despliegue

1. Recargar el administrador para obtener los módulos nuevos.
2. Plantillas Mail → Información → familia «Black Friday · Los números no son casualidad». Abrir cada uno de los cinco círculos. Si hubiera cambios propios pendientes, guardarlos; después pulsar Publicar y aceptar el diálogo de ese círculo. No asignar una finalidad automática.
3. Volver al borrador existente desde Borradores y salida, o abrirlo en Nueva campaña, y recargar su revisión. Mantener los cinco círculos, revisar destinatarios y las cinco vistas publicadas. Si falta una publicación, el panel indicará su círculo.
4. Elegir fecha/hora futura en Europe/Madrid, pulsar Programar envío y revisar/aceptar la confirmación. Una revalidación por cambios de audiencia o versión exige revisar de nuevo; no debe crearse otra campaña para superar el aviso.

La verificación posterior de producción es de solo lectura: SHA instalado, salud pública, módulos publicados, relaciones y huellas intactas, cero publicaciones/campañas nuevas. El propietario realizará los pasos de publicar y programar; Codex no los ejecuta en producción.
