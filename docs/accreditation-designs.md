# Diseños de acreditación

El administrador contiene **Multimedia → Acreditaciones** (`/admin.html#section-accreditations`). Inicialmente solo existe **Acreditación original**, activa. Seleccionar una tarjeta y abrir su vista previa son operaciones de lectura; únicamente **Activar** cambia la selección pública. Se puede editar el nombre identificativo y la imagen del libro. Guardar la configuración de un diseño activo modifica su presentación pública, como indica el formulario.

La carga del apartado observa su visibilidad y también comprueba si ya está abierto al inicializarse. No depende exclusivamente del callback de `admin.js`: se reprodujo un panel vacío al omitir ese callback (como en una versión anterior en caché), aunque la API devolvía el original activo. Se actualizaron las versiones de ambos scripts y se añadieron pruebas para apertura anterior/posterior a la carga del módulo, ausencia del callback y coalescencia de solicitudes. Si la API devuelve una lista vacía, aparece un error recuperable en vez de un panel silencioso. En la revisión local el registro original ya existía, con su configuración intacta; no se recreó ni se duplicó.

La vista previa utiliza el HTML y CSS reales de `profile.html` con datos ficticios y un QR sin validez. No carga `profile.js`, no emite identificadores ni ejecuta promociones, estadísticas, analítica o acciones de clientes. Su HTML y datos requieren ADMIN/SUPERADMIN y no se almacenan en caché. Puede revisarse con anchura de escritorio o móvil. La previsualización muestra la configuración guardada.

## Apertura de configuración y vista previa

El botón de la tarjeta abre un panel explícito, consulta los valores actuales y carga automáticamente la vista previa. El panel tiene cierre, foco accesible y mensajes de carga/error con reintento. Cerrar descarta la edición no guardada y cancela las cargas pendientes; no guarda ni activa. La vista previa confirma la carga de las imágenes mediante un mensaje validado por origen, ventana y token de intento; si falla o no responde dentro del plazo, el administrador muestra un error y permite reintentar.

**Guardar configuración** permanece deshabilitado mientras los campos no difieran de los valores guardados. Editar, abrir/cerrar o previsualizar no envía escrituras; el PATCH solo se envía al guardar cambios expresos. El servidor también trata un envío idéntico como una operación sin cambios: no modifica configuración, fechas, revisiones ni auditoría. La activación sigue siendo una acción separada mediante **Activar**.

Se reprodujo en el administrador servido por localhost el fallo anterior: el manejador solo ejecutaba `select()` sobre un formulario que ya se mostraba al cargar las tarjetas y ocultaba el iframe, eliminando su URL. El clic no generaba petición de vista previa ni error de JavaScript. Se sustituyó esa selección por la apertura del panel y se retiró la apertura automática del formulario al listar tarjetas.

Verificación directa en navegador: recorrido Multimedia → Acreditaciones, apertura, valores iguales a la API, imágenes del libro y QR cargadas, cierre/reapertura y edición descartada, tanto en escritorio como a 390 × 844. Se inyectaron respuestas 503 exclusivamente en el navegador de prueba para la consulta de configuración y los datos de vista previa: aparecieron errores visibles y los reintentos recuperaron las respuestas reales. Solo hubo peticiones GET del módulo; la respuesta administrativa completa antes y después fue idéntica. No hubo excepciones JavaScript; los errores HTTP esperados correspondían a los fallos 503 inyectados. La instancia local se recompiló y reinició y se actualizaron las versiones de caché del módulo, sus estilos y el script de vista previa.

## Persistencia y compatibilidad

- `AccreditationDesign`: identificador estable, nombre, renderer, configuración JSON validada por diseño y revisión independiente.
- `AccreditationSelection`: una fila `global`, referencia obligatoria al diseño activo, clave foránea y restricción SQL de singleton. No hay múltiples flags que puedan quedar activos simultáneamente.
- Activación/configuración: transacción PostgreSQL, bloqueo de la selección, control de revisión y auditoría en la misma transacción. Un conflicto devuelve 409; una imagen inexistente o no verificable impide guardar/activar. Cualquier fallo revierte todos los cambios.
- Permisos: los guards JWT, Admin y Roles existentes; protección CSRF global y validación de DTO. El registro de implementaciones del servidor rechaza filas de diseños no implementados o configuraciones incompletas.
- La migración `20261016120000_accreditation_designs` solo añade las dos tablas y registra el original. No modifica usuarios, tokens, QR, compras, círculos ni estadísticas.
- No hay inicialización de datos en el arranque ni en las consultas. Prisma omite la migración si ya está aplicada; se verificó en la base local que una segunda ejecución no cambia los registros. Una repetición manual de su SQL sobre tablas existentes falla dentro de la transacción sin sobrescribirlas; también se comprobó sobre una configuración personalizada en la base temporal.
- El perfil conserva sus accesos y solicita `GET /api/accreditations/active` sin caché cada vez que se abre la acreditación. El renderer aplica la configuración sobre el diseño existente; `profile.js` sigue controlando identidad, QR, privilegios, estadísticas y ascensos. Si no puede resolver el diseño, muestra un error y permite reintentar abriendo la sección, sin sustituir silenciosamente la selección por otra.
- `/api/membership/me/qr`, `/api/membership/me/stats` y `/api/m/:publicMemberToken` no cambian.

## Incorporar el siguiente diseño

Se necesitan las referencias visuales de escritorio/móvil, imágenes y fuentes con sus derechos de uso, disposición de identidad/QR/estadísticas/privilegios/acciones, y qué opciones específicas deben poder configurarse.

1. Guardar sus recursos con rutas propias/versionadas, sin sobrescribir los del original.
2. Añadir su renderer a `cronox-front/assets/accreditation-designs.js`. Debe conservar los nodos de datos y acciones que usa `profile.js`; puede reorganizarlos y aplicar sus estilos. No debe generar ni modificar identidades o datos de negocio. Cargar los recursos y estilos nuevos tanto en el perfil como en la vista previa.
3. Añadir su definición a `src/accreditations/design-registry.ts`, con su esquema de configuración y comprobación de recursos. Registrar únicamente implementaciones completas.
4. Añadir su formulario específico y adaptador en `admin-accreditations.js` (`configEditors`), sin modificar el selector o la activación. No existe un editor visual genérico.
5. Insertar la nueva fila por una migración aditiva, dejándola inactiva. No modificar la fila de selección ni la configuración del original.
6. Verificar vista previa, datos, acciones, móvil/escritorio, activación y vuelta al original antes de ofrecerlo en producción.

Las imágenes configurables del original se limitan a `/assets/` y al almacén de acreditaciones ya existente. No se añadió un cargador de archivos ni se duplicó el recurso remoto original. La comprobación de recursos remotos requiere que su servidor responda a HEAD; un fallo de red impide la operación y conserva la configuración anterior.

## Comprobaciones locales

```powershell
npm run migrate:local --prefix cronox-backend
npm run prisma:generate --prefix cronox-backend
npm run typecheck --prefix cronox-backend
npm run admin:typecheck
npm test --prefix cronox-backend -- --runInBand accreditation-designs.dom profile-accreditation-mobile membership.service circle.service
npm run test:accreditations:db --prefix cronox-backend
npm run test:accreditation:browser
npm run build:compiled --prefix cronox-backend
npm run start:local --prefix cronox-backend
```

La prueba de base de datos crea y elimina una base PostgreSQL temporal exclusivamente en loopback. Comprueba migración con usuarios existentes, preservación de identidad y configuración, cambio/vuelta, conexión nueva, concurrencia, rollback, recursos, restricciones SQL, guards administrativos, CSRF y vista previa de solo lectura. La identidad autenticada se inyecta únicamente en ese servidor HTTP de prueba; los guards de roles y CSRF son los reales. El segundo diseño solo se registra dentro de esta prueba y nunca se inserta en la base local de desarrollo.

En el navegador local se verificaron el acceso administrativo normal, la navegación, la vista previa con los recursos reales y el guardado de la configuración original sin cambiar sus valores. Se comprobó la selección después de recargar, cerrar sesión y reiniciar el proceso del servidor, y el rechazo HTTP 401 de la vista previa sin sesión real. Las cinco pruebas del perfil cubren Chromium 320/375/430/escritorio y WebKit iPhone, con sus recursos de prueba habituales. Las capturas de revisión están en `output/playwright/` (artefactos locales).

La ejecución local de `migrate:local` también aplicó las migraciones pendientes del repositorio `20261014000000_bank_transfer_abuse_protection`, `20261015120000_customer_account_enablement` y `20261016120000_correos_tracking`. No se modificó su código ni se aplicaron migraciones a entornos remotos.

No se ha realizado despliegue. La migración debe aplicarse también al entorno de destino cuando se autorice publicar esta versión; no es suficiente copiar el frontend. Las funciones interactivas de cliente se verifican en el perfil, no en la vista previa de datos ficticios.

Revisión final antes del commit: 14 pruebas en cuatro suites, cinco pruebas de navegador del perfil, integración PostgreSQL/HTTP, TypeScript frontend/backend y compilación aprobadas. En el navegador local, a 1440 × 900 y 390 × 844, abrir, editar sin guardar, previsualizar, cerrar y reabrir solo generó GET; el original siguió activo y la respuesta administrativa completa, incluida la revisión, permaneció idéntica. Los artefactos de revisión y las bases temporales no forman parte del código entregado.
