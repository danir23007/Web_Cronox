# Black Friday · Los números no son casualidad

Esta entrega añade contenido editable para Información (`info@cronox.es`). No modifica el transporte, los trabajadores, las automatizaciones ni los estilos globales. La campaña comercial se conserva en borrador; desplegar la web no publica ni envía el correo.

## Estructura y acceso

- Administrador → Mails → Plantillas Mail → Información → Familias de campañas → **Black Friday · Los números no son casualidad**. Incluye cinco versiones independientes, una en cada círculo, con contenido idéntico inicialmente.
- Correo → Información → Borradores y salida: un único borrador de campaña con los cinco círculos seleccionados, propiedad del SUPERADMIN existente. No contiene destinatarios individuales ni genera una audiencia congelada.
- La imagen posterior a la cabecera es un bloque nativo vacío; puede seleccionarse y completarse con las herramientas actuales del editor. No se sube ni se elige una fotografía.
- El logo oficial, la firma predeterminada de Información y el pie corporativo se componen con los mecanismos existentes. Se conservan contacto, redes y preferencias.

La portada real de Black Friday es `https://cronox.es/`: `assets/black-friday.js` integra el evento en `page-home` y carga `/api/black-friday`. Se comprobaron ambas rutas con HTTP 200; no hay una landing independiente ni un enlace a producto en esta entrega. No se cambia la configuración del evento.

## Guardado explícito en producción

Desde `cronox-backend`, después de compilar:

```powershell
node scripts/save-black-friday-drafts.cjs --production
node scripts/save-black-friday-drafts.cjs --production --apply
node scripts/save-black-friday-drafts.cjs --production
```

La primera y última operación son vistas previas de solo lectura de contenido. `--apply` es obligatorio para escribir. El script verifica el proyecto productivo configurado sin imprimir credenciales, fija el origen público y desactiva el correo únicamente en su propio proceso. No inicia Nest ni trabajadores y bloquea cualquier acceso a SMTP desde el servicio utilizado.

Se utilizan el guardado y vínculo de versiones del servicio existente, dentro de una única transacción RepeatableRead con bloqueo asesor. Las identidades estables son `campaign:INFO:BLACK_FRIDAY_NUMBERS_2026` y `campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026`. Repetir conserva los registros y cualquier edición manual posterior; no reescribe el contenido existente. No hay migraciones, hooks de arranque ni ejecución automática al desplegar.

La transacción compara huellas de plantillas ajenas, todas las versiones y publicaciones, otras familias y borradores, y pertenencia a círculos; cualquier diferencia aborta el guardado. El resultado informa los cinco IDs, estado del borrador y cantidades de versiones publicadas, campañas programadas y envíos. Para esta creación deben ser `DRAFT`, `0`, `0` y `0`, respectivamente. No se crean registros MailboxCampaign, MailboxCampaignDelivery ni MailboxSend.

## Verificación

Pruebas específicas: texto exacto, asunto, preheader, cabecera única con tamaños 19/46 px, orden de bloques, imagen vacía, destino del CTA, colores, nota de 12 px con margen, composición del pie, buzón Info, cinco vínculos, borrador compartido, vista previa sin escrituras y repetición sin sobrescrituras. Se revisó el HTML renderizado con Playwright a 1440 y 390 px. Las capturas y herramientas operativas permanecen fuera del commit.

El despliegue utiliza **Deploy CRONOX**, `workflow_dispatch` con `publish=true`, que publica el código de la web mediante el controlador habitual. Este parámetro del workflow no es la acción Publicar del editor de correo. La campaña no debe publicarse, programarse ni enviarse en este procedimiento; el usuario añadirá la foto y revisará el resultado manualmente.
