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

## Actualización: fotografía guardada y contador estático

La segunda petición parte de la lectura real de los cinco borradores productivos. La fotografía añadida por el administrador estaba guardada en el Círculo 2, revisión 6, activo `cmwwx34t70001l2adwp61142x`. Los otros cuatro estaban en revisión 3 con la imagen vacía. Se respalda el estado guardado y se actualizan los mismos cinco IDs, sin llamar a la factoría del documento inicial. Cada círculo conserva sus textos, asunto, preheader, enlaces, firma y ajustes, incluidos el ancho y los márgenes propios de su bloque de imagen.

El contador toma como referencia visual el componente real `.bf-clock` de la web: Arial, cifras blancas en negrita y cuatro etiquetas debajo. La composición PNG mantiene las dimensiones originales, **2172 × 724**, y toda la fotografía sin recortar ni redimensionar. El panel se centra en la zona inferior, separado del borde, sin tapar al modelo. Solo el relleno negro del panel tiene alfa de 0,72; cifras, separadores y etiquetas son blancos opacos. Los cuatro `00` son texto rasterizado literal: no hay fecha, JavaScript, animación ni cuenta atrás.

Se usa una imagen derivada porque la superposición CSS del navegador no ofrece la misma garantía en los clientes de correo. El PNG se almacena mediante `SupabaseStorageService.uploadEmailImage` y se registra como nuevo `EmailAsset` de INFO. El original permanece intacto en su ubicación y en la biblioteca. La auditoría enlaza el activo derivado con el original y sus hashes. Toda la imagen está dentro de un enlace nativo al destino actual del botón, verificado como `https://cronox.es/`; el texto alternativo indica que Black Friday ya ha comenzado. El resto del mensaje sigue siendo editable como bloques de correo.

Procedimiento explícito, desde `cronox-backend`, con un directorio privado nuevo para cada preparación:

```powershell
node scripts/update-black-friday-overlay.cjs --production --workdir ../output/black-friday-overlay/reviewed --prepare
node scripts/update-black-friday-overlay.cjs --production --workdir ../output/black-friday-overlay/reviewed
node scripts/update-black-friday-overlay.cjs --production --workdir ../output/black-friday-overlay/reviewed --apply
```

`--prepare` descarga únicamente la imagen ya guardada y crea respaldo, plan de revisiones/hashes y composición local; no escribe en producción. Debe inspeccionarse la composición antes de aplicar. `--apply` comprueba nuevamente las revisiones, registra el recurso persistente y guarda exclusivamente el `src`, enlace y texto alternativo del bloque de imagen de cada borrador mediante el servicio existente. Si alguien guarda otro cambio durante la preparación, la operación se detiene y exige preparar un nuevo plan. Una imagen diferente o una estructura ambigua tampoco se sustituye silenciosamente.

La identidad del activo deriva del hash de sus bytes; repetir reutiliza el mismo activo y deja las revisiones intactas. El guardado compara las huellas de plantillas ajenas, todas las versiones, publicaciones, familias y borradores de envío; cualquier diferencia revierte la transacción. Exige que la campaña esté sin publicar, programar ni enviar y nunca llama a las operaciones de publicación, cola o transporte. No se ejecuta al desplegar, migrar o reiniciar.

Verificación realizada: comparación exacta con el estado respaldado salvo el cambio de imagen autorizado; original con el mismo SHA-256; recurso derivado público con los mismos bytes revisados; **1.263.984 píxeles fuera del panel idénticos** al original; renderizado del servidor y compilación/lectura MIME en memoria para los cinco círculos, sin SMTP; revisión en Chromium a 1440, 390 y 320 px para ambos tamaños de imagen existentes, sin desbordamiento ni recorte. Se comprobó que repetir es un no-op y que siguen existiendo cero versiones publicadas, campañas programadas y envíos. Estas comprobaciones de renderizado y MIME no equivalen a recepción probada en Gmail, Outlook o Apple Mail: **no se ha enviado ningún correo de prueba ni se atribuyen pruebas en clientes reales**.
