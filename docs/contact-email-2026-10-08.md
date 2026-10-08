# Correo de contacto — 8 de octubre de 2026

El correo de contacto de las páginas informativas pasa a `support@cronox.es`. Se conservan el diseño, los elementos HTML y los demás buzones.

## Archivos modificados

- `cronox-front/develop.html`: texto y enlace `mailto:support@cronox.es`.
- `cronox-front/privacy-policy.html`: tres textos de contacto.
- `cronox-front/aviso-legal.html`: texto de contacto.
- `cronox-front/terms-of-service.html`: texto de contacto.
- `cronox-front/cookie-policy.html`: texto y enlace `mailto:support@cronox.es`.
- `cronox-backend/scripts/replace-obsolete-contact-email.sql`: procedimiento de reparación de contenido persistido, fuera de las migraciones.
- `cronox-backend/scripts/replace-obsolete-contact-email-local.cjs`: consulta, ejecución y verificación protegidas para PostgreSQL local.
- Este informe.

La búsqueda sin distinguir mayúsculas/minúsculas, incluyendo archivos ignorados de código, configuración, plantillas, semillas, pruebas y migraciones, encontró siete textos visibles y dos destinos de enlace en esos cinco HTML. Se excluyeron Git, dependencias, compilados y artefactos de pruebas. Tras sustituirlos, las únicas menciones al buzón obsoleto están en el selector de reparación y su muestra de prueba; no actúan como dirección de contacto. No se modificaron migraciones ni historial.

## Contenido editable

`assets/page-content.js` puede sustituir el HTML estático por `FooterPageContent.html`, consultado con `cache: no-store`. El editor `assets/admin-footer.js` usa ese contenido persistido o, si no existe, los mismos HTML ahora corregidos. `FooterSettings` no define un campo de correo; sus etiquetas públicas proceden de constantes y las redes sociales permanecen intactas.

La consulta a la base local protegida no encontró coincidencias en `FooterPageContent`, `FooterSettings` ni `ManagedEmailTemplate`. La reparación local se ejecutó dos veces: ambas actualizaron cero registros. No se consultó ni modificó producción en esta tarea.

## Procedimiento pendiente en producción

Antes de publicar esta corrección, un operador debe revisar y respaldar los registros editables de producción. Consultar las coincidencias con el mismo `WHERE` del SQL y ejecutar, si existen, `cronox-backend/scripts/replace-obsolete-contact-email.sql` mediante una conexión autorizada. Por ejemplo, con la conexión ya configurada en el entorno de PostgreSQL:

```sh
psql -X -v ON_ERROR_STOP=1 -f cronox-backend/scripts/replace-obsolete-contact-email.sql
```

El SQL reemplaza exclusivamente las coincidencias en `FooterPageContent.html`, tanto texto como atributos, sin cambiar usuarios, otros correos ni mensajes históricos. Incrementa la revisión y actualiza la fecha solo en registros afectados, conservando la atribución anterior. Así, un editor abierto con una revisión antigua debe recargar antes de guardar. Es transaccional e idempotente: una segunda ejecución no actualiza registros. Tras ejecutarlo, verificar que la consulta de coincidencias devuelve cero filas y revisar las páginas públicas y el editor. Si se importa contenido antiguo en local, volver a ejecutar la reparación local después de la importación.

El ejecutor local nunca acepta una conexión remota; reutiliza las restricciones de `start-local.cjs`:

```sh
cd cronox-backend
node scripts/replace-obsolete-contact-email-local.cjs
node scripts/replace-obsolete-contact-email-local.cjs --verify
node scripts/replace-obsolete-contact-email-local.cjs --apply
```

## Verificación

- Validación DOM de los cinco HTML: nueve referencias al nuevo correo y los dos enlaces existentes apuntan exactamente a `mailto:support@cronox.es`.
- Verificación del SQL real sobre una tabla temporal: sustituye texto y enlace con distinta capitalización, conserva `info@cronox.es`, incrementa la revisión una sola vez y no cambia nada al repetirlo. La prueba termina con rollback.
- 36 pruebas superadas en tres suites: servicio de Footer, DOM del Footer y páginas informativas/FAQ.
- `npm run admin:build` correcto.
- No se modificaron JavaScript ni CSS en esta tarea, por lo que no hay referencias de versión de recursos que actualizar. El HTML nuevo se entregará con la publicación futura; la consulta editable ya evita caché.

Cambios conservados en local, sin commit, push ni despliegue. Pendiente únicamente revisar y reparar, si corresponde, el contenido persistido de producción durante una actuación autorizada posterior.
