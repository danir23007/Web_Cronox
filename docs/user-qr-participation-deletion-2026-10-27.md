# Eliminación de usuarios con participaciones QR — verificación local

Fecha: 27/10/2026. Ajuste local sobre el estado existente, revisado para su registro en Git mediante commits locales. Sin push ni despliegue. No se han eliminado cuentas ni eventos reales.

## Comportamiento implementado

- La confirmación consulta `GET /api/admin/users/:id/deletion-preview`, exclusivamente para SUPERADMIN, con identidad estable y respuesta `private, no-store`. No modifica datos. Mientras se consulta, el botón de confirmación está deshabilitado; un fallo de consulta mantiene el borrado bloqueado.
- Conserva nombre, email y CRX. Con participaciones muestra cantidad, nombres de eventos y advertencia expresa; el botón pasa a «Sí, eliminar usuario y participaciones». Sin ellas conserva «Eliminar definitivamente».
- El servidor calcula una huella de identidad, IDs de participación y eventos/nombres. DELETE vuelve a comprobar todo dentro de la transacción. Una participación nueva, una sustitución con el mismo total o un cambio del alcance invalida la confirmación y devuelve una advertencia actualizada, sin borrar nada. En pantalla debe revisarse la nueva lista mediante una casilla y confirmar otra vez; un doble clic no autoriza ese nuevo alcance.
- Elimina solamente las filas `QrEventParticipant.userIdentityUid` del usuario confirmado, antes de ejecutar el procedimiento seguro de eliminación existente. Esas filas son las inscripciones/registros de escaneo de este modelo. Conserva los grupos y las filas de los demás participantes.
- Participar no equivale a registrar a otras personas: la autoría `registeredByIdentityUid` de filas ajenas y la creación de grupos siguen siendo historial administrativo protegido y bloquean el borrado con motivo concreto. Una fila propia registrada por la misma cuenta sí se puede eliminar. No se modifica la atribución de registros ajenos.
- Conserva permisos exclusivos de SUPERADMIN activo, bloqueo de eliminación propia, comprobación de versión de cuenta y protección del historial comercial/financiero. La nueva autorización no amplía las relaciones permitidas fuera de las participaciones propias.
- Mantiene transacción Serializable, reintentos limitados, bloqueo de usuario, recibo idempotente y comprobación SQL final. La auditoría añade cantidades, IDs de participaciones y eventos afectados. Los fallos revierten también las participaciones, sesiones, recibo y auditoría.
- Reutiliza la invalidación existente de sesiones, tokens, acreditación y accesos. No modifica la lógica de ordinales, reserva permanente de IDs/CRX ni secuencias.
- El listado de usuarios se recarga después del éxito, conserva búsqueda/orden y ajusta páginas vacías. Eventos QR recibe una señal local y entre pestañas, y se recarga al recuperar visibilidad; actualiza participantes, contadores y disponibilidad del Excel y cancela exportaciones pendientes. Las exportaciones siguientes consultan los registros actuales del servidor.

## Archivos

Backend: `src/admin/users/admin-user-deletion.ts`, controlador, servicio y DTO de borrado. Pruebas HTTP de usuarios y DOM de Eventos QR; el script `test-admin-user-deletion-db.cjs` incorpora `test-user-qr-deletion-fixtures.cjs`.

Frontend: `src/admin/admin-user.ts`, `api.ts`, `globals.d.ts`, sus assets generados; diálogo en `admin-user.html`; invalidación en `assets/admin-qr-events.js` y versión del recurso en `admin.html`. Pruebas CLI de navegador en `tests/admin-user-deletion/`.

No se han cambiado checkout, footer, compatibilidad móvil, puntos de venta ni las funcionalidades anteriores de eliminación de grupos.

## Verificaciones realizadas

### PostgreSQL real y datos ficticios

`node scripts/test-admin-user-deletion-db.cjs` (desde `cronox-backend`): 16 comprobaciones agrupadas aprobadas. Crea una base desechable con prefijo propio en PostgreSQL de loopback, aplica el esquema y las protecciones SQL existentes, y la elimina al terminar (`cleanedUp: true`). No utiliza cuentas de la base habitual para borrar.

Casos añadidos:

- Cero, una y varias participaciones; consulta/cancelación sin escrituras y consentimiento obligatorio para QR.
- Doble petición desde dos clientes: una sola eliminación efectiva y una sola auditoría; repetición idempotente.
- Conservación exacta de grupos y filas de participantes ajenos; contadores del servicio y apertura del Excel real con ExcelJS, que contiene solamente al participante conservado.
- Cambio de cero a una, de una a varias y sustitución con el mismo total: rechaza la confirmación anterior.
- Usuario con QR y pedido: sigue bloqueado y conserva cuenta, pedido y participaciones. Autoría de registros ajenos protegida; registro propio autoatribuido permitido.
- Sesión, refresh token y QR dejan de funcionar después del éxito.
- Error SQL deliberado después de la limpieza: restaura cuenta, participaciones, sesión, recibo y auditoría; reintento posterior correcto.
- Carreras reales con bloqueo de filas: si el escaneo confirma primero, el borrado exige una nueva advertencia; si el borrado obtiene primero el bloqueo del usuario, el escaneo pendiente falla y no crea huérfanos.
- Las comprobaciones anteriores del mismo script siguen aprobadas: permisos, eliminación propia, historial protegido, altas sin reutilizar IDs, ordinales globales con filtros/búsqueda/orden/paginación y conservación de otros usuarios/inventario/pedidos.

### HTTP, DOM, compilación y navegador

- Jest focal: usuarios HTTP, servicio de Eventos QR y DOM de Eventos QR: 85 pruebas aprobadas. Después se añadieron y ejecutaron 3 casos DOM de invalidación local, entre pestañas y al recuperar visibilidad: el archivo completo pasa con 48 pruebas (88 casos únicos entre las tres suites).
- Permisos HTTP de preview y DELETE, respuestas sin caché, validación de consentimiento/token y rechazo previo al servicio; errores de servidor y conservación de cuenta en navegador.
- `npm run admin:typecheck`, `npm run admin:build` y `npx tsc --noEmit` del backend: correctos. Assets generados actualizados.
- Playwright CLI sobre HTML/JS compilados con API aislada: seis escenarios QR y cinco de regresión del borrado anterior aprobados. Incluye cancelación, nombres/email/CRX, cero/uno/varios, nueva advertencia sin borrado automático, doble clic, historial protegido, fallo de consulta, ADMIN, cuenta propia, tema oscuro, búsqueda, ordinales y vaciado de última página. No escribe sobre cuentas reales.
- Revisión visual de capturas a 320 px y escritorio: diálogo contenido, lista visible, controles accesibles y confirmación deshabilitada hasta nueva revisión. Capturas locales en `output/playwright/user-qr-*.png`.
- Servidor habitual local: `/api/health` y `/api/ready` responden 200; preview sin autenticación responde 401. `git diff --check` sin errores.

Evidencias locales: `output/user-qr-deletion/` y `output/admin-user-deletion/database-results.json` (archivos de trabajo, no para publicar).

Revisión final para registrar los commits locales: tipos de frontend/backend y compilación administrativa correctos, 168 pruebas Jest focales aprobadas entre diez suites de usuarios, numeración, QR, footer y recuperación del checkout; las 16 comprobaciones PostgreSQL vuelven a pasar y la base desechable se elimina al terminar. Se repiten los seis escenarios de navegador QR y los cinco del borrado anterior con APIs aisladas, sin modificar cuentas reales. El control de credenciales del proyecto también pasa.

## Migraciones y alcance

**No requiere migración ni regeneración de Prisma**: no cambia el esquema ni ninguna migración aplicada. El guard SQL de eliminación segura permanece intacto: se eliminan previamente las filas propias expresamente autorizadas y el guard sigue comprobando las relaciones restantes. Requiere la migración de eliminación segura ya existente en el proyecto.

Este ajuste no se ha publicado ni validado sobre producción. No se ha repetido la batería de pagos ni las pruebas físicas móviles anteriores porque sus componentes no cambian. El zoom móvil no reproducido y las validaciones físicas de wallets/3DS mantienen su estado pendiente en los informes previos.
