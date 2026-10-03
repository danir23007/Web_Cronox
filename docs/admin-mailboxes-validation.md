# Entrega local y validación de Correo

La validación de la ampliación local posterior (plantillas, carpetas múltiples y campañas) está en [admin-mailbox-campaigns.md](admin-mailbox-campaigns.md). Este documento conserva la evidencia de la entrega anterior.

Estado posterior: publicación y conexiones reales completadas el 03/10/2026; véase [el registro de producción](admin-publication-2026-10-03.md). La prueba automática física de push sigue pendiente. Los resultados locales siguientes se conservan como evidencia histórica; las capturas y resultados brutos de `output/` son artefactos prescindibles y no se incorporan a Git. El preparador, las pruebas y los simuladores permanentes permanecen versionados.

Revisión: 2 de octubre de 2026. Base conservada: `main`, commit `f1669f2bc320ec7a4421bff30044df4424fbad3e`, publicación anterior del histórico de visitantes y finanzas. Esta funcionalidad no tiene commit, push, despliegue ni migraciones en producción. Los trabajadores nuevos nacen desactivados.

## Resultado de las comprobaciones

| Comprobación                                                                                 | Resultado                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Prisma validate/generate y compilación Nest                                                  | Correctos                                                                        |
| `npm run admin:build` y análisis sintáctico del módulo/service worker                        | Correctos                                                                        |
| Seguridad y políticas del módulo: `npm test --prefix cronox-backend -- --runInBand mailbox`  | 31 pruebas correctas                                                             |
| Regresiones de correo transaccional/plantillas, autenticación/permisos y visitantes/finanzas | 65 pruebas correctas en diez suites                                              |
| `npm run test:exports:ci --prefix cronox-backend`                                            | 59 pruebas correctas en seis suites                                              |
| Smoke de artefactos y rutas compiladas de exportaciones                                      | Correctos, con el módulo nuevo desactivado                                       |
| `node scripts/review-mailbox.cjs` desde backend                                              | 23 grupos de integración correctos                                               |
| Revisión en navegador Playwright, escritorio 1440×960 y móvil 390×844                        | Correcta; sin desplazamiento horizontal en lectura/compositor                    |
| `git diff --check`                                                                           | Sin errores de espacios/diff; avisos habituales de conversión LF/CRLF en Windows |
| Auditoría npm, comparada con package-lock.json de HEAD                                       | Mismos 15 avisos previos: 4 moderados, 11 altos; ningún nuevo paquete con aviso  |

Las regresiones se ejecutaron con:

```powershell
cd cronox-backend
npm test -- --runInBand mailbox visitor-history admin-finance-history auth-sessions session-permission-invalidation mail-transport.factory email.service restock-email admin-mails.dom managed-mail.service mail-lifecycle
npm run test:exports:ci
npm run smoke:exports:artifacts
npm run smoke:exports:compiled
```

Son 155 pruebas Jest distintas contando las 31 del módulo. Algunas se repitieron después de los ajustes; el total anterior no suma esas repeticiones. Los avisos/error logs de correo durante las suites corresponden a rechazos y fallos simulados esperados, no a envíos reales.

La integración utiliza PostgreSQL 17 temporal en loopback, la migración SQL real, usuarios/mensajes sintéticos, adaptador IMAP simulado y SMTP/TLS **real únicamente en localhost**, con un certificado efímero de prueba. Se impide la carga del entorno privado, incluido el autoload del cliente Prisma, y se desactivan todos los trabajadores automáticos. No se utiliza `migrate reset`. Web Push utiliza transporte/resolución simulados; no se contacta un proveedor push ni se envían correos reales.

Los 23 grupos cubren importación paginada y progresiva, UID repetidos/sin Message-ID/UIDVALIDITY/UID de 32 bits, flags y borrados externos, permisos/RLS/adjuntos/MIME, Reply-To y CCO, borradores/conflictos, diagnóstico sin envío, doble clic, aceptación/rechazo/incertidumbre SMTP, fallo independiente de copia en Enviados, recuperación de procesos y leases, caídas/backoff, mover/restaurar, avisos nuevos sin inundar la importación, revocaciones, buzones separados/conjuntos, contraseñas cifradas y campos vacíos, lectura de caché al desactivar, subidas privadas, suscripciones 410 y protección ante un trabajador push que pierde su lease.

En navegador se comprobó además:

- Lectura HTML aislada: ningún script/formulario/input activo; cero solicitudes de imágenes remotas antes de la acción explícita. Después se cargó una imagen interceptada localmente, sin contactar el destino real.
- Responder a todos con destinatarios efectivos, CC deduplicado y CCO vacío; remitente fijado al buzón original.
- Guardado de borrador y recuperación del texto tras abortar la petición de guardado y recargar la pestaña.
- Subida de un adjunto sintético de texto y descarga de un PDF sintético, mediante la interfaz real.
- Estados de Web Push pendiente, instalación/activación del service worker local y permiso del navegador todavía `default`; no se solicitó permiso automáticamente ni se creó una suscripción real.
- ADMIN sin asignaciones: sin mensajes/configuración y botón de redactar desactivado.
- Dos buzones en la navegación, temas claro/oscuro, vistas móvil y ausencia de errores JavaScript en el recorrido final.
- Conservación del lector cuando falla el marcado de leído en IMAP, mostrando un aviso. Los errores de consola de CSP bloqueando el píxel y de peticiones abortadas/503 en estas pruebas son intencionales.

Resultados detallados y capturas de revisión quedan en `output/mailbox-review/` y `output/playwright/mailbox-*.png`. Son artefactos de trabajo, fuera del inventario de código; no contienen credenciales de buzones reales. El servidor/SMTP/PostgreSQL temporal y la sesión de navegador se cierran al terminar la revisión. Para repetirla utiliza el modo `--serve` descrito en [la guía](admin-mailboxes.md).

## Archivos de la funcionalidad

Modificados:

- `cronox-backend/package.json`, `cronox-backend/package-lock.json`: dependencias IMAP, MIME, cifrado/direcciones y push; aliases SMTP/subidas con versiones corregidas para este módulo; servidor SMTP de prueba. El SMTP transaccional conserva su dependencia y configuración.
- `cronox-backend/prisma/schema.prisma`: diez modelos nuevos `Mailbox*`.
- `cronox-backend/src/app.module.ts`: registro de `MailboxModule`.
- `cronox-front/admin.html`: sección/navegación Correo, recursos, manifest y versiones de recursos modificados.
- `cronox-front/assets/admin.js`: carga de la sección.
- `cronox-front/assets/admin-shell.js`: integración con la protección de texto no guardado.

Nuevos:

- `cronox-backend/mailbox.env.example`.
- `cronox-backend/prisma/migrations/20261002160000_admin_mailboxes/migration.sql`: creación exclusivamente del módulo, índices, restricciones y RLS; sin DROP/TRUNCATE/DELETE ni modificaciones de datos anteriores.
- `cronox-backend/src/mailbox/mailbox.module.ts`, `mailbox.controller.ts`, `mailbox.service.ts`.
- En ese mismo directorio: `mailbox-access.service.ts`, `mailbox-security.ts`, `mailbox-files.service.ts`, `mailbox-leases.service.ts`, `mailbox-provider.service.ts`, `mailbox-reader.service.ts`, `mailbox-sync.service.ts`, `mailbox-sender.service.ts`, `mailbox-push.service.ts`, `mailbox-worker.service.ts`, `mailbox.spec.ts`.
- `cronox-backend/scripts/review-mailbox.cjs`, `tests/mailbox/mock-imap.cjs`.
- `cronox-front/assets/admin-inbox.js`, `admin-inbox.css`, `mailbox-icon.svg`.
- `cronox-front/mailbox-sw.js`, `cronox-front/mailbox.webmanifest`.
- `docs/admin-mailboxes.md`, este documento.

No se modifican migraciones aplicadas, servicios transaccionales, DNS ni el histórico permanente. Las credenciales, archivos privados, node_modules, datos de pruebas y artefactos temporales no forman parte de la funcionalidad a publicar.

## Pendiente de configuración y validación real

La preparación local posterior ya creó keyring privado AES, volumen privado con ACL restringida y VAPID/contacto propio. Las cuatro direcciones reales detectadas están registradas localmente como inactivas y pendientes de conexión. Sus referencias SMTP se resuelven desde la configuración actual sin duplicar contraseñas. No se necesita ni se supone una quinta dirección. Producción aún requiere ejecutar su preparación independiente, conservar cualquier clave privada de PM2 y comprobar las conexiones. Activa flags y buzones únicamente después de una publicación autorizada y diagnóstico satisfactorio.

No se ha verificado Hostinger/Titan con cuentas reales, cuotas/limitaciones del contrato, carpetas particulares, entrega final SMTP ni push en un Android/iPhone físico. Los avisos requieren sesión vigente y disponibilidad del navegador/sistema operativo; no se garantiza inmediatez. El cliente conserva caché y borradores privados, sin purgas automáticas del proveedor. Consulta los límites exactos, rotación/recuperación de claves y pasos posteriores en [la guía de conexión, uso y activación](admin-mailboxes.md).

Para revisar el panel local recuerda ejecutar **`npm run admin:watch`**.

## Preparación posterior y comprobaciones del 02/10/2026

- Nuevo preparador `scripts/prepare-mailboxes.cjs`: AES de 32 bytes/base64, VAPID P-256/base64url, conservación de claves válidas, rechazo de material perdido/incoherente, almacenamiento fuera del checkout, permisos y acceso comprobados. No conecta al proveedor ni habilita trabajadores. Puede conservar configuración privada de PM2 en el procedimiento de producción.
- `.env.local` continúa ignorado por Git. Las dos flags de correo están en false, igual que los trabajos locales. `start-local.cjs` añade resolución optativa de las referencias actuales de los cuatro buzones y rechaza flags activadas o heredadas accidentalmente.
- Seis comprobaciones Node de preparación/aislamiento local, 31 pruebas Jest de correo y 30 grupos de integración de visitantes pasaron. Compilaciones backend y panel completadas. La segunda preparación informó `changed=false`: claves estables y registros sin duplicar.
- Las cuatro migraciones pendientes de la base **local** revisadas quedaron aplicadas. La nueva conciliación de visitantes se hizo compatible con PostgreSQL sin los roles de Supabase; se recuperó una transacción fallida local mediante `migrate resolve --rolled-back` y reaplicación, sin reset ni borrado. No se modifica una migración ya publicada en producción.
- El servicio real de archivos del backend cifró y descifró correctamente un contenido sintético con las claves preparadas; los archivos de esa prueba se eliminaron.
- Navegador real a 1440×1000 y 390×844: cuatro buzones inactivos/PENDING_CONFIG, indicadores de cifrado/ruta y flags desactivadas, Configuración conserva el buzón seleccionado, referencias correctas sin contraseñas visibles, botón de diagnóstico disponible, opciones de notificaciones y cuatro selecciones de buzón. No se pulsó el diagnóstico ni se creó una suscripción push; cero escrituras del módulo durante esa revisión.
- VPS inspeccionado solo en lectura: mismas cuatro direcciones y referencias presentes, `.env` 0600 propiedad de deploy, ninguna variable MAILBOX definida en ese archivo; proceso backend root. El usuario deploy no puede listar PM2 de root. El preparador posterior debe ejecutarse en sesión administrativa para conservar también las claves que pudieran existir allí.

Capturas de esta revisión en `output/mailbox-preparation/`, fuera del conjunto a publicar. Procedimiento exacto de VPS, recuperación de claves, primera cuenta y móvil en [preparación y conexión](admin-mailboxes-connection.md). Sin commit, push, despliegue, migración de producción, correo real ni modificación de mensajes del proveedor.
