# Preparación local y publicación posterior — 2026-10-05

El propietario ha aprobado el resultado local y autorizado el commit en `main`.
Este cierre reúne SEO, catálogo/categorías/filtros, seguridad, resistencia a
fallos, cambio de email, dependencias, exportaciones y sus pruebas e informes.
Se conserva el trabajo intermedio; los cambios de categorías y visibilidad del
commit `6253604` ya pertenecen a la rama y no se revierten.
No se ha hecho push, despliegue, indexación ni modificación de producción.

## Decisiones que se conservan

- La separación de permisos de ADMIN sigue pospuesta. Se conserva la política
  actual, incluidas las rutas estrictamente reservadas a SUPERADMIN. SUPERADMIN
  mantiene las funciones administrativas sujetas a sus validaciones.
- Contacto del cambio de email: `support@cronox.es`, en texto y `mailto`.
- No se imponen cupos globales de visitas, clientes o ventas. Los límites por
  operación/IP siguen siendo por proceso; no equivalen a protección distribuida.
- No hay respuestas simuladas para disimular errores del catálogo.

## Base local, copia y migraciones

Antes de ejecutar migraciones se verificaron ambos destinos configurados:
`DATABASE_URL` y `DIRECT_URL` apuntan a **127.0.0.1:5433/cronox_dev**.
Correo y trabajos de fondo están desactivados en el arranque local protegido.
Se guardó una copia PostgreSQL en formato custom antes de ejecutar cambios:
`output/playwright/commit-preflight-2026-10-05/local-before-migrations.dump`.
La copia y los registros son privados, están ignorados y no forman parte del commit.

Se compararon **las 78 carpetas de migración** con `_prisma_migrations`:
78 aplicadas, ninguna pendiente y ninguna fallida. Se ejecutó el comando previsto
`npm --prefix cronox-backend run migrate:local`: confirmó que no había pendientes.
**No se aplicó ninguna migración nueva durante esta preparación del commit.**
Las siguientes dos se habían aplicado en el encargo anterior, únicamente allí,
y ahora se incorporan al repositorio:

- `20261005190000_email_change_authorization`
- `20261005200000_email_change_private`

No se emplearon reset, truncados ni eliminación de datos de desarrollo.
El historial de producción no se ha consultado: puede necesitar también otras
migraciones anteriores, por ejemplo las de grupos/visibilidad de categorías.

## Instalación, generación y comprobaciones finales

- `npm ci` en la raíz y en `cronox-backend`, utilizando los lockfiles existentes.
  No se añadió ninguna actualización de paquetes durante este cierre.
- `npm run build` en backend: generación de Prisma Client 6.19.3 y Nest correctas.
- `npm run admin:build` en la raíz: Vite correcto. El frontend público es HTML/JS
  estático servido por el backend; este build genera los bundles API/admin.
- Jest completo: **195 suites, 1.749 pruebas correctas**.
- Tras reparar cinco referencias corruptas de optional chaining en el perfil:
  **8 suites y 127 pruebas de perfil/medios/responsive correctas**; comprobación
  de referencias y optimización de medios correcta. `profile.js` pasa a `v=17`.
- Visitantes: **30 comprobaciones aisladas correctas**. Se actualizó la inyección
  de fallo del script al validador de sesiones actual; sigue exigiendo 503 y
  ausencia de registro como visitante anónimo ante una caída de autenticación.
- Cambio de email/privacidad: **101 comprobaciones**, doble autorización,
  concurrencia, caducidad, revocación y aislamiento RLS correctos.
- Exportaciones: siete módulos XLSX; SQL bloqueado termina en unos 30 segundos,
  sin consulta retenida después y con `statement_timeout` fuera de exportación
  igual a cero. Otra exportación y el catálogo continúan funcionando.
- HTTP/JWT/CSRF, roles, checkout concurrente, precios/stock, firmas Stripe y
  enlaces antiguos: correctos en PostgreSQL desechable y proveedores simulados.
- SEO: **12 pruebas Chromium/WebKit correctas**; estas pruebas usan un fixture
  aislado y no sustituyen la verificación independiente de localhost:3000.
- Rutas de dependencias: composición MIME, destinatarios, adjuntos sin acceso a
  URL/archivo, parser de formulario y transformaciones JPEG/PNG/WebP correctos.
- Navegador **localhost:3000**, escritorio 1366 y móvil 390: siete productos,
  seis categorías, selección/deselección múltiple, URL, fila completa pulsable,
  texto alineado, casillas visualmente ocultas, estado accesible y foco correctos.
  Galería preparada con diez elementos; respuestas de productos/categorías/galería
  200, cero errores JavaScript y cero respuestas públicas simuladas.
- Perfil y nueva confirmación: flujo real de dos etapas en fixture aislado,
  segundo enlace en la misma pestaña, fragmento retirado, confirmación por teclado
  y email anterior conservado hasta finalizar. Correos capturados en memoria.

Las verificaciones anteriores de carrito (120 correctas, tres omisiones previas)
y buzones (67 comprobaciones) siguen siendo aplicables: no se modificó su código
en este cierre. Las medidas y límites de saturación se documentan también en el
[informe de seguridad](security-functional-review-2026-10-05.md).
Los artefactos de esta repetición están en
`output/playwright/commit-preflight-2026-10-05/`, excluidos del commit.
Las imágenes externas se bloquean en el navegador de prueba para aislarlo;
esos fallos de red deliberados no se cuentan como fallos JavaScript del catálogo.

El proceso que ocupaba 3000 se identificó como el backend compilado de este
repositorio y se detuvo únicamente para regenerar su DLL Prisma en Windows.
Se reabrió con `start:local` después del build; no se detuvieron procesos ajenos.
Los bundles que ya se versionan siguen incluidos. El repositorio también tiene
`node_modules` raíz previamente versionado: sus cambios incidentales de `npm ci`
se restauraron a la base limpia; no se incluye una eliminación masiva ajena al encargo.

## Procedimiento de publicación posterior (no ejecutado)

Estos pasos requieren una autorización posterior y acceso al entorno destino.
Ejecutarlos desde un checkout del commit revisado, con Node >=22.12.0 y sin
mezclar el archivo local `.env.local` con la configuración de publicación.

1. Identificar y registrar **host, puerto, nombre de base y rol** del destino
   autorizado, sin imprimir credenciales. Guardar una copia verificable con el
   procedimiento del proveedor antes de migrar; comprobar cómo restaurarla.
   El `schema.prisma` actual usa `DATABASE_URL`: **no declara `directUrl`**.
   Definir para los comandos Prisma una conexión directa de migración autorizada
   si el proveedor lo exige; establecer `DIRECT_URL` por sí solo no la selecciona.
2. Instalar exactamente los lockfiles, desde la raíz del repositorio:

   ```powershell
   npm ci
   npm --prefix cronox-backend ci
   ```

3. Desde `cronox-backend`, con esa configuración de migración autorizada:

   ```powershell
   npx prisma migrate status
   npm run prisma:migrate:deploy
   npx prisma migrate status
   npm run prisma:generate
   npm run build:compiled
   ```

   Revisar **todas** las pendientes antes del deploy; no limitarlo a las dos de
   email. Si hay una migración fallida o un historial divergente, detener la
   publicación y reconciliarlo con evidencia; no ejecutar reset ni `db push`.
   `migrate deploy` aplica las pendientes sin borrar datos. Verificar al acabar
   que las 78 estén aplicadas. La tabla privada `EmailChangeRequest` necesita
   permisos para el rol backend; anon/authenticated/PUBLIC no deben acceder.
   Confirmar que el rol real permite las consultas previstas bajo RLS, sin
   abrir el acceso público para solventar un error de configuración.
4. Volver a la raíz y compilar los assets versionados:

   ```powershell
   npm run admin:build
   ```

   Publicar juntos `cronox-backend/dist` (incluidas las plantillas de correo
   copiadas por Nest), el cliente Prisma/dependencias requeridos y todo
   `cronox-front` con HTML y assets vigentes. No subir los node_modules Windows
   locales a otro sistema operativo; instalar/generar en el sistema destino.
5. Comprobar configuración existente: `NODE_ENV`, `DATABASE_URL` de aplicación,
   secretos JWT, `FRONTEND_URL` HTTPS real, CORS, cookies/proxy, Stripe/webhook,
   buzón NOREPLY/SMTP, pools y trabajos de fondo. Conservar las decisiones de
   producción; no copiar automáticamente las desactivaciones del entorno local.
   Este trabajo no habilita correo ni pagos reales ni decide permisos de ADMIN.
6. Antes de activar el tráfico, verificar en staging con capturador de correo
   y Stripe simulado/test: doble confirmación y cierre de sesiones, perfil,
   exportaciones y roles. Reiniciar mediante el gestor del despliegue con
   `npm run start:prod` o su equivalente ya configurado, sirviendo el build nuevo.
7. Comprobar `/api/health` y `/api/ready`, catálogo, categorías, filtros, galería,
   visibilidad de categorías desde administración, autenticación y los endpoints
   modificados. Revisar HTTP/errores sin secretos; title/canonical/JSON-LD,
   sitemap/robots, noindex de filtros y 404 de productos inexistentes.
   No enviar solicitudes de indexación automáticamente.

El rollback de código debe usar el artefacto anterior conservado, sin reescribir
Git. Estas dos migraciones son aditivas; no borrar tablas ni revertir SQL de
forma automática. Cualquier restauración de base requiere el procedimiento y
autorización del operador, considerando los datos creados desde la copia.

## Pendientes que no bloquean el commit local

- Decisión de producto sobre ADMIN y procedimiento manual de soporte cuando
  el usuario pierde el acceso al buzón actual.
- Auditoría npm backend: 42 avisos completos (40 altos, dos moderados), tres
  altos con `--omit=dev` en la cadena de configuración/CLI Prisma. Raíz: cero.
  Las rutas y propuestas concretas están en el informe; no se aplicó el downgrade
  sugerido por `npm audit fix --force` ni una actualización mayor indiscriminada.
- Validar en el despliegue real el rol RLS, proxy, reparto entre procesos,
  pools y capacidad. Las medidas locales no acreditan resistencia a DDoS
  ni establecen la capacidad de producción.
- Publicar, migrar el destino autorizado y comprobarlo allí queda expresamente
  pendiente; no se ha asumido ningún estado de la base de producción.
