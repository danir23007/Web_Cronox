# Clasificación visual y papelera de plantillas

Implementación local del 19/10/2026. Sin publicación del código, cambios remotos ni correos reales. La migración aditiva `20261019090000_mail_template_visual_classification` se ha aplicado únicamente a `cronox_dev` mediante el lanzador local protegido.

La comprobación local encontró que la tabla ya carecía de permisos públicos, pero tenía RLS desactivado. Una segunda migración aditiva, `20261019100000_mail_template_private_metadata`, activa RLS y mantiene la tabla sin concesiones a PUBLIC/anon/authenticated. No añade acceso público; el backend conserva su acceso administrativo. No se modifica ninguna migración ya aplicada.

## Uso

En Plantillas Mail → buzón → círculo, cada tarjeta tiene una papelera visible con nombre accesible y tooltip «Eliminar plantilla». El editor, tanto al crear como al abrir un borrador, muestra «Clasificación visual» antes del contenido:

| Opción | Etiqueta en tarjeta | Valor persistido |
| --- | --- | --- |
| Verde · Plantillas para todo | Para todo | `FOR_ALL` |
| Azul · Plantillas únicas | Única | `UNIQUE` |
| Morado · Plantillas diferentes | Diferente | `DIFFERENT` |

Seleccionar la opción y guardar el borrador. La duplicación conserva la clasificación inicial; después se puede cambiar independientemente. Las plantillas anteriores mantienen `NULL`, sin inferencias ni asignaciones automáticas. Este estado heredado no es una cuarta opción. La interfaz exige elegir una de las tres opciones al crear.

El servidor valida los valores y PostgreSQL añade una restricción equivalente. Los cambios de asunto, firma, carpeta o contenido conservan la clasificación omitida. El guardado explícito de contenido en varios círculos cambia la clasificación únicamente de la plantilla origen. Cambiar solo metadatos conserva incluso los bytes de HTML/texto importados: no vuelve a compilar el contenido. El renderizador y la selección de publicaciones no utilizan la clasificación; no se añaden correos ni disparadores.

## Eliminación y dependencias

La papelera consulta las dependencias actuales y abre un diálogo nativo con nombre, buzón, carpeta, publicación, campañas activas y versiones conservadas. Cancelar o Escape no escribe nada y devuelve el foco. Confirmar reutiliza `archive` con confirmación explícita y revisión optimista. El archivado es lógico: conserva documentos, versiones, snapshots, mensajes enviados y auditoría.

- Una publicación activa bloquea el archivado. El diálogo ofrece abrir el editor en Opciones avanzadas → Despublicar plantilla. Esta acción tiene su propia confirmación: retira exclusivamente las publicaciones de esa plantilla y los correos posteriores usan el respaldo configurado. La papelera nunca despublica automáticamente ni activa otra variante.
- Las campañas `SCHEDULED`/`PROCESSING` que contienen el ID exacto en el snapshot, una versión compartida o un contenido histórico también bloquean la operación. Se ofrece una ruta a Correo para gestionarlas explícitamente o esperar a su finalización. No se cancelan campañas desde las tarjetas.
- Una versión de familia sin campañas activas puede archivarse: la familia y los otros círculos se conservan; esta versión deja de estar disponible para nuevas campañas. Las referencias históricas permanecen.
- La creación del snapshot de campaña toma bloqueos compartidos de las plantillas de su familia. El archivado reclama la revisión antes de comprobar dependencias. Se prueban ambos órdenes de la carrera con PostgreSQL real: uno no puede invalidar silenciosamente al otro.
- El archivado de carpetas reutiliza estas comprobaciones y tampoco retira publicaciones silenciosamente.

Los permisos siguen siendo JWT + AdminGuard + RolesGuard con `SUPERADMIN`. Los cambios y archivados se registran en AuditLog por actor, acción e ID, sin almacenar contenido de correo. Los errores mantienen la tarjeta y el diálogo para revisar/reintentar; las revisiones se actualizan desde el servidor. Tras eliminar, se refrescan los contadores y se corrige la página si queda vacía.

## Comprobaciones reproducibles

```powershell
npm test --prefix cronox-backend -- --runInBand --testPathPatterns='email/managed|frontend/admin-mail|mailbox'
npm run test:mail-template-cards:db --prefix cronox-backend
npm run admin:typecheck
npm run build --prefix cronox-backend
```

Las pruebas de PostgreSQL crean y eliminan una base desechable en loopback, sin escribir en la base de origen ni disponer de transporte de correo. Comprueban la migración sobre datos anteriores, restricción de valores, privacidad de la tabla, persistencia, aislamiento, duplicación, HTML/texto intactos, publicación bloqueada, despublicación explícita, campañas actuales/heredadas, historia enviada, familias, concurrencia, contadores y auditoría.

Resultados finales: **2.882 pruebas / 269 suites** en la suite completa, **169 pruebas / 17 suites** focalizadas después del último cambio de guardado, y **10 grupos de comprobaciones** con PostgreSQL real. Typecheck del administrador y build del backend (incluida generación real de Prisma) correctos. El esquema generado tiene diff cero frente al esquema fuente. Las 70 plantillas de `cronox_dev` siguen sin clasificación asignada y ambas migraciones locales están aplicadas; la tabla tiene RLS y carece de concesiones públicas.

Validación en Chromium con el administrador y API reales en otra base desechable: clasificación tras guardar/recargar/cerrar sesión/entrar, duplicación y cambio independiente, cancelación y confirmación de papelera. HTTP: anónimo 401, usuario sin permisos 403 en lectura y archivado, valores inválidos/nulos 400 sin mutaciones. Se revisaron tarjetas, selector y diálogo en claro/oscuro y 1440/390 px, sin desbordamiento horizontal, con papelera de 44 px, foco dentro del diálogo y Escape. Contraste medido de textos/etiquetas/controles de tarjetas: mínimo 5,65:1 en claro y 7,38:1 en oscuro.

Evidencias locales ignoradas por Git: `test-results/mail-template-cards/results.json` y `output/playwright/mail-{cards,classification,delete}-{light,dark}-{desktop,mobile}.png`. La revisión desechable se cierra y elimina su base; el servidor local habitual conserva correo y trabajos desactivados.
