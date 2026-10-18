# METACRILATOS y Eventos QR — entrega local, 16/10/2026

Implementado en la arquitectura existente: frontend HTML/CSS/JS, administrador compilado con Vite/TypeScript y backend NestJS 11/Prisma 6/PostgreSQL. Se leyó íntegramente `metacrilatos-codex/PROMPT.md`. No había instrucciones adicionales en el repositorio; el `AGENTS.md` global localizado estaba vacío.

La aplicación queda disponible en **http://localhost:3000** mediante el lanzador protegido de desarrollo. No se ha realizado commit, push ni despliegue, ni cambios ni migraciones en producción. Al empezar, el único cambio del árbol era la carpeta de referencias sin seguimiento. Los cinco HTML aprobados y su manifiesto se conservan sin modificaciones.

Al finalizar la implementación inicial, la selección local continuaba en **original**, revisión **1**. Su fila, URL de imagen y configuración se compararon antes/después de la migración y de la revisión normal en navegador. Registrar METACRILATOS no modifica la selección global. Los ajustes posteriores conservan la selección que encuentren, sin volver a activar el diseño original.

## Ubicación y uso

1. Entrar en `http://localhost:3000/admin.html` con la cuenta local habitual. El acceso local está documentado en [local-development.md](local-development.md); las credenciales siguen en `.env.local`, sin copiarse a este informe.
2. **Multimedia → Acreditaciones → METACRILATOS → Configuración y vista previa**. Hay una única opción con un selector de círculo de muestra dentro de su preview. Se pueden revisar ambas caras y el giro sin guardar ni activar nada. El QR de muestra es inválido para eventos y no crea credenciales.
3. La acción existente **Activar** aplica la familia globalmente. Cada cliente obtiene su variante desde su círculo autoritativo. Las pruebas de activación/restauración se hicieron en una base desechable para mantener intacta la selección local habitual.
4. **Clientes → Eventos QR**: crear un grupo con nombre y descripción opcional, abrirlo y pulsar **Abrir cámara**. Cada QR válido registra directamente al cliente; la fila y el total se actualizan después de la respuesta del servidor.
5. Volver a escanear muestra **Ya registrado en este grupo**. El mismo cliente puede registrarse en otro grupo. **Detener escaneo**, cambiar de grupo/sección, ocultar la página o cerrar sesión libera la cámara. Puede seleccionarse otra cámara si hay varias.
6. Ante un fallo de red con resultado incierto, **Reintentar registro** reconcilia el resultado sin duplicar la inscripción. No se afirma que un registro no se guardó cuando la respuesta se ha perdido.

## Datos, identidad y diseño

| Dato | Fuente y comportamiento |
|---|---|
| Nombre | `User.firstName`, el campo de nombre editable del perfil. Espacios normalizados y máximo dos palabras. Sin concatenar `lastName`, sin usar `User.name` histórico, email o texto sustitutivo. Nulo/vacío mantiene el hueco. |
| Fecha | `User.createdAt` original, inmutable según el modelo existente. Formato DD/MM/AAAA en Europe/Madrid; entradas ausentes o inválidas quedan vacías. |
| Círculo | Reglas existentes de `CircleService`, sin cambios. Se rechazan valores fuera de 1–5; no se convierten silenciosamente a I/V. |
| ID visible estable | `User.identityUid`, UUID completo. Tanto `User.id` como `memberCode` se renumeran al borrar clientes, por eso no sirven como identidad permanente de esta tarjeta. |
| Identificador QR | `User.publicMemberToken` existente, con unicidad y reserva permanente de identidad. Se conserva byte a byte. No contiene credenciales de sesión ni datos personales. |
| Contenido nuevo | `CRX:1:<publicMemberToken>`. No inicia sesión ni autoriza acciones. El backend resuelve al usuario; el navegador no puede atribuir una inscripción enviando un `userId`. |
| QR anteriores | Se aceptan las URL antiguas solo si coinciden exactamente con el origen/ruta configurados de la API. No se navega ni se solicita ninguna URL escaneada. El endpoint gráfico original permanece intacto. |

Los cinco SHA-256 y tamaños coinciden con `MANIFEST.json`. Se extraen de forma reproducible las hojas de estilo específicas y los tres logos oficiales: no se unifican los contornos diferentes. Se conservan las dos líneas de I–III, la banda blanca aprobada de IV y el contorno original de V, los recortes, geometría, fuentes, colores, 68 paneles del canto y fórmulas de los reflejos. El color del logo largo coincide con el romano y el del símbolo pequeño con el texto de la etiqueta.

El renderer `CRONOX_METACRILATOS.mount(root, data)` ofrece `update`, `destroy` y `ready`. Las instancias tienen filtros SVG únicos y limpian animaciones, observadores, listeners y esperas de recursos. Las actualizaciones no acumulan anillos. El espacio completo se escala proporcionalmente; los campos largos ajustan solo su tipografía. El UUID completo también está disponible en el atributo de título del campo. Se mantienen giro manual/automático, arrastre y reducción de movimiento.

Los datos personales se obtienen mediante `GET /api/membership/me/accreditation`, autenticado y `private, no-store`; solo consulta la identidad de la sesión. El cliente descarta respuestas obsoletas y limpia QR/estadísticas al cambiar de usuario. Las vistas previas administrativas son de solo lectura y no ejecutan el código de cuenta del perfil.

El gráfico QR se genera en el servidor con la dependencia `qrcode` existente, PNG de 592 px, margen de cuatro módulos, corrección M y colores originales `#49212c`/`#e9d8c4`; cada variante conserva sus filtros CSS aprobados. No sale ningún identificador hacia generadores externos. Los reflejos permanecen debajo del QR opaco.

## Persistencia, permisos y cámara

Migración preparada y aplicada **solo en local**: `cronox-backend/prisma/migrations/20261016160000_metacrilatos_qr_events/migration.sql`.

- Inserta una sola fila `metacrilatos` con `ON CONFLICT DO NOTHING`, sin tocar `AccreditationSelection` ni la fila original.
- Provisiona únicamente tokens ausentes y añade un valor por defecto para usuarios nuevos mediante `gen_random_uuid()` compacto: 32 caracteres hexadecimales, 122 bits aleatorios. Se conserva la generación segura alternativa del servidor para cuentas antiguas sin token; su provisión concurrente está serializada.
- Añade `QrEventGroup` y `QrEventParticipant`. La restricción única es `(groupId, userIdentityUid)`, equivalente estable a grupo/usuario.
- La inscripción usa `INSERT ... ON CONFLICT DO NOTHING` mediante Prisma dentro de una transacción real. Los reintentos no actualizan la fecha, círculo ni administrador originales.
- Relaciones a usuarios por UUID con `ON DELETE SET NULL`: borrar una cuenta conserva un registro anónimo con círculo/fecha y total histórico, pero elimina el acceso a su nombre, UUID y QR. No se guardan copias personales en las inscripciones. El grupo con participantes no se elimina por cascada.
- El inventario existente de propiedad de datos también comprueba las nuevas referencias UUID. El bloqueo HTTP existente de renumeración protege la identidad durante toda la solicitud autenticada.

Todas las rutas `/api/admin/qr-events` requieren JWT/sesión vigente y ADMIN/SUPERADMIN; los POST pasan por CSRF y validación/límites de entradas existentes. Los listados tienen búsqueda y paginación. La tabla conserva el círculo y primer instante de inscripción y muestra también al administrador autor. Las fechas se almacenan como instantes PostgreSQL y se presentan en Europe/Madrid.

La cámara se solicita solo por botón, con `audio: false` y preferencia por la trasera. Hay estados de permiso pendiente/denegado, ausencia de cámara, cámara ocupada y contexto inseguro. Los streams que llegan después de cancelar una solicitud también se detienen. Las imágenes solo se procesan en memoria en el navegador, sin almacenarse ni subirse.

Se detecta soporte real de QR en `BarcodeDetector`; el lector alternativo es **zxing-wasm 3.1.5**, empaquetado localmente con su WASM y licencias. Durante las pruebas se detectaron fallos en el lector JavaScript probado inicialmente y se sustituyó por este motor; no fue necesario alterar el diseño ni los colores. No se carga el CDN por defecto del paquete. La CSP permite `wasm-unsafe-eval` exclusivamente en `/admin.html`, sin habilitar `unsafe-eval`; esa misma página permite `camera=(self)` y sigue bloqueando el micrófono. El resto conserva la política anterior.

## Archivos principales

| Área | Archivos |
|---|---|
| Renderer y referencias | `cronox-front/assets/metacrilatos.js`, `metacrilatos.css`, `metacrilatos/{symbol,wordmark,eye}.png`; `metacrilatos-codex/extract-assets.cjs`, `verify-qr-reader.cjs` |
| Perfil/selector/preview | `cronox-front/profile.html`, `assets/profile.js`, `accreditation-designs.js`, `accreditation-preview.js`, `admin-accreditations.js`; backend `src/accreditations/*` |
| Eventos e integración admin | `cronox-front/admin.html`, `admin-user.html`, `admin-launch.html`, `assets/admin.js`, `admin-navigation.js`, `admin-qr-events.js/css`; backend `src/admin/qr-events/*`, `src/app.module.ts` |
| Identidad y datos | Backend `src/membership/accreditation-identity.ts`, `membership.controller.ts`, `membership.service.ts`, `membership.module.ts`, `src/users/users.service.ts`, `prisma/schema.prisma`, migración, `scripts/user-numbering-ownership.cjs` |
| Seguridad/compilación | Backend `src/main.ts`, `src/common/config/content-security-policy.ts`; frontend `src/admin/qr-reader.ts`, licencias, `vite.qr-scanner.config.ts`, `assets/qr-reader.js`, `zxing_reader.wasm`; paquetes/locks, `.gitignore` para evidencias generadas |
| Pruebas | `tests/accreditation-mobile/metacrilatos-*.spec.cjs`, `normal-local-flow.cjs`; backend `scripts/test-qr-events-db.cjs`, pruebas de identidad/CSP/frontend y actualización de expectativas del menú |

## Comprobaciones y reproducción

Resultados finales:

- **40/40 pruebas de navegador**: acreditación original, perfil integrado y renderer, Chromium 320/375/430/escritorio y WebKit con iPhone 13 simulado. Ambas caras de los cinco círculos comparadas con referencias, nombres/fechas/UUID, anillos, recursos fallidos/reintentos, múltiples instancias y desmontaje. Se decodifican capturas del QR realmente mostrado con tokens de 32 y 64 caracteres; también dentro de un contenedor de solo 240 px.
- **63/63 pruebas focalizadas Jest** en seis suites: identidad, CSP, estados/cámara de eventos, aislamiento de preview/perfil y regresiones de acreditación. Incluyen respuestas tardías tras cambio de identidad y limpieza tras fallo de recursos.
- **PostgreSQL real desechable**: dos conexiones independientes, 12 escaneos simultáneos, exactamente una inscripción y 11 respuestas de duplicado; reintentos conservan primer autor/fecha/círculo. JWT, sesiones revocadas, roles, CSRF, entradas malformadas, aislamiento por usuario, borrado/renumeración y bloqueo concurrente de identidad verificados sin mocks de concurrencia.
- Pruebas anteriores de base de datos de acreditaciones y pruebas de navegación/UI pasan. Compilación de backend y administrador, ambos typechecks, ESLint focalizado del backend, comprobación de sintaxis y `git diff --check` pasan.
- **151/151 códigos sintéticos** del corpus reproducible se decodifican con colores aprobados; la investigación adicional incluyó 166 casos sin fallos con el motor final.
- **Aplicación normal en localhost, sin respuestas API simuladas**: login real, previews con CSP real, creación de dos grupos, QR personal real leído desde un stream de cámara simulado, duplicado, parada/reapertura, recarga, segundo grupo y segunda sesión independiente. Los grupos sintéticos se limpiaron; selección e imagen originales permanecieron iguales. Sin errores JavaScript en ese recorrido.

Comandos desde la raíz:

```powershell
node metacrilatos-codex/extract-assets.cjs --check
node metacrilatos-codex/verify-qr-reader.cjs
npm run admin:typecheck
npm run admin:build
npm run typecheck --prefix cronox-backend
npm run build:compiled --prefix cronox-backend
npm run test:qr-events:db --prefix cronox-backend
npm run test:accreditations:db --prefix cronox-backend
npm run test:accreditation:browser
node tests/accreditation-mobile/normal-local-flow.cjs
```

La última prueba requiere el servidor local normal arrancado. Lee las credenciales exclusivamente de `.env.local`, crea grupos con un UUID de prueba y limpia solo esos grupos. `test:qr-events:db` comprueba loopback y crea/elimina su propia base desechable. No ejecutar migraciones generales con un entorno heredado de producción: para aplicar esta migración en otra copia local, usar `npm run migrate:local --prefix cronox-backend`. Para regenerar Prisma en Windows, detener antes el proceso local que tenga cargada su DLL; después `npm run build --prefix cronox-backend` y `npm run start:local --prefix cronox-backend`.

Evidencias generadas, conservadas localmente y excluidas de Git: `output/metacrilatos/{backend-results,local-migration,normal-browser}.json`, captura `normal-admin-preview.png`, logs del servidor local y capturas por círculo/cara/tamaño en `output/playwright/metacrilatos-*.png`. La prueba de migración comparó exactamente las filas originales; su JSON se reconstruyó después de que Playwright limpiara la primera carpeta de resultados, circunstancia indicada en el propio informe.

## Validación física pendiente

No se ha probado una cámara física ni un iPhone/Android físico. WebKit simulado y vídeo de canvas verifican software y decodificación, pero no óptica, enfoque, reflejos del entorno ni comportamiento real de los permisos del sistema.

En un origen **HTTPS de pruebas** accesible desde los móviles, abrir Eventos QR con un administrador y mostrar la acreditación en un segundo dispositivo. Revisar Chrome/Android y Safari/iPhone: permitir/denegar/cancelar permiso, trasera y cambio de cámara, lectura de los cinco reversos al tamaño normal, repetición y siguiente persona, parada/reapertura, cambio de grupo y salida/cierre de sesión. Probar un corte de red tras leer y el reintento, y escanear simultáneamente desde dos administradores. Confirmar un solo registro por grupo, primer autor/fecha intactos y ausencia del indicador de cámara al salir. Mantener estas pruebas fuera de producción y restaurar la selección original tras una activación temporal local.

## Ajuste posterior del giro y control único

El renderer compartido `cronox-front/assets/metacrilatos.js` inicia el giro cuando sus recursos están listos y la instancia es visible, tanto en el perfil como en la vista previa. Conserva la dirección y velocidad anteriores (21°/s), la transición cúbica de 650 ms y todos los cálculos de reflejos. El CSS, las dimensiones, los cinco diseños y la protección del QR no se han modificado.

El botón nativo centrado **Ver reverso / Ver anverso** conserva su texto y transición. Desde el ajuste del 18/10/2026, presenta la cara solicitada y la mantiene visible durante **5 segundos completos desde que termina de colocarla**, tanto con ratón como con interacción táctil. Otra pulsación cancela la transición/espera anterior y comienza el nuevo movimiento desde la orientación actual. Si hay un gesto activo, este conserva el control: una activación simultánea del botón no deja un movimiento pendiente.

Un único bucle de animación coordina giro y transición. Pulsar la tarjeta cancela ambos y cualquier espera anterior, conservando su orientación. Mientras se mantiene el gesto no hay reanudación. Con ratón, soltar, cancelar o perder la captura inicia una espera de **5 segundos**. Con toque o lápiz, se reanuda **inmediatamente**, sin temporizador y sin modificar los ángulos dejados por el gesto; también un simple toque cancela la pausa anterior del botón. La decisión utiliza el `pointerType` registrado al comenzar, no el ancho ni la capacidad táctil del dispositivo, y sirve en equipos híbridos. Pasar el cursor no cambia el plazo. Cada instancia mantiene como máximo un temporizador y un identificador de generación descarta callbacks antiguos.

Ocultar la página o la tarjeta suspende la animación y conserva el plazo de inactividad cuando existe. Cancelar un gesto táctil al ocultarse no crea una espera: al volver continúa desde su orientación. Una transición suspendida se completa antes de comenzar los cinco segundos. Se mantiene el movimiento reducido: sin giro automático y con cambio de cara inmediato; al activar esa preferencia durante una transición, se coloca la cara y se cuenta la pausa desde ese momento. Desmontar cancela animación, espera, captura y observadores/listeners. Abrir una instancia nueva inicia un giro nuevo.

El renderer pasa a `v=7` en `cronox-front/profile.html`, `cronox-front/metacrilatos-preview.html` y la referencia inyectada por `cronox-backend/src/accreditations/accreditations.controller.ts`. No se modifica el libro original, Eventos QR, datos, selección activa ni configuración guardada. No se añaden dependencias ni migraciones. El trabajo permanece local, sin commit, push ni despliegue de este ajuste.

Verificación de este ajuste: **62 pruebas correctas en cuatro suites**, de las que **45** corresponden a `metacrilatos-motion.dom.spec.ts` con JSDOM y reloj controlado. Cubren cinco círculos, límites exactos de cinco segundos, continuidad táctil/lápiz, gesto prolongado, captura fallida/perdida, cancelación, blur, pulsaciones rápidas, equipos híbridos a 390/1440 px, varias instancias, ocultación, movimiento reducido dinámico, redimensionamiento y desmontaje/reapertura. Las regresiones de integración comprueban identidad/QR y coexistencia con el libro.

Navegador mediante Playwright CLI: **seis recorridos correctos** con las plantillas/scripts reales de perfil y preview, combinando escritorio, móvil emulado y dispositivo híbrido en Chromium. Las API están completamente interceptadas con datos ficticios; no se inicia sesión en producción ni se comprueba aquí la configuración persistida del servidor. Se verifica botón repetido, pausa desde fin de transición, ratón mantenido más de cinco segundos, toque/arrastre mediante CDP, reanudación sin salto, toque simple y cancelación/pérdida de captura sintéticas. Se conservan ID/QR y movimiento reducido. Un recorrido adicional de preview con **reloj real** mantiene la cara sin cambio durante 4.810 ms y observa la reanudación a los **5.025 ms** desde su colocación; comprueba también arrastre y reanudación táctil inmediata. Pasan el typecheck del backend, sintaxis JavaScript y `git diff --check`.

La suite existente `tests/accreditation-mobile/metacrilatos-motion.spec.cjs` actualiza sus expectativas al nuevo contrato y añade regresiones táctiles/lápiz híbridas. No se ha repetido su matriz completa Chromium/WebKit en este ajuste; las ejecuciones de navegador indicadas arriba son las de CLI y Chromium, con reloj controlado salvo el recorrido real especificado.

Para repetir las pruebas focalizadas desde la raíz:

```powershell
npm test --prefix cronox-backend -- --runInBand src/frontend/metacrilatos-motion.dom.spec.ts src/frontend/metacrilatos-integration.dom.spec.ts src/frontend/accreditation-designs.dom.spec.ts src/frontend/profile-accreditation-mobile.dom.spec.ts
npm run test:accreditation:browser
```

Los artefactos locales de esta revisión están en `output/playwright/metacrilatos-motion/`, incluidas las capturas de ambos consumidores, el harness reproducible y `real-clock-result.log`. Las comprobaciones históricas con login y datos locales de la revisión anterior no se presentan como una nueva validación autenticada de este ajuste.

Queda la comprobación física en Safari/iPhone, Chrome/Android y, si se dispone, un equipo híbrido con lápiz. En perfil y preview, mantener un dedo más de cinco segundos, arrastrar y comprobar la reanudación inmediata desde el ángulo dejado; repetir con un toque simple, cancelar/desplazarse y manipular durante la pausa del botón. Comprobar que solo el botón mantiene la cara cinco segundos desde su colocación, además de ocultar/volver y movimiento reducido del sistema.

## Información del miembro alrededor del metacrilato

La composición del perfil METACRILATOS incorpora círculo, privilegios e historial a la derecha en escritorio y debajo de la tarjeta y su control en móvil. En móvil, «Volver a la tienda» cierra el contenido. Se conservan la cabecera, las pestañas y los 24 px de desplazamiento del control aprobados anteriormente. La captura mencionada en la petición no estaba incluida en los adjuntos disponibles; la composición sigue las medidas, jerarquía y estética descritas en el texto.

Archivos de producto: `cronox-front/profile.html`, `cronox-front/assets/metacrilatos-profile.css` y `cronox-front/assets/profile.js`. Los estilos quedan limitados al perfil METACRILATOS. El renderer compartido, sus recursos, las vistas del administrador, el libro, Eventos QR y la selección guardada no se modifican en este ajuste.

El círculo exterior procede de la instancia montada con la respuesta autorizada de `/api/membership/me/accreditation`. Los privilegios reutilizan exactamente `ACCREDITATION_PRIVILEGES` y su función de presentación del libro. Las tres cifras proceden del mismo `GET /api/membership/me/stats`, con `JwtAuthGuard` y `CurrentUser('id')`: `MembershipService.getMyStats` llama a `HistorialService.calculatePurchaseStats(userId, prisma, false)`, sin paginación. Pedidos reembolsados cuentan como pedidos realizados pero no aportan unidades o productos retenidos; se mantienen compras presenciales y el resto de criterios anteriores. No se han cambiado reglas comerciales, cálculos ni endpoints.

La tarjeta se muestra al terminar de montar, mientras el historial mantiene su estado independiente de carga. El error ofrece un reintento local; respuestas incompletas o inválidas nunca se convierten en cero. El cero solo se muestra cuando el servidor lo devuelve. El reintento actualiza las cifras sin remontar la tarjeta ni modificar su orientación o espera de giro. Un contador de peticiones y la identidad activa impiden que respuestas antiguas actualicen una vista cerrada, reabierta o de otro usuario.

Pruebas añadidas: `src/frontend/metacrilatos-member.dom.spec.ts` (16 casos), `src/membership/member-composition.contract.spec.ts` (6 casos), ambos en `cronox-backend`, y `tests/accreditation-mobile/metacrilatos-details.spec.cjs` (15 ejecuciones en cinco proyectos). Se actualiza una expectativa de `metacrilatos-integration.dom.spec.ts` para comprobar que el historial pendiente ya no bloquea el 3D. Las siete suites Jest focalizadas y de regresión pasan: 44 pruebas. Las 15 comprobaciones nuevas de navegador pasan en Chromium de escritorio y 320/375/430 px y WebKit iPhone 13 simulado: cinco círculos, datos autorizados, ceros, carga/error/reintento, listas largas, ausencia de desbordamiento, giro completo e inclinación sin contacto con el control o la información. Los casos de espera usan reloj controlado y respuestas API simuladas.

Además, en `http://localhost:3000` se comprueban login, datos y base local reales, equivalencia con las cifras y privilegios del libro, una vuelta completa con reloj real, cambio de cara por teclado y reanudación tras 7 segundos. La selección y la configuración original se comparan antes/después y permanecen intactas. Evidencias locales ignoradas por Git: `output/metacrilatos/member-normal-browser.json`, `output/playwright/member-local-{desktop,mobile}.png` y `output/playwright/metacrilatos-details-*.png`. Se verifican de nuevo los cinco hashes aprobados y los cuatro activos extraídos. No hay pruebas con teléfonos físicos; los tamaños móviles y los gestos son simulados.

Se ejecutan también 14 regresiones de navegador del libro, perfil, vistas previas y movimiento: **29 casos de navegador aprobados** en total, sin contar repeticiones. La inspección visual detecta una limitación previa en WebKit sin interfaz: representa el reverso reflejado en la orientación inicial. Se reproduce en los cinco HTML aprobados cargados directamente, sin el perfil ni el renderer compartido, y ya aparece en las capturas anteriores a este cambio. Evidencia: `output/playwright/metacrilatos-approved-webkit-{1..5}-front.png`. Las pruebas de datos, geometría y temporizadores pasan en ese motor, pero no equivalen a validar visualmente ambas caras en Safari físico. No se modifica el diseño aprobado para corregir una incidencia ajena a esta composición; Chromium muestra las caras correctamente.

```powershell
npm test --prefix cronox-backend -- --runInBand src/frontend/metacrilatos-member.dom.spec.ts src/membership/member-composition.contract.spec.ts src/frontend/metacrilatos-integration.dom.spec.ts src/frontend/accreditation-designs.dom.spec.ts src/frontend/profile-accreditation-mobile.dom.spec.ts src/membership/membership.service.spec.ts src/historial/historial.service.spec.ts
npx playwright test metacrilatos-details.spec.cjs --config playwright.accreditation.config.cjs
```

## Ajuste a la captura aprobada recibida posteriormente

Con la referencia visual ya disponible, se ajusta únicamente `metacrilatos-profile.css` y se incrementa su versión de carga en `profile.html` a `v=2`. La composición de escritorio ocupa 690 px: columna izquierda de 336 px, separación de 40 px y columna informativa de 314 px. Así reproduce los aproximadamente 73 px visibles entre la tarjeta y el texto de la captura sin reducir el 3D. Las dos columnas caben desde 760 px; por debajo se conserva el orden apilado y el enlace a la tienda al final. La cabecera, navegación y título de cuenta actuales permanecen intactos.

Se mantienen los títulos serif de 42/36 px; se afinan alineación superior, separación de indicadores, filas de privilegios, tonos exteriores y marcadores de fondo oscuro (burdeos en V). Las cifras del historial quedan en 24 px y las etiquetas en 11 px con dos líneas. El enlace de escritorio se ancla a la altura del bloque izquierdo mediante filas de grid independientes de la altura informativa. Los privilegios reales se conservan completos, incluida «Acreditación roja», ausente en la captura de ejemplo.

Comprobaciones focalizadas de este ajuste: 15/15 pruebas de composición en Chromium 320/375/430/escritorio y WebKit iPhone 13 simulado; comparación visual de las capturas y verificación adicional a 778/760/759 px. Giro completo e inclinaciones conservan al menos 19,99 px hasta el botón y 59,14 px hasta la información en dos columnas. Aumentar la información a 900 px de altura no desplaza el enlace izquierdo. No se han añadido pruebas persistentes ni cambiado lógica de datos, renderer, administrador o Eventos QR. Los hashes del renderer, sus estilos, `profile.js`, adaptador, preview y script de Eventos QR permanecen idénticos; las referencias y los cuatro activos extraídos siguen verificados.

La revisión de localhost usa sesión y datos reales; las capturas finales son `output/playwright/reference-final-desktop.png` y `output/playwright/reference-final-mobile.png`. La captura de comparación V con datos de prueba está en `output/playwright/reference-layout-778.png`; las medidas, en `output/playwright/reference-breakpoint-results.json`. Se mantiene expresamente la incidencia previa del reverso espejado en WebKit documentada arriba. No se han probado dispositivos físicos ni modificado el renderer para esta incidencia. Todo queda local, sin commit, push ni despliegue.

## Ampliación proporcional de escritorio, pie e indicadores

La vista personal METACRILATOS incorpora un contenedor exterior en `profile.html`, los estilos específicos de `metacrilatos-profile.css?v=3` y el adaptador `metacrilatos-profile.js?v=1`. A partir de 760 px, el adaptador mide el ancho útil, la posición real del contenido después de cabecera/título/navegación, su altura natural, el pie y los márgenes. Aplica el mayor factor proporcional que cabe en ambos ejes, sin límite máximo fijo. Los 690 px anteriores son ahora la base de cálculo, no un máximo visible. El zoom CSS exterior reserva dimensiones reales y mantiene la rasterización de textos y QR al tamaño mostrado; no sobrescribe ninguna transformación del renderer.

El tamaño anterior es el mínimo de legibilidad: si la composición no cabe en altura a escala 1, se permite desplazamiento vertical. Esto ocurre también en 1366×768, donde conservar cabecera, navegación y proporciones deja menos altura que la composición original. En la cuenta local real del círculo II se obtiene ×1,2785 a 1920×1080 y ×1,8412 a 2560×1440 y 3440×1440. El círculo V, con más privilegios, obtiene ×1,2019 y ×1,7358 respectivamente. El cálculo depende del contenido real de cada usuario.

La cabecera, «Mi cuenta» y las pestañas conservan su geometría. El pie queda fuera del contenido ampliado, en flujo normal mediante flex, con 10 px a la izquierda y abajo cuando todo cabe. Cuando falta altura, aparece después del contenido. No hay capa fija ni superposición. El redimensionado, los cambios de contenido y la carga de fuentes agrupan la medición en un único frame, sin remontar el metacrilato, alterar su orientación o reiniciar su espera. Salir de esta vista o pasar a móvil retira las reglas de escritorio; `pagehide` cancela el trabajo y desconecta observadores/listeners, y `pageshow` permite restaurar la página.

Los cinco indicadores conservan siempre su color propio: I/II `#000`, III `#878f94`, IV `#fff`, V `#9a1c36`, tomados de los tonos aprobados. Se ajusta el contraste del número y se conserva la distinción del círculo actual con su tamaño y un contorno adicional, sin cambiar el relleno. Siguen siendo elementos informativos. Estos colores se aplican también en móvil; su tamaño y distribución anteriores permanecen iguales.

Verificación de este ajuste:

- **70 pruebas Jest aprobadas** en cuatro suites: ajuste exterior (17 casos nuevos), datos del miembro, integración y temporizadores/transiciones de giro. Incluyen medidas de cabecera/pie, ausencia de máximo, resize con escala previa, limpieza de observadores, móvil, libro, carga y restauración de página.
- **25 pruebas de navegador aprobadas y cuatro omisiones intencionadas** de un caso exclusivo de escritorio: las suites `metacrilatos-fit` y `metacrilatos-details`, más regresiones de libro y preview del administrador en Chromium y WebKit. Los datos y relojes de estas suites son simulados. Se comprueban los colores para los cinco círculos, gesto mantenido durante más de 7 segundos, espera desde soltar, arrastre en coordenadas ampliadas, resize sin remontaje ni cambio de orientación y QR ampliado decodificable.
- Comparación visual y geométrica en 1366×768, 1920×1080, 2560×1440, 3440×1440, ventana baja 1366×480 y móviles de 320/375/430 px. El escenario equivalente a zoom 200 % usa viewport 960×540 y DPR 2; no es una prueba del control de zoom nativo del navegador. Las coordenadas y dimensiones móviles de tarjeta, botón, información, historial, enlace y pie coinciden exactamente con la línea base. El barrido de 360° y las inclinaciones ±32° mantienen al menos 19,99 px hasta el botón en la base y 34,70 px en la composición grande, sin desbordamiento horizontal.
- En `http://localhost:3000`, con sesión, datos y base local reales, se verifican una vuelta completa con reloj real, cambio de cara por teclado y reanudación tras 7 segundos. Se decodifica el QR personal desde una captura del reverso ampliado y se compara en memoria con su gráfico original, sin guardar el identificador decodificado en informes. Las cifras/privilegios coinciden con API/libro; la selección guardada y la fila del diseño original son idénticas antes y después.
- Sintaxis del adaptador, `git diff --check`, cinco hashes de referencias y cuatro activos extraídos correctos. Los hashes de `metacrilatos.js`, `metacrilatos.css`, `profile.js`, adaptador de diseños, preview y Eventos QR permanecen idénticos a los del inicio del ajuste.

Evidencias locales ignoradas por Git: `output/playwright/autoscale-before.json`, `output/playwright/autoscale-visual-results.json`, `output/metacrilatos/autoscale-local-browser.json`. Las capturas finales con la cuenta local real están en `output/playwright/autoscale-final-desktop.png` (1920×1080), `autoscale-final-large.png` (2560×1440) y `autoscale-final-mobile.png` (375 px). Las capturas por tamaño del círculo V usan datos controlados de prueba. Durante la revisión, la herramienta de presentación de imágenes omitió visualmente regiones repetidas; la inspección de píxeles y de recortes de los PNG confirmó que los archivos completos eran correctos. No se añadió aislamiento ni recorte de pintura al producto por ese artefacto.

Se mantiene la incidencia previa del reverso espejado en WebKit documentada anteriormente; este ajuste no modifica el renderer. No se han utilizado teléfonos, cámaras ni otros dispositivos físicos. Sin cambios de dependencias, backend, migraciones, selección activa, libro, administrador o Eventos QR. Todo queda en local, sin commit, push ni despliegue.

```powershell
npm test --prefix cronox-backend -- --runInBand src/frontend/metacrilatos-profile-fit.dom.spec.ts src/frontend/metacrilatos-member.dom.spec.ts src/frontend/metacrilatos-integration.dom.spec.ts src/frontend/metacrilatos-motion.dom.spec.ts
npx playwright test tests/accreditation-mobile/metacrilatos-fit.spec.cjs tests/accreditation-mobile/metacrilatos-details.spec.cjs --config=playwright.accreditation.config.cjs
npx playwright test tests/accreditation-mobile/metacrilatos-profile.spec.cjs tests/accreditation-mobile/metacrilatos-motion.spec.cjs --grep 'preserves the original renderer|preview: all five' --project=chromium-desktop --project=webkit-iphone-13 --config=playwright.accreditation.config.cjs
```

## Presentación compartida y compatibilidad · 17/10/2026

La nueva petición autoriza publicar el trabajo pendiente. El enlace «Volver a la tienda» pasa a una fila inferior que abarca ambas columnas y queda centrado respecto al conjunto y al ancho útil de la página. Su texto pasa de 12 a 10,5 px (−12,5 %), manteniendo un área de pulsación de al menos 44 px. En móvil cierra el contenido. Se conserva la escala de tarjeta, información y control; el contenedor reserva la altura real de la nueva fila. Cuando esa fila no cabe en la altura disponible, el pie continúa después del contenido, a 10 px del borde inferior del documento, sin superponerse ni reducir el resto de la composición.

`metacrilatos-presentation.js` contiene una única plantilla informativa y las mismas listas de privilegios que usaba el libro. Perfil y preview comparten esa plantilla, estilos y adaptación de escala. El perfil mantiene sus endpoints y estados autorizados de historial; la preview recibe únicamente datos ficticios desde su endpoint protegido y presenta estadísticas coherentes por círculo. El documento mínimo `metacrilatos-preview.html` no carga la página de cuenta, datos personales, consentimiento, analítica ni promociones. El pie queda dentro del documento previsualizado y fuera de su bloque escalado. El selector de anchura cambia su propio viewport; nunca se calcula la escala respecto a toda la ventana administrativa.

Cambiar el círculo actualiza tarjeta, título, indicadores, acentos, privilegios e historial de muestra. El cambio de anchura conserva la instancia y orientación. Cerrar la preview destruye el renderer y sus listeners; reabrir genera una única instancia nueva. La presentación no hace peticiones ni monta renderers por su cuenta. Abrir y manipular la muestra no guarda configuración ni activa diseños; permanecen los controles explícitos de guardar/activar.

La incidencia visual histórica de WebKit queda reproducida mediante un ejemplo independiente de dos caras: WebKit 26.6 en Windows informa `backface-visibility:hidden`, pero pinta la cara opuesta reflejada. La corrección mínima de integración aplica `visibility:hidden` a la cara cuyo `aria-hidden` ya es `true`, reutilizando el estado visible calculado por el renderer. No modifica ángulos, geometría, cantos, reflejos, recursos ni temporizadores. Está recogida en el generador y en el CSS generado; los cinco HTML originales conservan sus hashes.

Validación de compatibilidad: 65 orientaciones en Chromium (13 ángulos y diversas inclinaciones por cada círculo) presentan cero diferencias en los bytes RGB con/sin la regla. Los cinco anversos y reversos de WebKit se presentan correctamente; los QR renderizados se decodifican sin reflejo (`isMirrored=false`) en ambos motores. Las 35 ejecuciones de renderer y 31 pruebas unitarias de giro pasan. Es una corrección comprobada en motores automatizados; Safari/iPhone físicos siguen sin verificarse.

La comprobación de `localhost:3000` con login y base reales revisa diez combinaciones de muestra (cinco círculos por dos anchuras), equivalencia de indicadores/privilegios, texto y área del enlace, ausencia de desbordamiento, resize sin remontaje y cierre/reapertura. No se observa ninguna petición de escritura de acreditaciones, y se comparan íntegramente antes/después todas las filas de diseños y selección. El perfil mantiene el círculo real. Informe privado: `output/metacrilatos/release/local-presentation-qa.json`; capturas `output/playwright/release-{profile,preview}-{desktop,mobile}.png` y `release-admin-complete.png`.

Se actualizan las referencias de caché y los controles de CI para verificar también los hashes de las referencias y los activos extraídos. El verificador de optimización de imágenes admite únicamente los tres PNG aprobados de METACRILATOS y conserva el rechazo de otras imágenes no autorizadas. La clasificación del documento de preview evita exigirle scripts de analítica propios de las páginas públicas.

El usuario confirma conservar el tamaño actual cuando la nueva fila inferior no cabe en la altura visible: se permite desplazamiento vertical y el pie sigue al contenido, fuera del bloque escalado.

Regresión final de navegador: **86 pruebas aprobadas, nueve omisiones intencionadas y cero fallos**. Las omisiones corresponden a cuatro ejecuciones del ajuste exclusivo de escritorio, cuatro repeticiones del recorrido de reloj real (comprobado una vez en escritorio) y el protocolo táctil de Chromium no disponible en WebKit. Pasan también los typechecks, ambas compilaciones, 151 casos de lectura QR, las pruebas de exportaciones y el ensayo de Eventos QR contra una base local desechable, incluida concurrencia y conservación de identidad. La suite general inicial identificó dos expectativas antiguas (versión fija de caché y clasificación de la nueva plantilla); ambas se corrigieron y sus suites focalizadas pasan. CI vuelve a ejecutar la suite general sobre el commit publicado.

## Columna compacta, STATUS e ID de administración · 17/10/2026

La presentación compartida muestra literalmente **TU STATUS EN CRONOX** en perfil y preview, tanto en escritorio como en móvil. Solo en escritorio se reduce la columna informativa al 90 % y se compactan sus márgenes y filas de privilegios. Todos los textos y cifras permanecen completos. Se mide momentáneamente la misma columna con su espaciado anterior, antes de pintar, para conservar exactamente la escala exterior aprobada del 3D; no se duplica la plantilla ni se remonta el renderer. El espacio inferior se calcula desde el último contenido visible, incluidos avisos de promoción, dejando 5 px base antes del área del enlace. El ajuste no mueve el metacrilato ni su botón ni modifica la barra de Mi cuenta.

En 1440×900, 1920×1080 y 2560×1440 caben la composición completa, el enlace pequeño centrado y el copyright con 10 px de margen inferior e izquierdo. En el círculo V, el historial completo termina antes del borde inferior del botón: 908,61 ≤ 929,48 px a 1920×1080 y 1210,09 ≤ 1243,36 px a 2560×1440. El móvil conserva sus medidas y distribución.

**Límite de altura comunicado:** a 1366×768, el botón aprobado ya terminaba en y=810,875 px incluso sin la columna derecha. No es posible añadir debajo el enlace y el pie dentro de 768 px conservando simultáneamente tamaño del 3D, posición del botón y barra superior. Se mantiene desplazamiento vertical cuando la altura es insuficiente, sin recortar contenido ni bloquear scroll. No se declara ese tamaño como encajado: el ajuste solicitado reduce texto, indicadores y espacios de información, conservando la tarjeta y su control.

La etiqueta del reverso recibe ahora un campo explícito `registrationNumber`, tomado del `User.id` actual por `GET /api/membership/me/accreditation`. Coincide con el N.º de Clientes → Usuarios y usa el mismo formato decimal de entero positivo seguro. La respuesta mantiene por compatibilidad `visibleId: identityUid`; ese UUID ya no se imprime. No se sustituye un número ausente por un UUID, memberCode, token o posición de fila. La muestra administrativa usa el número ficticio 23 y mantiene su QR sin validez.

La autorización sigue resolviendo el usuario desde `JwtAuthGuard` y `CurrentUser('id')`. La adaptación de perfil entrega la respuesta íntegra al renderer; no usa datos globales de otro usuario. `identityUid`, `publicMemberToken`, payload y gráfico del QR, relaciones e inscripciones no cambian. Las reglas existentes de renumeración quedan intactas: al recargar se obtiene el número actual, conservando el mismo QR. No se modifica el esquema ni se añade ninguna migración.

La prueba con PostgreSQL desechable compara cuatro usuarios con `AdminUsersService.listUsers`, y repite la comparación después de una renumeración real, exigiendo payload y PNG QR idénticos. Los contratos unitarios comprueban el campo, la autorización, entradas inválidas y recarga sin cambio de identidad. La rasterización se simula únicamente en la prueba unitaria del servicio para evitar depender de tiempos de CPU; la integración con base y HTTP conserva la comparación de PNG reales.

En localhost con sesión y base reales se comprueban las diez combinaciones de preview (cinco círculos y dos anchuras), STATUS, número ficticio, perfil autorizado y correspondencia con la lista administrativa. Se comparan todos los números, identidades y tokens locales y todas las configuraciones/selección antes y después; no cambian. Las pruebas visuales y táctiles se realizan con motores automatizados, sin dispositivos físicos.

Referencias de caché: renderer `v=4`, presentación `v=2`, estilos de composición `v=5`, ajuste exterior `v=3` y preview `v=5`. Los recursos aprobados, CSS interno, giro, pausa de siete segundos, protección del QR y corrección WebKit permanecen intactos. Antes de esta publicación, producción ya tenía METACRILATOS activo por elección del usuario; se conserva esa selección, sin copiar valores locales.

Validación local final: 249 suites y 2.596 pruebas generales aprobadas, typechecks y compilaciones correctos, y auditoría visual de 80 combinaciones de perfil/preview, cinco círculos y ocho tamaños. Los 80 QR se decodifican sin reflejo. La comparación contra la versión anterior no encuentra diferencias superiores a 0,5 px en tarjeta, botón, cabecera o navegación de escritorio ni en la geometría móvil completa. Los informes y capturas permanecen ignorados bajo `output/playwright/status-id-*` y `output/metacrilatos/release/status-id-*`.

## Corrección del ID público: memberCode · 17/10/2026

Esta instrucción sustituye expresamente la decisión anterior de imprimir `registrationNumber`. La etiqueta del reverso de METACRILATOS muestra ahora el **`memberCode` almacenado**, mediante `CRONOX_USER_IDENTITY.format(data)` de `assets/user-identity.js`. Se conserva literalmente: número administrativo `1` y código `CRX-000050` muestran `CRX-000050`; `000007` conserva sus seis caracteres. No se añaden prefijos, se eliminan ceros ni se reconstruye el código desde `User.id`.

`MembershipService.getMyAccreditation` selecciona y devuelve `memberCode` desde la fila del usuario autenticado. Conserva los campos `registrationNumber: user.id`, `visibleId: identityUid`, fechas, círculo y QR para compatibilidad. El perfil sigue pasando la respuesta autorizada completa, sin tomar el código de datos de perfil en caché ni de parámetros de otro usuario. La preview carga el mismo formateador antes del renderer y usa el código ficticio `CRX-000050`, manteniendo `registrationNumber: 23` y su QR de muestra inválido. El registro de recursos exige también la presencia de `user-identity.js`.

El esquema admite códigos nulos por compatibilidad histórica. Su provisión pertenece a los flujos existentes de alta/completado de cuenta y numeración; esta lectura no llama a generación o reparación. Ante un código ausente, el formateador existente presenta `—`, sin sustituirlo por número administrativo, UUID, token o código inventado. La comprobación previa de producción confirma 51 usuarios con 51 códigos distintos, ninguno nulo, vacío o blanco, y 51 tokens QR únicos; no hay códigos ausentes que resolver.

No se alteran códigos almacenados, identidades, tokens, payload o PNG QR, relaciones ni Eventos QR. No se añaden migraciones ni se ejecuta renumeración sobre datos locales o productivos. La integración usa exclusivamente PostgreSQL desechable para comprobar las reglas de renumeración ya existentes y exige conservar el mismo QR. No cambian estilos, dimensiones, composición, textos exteriores, giro ni controles.

Referencias de caché: `metacrilatos.js?v=5`, `accreditation-preview.js?v=6`; `user-identity.js?v=1` permanece igual. Pruebas focalizadas cubren códigos distintos del número de orden, prefijos y ceros literales, ausencia sin fallback, datos autorizados, recarga y QR idéntico. Las capturas y comprobaciones privadas de esta corrección se guardan bajo `output/playwright/member-code-*` y `output/metacrilatos/release/member-code-*`.

## Eventos QR: escaneo, ID administrativo y Excel · 18/10/2026

Entrega local, sin commit, push ni despliegue. Se conservan los ajustes pendientes del footer y del giro de METACRILATOS. No hay migraciones, dependencias nuevas, renumeración ni cambios en QR emitidos, relaciones o configuración de acreditaciones.

La causa del UUID en la tabla era la selección del campo en `admin-qr-events.js`: mostraba `publicUserId` (`User.identityUid`) aunque el servicio ya devolvía `userId` desde la relación con `User.id`, clave primaria PostgreSQL `Int`. La primera columna usa ahora ese número real, también en participaciones anteriores. Se añade búsqueda por ese número. Las columnas quedan ID, nombre, círculo al registrarse, primer registro en `Europe/Madrid`, responsable e identificador QR. Los UUID siguen siendo claves técnicas; el formateador compartido de acreditaciones usa `memberCode`, no UUID, y se conserva. La tabla mantiene búsqueda, paginación y scroll horizontal desde las primeras columnas. El título queda a 20 px del botón de regreso.

El visor presenta tick verde y «aprobado» durante 1.000 ms solo tras confirmación del servidor; X roja y «ya registrado» o «no válido» durante 2.000 ms. El aviso se superpone sin alterar la cámara ni los controles. Solo hay una petición de registro en curso. La observación continúa durante petición/aviso, pero se bloquean nuevas altas. Cada contenido procesado queda bloqueado mientras sigue siendo leído y se rearma tras 800 ms consecutivos de ausencia de lectura; un fotograma desenfocado aislado no lo rearma. Otro QR puede procesarse al acabar el aviso. La detección de retirada se basa en fotogramas decodificados y requiere validación física en condiciones de enfoque/luz reales.

Ausencia de lectura no genera error. Contenido decodificado inválido o credencial no utilizable genera «no válido»; red, servidor, sesión, permisos y cámara tienen mensajes específicos. Un resultado incierto bloquea nuevas altas y ofrece reintentar el mismo QR, manteniendo la cámara abierta; la unicidad del servidor reconcilia el reintento. Parar, cambiar grupo/cámara, ocultar o abandonar cancela temporizadores y peticiones y descarta respuestas anteriores. El timeout de 15 s cubre también el cuerpo JSON. El registro confirmado refresca tabla/contador sin recarga ni interrupción del stream.

`GET /api/admin/qr-events/:id/ids.xlsx` reutiliza ExcelJS y los guards ADMIN/SUPERADMIN. Exporta una instantánea del grupo completo, independiente de búsqueda/página, con una hoja «IDs», una columna «ID de usuario», celdas numéricas, IDs únicos y orden numérico. No incorpora datos personales adicionales, UUID ni tokens. La descarga tiene estado de carga, exclusión de doble clic, error visible y cancelación al salir. Grupo vacío: botón deshabilitado y rechazo servidor `EMPTY_GROUP`. La relación opcional `onDelete: SetNull` puede dejar historial de una cuenta eliminada: se muestra «ID no disponible / Cuenta eliminada» y se rechaza el Excel con `UNRESOLVED_PARTICIPANT_ID`, sin inventar números ni omitir filas silenciosamente. La consulta local de solo lectura encontró un grupo sin participantes y ninguna relación rota; no se han inspeccionado históricos de producción en este trabajo.

Verificaciones específicas:

- 44 pruebas DOM y 16 unitarias del servicio: límites exactos, respuesta lenta/incompleta, cancelación, QR retenido/retirado, errores diferenciados, datos históricos, orden, carga y descarga.
- PostgreSQL real desechable y HTTP: 12 escaneos simultáneos dejan una única participación; se conservan círculo, fecha y responsable. El mismo usuario entra en otro grupo. Se comprueban 401/403 y acceso ADMIN/SUPERADMIN. El XLSX real de 125 usuarios repartidos en tres páginas se abre e inspecciona: una hoja/columna, números únicos ascendentes incluyendo 2, 3 y 10; búsqueda/paginación no lo limitan. Fixtures de cuentas eliminadas y renumeración existente comprueban relaciones históricas sin tocar la base habitual.
- Chromium, 1440/390/320 px: lector ZXing/WASM local real sobre stream de canvas con QR sintéticos y API simulada. Cuatro resultados por anchura, 1.002–1.009 ms de aprobado y 2.000–2.015 ms de rechazo; QR mantenido no se reenvía, retirada/reintroducción funciona, visor conserva tamaño, separación 20 px y sin desbordamiento de página. Capturas y harness ignorados en `output/playwright/qr-events/`.
- WebKit, 390 px: los mismos cuatro resultados y comprobaciones pasan con 1.012 ms / 2.004–2.014 ms. Este binario de WebKit carece de `MediaStream` y `captureStream`: se simula el elemento de vídeo y se alimenta su canvas con los mismos fotogramas QR; el decodificador WASM sí se ejecuta realmente. No equivale a probar permisos/captura en Safari físico.
- Typecheck y compilación backend correctos. Reinicio de `localhost:3000` con base `cronox_dev` en loopback, correo/trabajos desactivados y guard de red local; salud y readiness 200, exportación sin sesión 401. El acceso administrativo continúa exigiendo login.

No se ha utilizado cámara física ni se han hecho altas de prueba en producción. Queda comprobar Safari/iPhone y Chrome/Android con enfoque real, QR sostenido, retirada/reentrada, permisos y pérdida de conexión. Las simulaciones no sustituyen esa comprobación.

## Publicación conjunta autorizada · 18/10/2026

El titular ha comprobado los cambios y autorizado expresamente publicar todo el trabajo pendiente: logos CRONOX/ojo/CX, posiciones y distribución proporcional del footer; pausa y reanudación de METACRILATOS según ratón/táctil/botón; X sin recuadro del menú móvil; mejoras de Eventos QR, ID administrativo, tabla y XLSX. Se incluyen las referencias de caché, originales de los logos conservados y pruebas correspondientes. No se modifican los diseños/configuración guardados de acreditaciones ni los QR emitidos.

Revisión conjunta previa: 161 pruebas correctas en nueve suites de footer, menú, movimiento, integración de acreditaciones y Eventos QR; typechecks frontend/backend correctos; integración PostgreSQL desechable correcta con concurrencia, XLSX, permisos e histórico. Compilan frontend y backend, pasan el control de contenido privado y los hashes de los cinco diseños aprobados. No hay cambios de esquema, nuevas dependencias ni migraciones nuevas. El procedimiento normal generará el cliente Prisma y comprobará el historial existente.

Git local coincide con `origin/main` antes del commit, sin commits locales pendientes previos. Pages permanece en modo workflow; push sólo verifica y el despliegue se solicita por `workflow_dispatch` después de CI. Se usa el controlador instalado con sus tres verbos SSH y el respaldo con restauración aislada obligatoria; no se emplea un canal alternativo. Este apartado registra preparación, no acredita todavía una publicación productiva completada.

Primer commit conjunto `f5c12c443252895e1cf69fa4da5d1679470b6af8`. [CI 39117215977](https://github.com/danir23007/Web_Cronox/actions/runs/39117215977) se detuvo antes del despliegue: 261 suites / 2.814 pruebas pasaron y falló una comprobación textual antigua de padding. El footer conserva exactamente `clamp(18px, 4.7vw, 90px)`, ahora definido en `--footer-side-padding` para compartirlo con el desplazamiento del copyright. Se actualiza esa prueba para exigir tanto los mismos límites como su aplicación; no se elimina ni relaja la aserción y no se cambia código de aplicación. Sus 55 casos pasan localmente. Producción permaneció abierta con la versión anterior.

## Cierre de la publicación conjunta

Versión realmente desplegada: **`121736dd70d5f31e2757c158bc1250706a0a23ad`**, que incluye los cambios funcionales de `f5c12c4` y la actualización de la prueba responsive de `121736d`. [CI del push 39117607144](https://github.com/danir23007/Web_Cronox/actions/runs/39117607144) terminó success: 262 suites / 2.815 pruebas, compilaciones, controles privados y de acreditaciones, más 59 pruebas específicas de exportaciones. [Publicación 39117940117](https://github.com/danir23007/Web_Cronox/actions/runs/39117940117): verify-release y deploy success. El diario root terminó success/public_check/phaseComplete=true a las **2026-10-18T10:13:59.303685+00:00**.

El recorrido normal del controlador hizo preflight, mantenimiento, parada, respaldo completo y restauración real aislada, instalación y compilaciones, generación Prisma, comprobación de migraciones, arranque pausado, activación, supervisión, guardado de PM2 y reapertura. La comparación del respaldo dio **295 objetos de origen y destino, cero diferencias**. Sus archivos y hashes permanecen privados bajo `/var/lib/cronox-release/121736dd70d5f31e2757c158bc1250706a0a23ad/`. No se aplicó ninguna migración nueva: las mismas 97 entradas terminadas y la huella del historial coinciden antes/después. No hubo restauración productiva ni continuación administrativa excepcional.

Verificación independiente posterior en producción:

- HEAD exacto `121736d`, proceso deploy UID 1000, PID 634722, iniciado a las 10:13:50.146Z; servicio PM2 activo/habilitado y dump online con script esperado, HOST=127.0.0.1 y recuperación habilitada. Listener exclusivo en loopback y mantenimiento inactivo.
- Portadas, health y ready HTTP 200; www redirige 308 al dominio canónico. Los seis CSS/JS/WebP comprobados coinciden **byte a byte** con Git. Se sirven las referencias store.css v124, metacrilatos v7 y Eventos QR CSS/JS v2.
- Chromium y WebKit, 1440/390 px, `/` y `/sobre-cronox`: tres logos cargados y alineados, posiciones y columnas proporcionales, copyright a 18/12 px, sin desbordamiento; X móvil sin borde, outline ni recuadro, área 44×44 y foco de teclado sobre el glifo. Son motores automatizados, no teléfonos físicos.
- Sesión SUPERADMIN legítima: GET y descarga real del grupo existente, sin crear grupos/participantes ni abrir cámara. Primera columna numérica y orden correcto; se abre el XLSX **descargado por el botón** y se verifica una hoja, una columna, encabezado, celdas numéricas, unicidad, orden y equivalencia con todos los IDs del grupo. Producción tenía un participante; la cobertura de 125 participantes y varias páginas corresponde al PostgreSQL desechable. Se elimina la descarga temporal, sin guardar datos personales ni IDs en informes. Acceso anónimo a participantes/exportación: 401.
- Preview METACRILATOS autenticada: HTTP 200, renderer v7 visible y girando, respuesta de diseños/configuración idéntica antes/después. Las huellas SQL de ambos diseños y selección global coinciden también con la captura anterior al despliegue; no se cambió su configuración.
- Huellas antes/después iguales para histórico completo de participaciones y para IDs, UUID, tokens y códigos de los usuarios. REVIEW histórico permanece en 1, sin reencolado ni reparación. No se hicieron pagos, reembolsos, comunicaciones ni altas ficticias como verificación.
- Worker de la instancia actual: enabled=true, sin motivo de desactivación ni error; sus ciclos completos avanzan **10:14:47.371Z → 10:15:07.395Z**, mismo PID. La telemetría procede del servidor real; no se forzó reprocesamiento.

Los artefactos saneados y capturas se conservan ignorados en `output/playwright/joint-release-20261018/`. La revisión administrativa bloqueó escrituras y utilizó exclusivamente lecturas y descarga del grupo real. El primer intento del harness no pudo recuperar el cuerpo de la respuesta interceptada tras la descarga; se corrigió el lector del harness para abrir el archivo efectivamente descargado, que pasó la inspección, sin modificar la aplicación.

Localhost:3000 permanece operativo con los mismos cambios funcionales y compilado actual, base `cronox_dev` en loopback, guard de red y correo/trabajos desactivados; health/ready 200. El cierre posterior modifica sólo documentación y usa el `paths-ignore: docs/**` existente, sin nuevo despliegue. No queda una regresión observada ni bloqueo operativo de esta publicación. Las altas/duplicados/errores de escaneo, tiempos y concurrencia se acreditan por pruebas aisladas; no se repitieron con una cámara física ni creando registros productivos. Continúan los límites generales de retención/copia externa de respaldos ya documentados, sin borrados automáticos ni ampliación de permisos.
