# Entrega de Plantillas Mail y bienvenida — 19 de octubre de 2026

## Alcance y limitación aceptada

Incluye clasificación visual (verde Para todo, azul Única, morado Diferente), papelera con confirmación/borrado lógico/protección de dependencias, las cinco carpetas canónicas originales por buzón, diseño aprobado de bienvenida, renderizado y herramientas de comprobación, y reglas del código personal con contexto de compra invitada y primera compra posterior al correo. Se conservan todos los cambios locales de esta fase.

**El marco blanco de Gmail para iPhone sigue apareciendo en v7, confirmado por el titular. Queda pospuesto expresamente y no bloquea esta entrega.** `light only` sigue siendo una hipótesis causal. Se conserva exactamente el último diseño, textos, coma tras «iniciación», colores, imágenes, logos, enlaces y espaciados; no se envían nuevas pruebas ni se investiga el marco durante esta publicación. [Cronología y configuración aplicada](welcome-approved-local-2026-10-19.md).

## Borrador y publicaciones

El documento local en PostgreSQL no viaja con Git. Se amplía el importador existente con una operación explícita:

```sh
cd cronox-backend
node dist/email/managed/import-mail-templates.js --approved-welcome-draft
```

Se ejecuta solo después del despliegue y las migraciones, usando el entorno legítimo del servidor. No inicia Nest ni trabajadores. Resuelve la carpeta numérica original, sin crear carpetas; crea únicamente un borrador con identidad estable `NOREPLY:1:NEWSLETTER_WELCOME:approved-20261019` y auditoría transaccional. El bloqueo y la clave única impiden duplicados simultáneos. Si ya existe, conserva todos sus campos, incluso ediciones, archivo o publicación posteriores. Si encuentra una tarjeta manual con el mismo nombre, aborta sin sobrescribirla. No escribe versiones ni publicaciones, ni copia el diseño a otros círculos. La inicialización automática y los disparadores no llaman esta operación.

La bienvenida anterior queda intacta. El nuevo borrador usa NOREPLY, Círculo 1, azul Única, finalidad NEWSLETTER_WELCOME, asunto «CRONOX · Te damos la bienvenida» y Sin firma (pie incorporado). El HTML almacenado conserva variables; el código ficticio solo aparece en previsualizaciones/pruebas controladas, nunca sustituye un código personal en envíos a clientes.

Ruta productiva: `https://cronox.es/admin.html#section-mails` → **Plantillas Mail** → **No-reply** (`no-reply@cronox.es`) → **Círculo 1** → **Bienvenida · Diseño aprobado** → **Editar plantilla**. **Opciones avanzadas → Enviar prueba** es la función existente; no se usa en esta entrega.

## Migraciones y procedimiento

- `20261019090000_mail_template_visual_classification`
- `20261019100000_mail_template_private_metadata`
- `20261019110000_account_welcome_purchase_context`
- `20261019120000_mail_canonical_circle_folders`

Se conservan sin alterar sus checksums. El procedimiento es [Deploy CRONOX](autonomous-deployment.md): push a main verifica; workflow_dispatch con publish=true despliega una vez. El controlador realiza respaldo y restauración aislada verificada antes de migrate deploy. No hay resets ni sustitución por la base local. Se conserva la configuración operativa productiva; las pausas locales no se trasladan ni se habilita Correos.

Preflight productivo: SHA `5684a7d13201a2aa82c4683060d4d05450e8048c`, 99 migraciones completas y las cuatro anteriores pendientes, 20 carpetas originales exactas, cero publicaciones activas y bienvenida anterior conservada. Pages usa workflow. Los cambios de dependencias existentes en el VPS y `src/main.ts.cronox-before-stripe` son previos y no se descartan.

## Validación previa

- 270 suites y 2.902 pruebas correctas; typecheck y build de frontend/backend correctos.
- Pruebas del procedimiento de release, seguridad del checkout y referencias/recursos de acreditaciones correctas.
- Prueba PostgreSQL desechable del importador: carpeta original, concurrencia/idempotencia, conservación de edición/archivo/publicación, rechazo de colisión manual y ausencia de correo o registros de negocio. La base se elimina al terminar; no escribe en la base local de trabajo ni en producción.
- Ocho recursos HTTPS públicos comprobados con respuesta 200 y hash igual al manifiesto; el fondo utilizado sigue siendo el JPEG optimizado de 261.330 bytes.
- Documento local idéntico a `welcomeDocument()`, revisión 25 y cero publicaciones activas del diseño. Checksums de las cuatro migraciones locales verificados sin cambios.
- Revisión de archivos de entrega sin valores privados de entorno, MIME, volcados ni artefactos temporales. Evidencia operativa privada en `output/playwright/mail-release-20261019/`, fuera de Git.

Los resultados finales de CI, despliegue, migraciones e importación se añadirán tras verificar la entrega. No se han autorizado correos, usuarios, pedidos, promociones ni reencolados para esta publicación.
