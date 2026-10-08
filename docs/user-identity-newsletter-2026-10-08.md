# Identidad de usuarios y altas de newsletter — 8 de octubre de 2026

Corrección realizada en local. No se han hecho commit, push, despliegue, envíos de correo ni modificaciones en producción. No se encontró `AGENTS.md` en el repositorio ni en sus directorios ascendentes. Se han seguido los patrones NestJS/Prisma, el entorno local protegido y la compilación existente del administrador.

## Causas confirmadas

La lista calculaba `registrationNumber` mediante `ROW_NUMBER()` ordenado por fecha de alta e ID interno. La ficha mostraba la clave primaria `User.id` y la acreditación utilizaba `memberCode`. Eran tres referencias diferentes presentadas como identidad. Además, activar una cuenta prerregistrada generaba otro `memberCode`, y las asignaciones concurrentes de código/QR podían leer el estado anterior antes de tomar un bloqueo.

La newsletter persistía el consentimiento y el trabajo de bienvenida, pero solo actualizaba un usuario si ya existía. No creaba un usuario nuevo. La prueba anterior incluso exigía que no se creara. La tabla y su contador consultan `User`, por lo que estas altas no podían aparecer. La causa no era la caché, la paginación ni un filtro oculto.

## Identidad persistente

Se reutiliza `User.memberCode` como ID público. Se conserva literalmente todo código existente, sin rellenarlo ni convertirlo a partir de una fila o de la clave primaria. El formato central `assets/user-identity.js` lo presenta igual en lista, ficha, edición, acreditación, círculos, pedidos, previsualización masiva y visitantes. Si falta, muestra «—», nunca un ID inventado.

La tabla separa «N.º» (posición, que puede cambiar) de «ID de usuario» (persistente). Los enlaces, sesiones y relaciones siguen utilizando la clave primaria. La ficha identifica esa referencia como «ID interno». Las exportaciones separan «ID de usuario» e «ID interno de usuario», sin perder las referencias existentes. La búsqueda de usuarios, círculos exportados y visitantes admite el código público.

`UserIdentityReservation` reserva cada ID, código y token QR sin clave foránea para que sobrevivan a una eliminación. Las restricciones de base de datos impiden colisiones y los triggers impiden modificar una identidad emitida, reutilizar un código/token o recrear un ID interno eliminado. La secuencia no retrocede. Los bloqueos de transacción protegen las asignaciones concurrentes de código y QR. Activar la cuenta conserva su código anterior.

El QR sigue siendo un token opaco vinculado a su titular; no representa el número de fila ni el código de bienvenida. Se han conservado los tokens existentes. El código de bienvenida mantiene su etiqueta propia y no se utiliza como ID de usuario. No se encontraron controles de descarga o impresión específicos de la acreditación: se comprobó el PNG de QR real y la presentación bajo el medio de impresión del navegador; no se realizó impresión física.

## Alta y consentimiento

`linkNewsletterUser` utiliza `normalizeEmail` y busca por correo normalizado. El consentimiento, la creación/vinculación del usuario, la relación `NewsletterSubscription.userId` y la programación del correo se guardan en la misma transacción. Una inserción fallida revierte también la suscripción y el trabajo; no se devuelve una aceptación parcial.

Un correo nuevo crea una cuenta `PRE_REGISTERED`, sin contraseña, con código público y consentimiento explícito. Una cuenta existente conserva contraseña, estado, rol e identidad. No se deduce consentimiento del registro de una cuenta. Los índices de correo normalizado y el bloqueo compartido por email impiden duplicados por espacios, mayúsculas, concurrencia o reintentos. Se mantienen la deduplicación de bienvenida, beneficios y el límite existente para solicitudes de acceso.

La lista incluye los prerregistrados cuando no se filtra por otro estado. El total y las filas utilizan el mismo filtro. El contador de newsletter continúa contando suscripciones; no se confunde con el total de usuarios.

## Lectura de producción y los dos ejemplos

Consulta autorizada, exclusivamente `SELECT`, realizada mediante la conexión Supabase disponible. Los correos se recibieron escritos por el usuario; se omiten completos del informe.

| Caso | Usuario | Suscripción confirmada | Bienvenida | Resultado |
| --- | --- | --- | --- | --- |
| 1 — eva…@gmail.com | No existe | Sí, una | Enviada; trabajo SENT, sin error | Requiere reparación de datos |
| 2 — naki…@gmail.com | No existe | Sí, una | Enviada; trabajo SENT, sin error | Requiere reparación de datos |

Ambos casos siguen pendientes en producción. La corrección del código está verificada en local, pero no puede crear retrospectivamente esas cuentas sin ejecutar la reparación autorizada después de aplicar las migraciones.

Auditoría agregada: 40 usuarios, 5 suscripciones confirmadas, 2 suscripciones confirmadas sin usuario, 0 sin confirmar, 0 duplicados de correo normalizado en ambas tablas, 0 colisiones actuales de código público, 0 colisiones actuales de token QR y 31 usuarios sin `memberCode`. No hay usuarios `PRE_REGISTERED` actualmente ni cuentas con consentimiento confirmado y bandera de newsletter ausente. Tras reparar únicamente esos dos huérfanos, sin otras altas intermedias, se esperan 42 usuarios y las mismas 5 suscripciones.

No se han detectado colisiones entre los códigos y QR almacenados actualmente. No hay inventario de tarjetas físicas ni historial de códigos de cuentas borradas antes de esta reserva: no se puede certificar desde la base actual que nunca existieran duplicados históricos. No se renumera ninguna acreditación emitida. Una tarjeta antigua que solo presente una numeración de fila no identifica inequívocamente a una persona: debe contrastarse con su QR vigente y la ficha autorizada, sin asignarla automáticamente a otra cuenta. Un QR perteneciente a una cuenta eliminada deja de validar y queda reservado.

En la base local habitual ninguno de los dos ejemplos existe, ni como usuario ni como suscripción; no se copiaron datos personales de producción. La reparación local habitual procesa cero registros. La reproducción y las reparaciones se realizaron con correos ficticios en PostgreSQL aislado.

## Migraciones y reparación

Migraciones pendientes de cualquier despliegue futuro:

1. `20261008120000_stable_user_identity_newsletter_link`: prevalidación de duplicados, índices normalizados, normalización de correos, relación de suscripción, reserva de identidades, secuencia y protección de identidad. Asigna códigos únicamente donde faltan; conserva los ya emitidos.
2. `20261008121000_prevent_deleted_user_id_reuse`: impide recrear explícitamente una clave primaria reservada y restringe la ejecución directa de las funciones de trigger.

La primera migración aborta ante colisiones normalizadas. No fusiona cuentas. Ambas están aplicadas y registradas exclusivamente en la base local protegida.

Procedimiento local desde la raíz:

```powershell
npm run build:compiled --prefix cronox-backend
node cronox-backend/scripts/apply-user-identity-local.cjs
node cronox-backend/scripts/repair-newsletter-users.cjs
node cronox-backend/scripts/repair-newsletter-users.cjs --apply
node cronox-backend/scripts/repair-newsletter-users.cjs
```

Sin `--apply` solo se audita: huérfanos confirmados, vínculos/banderas pendientes, duplicados, ambigüedades, colisiones y estados. `--apply` acepta exclusivamente la base local protegida, toma el mismo bloqueo por email, vuelve a comprobar consentimiento, reutiliza cuentas y repara cada suscripción en una transacción. No importa servicios de correo, no crea trabajos, no activa cuentas ni cambia contraseñas. Repetirlo procesa cero registros ya reparados. Los conflictos requieren revisión manual; no se borran ni fusionan cuentas.

Para una auditoría externa futura puede utilizarse `--audit-url-env=NOMBRE_VARIABLE` con una conexión de solo lectura suministrada de forma segura. No se imprime la conexión. Esta opción rechaza `--apply`.

Para una futura reparación de producción se requiere un procedimiento expresamente autorizado, copia de seguridad, auditoría previa y aplicación ordenada de las dos migraciones. Revisar el dry-run después de migrar y ejecutar la función exportada `repairNewsletterUsers(db, true)` en un proceso controlado sin trabajadores de correo, usando una conexión autorizada; el CLI incluido bloquea deliberadamente la aplicación externa. Verificar después cero huérfanos, identidad estable, 42 usuarios si no ha cambiado el conjunto y 5 suscripciones. Ese paso no se ha ejecutado.

## Verificación

- 190 pruebas en 23 suites: newsletter, usuarios, exportaciones, edición masiva, pedidos, membresía y regresiones DOM de administración, autenticación, paginación y acreditación móvil. Todas pasan.
- 52 pruebas en 12 suites adicionales de analítica, visitantes y regresiones de exportaciones/administración: todas pasan (algunas suites coinciden con la ejecución anterior).
- Backend `build:compiled`, generación Prisma y `admin:build`: correctos. `git diff --check`: correcto.
- PostgreSQL aislado real: migraciones sobre esquema anterior, auditoría previa, dry-run sin mutaciones, reparación de huérfano y vínculo existente, segunda ejecución sin cambios, ninguna creación de correo por reparación, rollback de alta fallida, seis altas concurrentes del mismo email y cuatro de emails distintos, estados/contraseñas conservados, código estable al activar, QR concurrente, rechazo de cambios y reutilizaciones, eliminación sin renumerar, creación directa con código, búsqueda/filtros/paginación/total coherentes.
- Chromium mediante Playwright CLI: HTML y recursos reales con respuestas generadas por los servicios sobre PostgreSQL aislado. El nuevo prerregistrado aparece en la tabla y su total; mismo `CRX-000053` en tabla, ficha, edición y acreditación tras activación. QR PNG real cargado. Escritorio 1440 px, móvil 390 px y medio de impresión. Capturas inspeccionadas visualmente; sin errores JavaScript, desbordamiento en acreditación móvil ni peticiones de escritura del navegador.
- El chequeo independiente `tsc -p tsconfig.admin.json --noEmit` mantiene cinco errores anteriores en `src/admin/api.ts` (stock posiblemente indefinido y métodos ausentes); no se han introducido errores nuevos. La compilación Vite del administrador pasa. No se presenta ese chequeo como aprobado.

Recursos con referencias de caché actualizadas: `admin.js`, `admin-user.js`, `admin-bulk.js`, `admin-orders.js`, `admin-visitors.js`, `profile.js` y el nuevo formateador. El bundle `api.js` no tiene cambios funcionales en el diff.

Reproducción aislada:

```powershell
node cronox-backend/scripts/review-user-identity-local.cjs
node tests/users/review-server.cjs
npx --yes --package @playwright/cli playwright-cli -s=users open http://127.0.0.1:43130
npx --yes --package @playwright/cli playwright-cli -s=users run-code --filename tests/users/review-browser.cli.js
```

El servidor de revisión escucha solo en loopback y carece de conexión a base de datos o correo. Los datos ficticios se generan en una instancia temporal aislada que se detiene al finalizar. El backend habitual queda disponible en `http://localhost:3000/` mediante su lanzador protegido, con correo y trabajos desactivados.

Evidencias en `output/playwright/user-identity/`: `database-report.json`, `browser-report.txt`, `examples-local.json`, `users-desktop.png`, `detail-desktop.png`, `edit-desktop.png`, `accreditation-desktop.png`, `accreditation-mobile.png`, `accreditation-print.png` y `qr-fixture.png`.
