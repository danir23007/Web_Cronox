# Publicación conjunta autorizada: Favoritos, avisos y costes

La autorización posterior del usuario permite integrar los trabajos locales previamente verificados y publicarlos mediante el flujo habitual. La conciliación manual de ventas históricas queda expresamente fuera de la publicación.

## Alcance integrado

- Favoritos: un único contrato público de precios; céntimos en la respuesta HTTP, modelo de catálogo con priceCents en céntimos y price en euros. Se evita la segunda conversión del perfil, la inferencia por tamaño del número y la preferencia por un catálogo antiguo. Se refresca al volver a abrir la vista, recuperar foco/visibilidad y volver desde bfcache. Se conservan los favoritos ya guardados y los importes de pedidos históricos.
- Avisos: hover negro/blanco con elevación de 2 px solo en el botón, tallas activas según suscripciones confirmadas, varias tallas simultáneas, cancelación individual confirmada por el servidor, recuperación de estado y errores/reintentos coherentes. Ratón limitado a dispositivos compatibles; foco de teclado y táctil conservados.
- Costes: ampliación de evidencia para la conciliación local, tirada original o única demostrable, componentes de recepción, historial estable, cero explícito y casos ambiguos pendientes. Previsualización con origen e impacto; revisiones idempotentes sin modificar stock ni importes ajenos al coste.
- Pruebas, herramientas de reproducción aislada y documentación necesaria. Los informes con ventas reales, credenciales, dumps y capturas se conservan exclusivamente en carpetas ignoradas.

## Auditoría de ramas y copias

Antes de publicar, origin/main y producción coincidían en 5766a08ad124977e2dbc222a460817685e31e42c. Ya incluían el rediseño de agotados, negrita de Agotado y flujo de avisos por talla (77b268a8), además de la primera corrección de coste congelado, selector de tiradas e informes parciales (5766a08a). No se duplican esos cambios.

Las ramas locales de release, verificación, SSH y trabajo anterior no aportaban commits nuevos respecto de main. El worktree release-20261103 estaba limpio. La copia móvil antigua conservaba cambios sin commit, pero sus componentes, pruebas y gráficos ya coincidían con main; los HTML y CSS restantes contenían versiones de caché antiguas y modificaciones de pie ya publicadas. Se conserva esa copia sin trasladar retrocesos.

Dos checkouts temporales antiguos solo mostraban archivos eliminados y no tenían commits nuevos; no representan una solicitud de borrar el proyecto. Se mantienen intactos. Dos ramas remotas antiguas siguen separadas: restore-navigation-from-product-card (2025), cuyo comportamiento ya está sustituido por rutas limpias y lectura por slug, y maintenance/stripe-checkout-verification (septiembre), una auditoría de modo test incompatible con producción y ajena a estos arreglos. No se incorporan esos workflows ni se hace force push.

La consulta autenticada con permisos de administración confirmó que main no tenía protección ni reglas activas que exigieran PR. No había PRs abiertos. Se usa integración fast-forward y el workflow existente; el push ejecuta verificaciones y no despliega por sí solo.

## Validación

La batería completa integrada alcanza 297 suites y 3158 pruebas aprobadas. Se ajustan dos regresiones antiguas que confundían la talla objetivo con un aviso realmente guardado: abrir el selector ya no debe marcar un aviso inexistente, y la prueba de disponibilidad resuelve las lecturas iniciales antes de comprobar la compra.

También se verificaron las regresiones PostgreSQL desechables de Puntos/Mapa y tiradas, los 18 guardias Node del despliegue, seis suites Excel y sus artefactos/rutas compiladas, tipos de frontend y backend, compilaciones y comprobación de contenido privado. El controlador de despliegue contiene pruebas para Linux: su ejecución completa y autoritativa forma parte de verify-release en Ubuntu; Windows no permite ejecutar todos sus casos de permisos y sistemas de archivos.

Los recursos finales se regeneran con npm ci y las versiones exactas del lockfile. Cachés integradas: API v30, perfil v36, Favoritos v8, avisos JS v5/CSS v3 y store.css v131; la portada usa el hash del CSS minificado. Se preservan las versiones de los módulos de administración de costes ya publicados.

## Flujo de publicación y límites

Se publica por GitHub Actions → Deploy CRONOX, workflow_dispatch sobre main y publish=true, una vez aprobado el CI del commit exacto. Se respeta el controlador instalado y sus respaldos, preflight, migraciones normales, build y comprobación pública. No se añaden migraciones nuevas y ninguna fase invoca la conciliación de ventas históricas.

La comprobación posterior debe contrastar el SHA del servidor y los recursos servidos, salud/ready, ASHEN en catálogo y ficha al precio de su tirada activa, hover/selector de avisos sin altas ni bajas, y código/cálculos de costes mediante consultas de solo lectura. Las dos vistas autenticadas de Favoritos y los flujos que modifican suscripciones se verificaron con cuenta sintética local; la evidencia productiva autenticada depende de la sesión disponible, sin crear cuentas ni solicitudes de prueba en producción.

Los hashes finales, enlace al despliegue y resultados productivos se entregan en el cierre al usuario. El diario de ejecución y la evidencia privada permanecen fuera del árbol versionado, en output/playwright/release-20261111.
