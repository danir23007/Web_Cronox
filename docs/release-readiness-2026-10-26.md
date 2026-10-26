# Cierre local de verificaciones · 26/10/2026

Estado: correcciones y comprobaciones locales terminadas; cierre del CI Linux en curso en la rama exclusiva `verify/release-20261026-linux`, autorizado posteriormente por el titular. No se ha hecho merge, despliegue, cobro ni envío real. WebKit automatizado no acredita Safari en un iPhone físico.

## Ejecución Linux sin publicación

Se revisaron el diff y los workflows efectivos de la rama predeterminada, coincidentes con los locales. `Deploy CRONOX` solo responde a pushes de `main`; la rama de verificación se ejecuta mediante `workflow_dispatch` con **`publish=false` explícito**. El job `deploy` exige `inputs.publish=true`. El otro workflow actual, de SSH, es exclusivamente manual y no se invoca. La API de Pages confirmó `build_type=workflow`, sin publicación legacy por push. No se cambió ninguna configuración remota.

La rama parte de `8867cd12df8f5f444e4a4376cbb478322311e9d2`. Se incluyen fuentes, pruebas, recursos tipográficos y la migración ensayada; se excluyen credenciales, perfiles y resultados temporales de `output`. Resultado Linux y SHA exacto: pendientes de completar esta ejecución.

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

- **Obligatorio antes de publicar:** CI Linux del SHA definitivo. En este Windows, el controlador descubre 130 pruebas: 74 pasan, 46 se omiten y 10 fallan/no pueden cargarse por dependencias POSIX (`pwd`), permisos Unix y entorno de subprocesos Linux. No se relajaron esas pruebas ni se presenta el controlador como verificado íntegramente en Windows. El workflow ya las ejecuta en Ubuntu y bloquea deploy si fallan.
- No se ha identificado la causa histórica del 400. La falta de logs adecuados no bloquea la corrección demostrada de identificación/validación, pero debe conservarse como incertidumbre.
- No hay prueba en iPhone físico. WebKit Windows verifica comportamiento disponible, no barras del navegador, almacenamiento real de iOS o carteras del dispositivo.
- El checkout usa proveedor simulado; no acredita una nueva autorización real en Stripe sandbox, 3DS, Apple Pay o PayPal. La configuración y tipografía de Stripe se conservaron. No se efectuaron cobros.
- Las mediciones de concurrencia corresponden al equipo/base aislados, no a capacidad o latencia del VPS.

No queda un fallo de aplicación reproducido sin corregir en estos recorridos. La preparación local queda lista para revisión; no debe saltarse el CI Linux para publicarla.

## Pasos de publicación futura

1. Revisar el commit de la rama de verificación con fuentes, pruebas, fuentes tipográficas originales y la única migración nueva. No incluir perfiles de navegador ni archivos temporales de `output`. La preparación del commit y su push a una rama aislada se autorizaron en la tarea posterior de CI Linux.
2. Seguir [el procedimiento autónomo existente](autonomous-deployment.md): comprobar estado de Pages, push para CI y verificar que el SHA concreto sigue siendo `main`. El push por sí solo no publica. Exigir tipos, suite completa, builds, controller Linux, guards, recursos y smoke de exportaciones verdes.
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
