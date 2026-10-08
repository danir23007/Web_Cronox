# Live stats — revisión y corrección local, 8 de octubre de 2026

Corrección completada en local, conservando los cambios anteriores de identidad, newsletter y Mapa. Sin commit, push, despliegue ni modificaciones en producción. No se encontró `AGENTS.md` en el repositorio ni en sus directorios ascendentes.

## Diagnóstico y alcance de la reproducción

La causa confirmada del bloqueo era el consentimiento analítico: `live-presence.js` registraba su inicio como servicio de la categoría `analytics`, y `LiveStatsService.signal` descartaba también las peticiones que no llevaran ese consentimiento. Un visitante sin cuenta que no hubiera elegido cookies o las hubiera rechazado no enviaba presencia y tampoco podía registrarla por el endpoint. La suscripción a newsletter no era un requisito ni solucionaba ese bloqueo.

La reproducción anterior a la corrección usó Chromium, administrador y visitante en contextos independientes, HTML/recursos reales y el backend PostgreSQL local habitual. Sin elegir cookies: cero peticiones de presencia; al rechazarlas: cero; al aceptarlas: una petición y aumento del contador en una persona. Había una presencia de una reproducción local previa en la línea base: el total pasó de 1 a 2 al aceptar. Esa línea base no se presenta como la visita nueva. Evidencia: `output/playwright/live-stats/reproduction.txt`.

Otros problemas confirmados en el código:

- La presencia no esperaba la resolución de autenticación; los eventos posteriores solo reprogramaban un temporizador. El servidor valida la sesión, pero la espera del cliente también es necesaria para no tratar una identidad desconocida como anónima.
- No se comprobaba `response.ok`: errores HTTP de presencia se trataban como envío completado y retrasaban el siguiente intento normal.
- La exclusión de administradores eliminaba su prueba del navegador; al volver a ser anónimo podía emitirse otra identidad.
- La instantánea contaba cada prueba de navegador, incluso cuando varias pertenecían a la misma cuenta normal validada.
- La alternativa de CSRF usaba una ruta relativa fija, aunque la petición de presencia admitía una base de API configurada.

El panel ya tenía consultas automáticas, conservación de cifras ante error y protección por controlador contra respuestas de consultas anteriores. Se han verificado esas funciones; no se aumentó su caducidad ni se sustituyó un error por cero visitantes.

## Decisión sobre consentimiento e identidad

Tras consultar la diferencia entre presencia temporal e histórico, el usuario dejó la decisión técnica a criterio de implementación. Live stats funciona ahora con cualquier elección de cookies; el histórico diario y el resto de analítica conservan el consentimiento existente. La ayuda del administrador y la descripción de `cronox_live_visitor` en la política de cookies reflejan este comportamiento. No se han cambiado las reglas ni los totales del histórico en el código.

Se reutiliza la prueba firmada `cronox_live_visitor` existente: cookie HttpOnly, `SameSite=Lax`, ruta `/api`, `Secure` en producción, firma de hasta 24 horas. La base guarda su hash, no la prueba original. No se crea otro identificador anónimo, fingerprint ni sistema de autenticación. La presencia no guarda IP, correo ni URL completa: conserva sección, producto opcional y referencias temporales a sesión/cesta.

La misma prueba se mantiene al navegar, recargar, abrir pestañas, iniciar y cerrar sesión. El servidor actualiza la fila existente con la identidad validada. ADMIN/SUPERADMIN quedan excluidos en recepción y en la consulta; al excluirlos se elimina su fila, conservando la prueba para un cierre de sesión posterior. Las sesiones revocadas, inválidas o pertenecientes a cuentas no activas siguen fuera de la instantánea.

Las pestañas comparten cookie y Web Locks. Para navegadores sin Web Locks se conserva la alternativa de lease temporal compartida. La instantánea deduplica una cuenta normal entre diferentes pruebas de navegador y toma su sección válida más reciente; los anónimos se deduplican por prueba del navegador. Las cestas se siguen sumando una vez por cesta. Dos cuentas distintas utilizadas en un navegador conservan dos identidades diarias donde corresponde; el contador de presencia simultánea no se convierte en ese histórico.

## Cambios y tiempos

`live-presence.js` inicia la presencia sin depender de la categoría analítica, espera `CRONOX_AUTH_READY` y utiliza el estado y la comprobación de autenticación del proyecto. Se expone `CRONOX_refreshAuthState`, que reutiliza `initAuthState`, para recuperarse de una resolución desconocida sin navegación. Las páginas informativas que omiten `app.js` consultan el mismo endpoint validado de sesión. Un error de sesión conserva la identidad desconocida y se reintenta; no se transforma en visitante anónimo.

La publicación de autenticación usa una revisión para impedir que una lectura inicial antigua sobrescriba un login o logout posterior. La presencia vuelve a comprobar la revisión después de esperar CSRF. Mantiene una sola petición lógica pendiente y un único temporizador de heartbeat, limita las esperas, comprueba el estado HTTP y coalesce eventos. Al cambiar de identidad se cancela una preparación anterior; si el POST ya ha salido, se espera su respuesta antes de enviar la actualización siguiente, evitando superponerlo por cancelar y volver a abrir inmediatamente.

| Operación | Intervalo |
| --- | --- |
| Primer envío | Tras resolver autenticación y CSRF, sin esperar consentimiento |
| Heartbeat visible | 30 segundos |
| Eventos de foco/navegación/producto/cesta | Se agrupan; separación habitual mínima de 5,1 segundos desde el último envío correcto |
| Cambio de identidad | Actualización prioritaria tras terminar/cancelar la preparación anterior |
| Reintento de presencia fallida o autenticación no resuelta | 5 segundos; las esperas tienen límite de 10 segundos |
| Actualización del panel y punto rojo | 15 segundos mientras la pestaña administrativa está visible |
| Presencia activa | Última señal válida hace **menos de 120 segundos**, según el reloj de PostgreSQL |
| Limpieza | En señales/instantáneas y cada 60 segundos si se habilitan los trabajos |

Ocultar una pestaña pausa su heartbeat. Regresar, recuperar conexión o volver desde la caché de navegación lo reactiva. No se elimina una persona por ocultar una de sus pestañas, ya que otra puede seguir visible. Una presencia sin señales sale de las métricas a los 120 segundos desde su última actividad, no desde el momento de cerrar. El indicador puede tardar hasta la siguiente consulta de 15 segundos en reflejarlo. La consulta filtra por caducidad aunque el trabajo de limpieza esté deshabilitado en local.

El punto rojo distingue actividad, ausencia de actividad y estado no disponible. Un fallo conserva las últimas cifras con advertencia y reintento automático; no representa cero ventas/visitantes ni mantiene el indicador como si los datos estuvieran actualizados.

Caché actualizada en todas las páginas consumidoras: `cookie-consent.js?v=9`, carga dinámica de `live-presence.js?v=2`, `app.js?v=89`. El script del panel no necesita nueva versión porque no se ha modificado. No hay migración de presencia: cambian la lógica y la consulta, no sus columnas. Las migraciones de usuarios de la tarea anterior siguen en local.

## Comprobaciones de producción: solo lectura

- GET de los tres recursos públicos relevantes: respuesta 200, `Cache-Control: public, max-age=0`. El recurso publicado `live-presence.js?v=1` coincidía exactamente con el código anterior a la corrección y contenía el bloqueo por consentimiento. Se conservaron tamaño/hash y resultado en `production-readonly.json`.
- SELECT autorizado mediante Supabase: tabla `LivePresence` existente, cero filas almacenadas y cero filas recientes en ese momento. No se consultaron correos ni identidades personales.
- No se abrió un visitante sintético en producción, no se enviaron heartbeats allí y no se modificaron sus estadísticas. Tampoco se utilizó el endpoint de instantánea de producción, que puede ejecutar limpieza.

**No se ha reproducido la visita concreta del amigo en producción.** No se conoce su consentimiento, estado de red ni instante de visita. Se ha reproducido un bloqueo determinista del mismo flujo en local y se ha contrastado que ese cliente estaba publicado. No se atribuye el incidente concreto a caché, infraestructura o caducidad sin evidencia.

Pendiente después de un despliegue futuro expresamente autorizado: contrastar la nueva versión publicada, configuración efectiva de API/HTTPS/cookies y observar mediante lectura el siguiente visitante real no administrador, con su elección de cookies, así como la siguiente actualización del panel. Esta tarea no incluye ese despliegue.

## Pruebas y evidencias

- **83 pruebas en 9 suites**, todas correctas: Live stats, temporizadores DOM, consentimiento, autenticación/newsletter, histórico y puente de autenticación, acceso administrativo e identidad pública. Cubren espera desconocida, ADMIN/SUPERADMIN, autenticación atascada, HTTP fallido con Web Locks y con lease, revisión tras CSRF, construcción única, pestaña oculta y recuperación. La suite de newsletter emite avisos ya existentes de su fixture de favoritos, sin fallos.
- PostgreSQL efímero real: prueba de unicidad de invitado, misma cuenta entre pruebas distintas, ADMIN/SUPERADMIN excluidos, sección/producto más reciente, cantidades de cesta sin duplicar, sesión revocada y caducidad/limpieza. Instancia temporal detenida al terminar; no crea pedidos ni pagos.
- Chromium contra backend real local: dos contextos independientes administrador/visitante; autenticación inicialmente retenida, sin elección, rechazo y aceptación; mantenimiento; recarga, navegación y volver atrás; pestañas; login/logout; dos cuentas diarias y una presencia simultánea; cuenta normal en otro contexto; administradores y recargas excluidos; fallos HTTP de heartbeat y panel con recuperación automática; móvil.
- Revisión de heartbeat programado y **caducidad con reloj real**, sin adelantar el timestamp de ese visitante: tras cerrar el contexto, la ausencia y retirada automática del punto rojo se observaron unos 103 segundos después del cierre. Es compatible con los 120 segundos desde la última señal previa y el ciclo de consulta; el cierre no inicia un nuevo plazo. Resultado final: cero activos. Se adelantó únicamente la caducidad de otra presencia propia de QA para limpiar su caso intermedio, no para acreditar esta comprobación real.
- En la ejecución completa: 17 peticiones de presencia observadas y máximo de una pendiente hasta recibir respuesta. Evidencia: `browser-report.txt`.
- Capturas finales con un visitante anónimo real local, escritorio 1440 px y móvil 390 px, ayuda actualizada y punto rojo móvil. Inspección visual y comprobación de ausencia de desbordamiento horizontal. La captura de presencia caducada pertenece a la ejecución completa.
- Backend `build:compiled`, administrador `admin:build`, comprobaciones de sintaxis y `git diff --check`: correctos.

Las pruebas de histórico se ejecutaron exclusivamente en la base local protegida. Sus hechos ficticios quedan conservados y anonimizados al eliminar las cuentas de QA, conforme a la protección de histórico permanente del proyecto; no se desactivó esa protección ni se borró histórico real. Las reservas de sus IDs/códigos se conservan también. La base habitual vuelve a tener solo su cuenta administradora y ninguna presencia de QA activa. Correo y trabajos comerciales permanecen deshabilitados. El backend local sigue disponible en `http://localhost:3000/`; el helper de revisión se detiene al finalizar.

Para repetir:

```powershell
npm run build:compiled --prefix cronox-backend
node cronox-backend/scripts/review-live-stats-sql.cjs
# Con el backend local protegido en marcha, en otra terminal:
node tests/live-stats/review-helper.cjs
npx --yes --package @playwright/cli playwright-cli -s=live open http://localhost:3000/admin.html
npx --yes --package @playwright/cli playwright-cli -s=live run-code --filename tests/live-stats/review.cli.js
npx --yes --package @playwright/cli playwright-cli -s=live run-code --filename tests/live-stats/capture.cli.js
```

La revisión requiere que no haya otros visitantes locales activos. La prueba completa espera el heartbeat y la caducidad reales, por lo que tarda varios minutos. El helper acepta únicamente el entorno local protegido, escucha en loopback y usa cuentas ficticias; no imprime credenciales. La reproducción anterior `reproduce.cli.js` se conserva como evidencia del caso previo, no como aserción de bloqueo después de corregirlo.

Evidencias en `output/playwright/live-stats/`: `reproduction.txt`, `production-readonly.json`, `sql-report.json`, `browser-report.txt`, `captures-report.txt`, `before-desktop.png`, `after-desktop.png`, `after-mobile.png`, `menu-mobile.png`, `visitor-mobile.png` y `expired-mobile.png`.
