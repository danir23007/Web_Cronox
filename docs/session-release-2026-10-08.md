# Publicación de las mejoras de la sesión — 8 de octubre de 2026

## Alcance y preparación

La lectura de Git, remoto y VPS confirmó `c83eb3cb95e0687939014316f1e8e37b47102875` como base publicada. El Mapa inicial y la protección principal de newsletter ya formaban parte de esa base; la ampliación territorial, identidad, vinculación de newsletter, Live stats, Favoritos, carrusel y correo de contacto seguían en local. Se publican juntos, conservando esos comportamientos existentes.

No existe `AGENTS.md` en el repositorio ni en los ascendentes; el global está vacío. No se añaden migraciones duplicadas ni se alteran las aplicadas. Las dos preparadas preservan los ID internos y sus relaciones, códigos emitidos y tokens QR, reservan identidades incluso tras borrar cuentas y rechazan colisiones. No hay inventario de acreditaciones eliminadas anterior a la reserva; sigue vigente la limitación histórica del informe de identidad.

El cierre de sesión tenía dos limpiezas de `sessionStorage` que podían borrar la marca de newsletter. Ambas conservan ahora `cronoxNewsletterShown`, incluso tras recargar o volver a crear el controlador. Se incrementan `app.js` a v90 y `profile.js` a v20. La prueba nueva confirma conservación de la marca y eliminación de la caché privada de cuenta.

## Respaldo y recuperación

Copia privada recuperable de todo el esquema de aplicación `public` en el VPS:
`/home/deploy/cronox-release-backups/session-20261008-joXODH/database.dump`.
SHA-256: `aa821fad5b25e5b117ee1a5b0994133dcbecd154cc81cc663ddf7ea32b8096d1`.

Antes del despliegue se restauró realmente en PostgreSQL 18.6 aislado, socket Unix privado, sin TCP ni aplicación/trabajadores. Se verificaron 40 usuarios y cinco suscripciones y se ejecutaron las dos migraciones sobre esa restauración: ID internos, códigos emitidos y QR conservados. El clúster de verificación se detuvo. Esta copia no incluye esquemas gestionados por Supabase ni ficheros privados de correo; estos no se modifican en esta publicación. Dump, inventario detallado y logs están fuera del checkout, con permisos privados, sin credenciales ni datos personales en el commit.

Ante un problema, conservar el código compatible con las migraciones aditivas y corregir hacia delante. Para investigar una recuperación de datos, restaurar primero el dump en una instancia aislada siguiendo la verificación del operador `scripts/release-session-production.cjs`; comparar registros y reconciliar las escrituras posteriores. No restaurar todo sobre producción automáticamente, no resetear y no borrar reservas o cuentas. Un rollback de código debe revisarse por compatibilidad: la creación antigua de usuarios podría intentar cambiar códigos ahora inmutables. Las cuentas nuevas reparadas no deben eliminarse como supuesto rollback.

## Validación previa

- Prisma 6.19.3: esquema válido, cliente generado y backend Nest compilado.
- Vite 7.3.6 / Node 22: build del panel correcto, SVG local de 19 comunidades y 52 provincias/ciudades generado e incluido junto a GeoJSON y licencia.
- Jest completo final: **209 suites y 1.970 pruebas correctas**, incluyendo las regresiones nuevas de logout y click táctil residual. El ajuste de visor pasó además 107 pruebas en tres suites y ambos builds.
- PostgreSQL desechable: identidad/migraciones/newsletter concurrente/reparación, favoritos persistidos y presencia/deduplicación/caducidad correctos.
- Exportaciones CI: 59 pruebas; verificaciones de artefactos y rutas compiladas correctas.
- Cinco errores en `tsc -p tsconfig.admin.json --noEmit` siguen pendientes: stock posiblemente indefinido y cuatro métodos ausentes de la declaración de API. Se reprodujeron exactamente los mismos cinco sobre los archivos extraídos del commit base, cambiando únicamente la ruta del import para ejecutar esa copia aislada. No hay errores nuevos; el chequeo no se declara aprobado ni se desactiva.
- Se corrigieron fixtures de Bulk Edit para cargar el formateador real y expectativas de caché/allowlist de recursos para las nuevas versiones y la cartografía autorizada.

## Flujo de publicación

GitHub Actions de `main` valida y despliega. Genera Prisma, aplica `migrate deploy`, compila y reinicia una sola vez por release. El wrapper actualiza por `git merge --ff-only` y usa `deploy-vps-release.sh` con la misma secuencia; no usa el `reset --hard` del script antiguo. Se preserva el archivo ajeno `cronox-backend/src/main.ts.cronox-before-stripe` del VPS. Los cambios solo en `docs/**` no reinician una aplicación cuyo código no cambió.

La reparación autorizada se ejecutó después de migrar y con dry-run previo. El operador no inició Nest ni servicios de correo. Vinculó exclusivamente suscripciones confirmadas pendientes, sin contraseñas, fusión, borrado ni trabajos de correo. Verificó los dos ejemplos mediante variables efímeras y solo registró alias y sus ID/códigos. La reparación del contenido editable devolvió cero filas porque no existía ninguna coincidencia; no alteró contenido ni revisiones.

## Despliegues completados

- `4ecb2730fc0bb9e90f3d375a840451259e11447d`: mejoras de la sesión, migraciones, herramientas y documentación. [Workflow 37788342263](https://github.com/danir23007/Web_Cronox/actions/runs/37788342263), verificación y despliegue correctos; finalizó el 8 de octubre a las 16:00:37 Europe/Madrid.
- `c2488d4f7bcee64b2a9aa1736c0452ad8e054635`: corrección adicional del click móvil retargeteado, confirmada durante la revisión real. [Workflow 37790679778](https://github.com/danir23007/Web_Cronox/actions/runs/37790679778), verificación y despliegue correctos. El VPS confirmó ese SHA y `/api/health` y `/api/ready` correctos. El segundo despliegue no tenía migraciones nuevas ni repitió la reparación.
- Solo se aplicaron `20261008120000_stable_user_identity_newsletter_link` y `20261008121000_prevent_deleted_user_id_reuse`. `prisma migrate status` posterior confirma las **81 migraciones al día**, ninguna fallida.

La corrección táctil evita que el click que sigue a `pointerup`, al quedar dirigido al stage recién abierto, lo cierre de inmediato. El fondo solo se cierra por una pulsación iniciada dentro del visor; controles y Escape se conservan. No se compensa con otro tiempo arbitrario. Se incrementó `gallery.js` a v18. El fallo se reprodujo en la web real antes de corregirlo, con traza de eventos, y el cambio local dejó de cerrarlo ante esa misma secuencia.

## Reparaciones ejecutadas

Dry-run real: dos suscripciones confirmadas sin cuenta y tres vínculos ausentes, sin ambigüedades ni colisiones. Se procesaron **cinco registros**: dos cuentas nuevas PRE_REGISTERED y tres vínculos con cuentas existentes. Resultado: **42 usuarios, cinco suscripciones, cero huérfanos y cero vínculos pendientes**. No se modificaron contraseñas ni estados de cuentas existentes, no se fusionaron/borraron cuentas y el número de trabajos de newsletter no cambió. La auditoría repetida tras el segundo despliegue vuelve a mostrar cero pendientes.

| Ejemplo aportado | ID interno | ID público | Cuenta y vínculo |
| --- | --- | --- | --- |
| eva… | 44 | CRX-000042 | PRE_REGISTERED, consentimiento conservado y suscripción vinculada |
| naki… | 43 | CRX-000041 | PRE_REGISTERED, consentimiento conservado y suscripción vinculada |

El servicio desplegado de Usuarios incluye ambos en la búsqueda exacta y devuelve el mismo código en la ficha; total global 42. Estas comprobaciones se hicieron en READ ONLY, sin crear una sesión de autenticación.

`FooterPageContent.html` no contenía el correo antiguo: se ejecutó la sustitución idempotente autorizada y devolvió cero registros. Las páginas estáticas se publicaron corregidas. No queda esta reparación pendiente.

## Verificación real y límites

- Catorce recursos públicos (JS/CSS, ambos SVG, GeoJSON provincial y licencia) responden 200 y coinciden con los locales normalizando finales de línea; referencias de caché vigentes.
- Servicios desplegados contra datos reales, en transacción READ ONLY: Mapa con 19 comunidades y 52 provincias/ciudades, totales idénticos en ambos modos y cero ventas en 1–8 de octubre y en un período vacío adicional; Favoritos con siete productos, tres favoritos actuales y tres usuarios. Sin datos simulados en producción.
- Endpoints de Favoritos, Mapa y Live stats responden 401 sin sesión; no se debilitó la protección para acceder.
- Se observó una visita anónima de revisión con analítica desactivada: instantánea real pasó de cero a un invitado y después volvió a cero por caducidad. No se adelantaron timestamps ni se borraron presencias manualmente. El histórico diario mantuvo 40 filas. Heartbeat 30 s, caducidad 120 s y consulta normal del panel 15 s.
- Las cinco páginas informativas públicas contienen `support@cronox.es` y no el correo antiguo. Los enlaces conservan `mailto:support@cronox.es`.
- Chromium sobre la web publicada sin reemplazar código ni respuestas: primera apertura automática anónima marcada en el momento de abrir; cierre, tres navegaciones, recarga y vuelta atrás no la repiten; otro contexto independiente la muestra de nuevo. El recorrido termina sin errores JavaScript. No se enviaron formularios de suscripción.
- Carrusel real publicado: 20 px en escritorio durante tres cambios de slide por teclado, 30 px en móvil sin desbordamiento horizontal; apertura táctil y siguiente foto mantienen el visor abierto. Se tomaron capturas con la fotografía principal y la primera imagen de producto cargadas, inspeccionadas visualmente. Recursos/fotografías reales, sin fixtures de ventas ni productos.
- El recorrido completo recibió 14 respuestas 204 de presencia, máximo una petición pendiente, cookie de prueba HttpOnly/Secure en `/api`, cero POST de analítica. Al cerrar el contexto, la instantánea volvió a cero a las 16:21:15 Europe/Madrid y las filas diarias continuaron en 40. La caducidad se observó sin cambios manuales ni simulación de reloj.

Evidencias locales, excluidas del commit: `output/playwright/release-2026-10-08/complete-tests.json`, `resources.log`, `public-browser.log`, `captures.log`, `newsletter-production.png`, `carousel-production-desktop.png` y `carousel-production-mobile.png`. La copia y los informes privados de reparación permanecen en el directorio de respaldo del VPS. El navegador móvil adicional usado para capturas bloqueó presencia/analítica para no generar otra identidad; la recepción real corresponde al contexto anónimo del recorrido completo.

No había una sesión administrativa ni de usuario normal disponible en navegador. Por tanto quedan pendientes las comprobaciones visuales **autenticadas** en producción: tabla/ficha/acreditación, navegación y Mapa (ambos modos y sus estados), pantalla y resúmenes de Favoritos, actualización del panel/punto rojo, newsletter con usuario real suscrito/no suscrito y login antes del temporizador, y transición de presencia por login/logout con cuentas reales. Se verificaron los servicios reales y recursos, pero eso no se presenta como una comprobación visual de esas pantallas. Las pruebas locales documentadas cubren esos casos. No se cambiaron contraseñas, crearon sesiones, enviaron correos, realizaron pedidos/pagos o suscripciones de prueba para obtener acceso.
