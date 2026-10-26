# Cierre local de verificaciones · 26/10/2026

Estado: primera ejecución Linux aprobada para `467816bb0a13e2682982b2edd161f192cb85e768`; repetición final pendiente tras corregir un fallo de dependencia descubierto en sus avisos. Rama exclusiva `verify/release-20261026-linux`. Commit y push de esa rama autorizados posteriormente por el titular. No se ha hecho merge, despliegue, cobro ni envío real. WebKit automatizado no acredita Safari en un iPhone físico.

## Ejecución Linux sin publicación

Se revisaron el diff y los workflows efectivos de la rama predeterminada, coincidentes con los locales. `Deploy CRONOX` solo responde a pushes de `main`; la rama de verificación se ejecuta mediante `workflow_dispatch` con **`publish=false` explícito**. El job `deploy` exige `inputs.publish=true`. El otro workflow actual, de SSH, es exclusivamente manual y no se invoca. La API de Pages confirmó `build_type=workflow`, sin publicación legacy por push. No se cambió ninguna configuración remota.

La rama parte de `8867cd12df8f5f444e4a4376cbb478322311e9d2`, que se conserva en `main`. Se incluyen los 166 archivos de fuentes, pruebas, recursos tipográficos e informe y la migración ensayada; se excluyen credenciales, perfiles y resultados temporales de `output`.

- **Commit comprobado:** [`467816bb0a13e2682982b2edd161f192cb85e768`](https://github.com/danir23007/Web_Cronox/commit/467816bb0a13e2682982b2edd161f192cb85e768).
- **CI:** [Actions 40408456804](https://github.com/danir23007/Web_Cronox/actions/runs/40408456804), `workflow_dispatch`, `publish=false`, 26/10/2026 21:56–21:58 UTC (22:56–22:58 Europe/Madrid).
- **Entorno:** Ubuntu 24.04.5, Node 22.23.3; dependencias instaladas con ambos lockfiles mediante `npm ci`.
- **Resultado:** `verify-release=success`; **`deploy=skipped`, sin pasos ejecutados**.

| Comprobación Linux | Resultado |
|---|---|
| Preflight, mantenimiento y gates Node | **16 correctas, 0 omitidas** |
| Controlador Python, instalación, recuperación e interrupciones | **143 correctas, ninguna omitida** |
| Generación Prisma y tipos frontend/backend | Correctos |
| Suite completa de aplicación | **3.021 pruebas / 277 suites correctas** |
| Builds frontend y backend | Correctos |
| Guardia de credenciales y contenido exclusivo de sandbox | Correcta |
| Referencias aprobadas y generador de acreditaciones | Correctos |
| Exportaciones | **59 pruebas / 6 suites correctas**, smoke de artefactos y rutas compiladas correctos |

El controlador carga en Linux los módulos que no podían importarse en Windows: por eso su total es 143 y no los 130 casos descubiertos allí. No se desactivaron pruebas ni se rebajaron validaciones. No se repitieron auditorías de producción, pruebas de carga ni ensayos de migración ya completados.

### Corrección surgida de los avisos de instalación

El CI inicial pasó, pero `npm ci` informó de dependencias vulnerables. La revisión acotada confirmó que `body-parser@2.3.0`, utilizado por `express.json` antes de autenticación, estaba afectado por [GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828), publicado el 22/10. Se reprodujo en un proceso hijo aislado: un frame gzip válido, terminador y bytes tardíos provocaban `Z_DATA_ERROR` no capturado y salida 1. No se probó contra producción.

Se fijó `body-parser` a **2.4.0** y su requisito `qs` a **6.16.1** mediante los overrides existentes y el lockfile; solo cambiaron tres paquetes instalados (incluido `content-type` 2.1.0). Se conserva la aceptación de cuerpos comprimidos, la validación y los límites. La regresión HTTP usa un proceso hijo y comprueba petición válida, bytes tardíos y rechazo 413 de un cuerpo descomprimido excesivo; después verifica la salud del mismo servidor. **11 pruebas focales correctas**, incluidas las 8 existentes de validación. La suite Linux debe repetirse sobre este cambio antes del cierre.

Los avisos restantes de `npm audit` no son gates del workflow: 1 alto en frontend (Vite de desarrollo) y 11 en backend (6 moderados, 5 altos, con avisos propagados entre dependencias). No se ejecutó `npm audit fix --force` ni se cambió Prisma de versión mayor. Se mantienen visibles como mantenimiento de dependencias; este CI no constituye una auditoría de seguridad completa ni acredita su ausencia. El fallo remoto confirmado de `body-parser` sí se corrigió y tiene regresión.

La comparación de hashes conserva todos los archivos pendientes incorporados al commit; el SQL de `20261026180000_storefront_concurrency` mantiene SHA-256 `8ab1ad256ad0139ab7770b30355e1c2d40ecc3e15306a35d7a6e05d757c792bb`. El diff de código no tiene errores de espacios; se conserva literalmente el archivo de licencia original OFL, incluido su espacio final en la línea 21. No se modificaron workflows ni configuración remota.

## Producción y proxy: evidencia de solo lectura

Revisión por SSH con la identidad configurada, host verificado y consultas SQL de solo lectura. Evidencia saneada: [production.json](../output/release-readiness-20261026/production.json).

- SHA publicado: `b183d238c11d29fa1d06f3782d008eebb2fc602a`. PM2 estaba online; el backend escucha únicamente en `127.0.0.1:3000`.
- Configuración efectiva del proceso: `NODE_ENV=production`, `TRUST_PROXY_HOPS=0`, límite general de 100 por 60.000 ms, con límites específicos por ruta.
- Nginx envía a ese listener y sobrescribe `X-Real-IP` con `$remote_addr`; construye `X-Forwarded-For` mediante `$proxy_add_x_forwarded_for`. No se encontraron reglas adicionales `real_ip`, `limit_req` o `limit_conn` en la configuración revisada.
- La versión publicada utiliza el tracker predeterminado de Nest: `req.ip`. Sin confianza de proxy, Express obtiene la IP del socket: usuarios distintos llegan como el mismo proxy local. Por tanto, comparten el contador de cada ruta. Es un defecto confirmado de identificación, compatible con el incidente comunicado del **24/10, 18:00–20:30 Europe/Madrid (16:00–18:30 UTC)**. No hay trazabilidad para atribuir cada intento histórico a ese contador.
- La implementación local pendiente separa correo normalizado, usuario con JWT verificado, carrito y red. Persiste contadores atómicos en PostgreSQL y conserva un techo por red para evitar la rotación ilimitada de identidades. Las claves almacenadas son HMAC; conserva cuotas y `Retry-After`.
- Con el proxy actual, `requestNetwork` acepta `X-Real-IP` solo de un peer loopback exacto y si contiene una IP válida. Nginx sobrescribe la cabecera del visitante. Una prueba HTTP con dos clientes y un proxy aislado demuestra que la versión publicada los agrupa y la local los separa, incluyendo cabeceras falsificadas. No hace falta cambiar `TRUST_PROXY_HOPS` ni Nginx para este contrato. Si se añade otro proxy/CDN o se expone el puerto del backend, hay que revisar ese contrato.

Referencias del comportamiento: [Express: behind proxies](https://expressjs.com/en/guide/behind-proxies/), [Nginx: proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header).

## «Bad Request»: defecto reproducido y límite histórico

Los logs PM2 accesibles no contienen entradas identificables de `Bad Request`, validación o `ThrottlerException`. El usuario deploy no puede leer los logs de acceso/error de Nginx. No se cambiaron permisos. **No hay evidencia suficiente para determinar la causa del 400 de la tercera fotografía**, y el arreglo de los 429 no se presenta como solución demostrada de ese incidente.

Sí se reprodujo otro defecto concreto: `disableErrorMessages` hacía que validaciones de formularios en modo producción devolvieran únicamente `Bad Request`. Se corrigió con:

- Mensajes españoles acotados por campo para registro, login y newsletter; siguen activos whitelist, rechazo de campos no admitidos y validaciones originales.
- JSON malformado: mensaje comprensible y sin fragmentos del cuerpo enviado.
- `X-Request-ID` generado en servidor y diagnóstico estructurado de solicitudes fallidas: ruta conocida, estado, motivo y nombres permitidos de reglas/campos. No incluye contraseña, correo, IP, cookies, valores introducidos ni nombres arbitrarios de campos.
- Las demás validaciones y respuestas conservan su tratamiento anterior.

Las pruebas cubren formato, nombre, correo, contraseña, campos extra, concurrencia, cuenta existente, CSRF y ausencia de datos sensibles en respuesta/diagnóstico. La UI conserva la edición ante error y distingue conflicto de cuenta, conexión y límite temporal.

Durante la revisión WebKit también se detectó un enfoque tardío del modal que podía interrumpir el rellenado rápido. Ahora el enfoque inicial respeta el campo ya elegido y un modal cerrado. Hay prueba de regresión y versión de caché de `app.js` actualizada a 104.

## Verificaciones del estado final

Resultados y logs: [output/release-readiness-20261026](../output/release-readiness-20261026/). Datos de registro, pedidos y pago exclusivamente ficticios. Bases temporales independientes; correo en memoria y trabajadores desactivados.

| Comprobación | Resultado |
|---|---|
| Jest completo, estado final de la aplicación | **3.021 pruebas, 277 suites** correctas |
| Tipos frontend y backend; builds frontend y Nest | Correctos |
| Pruebas Node de preflight, mantenimiento y gates | **16 correctas** |
| Exportaciones: tests, artefactos y rutas compiladas protegidas | **59 pruebas / 6 suites**; ambos smoke correctos |
| Guardia de contenidos privados/sandbox del release | Correcta |
| Recursos aprobados y generador del modelo 3D | Correctos; cinco referencias y cuatro salidas verificadas |
| Carrito Playwright, Chromium + WebKit | **83 correctas, 1 omitida**: el gesto CDP de tacto solo existe en Chromium |
| Newsletter Playwright, Chromium + WebKit | **30 correctas** |
| Newsletter con PostgreSQL real aislado | **72 escenarios UI + 18 de seguridad**, ambos motores; footer/popup y móvil/escritorio |
| Carrito/favoritos con PostgreSQL real aislado | **28 escenarios de navegador**, dos pestañas, respuestas fuera de orden, doble clic, pérdida de respuesta y 429 |
| Concurrencia de servidor | **40 lotes, 1.565 solicitudes + 18 comprobaciones de consistencia**; inventario de 111 rutas |
| Sesiones | Ambos motores: registro, recarga, renovación por visita, interrupción de red/DB, refresh concurrente, caducidad y cierre explícito; navegador realmente cerrado/reabierto, con recuperación y con logout |
| Checkout UI | **8 escenarios**, invitado/cuenta, 390/1366 px, ambos motores; datos incompletos bloqueados, pago montado simulado, doble clic, rechazo y reintento sin perder datos |
| Checkout de servidor | Última unidad, totales, propiedad, reutilización, confirmación duplicada, devolución y liberación de stock: PostgreSQL real y proveedor simulado |
| Copyright/layout | **162 escenarios** en ambos motores: cuenta, pestañas, carga dinámica, orientación, cesta, favoritos, información/legal, tienda, producto y checkout |
| Footer/tipografía/tarjetas | Ambos motores, 320/390/768/1101/1366/1920/2560 px; textos de newsletter en una línea en escritorio, logos verticales, Instagram, desplegables, títulos largos, rebajas y agotados |

Se verificó en servidor que abandonar el primer paso no crea cuenta/suscripción/código/bienvenida; completar crea exactamente uno de cada elemento aplicable. Fallos de transacción revierten las escrituras. La cuenta existente exige autenticación y no se reemplazan sus credenciales. El checkout sigue permitiendo comprar como invitado.

La sesión tiene un plazo de servidor de 500 días con renovación por visita legítima. Chromium limitó la cookie a 400 días; WebKit Windows informó 500. No se promete que todos los dispositivos conserven cookies durante todo ese plazo. Se comprobó `SameSite=Lax` en la cabecera real: WebKit Windows lo informa como `None` al consultar su almacén automatizado; no se cambió la política de cookies de la aplicación.

Dos ajustes necesarios del instrumental:

1. El generador de metacrilatos no reproducía los cambios tipográficos pendientes. Se incorporó la composición de fuentes y las excepciones de números romanos en el generador; **el CSS generado y los originales permanecen byte a byte como estaban al empezar esta revisión**.
2. El smoke compilado de exportaciones suponía que el limitador no necesitaba DB. Se trasladó su arranque a un bootstrap exclusivo de pruebas con los módulos compilados y el proveedor de almacenamiento en memoria de Nest. Conserva los guards reales de autenticación, CSRF y limitación. Producción sigue usando PostgreSQL; no se añadió una vía para desactivar su limitador. Este smoke verifica las rutas compiladas, no un arranque productivo completo con proveedores externos.

WebKit puede comunicar cancelaciones de peticiones durante la sustitución del documento como errores de acceso. Se confirmó la correspondencia con las trazas y el [incidente documentado por Playwright/WebKit](https://github.com/microsoft/playwright/issues/43120). El instrumental conserva esos eventos aparte **solo durante una navegación y para fetch del mismo origen**. Los errores de una página estable siguen fallando. Las primeras ejecuciones y sus trazas se conservaron, no se cuentan como éxitos.

Capturas revisadas: [footer escritorio](../output/playwright/footer-cards/after-footer-1366.png), [footer móvil](../output/playwright/footer-cards/after-footer-390.png), [tarjetas](../output/playwright/footer-cards/after-cards-1366.png), [cuenta corta móvil](../output/playwright/copyright/after-orders-empty-390.png), [pedidos largos](../output/playwright/copyright/after-orders-populated-1366.png). Hay mediciones por motor en los JSON `*-footer-cards-final` y `*-copyright`.

## Migraciones y recuperación

Producción tiene **103 migraciones terminadas y ninguna fallida**. Todas coinciden con los archivos publicados; las diferencias iniciales de checksum se explican por LF/CRLF y coinciden al normalizar. Incluye `20261019100000_mail_template_private_metadata` y las carpetas canónicas. No se editaron migraciones ya aplicadas.

Única pendiente: `20261026180000_storefront_concurrency`. Añade `CartOperation` (clave compuesta, FK al carrito y borrado en cascada) y `RequestRateWindow` (contador e índice de caducidad). Activa RLS y revoca privilegios de PUBLIC. El rol productivo revisado tiene BYPASSRLS, sin ser superusuario.

Orden: conservar todo el historial existente, aplicar esta migración mediante `prisma migrate deploy` **antes de arrancar el backend nuevo**. El resultado esperado es 104 migraciones terminadas. La versión anterior no utiliza las nuevas tablas y sus operaciones sobre carrito siguen siendo compatibles; la nueva versión necesita ambas tablas.

[Ensayo aislado](../output/release-readiness-20261026/migration-rehearsal.json): esquema del SHA publicado, datos ficticios, historial anterior marcado como aplicado, deploy real de la única pendiente, conservación de carrito, SQL anterior compatible, PK/FK/cascada/permisos, segunda ejecución sin cambios. Una prueba separada de fallo en un lote SQL no deja ninguna tabla nueva. **No es una restauración de datos productivos ni una garantía de rollback automático del controlador.**

El procedimiento existente mantiene mantenimiento y escritores detenidos si falla. `recover SHA` solo permite volver a arrancar la misma versión en fases anteriores a instalación/migración (`maintenance`, `stop`, `backup`), con HEAD e historial intactos. Desde `install`/`migrate`, exige una corrección hacia delante revisada. No ejecutar `migrate reset`, `db push`, `migrate resolve`, down-migrations ni restauraciones improvisadas. Si la conexión se pierde, consultar el estado del mismo SHA; no repetir la publicación por intuición.

## Limitaciones y condición de publicación

- **Cerrado el pendiente de CI Linux:** el SHA indicado arriba supera todas las comprobaciones y las 143 pruebas del controlador, sin omisiones. El resultado parcial anterior en Windows (130 casos descubiertos, 74 correctos, 46 omitidos, 10 fallos/cargas imposibles por POSIX) queda como evidencia histórica, no como resultado definitivo. El workflow conserva su bloqueo de deploy ante cualquier fallo.
- No se ha identificado la causa histórica del 400. La falta de logs adecuados no bloquea la corrección demostrada de identificación/validación, pero debe conservarse como incertidumbre.
- No hay prueba en iPhone físico. WebKit Windows verifica comportamiento disponible, no barras del navegador, almacenamiento real de iOS o carteras del dispositivo.
- El checkout usa proveedor simulado; no acredita una nueva autorización real en Stripe sandbox, 3DS, Apple Pay o PayPal. La configuración y tipografía de Stripe se conservaron. No se efectuaron cobros.
- Las mediciones de concurrencia corresponden al equipo/base aislados, no a capacidad o latencia del VPS.

No queda un fallo de aplicación reproducido sin corregir; falta el CI del ajuste de `body-parser` antes de declarar preparada la revisión definitiva. Permanecen pendientes, por separado, la aceptación en iPhone físico y el recorrido real de Stripe sandbox/3DS/carteras. No puede declararse compatibilidad física ni pago externo verificados; si son condiciones de aceptación de la publicación, deben completarse antes de autorizarla. Los avisos de dependencias restantes se detallan arriba y no se confunden con pruebas aprobadas. La integración en `main` y la publicación no están autorizadas en esta tarea.

## Pasos de publicación futura

1. Revisar y autorizar la integración de `verify/release-20261026-linux`, cuyo código ya tiene CI verde en el SHA indicado. El commit posterior de cierre contiene exclusivamente este informe. No incluir perfiles de navegador ni archivos temporales de `output`. No se ha realizado merge ni push a `main` en esta tarea.
2. Tras esa autorización, seguir [el procedimiento autónomo existente](autonomous-deployment.md): comprobar estado de Pages, integrar y verificar el SHA concreto en `main`. Si la integración genera un SHA nuevo, exigir su CI verde; no atribuirle automáticamente el resultado de otro commit. El push por sí solo no publica. Exigir tipos, suite completa, builds, controller Linux, guards, recursos y smoke de exportaciones verdes.
3. Con autorización de publicación del SHA exacto, invocar **Deploy CRONOX → workflow_dispatch → publish=true**. No ejecutar un despliegue alternativo por SSH.
4. El controlador hace preflight, mantenimiento, parada, respaldo con restauración comprobada, instalación, migración, arranque pausado, health/ready y gates, activación normal y reapertura. Mantener este orden y las restricciones instaladas. No cambiar la confianza del proxy ni las cuotas durante el despliegue.
5. Consultar `sudo -n /usr/local/sbin/cronox-release status <SHA>` hasta resultado terminal. Ante fallo, seguir la fase y las reglas anteriores; conservar respaldo y diagnóstico. No reencolar bienvenidas ni ejecutar reparaciones históricas.

Después de publicar:

- Confirmar SHA, 104 migraciones terminadas, tablas nuevas, health/ready, PM2 online/loopback y web pública en ambos dominios. Verificar telemetría habitual y ausencia de errores de DB o contador.
- Navegar tienda, producto, cesta, cuenta, footer/legal y checkout; verificar las fuentes y `app.js?v=104`, sin caché antigua. Revisar una página corta y otra larga.
- Revisar login/logout, carrito y favoritos con una cuenta de revisión autorizada, sin compra ni alta ficticia en producción. Observar los contadores/429 y los nuevos identificadores de diagnóstico sin registrar datos sensibles.
- Para una prueba completa con escritura, usar el entorno aislado/sandbox; una prueba de correo o pago en producción requiere autorización propia.

Comprobación breve en iPhone físico, sobre revisión/sandbox autorizado:

1. Safari normal, cerrar pestañas previas; probar footer y popup con direcciones de prueba distintas. Abandonar primero y confirmar que no hay alta; después completar y comprobar una sola cuenta/suscripción.
2. Probar nombre/contraseña inválidos, pérdida de conexión, reintento y cuenta existente mediante login. Confirmar que no pide de nuevo el correo y no reemplaza credenciales.
3. Cerrar completamente Safari y reabrir Mi cuenta; comprobar sesión, luego cerrar sesión expresamente y repetir. Probar dos pestañas y volver desde segundo plano.
4. Añadir/modificar cesta y favoritos; entrar al checkout como invitado. Revisar teclado, orientación, scroll y rechazo/reintento usando exclusivamente el proveedor de prueba.
5. Revisar footer, desplegables, tipografía y copyright en pedidos vacíos y contenido largo, sin recortes ni scroll horizontal.
