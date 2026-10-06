# Edición masiva: Activa sin contraseña — 2026-10-06

La decisión del propietario sustituye el aplazamiento anterior: SUPERADMIN puede
asignar Activa aunque la cuenta no tenga contraseña. Se conserva el trabajo previo
del checkout `c20f666`, incluida la posición de la entrega estimada en la cesta.
La fase local se completó sin commit, push ni despliegue. La publicación posterior
ha sido autorizada por el propietario y se describe al final de este informe.

## Causa y reproducción

En localhost:3000, PostgreSQL local `127.0.0.1:5433/cronox_dev`, se crearon trece
cuentas temporales sin contraseña y un SUPERADMIN temporal. Correos y trabajos
de fondo estaban desactivados mediante `start:local`. No se utilizaron las trece
cuentas reales de la captura ni credenciales reales de usuarios.

Selección capturada de trece IDs → consulta inicial del modal HTTP 201 → revisión
con `accountState: ACTIVE` HTTP 400: «para activar la cuenta debe establecer primero
una contraseña». No se enviaba execute ni se escribía ningún estado. La condición
estaba únicamente en `AdminBulkService.plan`; la edición individual ya permitía
Activa sin contraseña y utilizaba las mismas escrituras protegidas del servicio
de usuarios. Se elimina solo la restricción de ACTIVE; siguen las validaciones de
Pendiente de contraseña y Prerregistrado, las exclusiones SUPERADMIN/autor, DTOs,
límite de 100, revisión firmada y selección capturada.

Se detectaron además dos problemas en la presentación de errores del modal:

- Una respuesta 5xx perdía el motivo público del backend y se sustituía por
  «resultado no confirmado». Ahora se muestra ese motivo y el HTTP, manteniendo
  el estado de incertidumbre, la consulta del recibo y el reintento con el mismo UUID.
- Si la escritura estaba confirmada pero fallaba la recarga de la tabla, el
  manejador intentaba consultar el UUID ya limpiado. Ahora distingue escritura
  confirmada de fallo de actualización del listado y pide recargar la página.

No se muestra éxito antes del recibo de execute/consulta. Un error de revisión o
escritura conserva los valores y la selección. El éxito confirmado actualiza la
tabla; un 409 exige revisión nueva sin modificar la petición silenciosamente.

## Acceso, newsletter y recuperación

Activar modifica estado, versión de sesión y auditoría mediante la transacción
existente; no crea contraseña, sesión, consentimiento o tarea de correo. No se
introduce un acceso implícito para cuentas activas.

- Login: se conserva bcrypt y la comparación con hash ficticio para cuentas
  inexistentes/sin contraseña. Se exige explícitamente contraseña almacenada y
  entrada no vacía, además de coincidencia y estado ACTIVE. El DTO rechaza vacío
  con HTTP 400; contraseña incorrecta en ACTIVE sin contraseña da HTTP 401.
- Lanzamiento/newsletter: acceso solo con sus tokens existentes, comprobaciones
  de cuenta/rol/email, caducidad y consumo único. ACTIVE por sí solo no crea token.
- Recuperación: una cuenta ACTIVE puede pedir el flujo existente; establecer
  contraseña sigue exigiendo un token válido y no utilizado. La activación masiva
  no solicita recuperación ni envía correo. El registro normal conserva su rechazo
  de emails ya existentes en ACTIVE; no se abre una vía de apropiación de cuentas.
- Newsletter: una suscripción posterior de una cuenta ACTIVE USER/FRIEND sigue
  el flujo existente de acceso verificado. Ese flujo puede preparar su contraseña
  inicial al entregar la newsletter, como antes; no se ejecuta desde bulk ni se
  altera aquí. ADMIN/SUPERADMIN no pasan por ese acceso de newsletter.

## Verificación y límites

- Jest: 16 suites / 177 pruebas de bulk, usuarios, autenticación, sesiones,
  lanzamiento y newsletter, más repetición de las nueve pruebas DOM del modal
  tras añadir dos casos; 179 pruebas distintas correctas en el conjunto actual.
- Backend Nest y administrador Vite compilados correctamente. No cambia schema,
  dependencias ni migraciones; no es necesaria una regeneración Prisma.
- Navegador/API reales locales: trece cuentas activadas sin contraseña, revisión
  sin escrituras, un solo execute tras doble clic, tabla actualizada y estado
  persistente tras recarga. Cero sesiones de esos usuarios y cero tareas newsletter.
- Selección mixta con/sin contraseña y cambios combinados de estado, rol y círculo;
  preservación de contraseñas; cambios de estado solos conservan rol/círculo.
- Doble petición simultánea con UUID compartido devuelve un resultado durable;
  una modificación posterior a la revisión produce 409 sin escritura parcial.
- Fallo HTTP 503 inyectado únicamente en la petición local del navegador: motivo
  visible, selección/valores conservados y sin cambio de datos. Consulta real 404
  y reintento real con el mismo UUID completan una sola operación. Modal móvil
  comprobado con captura. Fallo de recarga tras escritura cubierto en DOM aislado.
- Edición individual comprobada por PATCH y formulario real sin contraseña.
- Suite de integración existente: permisos 401/403, exclusiones, invalidación de
  sesiones, 100 IDs, snapshot, concurrencia y recibos durables correctos. Su fixture
  de categorías declara ahora GARMENT: el default UNCLASSIFIED se conserva al
  sustituir categorías por una regla previa y no debe usarse para aquella prueba.
- Todos los fixtures se eliminan al terminar por sus IDs/tag exclusivos. No se
  crean pedidos, pagos ni envíos externos. `git diff --check` correcto.

Reproducción (requiere backend local actual):

```powershell
node tests/admin-bulk/active-without-password.cjs
node tests/admin-bulk/integration.cjs
npm --prefix cronox-backend test -- --runInBand --testPathPatterns="admin-bulk|admin-users.service|auth.service|launch-login|newsletter|auth-sessions|session-permission"
```

`--reproduce` en el nuevo script documenta el rechazo del código anterior; no se
espera que pase tras esta corrección. Evidencias y capturas privadas/ignoradas:
`output/playwright/bulk-active-2026-10-06/` y registros `bulk-active-*` en esa raíz.

## Publicación autorizada y preparación — 2026-10-06

El propietario autorizó commit, push a main y publicación de esta corrección y
sus ajustes de errores/recarga. Se conserva el resto del código de c20f666.
La publicación anterior terminó correctamente: Actions 37344759093, commit
c20f666d1e94489ad5f5553f8b5d64522bfd6b06, confirmado también en el VPS.
No había un despliegue simultáneo antes de preparar el nuevo push.

Destino comprobado mediante la configuración activa del backend por SSH:
aws-1-eu-west-1.pooler.supabase.com:5432/postgres. Las 78 migraciones del
repositorio están aplicadas: cero pendientes y cero fallidas. No se crea ninguna
migración nueva. El flujo existente ejecuta migrate deploy para comprobar/aplicar
únicamente las pendientes, sin reset ni db push.

Copia custom privada anterior a la publicación, validada con pg_restore --list:
/home/deploy/cronox-backups/bulk-2026-10-06-IPDhMp/before-release.dump
(913.199 bytes; directorio 700 y archivo 600). No se descarga ni incluye en Git.

Se repitieron las 16 suites pertinentes: 179 pruebas correctas, además de la
compilación Nest y Vite. Las comprobaciones reales locales de cuentas desechables
y protecciones también se repitieron correctamente. El workflow instala los
lockfiles con npm ci, genera Prisma, compila y ejecuta sus comprobaciones de
exportaciones antes de publicar mediante el script existente. No se cambian
dependencias, configuración de correo ni cuentas reales.

La comprobación posterior en cronox.es debe confirmar el SHA del VPS, el contenido
de admin-bulk.js y la referencia v=7 en el HTML administrativo instalado, la
ausencia de la restricción retirada en el backend compilado y salud HTTP 200.
Se verificará sin ejecutar Bulk Edit sobre usuarios de producción. El resultado
de Actions y esas comprobaciones se entregan en el cierre de publicación; esta
preparación por sí sola no acredita que esté publicado.

## Corrección adicional del flujo del modal — 2026-10-06

Tras publicar `dc22004`, la captura del propietario mostró un problema distinto:
al seleccionar Activa, Aplicar cambios permanecía deshabilitado hasta pulsar
Revisar cambios. El texto inicial no se actualizaba ni explicaba ese requisito.
Ese clic no enviaba execute; no era otro rechazo de contraseña del backend.

Aplicar cambios se habilita ahora al elegir cambios válidos. Su primer clic
obtiene la revisión y muestra el resumen, sin escribir. El botón pasa a Confirmar
cambios a N usuarios/productos y solo esa confirmación ejecuta la operación.
Revisar cambios sigue disponible. El mensaje se actualiza al editar los campos;
No modificar conserva sus valores, incluido el círculo. Cambiar una revisión
invalida su token; una revisión sin cambios deja la confirmación deshabilitada
y muestra el motivo. Un doble clic de ratón no confirma accidentalmente el
resumen que acaba de aparecer. Se conservan errores, selección, UUID de reintento,
protecciones de roles y actualización de tabla. No cambia código del backend,
schema, dependencias ni reglas de autenticación. El recurso pasa a v=8.

Verificaciones repetidas: diez pruebas DOM, incluyendo acceso directo desde
Aplicar cambios, ausencia de escrituras antes de confirmar, invalidación de la
revisión, selección sin cambios, doble clic, edición de productos y errores/reintentos. Navegador y API
reales locales con trece cuentas desechables: preview 201, execute 201, persistencia
y recarga; pruebas combinadas, concurrencia, error 503 aislado, edición individual
y login conservadas. Se revisaron capturas en escritorio y móvil. Compilaciones
Vite y Nest y revisión de diff; se reutilizan las comprobaciones anteriores de
autenticación no modificada. La publicación adicional usa la autorización del
propietario para la corrección de Bulk Edit; su resultado se confirma al terminar
Actions y comprobar los recursos online. Ninguna cuenta real se activa para QA.

Preflight adicional: el despliegue anterior terminó correctamente; destino
`aws-1-eu-west-1.pooler.supabase.com:5432/postgres`, 78/78 migraciones aplicadas,
cero pendientes y cero fallidas. Nueva copia privada validada con pg_restore:
`/home/deploy/cronox-backups/bulk-flow-2026-10-06-KY3TfT/before-release.dump`
(914.304 bytes; directorio 700, archivo 600). No se incluye en Git.
