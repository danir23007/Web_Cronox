# Últimas unidades por producto — 7 de octubre de 2026

Implementación inicial y refinamiento de los avisos publicados anteriormente (base 535990e). La publicación de los ajustes posteriores de Quick Add, selección y entrega está autorizada. Este informe recoge la comprobación local de la versión candidata; el resultado de GitHub Actions y la verificación online se comunican al terminar la publicación. Las secciones históricas conservan sus resultados y reglas anteriores, sustituidas por el comportamiento vigente descrito a continuación.

## Posición vigente de la entrega: pie derecho para todo producto comprable

La entrega de Quick Add comparte siempre `.qa-footer` con «Ver detalles del producto»: enlace a la izquierda y fecha a la derecha, en la misma fila y con los centros verticales alineados, también cuando todas las tallas tienen stock. Ese caso sigue mostrando únicamente Añadir al carrito; AVÍSAME permanece oculto sin reservar espacio. Los productos mixtos conservan ambos botones y sus reglas por talla; agotado completo conserva solo AVÍSAME y no muestra entrega.

Se elimina la bifurcación que devolvía la fecha a `.qa-actions` cuando no había tallas agotadas. El reparto flexible de ancho pasa a bases de 110/140 px, conservando los bordes y permitiendo envolver el texto dentro de cada columna a 320 px sin separar la fila. No hay posiciones absolutas ni desplazamientos artificiales. La selección inicial, cambios manuales, cálculo compartido y protecciones asíncronas se conservan.

Verificado visualmente y mediante geometría en Chromium: 1365×900, 390×844 y 320×700, con los tres estados, textos largos y cambios de disponibilidad. En todas las tallas disponibles, y también en el caso mixto: **0 px de diferencia entre centros verticales, enlace en el borde izquierdo y texto de entrega en el borde derecho, sin solapamientos ni desbordamientos**. Las capturas comparativas de la sección siguiente se han actualizado a este resultado.

Pasan las **8 suites afectadas, 174 pruebas**, sintaxis JavaScript y compilación Vite. Se reutilizan las comprobaciones previas no afectadas, incluida la suite completa de 203 suites/1868 pruebas y el flujo de suscripción en base aislada. Cambios adicionales: `products.js`, `quick-add.css`, referencias HTML, pruebas y este informe; recursos **products v72 y quick-add.css v11**. Backend local identificado y reiniciado únicamente para invalidar las plantillas en memoria. Fixtures exclusivamente locales retirados al terminar; sin correos, producción, migraciones nuevas, commit, push ni despliegue.

## Preflight de publicación de los ajustes pendientes

- Todas las tallas disponibles: solo compra; mixto: ambos controles y la talla elegida habilita uno; agotado completo: solo aviso activo desde la apertura, sin entrega en modal ni ficha. Los botones usan disabled nativo y las tallas agotadas siguen seleccionables.
- Prioridad inicial M → S → L → XS → XL → XXL; otros sistemas eligen una talla comprable aleatoria una vez por apertura. Las actualizaciones respetan la elección manual y descartan respuestas antiguas. Entrega siempre en el pie derecho junto a detalles.
- Tarjetas 11 px; Quick Add y outfit 12 px. Naranja #D9A21B y rojo #ff6464; agotado sin punto y últimas unidades con punto fijo; sin recuadros. Cesta sin avisos decorativos y recomendaciones sin agotados.
- Instalaciones reproducibles raíz/backend, Prisma Client, Vite y Nest completados. Los bundles api.js/admin-user.js regenerados coinciden con los ya versionados: no se introduce una modificación artificial. Los scripts públicos modificados se publican directamente y sus referencias son products v72, quick-add.css v11, product-delivery v5, product-page v46 y waitlist v3.
- Suite completa: 202 suites/1867 pruebas pasan; la única prueba de medios afectada por eliminaciones generadas de node_modules pasa al restaurar exclusivamente esas dependencias versionadas y repetirla. Resultado final de las 203 suites/1868 pruebas: sin fallos pendientes. Las tres comprobaciones CI de exportaciones pasan, incluidas rutas compiladas. Sin cambios de paquetes o lockfiles.
- Chromium con 22 productos desechables locales: escritorio 1365×900, móvil 390×844 y 320×700, los tres estados, prioridades, elecciones manuales, teclado/toque, respuestas fuera de orden y cierre/reapertura. Geometría de entrega y detalles: diferencia vertical 0 px, sin solapamientos ni desbordamientos, incluso con textos largos. Persistencia, rechazos HTTP 400, cesta y recomendaciones comprobados. Fixtures retirados y correo desactivado.
- Producción antes del push: commit 535990e, workflow Deploy CRONOX anterior completado con éxito y sin despliegues simultáneos. Consulta prisma migrate status por SSH al backend de producción: 79 migraciones, esquema actualizado. No hay cambios de Prisma en este ajuste ni migraciones pendientes, por lo que no se requiere una nueva migración ni copia para modificar datos. El procedimiento habitual ejecuta migrate deploy como comprobación sin cambios de esquema.
- Solo se incluyen los cambios de esta tarea. Se excluyen .env, credenciales, capturas, logs, manifests privados y modificaciones de dependencias instaladas. La copia ajena no versionada main.ts.cronox-before-stripe del servidor se conserva.
- Verificación online reproducible de solo lectura: tests/admin-review/quick-add-release.browser.js. No pulsa compra ni confirma suscripciones; documenta los estados ausentes del catálogo real.


## Regla local anterior: tres estados de disponibilidad en Quick Add (histórico)

El último ajuste sustituye la visibilidad de AVÍSAME cuando todas las tallas están disponibles. `updateQuickAddControls` usa `productStockStatus(variants, null)` y `soldOutSizeCount(variants)`, compartidos con la disponibilidad comprable; no cuenta variantes inactivas ni considera agotada una talla que tenga otra variante comprable.

| Disponibilidad del producto | Botones | Entrega |
| --- | --- | --- |
| Todas las tallas disponibles, confirmado | Solo Añadir al carrito | Debajo de compra, dentro de `.qa-actions`, sin clase lateral |
| Alguna talla agotada y otras comprables | Ambos visibles; la talla elegida determina cuál se habilita | Lateral derecho del pie, junto al enlace izquierdo, solo si la talla elegida es comprable |
| Todo agotado | Solo AVÍSAME, activo desde la selección inicial | Oculta y sin espacio |

AVÍSAME se oculta con `hidden` nativo y las reglas existentes del componente (`display:none`); no se reserva su altura ni un hueco intermedio. La falta de datos no se interpreta como «todas disponibles». Cada actualización vuelve a asignar la visibilidad y mueve la fecha a su contenedor correspondiente, retirando la clase lateral al pasar a todas disponibles. Se conserva la selección inicial, la elección manual, el cálculo de entrega, la protección frente a respuestas antiguas, el flujo de aviso y el resto del trabajo pendiente.

Verificación en Chromium: escritorio 1365×900, móvil 390×844 y estrecho 320×700, los tres estados. Todas disponibles: M marcada, AVÍSAME con altura **0 px**, fecha debajo de compra y separación del grid de **6 px**, sin clase lateral. Mixto: ambos botones, talla disponible/agotada y entrega lateral con texto normal/largo; a 320 px la fila envuelve cuando hace falta, sin solaparse ni desbordar, conservando la fecha a la derecha. Agotado: compra y fecha con altura cero y aviso disponible desde la apertura. Cambios reales de stock de fixtures con el modal abierto: mixto → agotado → mixto → todas disponibles → mixto, conservando la elección manual de L y la posición/visibilidad correctas. Nuevas aperturas y respuestas tardías tampoco recuperan los estados anteriores.

Suite completa: **203 suites y 1868 pruebas aprobadas**. Compilación frontend Vite y sintaxis JS correctas; se conserva la compilación Nest previamente verificada porque este ajuste no modifica código de backend ni su esquema. Se repite la revisión de cesta, recomendaciones, entrada de avisos, teclado/toque, colores y tamaños. El helper de cesta espera el estado confirmado y su entrega antes de medir; la navegación del helper fuerza un documento nuevo al reintentarlo para no conservar un drawer de una ejecución previa. No se añaden esperas artificiales al producto. El flujo completo de suscripción aislada de la revisión anterior sigue siendo válido: no se cambia `waitlist.js` en este ajuste.

Cambio adicional limitado a `products.js`, referencia **products v71** en HTML, regresiones y este informe. CSS v10, API v17, product-page v46, product-delivery v5 y waitlist v3 se conservan. Se identifica y reinicia únicamente el backend local en 3000 para invalidar las plantillas HTML en memoria. Pruebas con 22 productos y un SUPERADMIN desechables en PostgreSQL 127.0.0.1:5433/cronox_dev, correo y jobs desactivados; se retiran los datos al terminar. Sin migraciones nuevas, commit, push, despliegue o escrituras en producción.

Capturas comparativas actuales, revisadas visualmente; archivos ignorados por Git:

| Estado | Escritorio | Móvil | 320 px |
| --- | --- | --- | --- |
| Todas disponibles | [Captura](../output/playwright/quick-add-selection/desktop-all-available.png) | [Captura](../output/playwright/quick-add-selection/mobile-all-available.png) | [Captura](../output/playwright/quick-add-selection/narrow-all-available.png) |
| Mixto, talla disponible | [Captura](../output/playwright/quick-add-selection/desktop-available.png) | [Captura](../output/playwright/quick-add-selection/mobile-available.png) | [Captura](../output/playwright/quick-add-selection/narrow-available.png) |
| Todo agotado | [Captura](../output/playwright/quick-add-selection/desktop-fully-out.png) | [Captura](../output/playwright/quick-add-selection/mobile-fully-out.png) | [Captura](../output/playwright/quick-add-selection/narrow-fully-out.png) |

## Ajuste local anterior: selección inicial y laterales de Quick Add (histórico)

Este encargo sustituye la selección inicialmente vacía y la compra visible cuando todo está agotado. Cada apertura elige una talla existente activa. En APPAREL, usa **M → S → L → XS → XL → XXL**, buscando primero entre las tallas comprables; si todas están agotadas, aplica esa prioridad entre las existentes. El orden visual del selector sigue siendo XS, S, M, L, XL, XXL. En US_RING u otro sistema se elige aleatoriamente una talla comprable, o una existente si no queda stock. El esquema actual contempla APPAREL y US_RING; no se crean nuevos sistemas ni reglas de stock.

La elección inicial se calcula una sola vez por apertura. Imágenes, disponibilidad y catálogo conservan esa selección o la elección manual posterior. Abrir otro producto o reabrir inicializa su propia talla; si una variante desaparece durante una actualización no se inventa una sustitución ni se permite comprar con una selección inválida. La disponibilidad desconocida mantiene las acciones deshabilitadas.

| Situación | Compra | AVÍSAME |
| --- | --- | --- |
| Producto con stock, talla elegida comprable | Visible, blanca y habilitada | Visible, gris y deshabilitado |
| Producto con stock, talla elegida agotada | Visible, gris y deshabilitada | Visible y habilitado |
| Todo el stock comprable agotado | **Oculta, sin espacio** | Visible y habilitado desde la apertura con su talla marcada |

AVÍSAME conserva tanto una talla inicial como una elegida manualmente al navegar al producto. El flujo permite revisarla o cambiarla y mantiene autenticación, confirmación e idempotencia. No se crea ninguna suscripción al abrir, seleccionar o navegar. Se conservan las generaciones, identidad de producto y marcas de inicio de lectura para descartar respuestas antiguas.

La fecha inferior derecha quedaba dentro de una columna flexible, pero su contenido interno se alineaba al inicio. `.qa-delivery--corner` ahora usa `justify-content:flex-end`, además de su texto alineado a la derecha. El enlace permanece en el borde izquierdo y el texto de entrega llega al borde derecho del contenido, respetando el padding del popup. A 1365×900 y 390×844, textos normales y largos: **0 px de diferencia vertical entre centros y 0 px de distancia adicional a ambos bordes**. A 320×700, el texto largo envuelve la fila sin solaparse ni desbordar. No hay posiciones absolutas ni desplazamientos artificiales. Los productos totalmente agotados no muestran entrega ni compra ni su espacio.

Comprobado con Chromium y **22 productos desechables locales**: los seis escalones de prioridad, todas las tallas disponibles con M marcada, anillos con selección aleatoria válida y estable, agotado completo de prenda/anillo, elección manual, respuestas fuera de orden y tras cerrar/reabrir, actualización real de stock, controles nativos deshabilitados por ratón/teclado/toque, avisos, cesta y recomendaciones. Se mantienen tarjetas a 11 px, Quick Add/recomendaciones a 12 px, naranja #D9A21B y rojo #ff6464, últimas unidades con punto fijo y agotado sin punto.

Suite completa final: **203 suites y 1867 pruebas aprobadas**. Compilaciones Vite/Nest y sintaxis JS correctas. Flujo real de avisos repetido en base aislada sin correo: JWT 401, CSRF 403, talla comprable 409, confirmación 201, mismo ID ante duplicado, persistencia y cancelación 200. El aviso pertenece al producto elegido y S. Se mantiene el 403 de la revisión histórica local; no se desactiva ninguna protección. Sin pruebas ni escrituras en producción. Todos los datos y el proceso aislados se retiran al terminar.

Cambios adicionales de este ajuste: `products.js`, `quick-add.css`, referencias HTML, regresiones DOM y helpers de navegador. Referencias actualizadas a **products v70 y quick-add.css v10**. Se conservan product-page v46, product-delivery v5, waitlist v3, API v17, store.css v114 y app v87. No hay migración, generación Prisma o dependencia nueva. Se reinicia únicamente el backend local identificado en 3000 para invalidar sus plantillas HTML en memoria; health, catálogo, categorías, galería y recursos actuales responden 200. **Sin commit, push ni despliegue.**

Capturas revisadas: [escritorio disponible](../output/playwright/quick-add-selection/desktop-available.png), [móvil disponible](../output/playwright/quick-add-selection/mobile-available.png), [escritorio agotado](../output/playwright/quick-add-selection/desktop-fully-out.png), [móvil agotado](../output/playwright/quick-add-selection/mobile-fully-out.png), [todas disponibles](../output/playwright/quick-add-selection/desktop-all-available.png), [anillo con elección manual](../output/playwright/quick-add-selection/mobile-ring.png) y [320 px con texto largo](../output/playwright/quick-add-selection/narrow-long-footer.png). La tabla de capturas de la corrección local anterior conserva los enlaces a los demás estados y ahora apunta a esta última ejecución local.

## Corrección local anterior: entrega y selección explícita (histórico)

La ficha calculaba la fecha sin comprobar el stock del producto. Quick Add deshabilitaba las tallas agotadas, elegía automáticamente una disponible y decidía mostrar AVÍSAME por el número de tallas agotadas. Esos comportamientos se sustituyen por la selección explícita y la disponibilidad comprable de la talla elegida.

`product-delivery.js` registra el producto asociado a cada aviso y comprueba `CRONOX_STOCK.productStockStatus(variants, null)`. La ficha empieza con el aviso oculto y solo lo muestra con stock total positivo confirmado. Total cero o desconocido: fecha vacía y elemento oculto, sin espacio reservado. Quick Add requiere además una talla seleccionada con stock confirmado; tampoco promete entrega al elegir una talla agotada. Se conserva exactamente el cálculo existente de Madrid, fines de semana y festivos, y la entrega de la cesta.

Las tallas agotadas de Quick Add mantienen su aspecto tachado, pero son botones seleccionables por ratón, teclado y toque. Ambos botones de acción permanecen visibles:

| Selección | Añadir al carrito | AVÍSAME | Entrega de Quick Add |
| --- | --- | --- | --- |
| Ninguna o disponibilidad desconocida/en comprobación | Deshabilitado, gris | Deshabilitado, gris | Oculta |
| Talla con stock comprable | Habilitado, blanco | Deshabilitado, gris | Visible |
| Talla agotada, incluido agotado completo | Deshabilitado, gris | Habilitado | Oculta |

Se usa `disabled` nativo, además del estilo y comprobaciones en los handlers. No hay talla de reserva al añadir. AVÍSAME navega al producto con `waitlist=<ID interno de variante>` y `size=<talla seleccionada>`; el flujo existente conserva esa elección, exige autenticación y confirmación y no realiza altas al navegar. Si esa talla deja de ser elegible, no elige otra automáticamente. El foco del selector se aplica tras la lectura de estado, cuando deja de estar deshabilitado.

La disponibilidad recibida vuelve a calcular ambos botones y conserva una selección que siga perteneciendo al producto. Una generación por apertura/lectura, la identidad del producto y la hora de inicio de las peticiones descartan respuestas antiguas, snapshots anteriores del catálogo y respuestas tras cerrar/reabrir. La finalización de una compra pendiente no rehabilita una talla agotada. La ficha aplica la misma protección para no restaurar una entrega antigua. Las lecturas de detalle se refrescan al recuperar el foco o restaurar desde BFCache; no hay sondeo ni consulta por tarjeta. No se ofrece stock en tiempo real mientras no llegue una lectura nueva; el servidor mantiene la validación final de compra.

El enlace de detalles y la entrega inferior derecha comparten `.qa-footer`: flex con alineación central, ancho repartido y envoltura normal del texto. A 1365×900 y 390×844, tanto texto normal como texto largo tienen **0 px de diferencia entre sus centros verticales**, sin solapamientos ni desbordamiento. En anchos menores que no admitan ambas columnas se permite envolver la fila. No se usan posiciones absolutas ni desplazamientos artificiales.

### Comprobaciones de esta corrección

- Chromium local, escritorio 1365×900 y móvil 390×844, con catorce productos y un SUPERADMIN desechables: selección inicial vacía, alternancia repetida de tallas disponibles/agotadas y navegación por flechas. Botones deshabilitados sin acciones por ratón, clic nativo/sintético, Enter, Espacio o toque CDP.
- Cambio real del stock del producto de prueba con Quick Add abierto: selección conservada, compra/aviso/entrega actualizados. Dos respuestas reales de detalle entregadas fuera de orden y otra retenida hasta cerrar y abrir un producto distinto: el resultado antiguo no sobrescribe el nuevo producto ni restaura la fecha. Ficha agotada y actualización de stock con la ficha abierta: sin promesa ni espacio reservado, incluso después de actualizar el módulo de entrega.
- Navegación de AVÍSAME conserva exactamente producto y talla S, tanto con agotado parcial como total. No hay POST al navegar. La revisión histórica de localhost:3000 conserva su protección `localReviewSafety` y el POST devuelve el 403 conocido; no se desactiva.
- Flujo real adicional en `127.0.0.1:43129`, base independiente desechable `cronox_avisa_release_test_*`: sin sesión 401, sin CSRF 403, talla comprable 409, confirmación 201, duplicado con el mismo ID, persistencia y cancelación 200. Verificación de base: un aviso del producto elegido y S, cancelado, sin reclamación ni aceptación de correo. Perfil independiente sin credenciales de producción y con correo/workers desactivados. Se eliminan únicamente esa base y ese proceso al terminar.
- Sin regresiones en tarjetas (11 px), Quick Add y recomendaciones (12 px), naranja `#D9A21B`, rojo `#ff6464`, punto fijo de últimas unidades y agotado sin punto. Hover, flechas y swipe comprobados. Cesta real local y recomendaciones: compra de fixtures, eliminación y reapertura, sin avisos decorativos en las filas y agotados excluidos de recomendaciones.
- `npm run admin:build`, `npm --prefix cronox-backend run build:compiled`, comprobaciones de sintaxis JavaScript y revisión de diff. No hay cambios de esquema, migraciones nuevas ni dependencias nuevas.
- Pruebas de regresión en `quick-add-selection.dom.spec.ts` y scripts de navegador mantenibles actualizados, incluido `quick-add-selection.browser.js`. Suite completa final: **203 suites y 1859 pruebas aprobadas**, sin pruebas fallidas ni handles pendientes.

Durante la revisión se detectó la plantilla antigua de producto almacenada en memoria por `createSeoPages`. Se identificó el PID 40428 del backend local en 127.0.0.1:3000 y se reinició únicamente esa instancia mediante `start-local.cjs`, con PostgreSQL 127.0.0.1:5433/cronox_dev y correo/trabajos desactivados. La prueba se repitió con las referencias y el HTML actuales. Los fixtures y sus cestas/usuarios se retiran al terminar; las capturas y scripts privados permanecen ignorados por Git.

Referencias actuales: products v69, product-page v46, product-delivery v5, waitlist v3 y quick-add.css v9. API v17, store.css v114 y app v87 se conservan. Esta corrección no modifica bundles de API/administrador; su compilación reproduce los artefactos existentes.

| Capturas de la corrección | Escritorio | Móvil |
| --- | --- | --- |
| Talla disponible, entrega alineada | [Captura](../output/playwright/quick-add-selection/desktop-available.png) | [Captura](../output/playwright/quick-add-selection/mobile-available.png) |
| Talla agotada seleccionada | [Captura](../output/playwright/quick-add-selection/desktop-selected-out.png) | [Captura](../output/playwright/quick-add-selection/mobile-selected-out.png) |
| Producto totalmente agotado | [Captura](../output/playwright/quick-add-selection/desktop-fully-out.png) | [Captura](../output/playwright/quick-add-selection/mobile-fully-out.png) |
| Pie con textos largos | [Captura](../output/playwright/quick-add-selection/desktop-long-footer.png) | [Captura](../output/playwright/quick-add-selection/mobile-long-footer.png) |
| Ficha agotada sin entrega | [Captura](../output/playwright/quick-add-selection/desktop-pdp-out.png) | [Captura](../output/playwright/quick-add-selection/mobile-pdp-out.png) |

Para reproducir con Playwright CLI: crear fixtures con `node tests/admin-review/last-units-fixtures.cjs`, abrir `/admin-login.html`, ejecutar `browser-private.js`, `selection-private.js` y `actions-private.js` generados en `output/playwright/last-units/`. El último comprueba también el bloqueo histórico local y cierra sesión. Retirar los datos con `node tests/admin-review/last-units-fixtures.cjs cleanup`. El flujo completo permitido usa los helpers `last-units-isolated.cjs` y `last-units-isolated.browser.js`. Todos los archivos privados, credenciales, logs y capturas quedan fuera de Git.

## Regla y persistencia

`Product.lastUnitsThreshold` es un entero nullable. Los productos existentes quedan en `NULL` (desactivado). El editor admite enteros de 0 a 2147483647; vacío envía `null`. Tanto `null` como **0 desactivan únicamente el aviso de últimas unidades**, según la aclaración del propietario. «AGOTADO» depende del stock real, conserva las restricciones de compra y aparece arriba en las tarjetas y junto al precio en Quick Add.

El aviso aparece únicamente si `0 < stock disponible total <= lastUnitsThreshold`. Se reutiliza `availableStock` en `src/common/stock-status.ts`: variantes activas y disponibles, sumando cantidades positivas. `purchasableStock` exige cantidades conocidas de las variantes activas y `productStockStatus` comparte el resultado entre superficies. Total cero produce agotado antes de consultar el umbral; con información incompleta no se infiere escasez ni agotado. El checkout ya descuenta las reservas de `stockQty` al reservar (`OrdersService.reserveStockForCheckoutSnapshot`) y las devuelve al liberarlas; no se descuentan por segunda vez. Se conserva la clasificación del inventario administrativo y no se cambian precios, reservas ni reglas de compra. El frontend deja de usar el umbral fijo anterior de 14 unidades para sus avisos.

La configuración se valida en los DTO de alta y edición, en el editor y con un CHECK PostgreSQL no negativo. Se mantiene el control de concurrencia existente del editor. Las respuestas públicas de catálogo incorporan el nuevo escalar y la disponibilidad existente; no incluyen `privateCost`, `unitCostCents` ni palabras de búsqueda internas. Favoritos conserva explícitamente el umbral en su respuesta limitada.

## Presentación y actualización

`CRONOX_STOCK.decorateLastUnits` añade un único aviso en la esquina superior izquierda de la imagen en las tarjetas compartidas de tienda, Favoritos, Perfil y productos relacionados, usando sus datos ya cargados. «ÚLTIMAS UNIDADES» y «AGOTADO» se excluyen mutuamente; no queda ningún aviso bajo el precio. «ÚLTIMAS UNIDADES» conserva su punto rojo fijo; «AGOTADO» aparece solo como palabra. Ambos usan 11 px en las tarjetas: sin fondo, borde, sombra, padding ni recuadro, sin animación y con `pointer-events:none`. Se reserva el área de los controles de favorito; el texto puede envolver en espacios estrechos. Carrusel y navegación se conservan.

`decoratePurchase` mantiene el aviso junto al precio en Quick Add (y en la ficha que reutiliza este componente): «Últimas unidades» con punto rojo fijo o «Agotado» sin punto. Conserva los 12 px existentes. Usa el mismo estado por producto, sin una condición independiente basada en tallas o en el umbral antiguo. El precio tachado y el bloqueo de compra se conservan cuando el total es cero.

Los colores se reutilizan exactamente desde `store.css`: naranja original **`--stock-low-warning: #D9A21B`** y rojo original **`#ff6464`**, ahora identificado como `--stock-out-warning`. Ambos avisos y el punto usan esas variables. Se eliminan las reglas obsoletas de `.product-card__stock-label` y su cambio de color contextual; no se usa el naranja aproximado `#a84400` de la primera implementación.

### Ajustes adicionales iniciales de Quick Add y recomendaciones (histórico)

`soldOutSizeCount` agrupa las variantes activas por talla normalizada y cuenta únicamente grupos con stock comprable conocido igual a cero. Una variante comprable impide considerar agotada esa talla. No cuenta filas duplicadas, tallas externas al producto ni stock desconocido como cero. La base actual tiene UNIQUE(productId, size); las duplicaciones se prueban con snapshots locales del renderer y pruebas unitarias, sin alterar esa restricción. Quick Add elige una variante comprable cuando recibe un snapshot con variantes duplicadas.

| Situación | Acción | Mensaje inferior | Entrega |
| --- | --- | --- | --- |
| Ninguna talla agotada | Añadir al carrito | Ver detalles del producto | Debajo del botón |
| Una o dos agotadas, compra disponible | Añadir al carrito | Pregunta sobre talla agotada y aviso desde el producto | Inferior derecha |
| Tres o más agotadas, compra disponible | Añadir al carrito + AVÍSAME | Ver detalles del producto | Inferior derecha |
| Agotado completo, incluso una sola talla | Compra bloqueada + AVÍSAME | Ver detalles del producto | Oculta; no promete reposición |

**Comportamientos iniciales solicitados:** AVÍSAME es un enlace con estilo de botón hacia `#productWaitlist` del producto actual; enfoca el selector existente sin preselección ni suscripción. Solo tras elegir una talla se consulta el aviso y se conserva la confirmación explícita y el acceso autenticado. Si deja de ser elegible la talla elegida, esta entrada no elige otra automáticamente. La posición inferior derecha con una o dos tallas agotadas también es el tratamiento inicial indicado, que podrá ajustarse posteriormente.

`product-delivery.js` expone su actualización compartida. Quick Add usa la misma estimación que producto y cesta, con los festivos, fines de semana y cambio de fecha de Madrid existentes; no añade fórmula ni calendario nuevos. La fecha se oculta con disponibilidad incompleta o total cero y al cerrar. El módulo conserva un único temporizador de cambio de día; no hace consultas externas ni sondeos. La posición inferior derecha forma parte del flujo normal del contenido para evitar solapamientos al envolver texto en móvil.

Las filas añadidas a la cesta no reciben avisos decorativos de stock; sus errores funcionales siguen intactos. Las recomendaciones filtran el stock comprable confirmado cero **antes** de limitar a seis. Las pocas unidades siguen siendo recomendables y comprables. Su aviso es exclusivamente ` · Últimas unidades` a continuación del precio, naranja original, sin punto rojo ni aviso sobre la imagen. La firma existente de renderizado incluye los datos de disponibilidad y umbral y se invalida al recibir datos nuevos.

La decoración puede repetirse con datos nuevos: elimina el aviso anterior, vuelve a calcularlo y no duplica filas de precio. Catálogo, detalle, productos por categoría y favoritos se sirven sin caché HTTP de disponibilidad; las lecturas públicas correspondientes usan `no-store`. El catálogo y Favoritos se refrescan al restaurar una página desde la caché de navegación. El catálogo usa la búsqueda actual al refrescar. Las referencias de recursos HTML llevan nueva versión para invalidar los archivos JS/CSS anteriores.

No existe una caché nueva de producto, una consulta por tarjeta ni sondeo. La actualización ocurre al recibir disponibilidad nueva, recargar catálogo/página o restaurar las vistas indicadas. Una pestaña que permanece abierta no recibe stock en tiempo real sin una nueva lectura; la compra mantiene sus comprobaciones de stock en servidor.

## Verificación local inicial (histórico)

Base de desarrollo confirmada: **127.0.0.1:5433 / cronox_dev**, correo y trabajos automáticos desactivados. Copia PostgreSQL custom anterior a la migración, 411909 bytes, en `output/playwright/last-units/cronox_dev_before_last_units.dump` (ignorada por Git). `npm --prefix cronox-backend run migrate:local` aplicó exclusivamente `20261007160000_product_last_units_threshold`; las 79 migraciones del repositorio quedan aplicadas en local. Sin reset.

Prisma Client regenerado en la implementación inicial; estas revisiones no cambian el esquema ni necesitan otra migración o generación. Compilaciones Nest y Vite del administrador/API completadas de nuevo. Pruebas mantenibles: DTO de alta/edición, persistencia en alta HTTP, función compartida, avisos inline, redecoración DOM y nuevas acciones/fechas de Quick Add y recomendaciones. Batería completa: **202 suites y 1850 pruebas aprobadas**, incluyendo productos, stock, autenticación, avisos y checkout. Tras el último ajuste que evita elegir otra talla automáticamente se repiten las pruebas DOM y de controlador/servicio de avisos, también aprobadas. Se actualizan dos expectativas de versión de quick-add.css para conservar sus comprobaciones de caché.

Chromium con catorce productos y un SUPERADMIN desechables, exclusivamente locales:

- Umbral 5: total 6 sin aviso; 5 (2+3) y 1 con aviso; 0 muestra AGOTADO arriba sin aviso de últimas unidades. Los precios de las tarjetas no tienen avisos debajo.
- Umbral vacío y 0: sin últimas unidades con stock positivo; con todas las tallas a cero muestran agotado. Una talla positiva y las demás cero nunca produce agotado. Una variante inactiva con 100 unidades no altera la suma.
- Frontend rechaza negativos y decimales. Peticiones reales con -1, 1.5, texto, cadena vacía, booleano y valor fuera de rango devuelven HTTP 400.
- Guardado/reapertura y recarga del editor conservan 5, 0 y null. Cambiar umbral y stock actualiza la tarjeta tras leer el catálogo de nuevo.
- Favoritos usa la misma decoración y los datos recientes; respuesta pública sin costes privados.
- Escritorio 1365×900 y móvil 390×844, comprobación visual y geométrica: aviso dentro de la imagen y sin solapar favorito/Quick Add. Hover, flechas, swipe táctil real mediante CDP, selección de talla y apertura/cierre de Quick Add funcionan. Se comprueban las catorce combinaciones también dentro de Quick Add, junto al precio, y su botón queda deshabilitado únicamente por agotado cuando no hay stock comprable.
- Colores efectivos de navegador: `rgb(217, 162, 27)` y `rgb(255, 100, 100)`, exactamente los valores originales. Puntos sin animación, un único aviso por superficie. Búsqueda de «Últimas tallas» en HTML, CSS, TS y JS del frontend: ninguna aparición, incluido el bundle regenerado. La ficha de producto también adopta el texto y cálculo compartidos para que no sobreviva ese aviso antiguo en otra vista.
- Casos 0, 1, 2, 3 y 4 tallas agotadas, agotado completo con una y dos tallas, recuento duplicado y talla externa: botón y mensaje correctos. Fecha idéntica a estimateCart bajo las mismas condiciones, sin solapamientos con botones/enlace; oculta si agotado. Estilos de tarjetas sin fondo, borde ni sombra comprobados en navegador.
- Cesta real local: añadir desde Quick Add un producto con pocas unidades, añadir otro desde recomendaciones, conservar ambos, retirar el segundo y reabrir. Sin textos decorativos en sus filas; recomendaciones con texto naranja al lado del precio y sin productos agotados. Comprobado en ambas dimensiones.
- Entrada AVÍSAME y enlace de una/dos tallas: navegan al producto correcto. AVÍSAME enfoca la sección, no elige talla ni llama a /api/waitlist antes de elegir. Tras elegir, GET consulta el estado; un visitante debe abrir el acceso y confirmar después. **Límite local confirmado:** el POST explícito devuelve HTTP 403 «Operación deshabilitada en la revisión local de datos históricos.» por `localReviewSafety`. Se conserva esta protección y se comprueba que el error se muestra y permite reintentar; no se declara una alta/cancelación real de avisos completada en navegador. Las validaciones de autenticación, elegibilidad, confirmación y cancelación del controlador/servicio pasan sus pruebas aisladas existentes, sin correo real.
- Doce aperturas/cierres sucesivos: máximo dos nodos de imagen mientras está abierto, cero al cerrar y cero nuevas peticiones de imágenes o catálogo durante el segundo de reposo observado. No se añaden peticiones por tarjeta, sondeos ni listeners por apertura.

### Revisión de lo que ya funcionaba y lo corregido

Ya funcionaban la persistencia y validación, vacío/0 como desactivación de últimas unidades, suma de stock disponible respetando reservas, punto fijo, actualización y las interacciones de tarjetas. Faltaba retirar el aviso antiguo bajo el precio, usar el color original en lugar de uno aproximado, trasladar agotado arriba con independencia del umbral y actualizar Quick Add para que usara ese mismo umbral y un punto fijo. Esta revisión corrige esas diferencias sin modificar datos reales de producción.

El encargo adicional sustituye el fondo negro de la revisión anterior por punto y texto sin etiqueta, añade las acciones según tallas agotadas y la fecha compartida en Quick Add, y separa la presentación de recomendaciones de las tarjetas normales. No cambia el campo del administrador, precios, existencias, reservas ni las comprobaciones de identidad.

Capturas locales, después de terminar el preloader. Para exportar el grid completo se amplía únicamente la altura del viewport de captura; las interacciones móviles se prueban a 390×844.

| Superficie | Escritorio | Móvil |
| --- | --- | --- |
| Tarjetas, todos los casos | [Captura](../output/playwright/last-units/desktop-cards.png) | [Captura](../output/playwright/last-units/mobile-cards.png) |
| Quick Add, últimas unidades | [Captura](../output/playwright/last-units/desktop-quick-add-low.png) | [Captura](../output/playwright/last-units/mobile-quick-add-low.png) |
| Quick Add, agotado | [Captura](../output/playwright/last-units/desktop-quick-add-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-out.png) |
| Quick Add, una talla agotada | [Captura](../output/playwright/last-units/desktop-quick-add-one-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-one-out.png) |
| Quick Add, tres tallas agotadas | [Captura](../output/playwright/last-units/desktop-quick-add-three-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-three-out.png) |
| Quick Add, cuatro tallas agotadas | [Captura](../output/playwright/last-units/desktop-quick-add-four-out.png) | [Captura](../output/playwright/last-units/mobile-quick-add-four-out.png) |
| Cesta y recomendaciones | [Captura](../output/playwright/last-units/desktop-cart-recommendations.png) | [Captura](../output/playwright/last-units/mobile-cart-recommendations.png) |
| Entrada a avisos sin talla elegida | [Captura](../output/playwright/last-units/desktop-alert-entry.png) | [Captura](../output/playwright/last-units/mobile-alert-entry.png) |

Regresión local de rendimiento con 51 productos, 6 imágenes activas y 3 archivadas por producto: listado inicial 159 ms (API 15 ms), editor inicial 97 ms (detalle 8 ms), listado posterior 107 ms. Cero tareas largas y cero peticiones/cargas de imágenes en editor inactivo y tras cerrarlo. Comprueba también borradores, respuestas antiguas, guardar stock/precio/coste privado, orden/restauración de imágenes, categorías, activación, paginación y Bulk Edit. Estas cifras son **locales**, no mediciones de producción. El benchmark ahora fuerza una navegación de documento en su muestra inicial: cambiar solo el hash podía reutilizar la página y omitir los contadores de esa muestra.

Los resultados temporales, capturas y credenciales desechables están en `output/playwright/last-units/`, excluidos de Git. Se han eliminado los catorce productos, sus cestas y el usuario de prueba; se conserva la copia local anterior a la migración.

Scripts mantenibles en `tests/admin-review/last-units-fixtures.cjs`, `last-units.browser.js` y `last-units-actions.browser.js`. El generador valida el destino local y produce ambos scripts privados para ejecutar por Playwright CLI (`run-code --filename`), en ese orden, con una sesión inicialmente en `/admin-login.html`. Al terminar, `node tests/admin-review/last-units-fixtures.cjs cleanup` comprueba la pertenencia de los datos antes de retirarlos. No introducir los scripts privados, credenciales o capturas en Git.

Verificación final con la compilación actual: `localhost:3000/api/health`, productos, categorías y los recursos `api.js?v=16` y `store.css?v=113` devuelven HTTP 200. Los recursos adicionales llevan products v68, app v87, quick-add.css v8, product-delivery v4 y waitlist v2. El catálogo incluye el umbral y ya no contiene los productos desechables; el CSS servido contiene los dos colores originales. La preparaci?n de publicaci?n posterior conserva estos recursos y las comprobaciones locales.

## Publicación posterior (no ejecutada)

Seguir `.github/workflows/deploy.yml` y `.github/scripts/deploy-production.sh`. Esta tarea requiere una migración; el backend nuevo no debe arrancar contra un esquema que carezca de la columna.

1. Revisar el diff y los despliegues activos. Confirmar explícitamente el destino de publicación, consultar **todas** las migraciones pendientes y guardar/verificar una copia de seguridad del destino antes de migrar.
2. Usar la instalación reproducible prevista (`npm ci` en raíz y backend), generar Prisma Client y compilar con los comandos del proyecto (`npm --prefix cronox-backend run prisma:generate`, `npm --prefix cronox-backend run build:compiled`, `npm run admin:build`). No añadir dependencias ni actualizar paquetes por esta función.
3. Aplicar con el flujo de publicación `prisma migrate deploy` las migraciones pendientes verificadas, incluida `20261007160000_product_last_units_threshold`. No usar `reset`, ni presuponer que las migraciones locales están en producción. La migración añade una columna nullable y un CHECK; no modifica stocks ni activa avisos existentes.
4. Arrancar el backend compilado y publicar los recursos/versiones HTML juntos. No requiere una variable de entorno nueva.
5. Verificar salud, historial de migraciones, recursos nuevos, DTO/API pública y editor. En producción, verificar las vistas sin alterar productos, pedidos ni inventario reales. No enviar correos ni realizar pagos de prueba reales.

## Confirmación AVÍSAME y preflight de publicación

El HTTP 403 de la revisión histórica local procede de `localReviewSafety`, que rechaza escrituras de `/api/waitlist` cuando `CRONOX_LOCAL_DEV=true`, antes del controlador. No se ha cambiado ni omitido este middleware. Producción no activa ese indicador.

Se ha completado el flujo real en una base PostgreSQL desechable independiente (`127.0.0.1:5433/cronox_avisa_release_test_*`), con esquema e historial de migraciones copiados del desarrollo local y sin copiar datos históricos. Las migraciones históricas requieren un baseline legado: por eso no se presentan como una instalación desde cero autosuficiente. El perfil de pruebas utiliza JWT y CSRF reales, correo y todos los workers desactivados, claves ficticias y ninguna credencial de producción.

Playwright CLI verifica en escritorio y móvil la entrada desde Quick Add sin talla preseleccionada, elección de S, inicio de sesión sin suscripción automática, confirmación HTTP 201, respuesta idempotente, persistencia tras recargar y cancelación HTTP 200. Se comprueba en base de datos que el único aviso pertenece al producto elegido y a S, sin reclamación ni aceptación de correo. Sin sesión: 401; sin CSRF: 403; talla con stock: 409. No se envían correos. Scripts mantenibles: `last-units-isolated.cjs` y `last-units-isolated.browser.js`; credenciales, logs y capturas quedan excluidos en `output/playwright/last-units-release/`.

Preflight de producción del 7 de octubre: destino confirmado `aws-1-eu-west-1.pooler.supabase.com:5432/postgres`; 78 migraciones aplicadas, sin fallidas y checksums coincidentes. Única pendiente: `20261007160000_product_last_units_threshold`. Copia privada previa del esquema público y sus datos: `/home/deploy/.cronox-ops/last-units-2026-10-07T12-29-57-570Z/public-before-last-units.dump`, 614415 bytes; índice de restauración verificado; SHA-256 `879c177d04deedccbabf6a9dd09b7493dc10885be35c39a76e3ca12856f9c42c`. No se copia la base de producción al repositorio.

Instalación reproducible de raíz y backend, Prisma Client y compilaciones Vite/Nest completadas. Se reutiliza la suite completa previa (202 suites, 1850 pruebas); se repiten 8 suites afectadas (108 pruebas), exportaciones CI (59 pruebas), comprobación de artefactos y smoke compilado: todo correcto. La publicación sigue el workflow existente, que genera, compila, aplica las migraciones pendientes mediante `prisma migrate deploy` y reinicia el backend. El resultado del workflow y la comprobación online se entregan al finalizar; este preflight no acredita por sí solo un despliegue terminado.

## Ajuste posterior de presentación

Tras el commit publicado `ddf8636`, el nuevo ajuste aumenta únicamente los avisos de las tarjetas de 10 a 11 px y elimina el punto de agotado en tarjetas y en el renderizado compartido de compra. Quick Add y «Completa tu outfit» conservan sus 12 px. Colores intactos: naranja `#D9A21B`, rojo `#ff6464`. Referencias locales actualizadas a api v17 y store.css v114 para evitar reutilizar recursos anteriores.

Verificado con Playwright en localhost:3000, escritorio 1365×900 y móvil 390×844: últimas unidades con punto fijo, agotado sin punto con umbral positivo, vacío y 0, posición a 8 px de los bordes superior e izquierdo, sin fondo/recuadro ni solapamiento con controles. Quick Add conserva tamaño, aviso junto al precio y restricciones de compra; recomendaciones conservan tamaño y color. Compilación frontend correcta y 89 pruebas afectadas pasan. Capturas ignoradas: `output/playwright/last-units/{desktop,mobile}-sizing-*`. Datos desechables retirados al terminar.

Publicación autorizada mediante el workflow habitual tras revisar estos cambios y repetir las 89 pruebas. No cambia el esquema: las 79 migraciones del destino están aplicadas y no existen pendientes ni fallidas. Las verificaciones online se realizan con los productos existentes, sin cambiar stock ni umbrales. Los estados que no estén presentes en producción se distinguen de las comprobaciones visuales locales.
