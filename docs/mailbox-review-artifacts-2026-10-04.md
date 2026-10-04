# CRONOX: revisión de auxiliares de correo

Se revisaron los ocho archivos nuevos de `output/mailbox-review`, las instrucciones disponibles, `.gitignore` y el workflow de publicación. Los diagnósticos reutilizables se conservan como código bajo `cronox-backend/scripts`. Los auxiliares de una sola intervención se conservan en disco y se ignoran por nombre; no se elimina ninguno ni se oculta toda la carpeta.

| Archivo original | Destino o tratamiento | Motivo |
| --- | --- | --- |
| `imap-readonly.cjs` | `cronox-backend/scripts/verify-production-mail-imap.cjs` | Comparación reproducible de proveedor/caché mediante EXAMINE, UID y banderas, sin enviar ni modificar mensajes. |
| `production-readonly.cjs` | `cronox-backend/scripts/inspect-production-mail.cjs` | Inventario de migraciones, buzones, colas y configuración permitida, en transacciones READ ONLY. |
| `production-quota-readonly.cjs` | `cronox-backend/scripts/inspect-production-mail-quota.cjs` | Verificación de cuotas, identidad SMTP, reservas históricas, RLS y conservación de mensajes. |
| `public-assets.cjs` | `cronox-backend/scripts/verify-public-admin-assets.cjs` | Comparación de recursos públicos y salud; acepta un identificador de versión y resuelve rutas desde el script. |
| `edit-campaign-quota.cjs` | Ignorado, conservado localmente | Parche puntual ya aplicado y superado por el código final. No debe ejecutarse de nuevo. |
| `production-extensions.cjs` | Ignorado, conservado localmente | Consulta puntual para investigar la dependencia pg_trgm. |
| `restore-extension-probe.cjs` | Ignorado, conservado localmente | Prueba sintética ligada al directorio temporal de binarios de aquella intervención. La recuperación real está documentada y dispone de su ayudante versionado. |
| `retention-readonly.cjs` | Ignorado, conservado localmente | Inventario previo sin leases, sustituido operativamente por `configure-production-mail.cjs dryrun` con coordinación real. No debe usarse para autorizar una limpieza. |

## Privacidad y ejecución

La revisión completa y la búsqueda de credenciales literales no encontraron contraseñas, tokens, claves, URLs con credenciales, cuerpos de correo, destinatarios reales ni resultados privados incrustados en los ocho scripts. Contienen código, referencias al entorno y rutas operativas; la prueba de restauración usa únicamente datos sintéticos. No se incorporan archivos `.env`, backups ni informes de producción a Git.

Los tres diagnósticos del VPS leen su `.env` en memoria y pueden producir direcciones de buzones, identificadores, fechas, cuotas y metadatos del servidor. **Esas salidas son informes privados**, aunque no incluyan cuerpos o contraseñas: guardarlas fuera del checkout y compartir únicamente la información permitida. El inventario de archivo no acredita por sí solo el entorno efectivo de PM2; para ello se conserva `verify-production-mail-access.cjs inspect` con root autorizado. Los scripts no se invocan automáticamente por el despliegue, tests ni trabajadores.

El comprobador de recursos públicos ya no imprime diferencias de HTML ni el JSON completo de salud; muestra solamente estado, coincidencia y `ok`. Una página de acceso anónima diferente de `admin.html` no verifica la UI autenticada.

Comprobación local sin ejecutar diagnósticos del VPS: `node --check` sobre los ocho archivos, revisión de literales sensibles, `git diff --check` y `git check-ignore` de los cuatro auxiliares. No se enviaron correos, consultaron buzones, cambiaron permisos ni modificó producción durante esta revisión.

## Commits y despliegue

Después de `git fetch origin`, `origin/main` continúa en `18a5465`; `d38188e` está pendiente de push y modifica únicamente el informe de resultados de producción. Su mensaje no incluye una instrucción de omisión de CI.

`.github/workflows/deploy.yml` se ejecuta ante **todo push a main**, sin filtros de rutas. Publicar `d38188e` mediante un push normal activaría la verificación y otro despliegue, aunque solo cambie documentación. La organización de auxiliares de esta revisión queda asimismo en un commit local; no se hace push ni se dispara un despliegue.
