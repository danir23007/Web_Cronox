# Cierre local de verificaciones · 26/10/2026

**Publicación completada el 27/10/2026:** SHA `7952ed37f84e41951b02b35a04a5b9e894772079`, CI Linux y Deploy CRONOX correctos, 104 migraciones terminadas y web reabierta. Véase el [cierre de publicación y sus límites de verificación](release-publication-2026-10-27.md). Los apartados siguientes conservan la preparación y su historial.

Estado de preparación: **dependencias revisadas, tarjeta Stripe sandbox con webhooks originales y CI Linux aprobados**. Código comprobado: **`d92b7f0633d6b29a8a5d3f4f03fc6c89cd2a3f43`**, rama `verify/release-20261026-linux`; **`f7c12a6a57fcb2346e688d1a1400c102dac96999`** añade únicamente documentación. Las pruebas no cobraron dinero real ni enviaron correo.

## Autorización de publicación · 27/10/2026

El titular autoriza integrar esta versión en `main`, hacer push, aplicar las migraciones y publicar mediante **Deploy CRONOX / workflow_dispatch / publish=true**, con CI Linux satisfactorio para el SHA final. La integración y la publicación se ejecutan por separado; no se permite force push ni un despliegue alternativo por SSH.

**iPhone físico: no realizado y omitido expresamente por decisión del titular.** El entorno de revisión no cargaba correctamente sus recursos. Esta aceptación deja de ser requisito de publicación; no se prepara otro sandbox ni se sustituye por emulación. Se mantienen las limitaciones de carteras y métodos de pago no acreditados descritas abajo.

Antes de integrar se ha contrastado Git local/remoto: `main` sigue en `8867cd12df8f5f444e4a4376cbb478322311e9d2`, la rama de verificación coincide con `f7c12a6a57fcb2346e688d1a1400c102dac96999` y no hay cambios posteriores de aplicación. Pages conserva `build_type=workflow`; el workflow efectivo coincide con el revisado: push a `main` solo verifica, publicación exclusivamente manual. Se conserva la migración ensayada y su checksum. Los archivos privados y `output/` quedan fuera de los commits.

La evidencia de integración, CI del SHA final, controlador y verificaciones públicas se registrará en el cierre de publicación. Los resultados históricos siguientes conservan su fecha y alcance.

## Cierre de los pendientes concretos

### Dependencias y commit comprobado

La [matriz de dependencias](release-dependencies-2026-10-26.md) documenta **los 18 avisos únicos**, condiciones de explotación, consumidores del proyecto y conclusión individual. Se aplicaron exclusivamente actualizaciones compatibles de Vite, Multer, Nodemailer y su parser, sanitize-html, fast-uri, ip-address y SMTP de pruebas. Quedan **0 avisos frontend y 3 entradas backend de un único aviso** de `deepmerge-ts` en el CLI de Prisma. Su condición —objetos cíclicos no fiables en configuración local— no existe en el recorrido publicado de clientes; se acepta como mantenimiento no bloqueante, con el alcance de la migración mayor Prisma documentado. No se oculta ni se marca resuelto.

[CI Linux 40413530898](https://github.com/danir23007/Web_Cronox/actions/runs/40413530898), **26/10/2026 22:35–22:39 UTC** (23:35–23:39 Europe/Madrid), sobre [`d92b7f0633d6b29a8a5d3f4f03fc6c89cd2a3f43`](https://github.com/danir23007/Web_Cronox/commit/d92b7f0633d6b29a8a5d3f4f03fc6c89cd2a3f43):

| Comprobación | Resultado definitivo |
|---|---|
| Aplicación Jest | **3.036 pruebas, 279 suites correctas** |
| Controlador Linux | **143 correctas**, ninguna omitida |
| Preflight/mantenimiento/gates | **16 correctas** |
| Exportaciones | **59 pruebas, 6 suites**, smoke de artefactos y rutas correctos |
| Prisma, tipos frontend/backend y ambos builds | Correctos |
| Guardias de secretos/sandbox y recursos aprobados | Correctos |
| Publicación | `publish=false`, **deploy omitido sin pasos** |

`bfc794cd` conserva su CI anterior; `e757e086` solo documentó aquel resultado. El nuevo CI es necesario porque ahora sí cambiaron los lockfiles. El cierre posterior a `d92b7f06` modifica únicamente documentación y no necesita atribuirse otra ejecución. Se ha vuelto a comprobar Pages `build_type=workflow`, push limitado a la rama de verificación y `main` intacto en `8867cd12df8f5f444e4a4376cbb478322311e9d2`.

La comparación del estado inicial conserva todos los archivos de aplicación, tipografía, newsletter, sesiones, footer y proxy. Solo cambian cuatro manifiestos/lockfiles, la nueva regresión de parsing de correo y esta documentación. La migración ensayada conserva SHA-256 `8ab1ad256ad0139ab7770b30355e1c2d40ecc3e15306a35d7a6e05d757c792bb`. No se repitieron la auditoría productiva ni el ensayo de migración.

### Stripe sandbox: pruebas reales del proveedor

Sandbox separado existente: **Entorno de prueba de CRONOX**, cuenta `acct_1SPoZCFk1nGlnJwa`. Se verificó `livemode=false` en API, PaymentIntents y eventos. PostgreSQL vacío local exclusivo de esta revisión, producto/envíos/direcciones ficticios; no se importaron datos. Trabajadores y transportes de correo desactivados. El bootstrap aislado reutiliza módulos compilados, validación, autenticación, CSRF, limitador PostgreSQL, firma de webhooks y lógica real de pedidos. No se desactivó ninguna protección del proyecto para usar la base histórica.

El acceso de revisión sirve su propia configuración pública `pk_test` mediante el mecanismo `runtime-config.js` existente, sin cambiar el archivo publicado. En la primera carga se detectó la configuración pública de producción; se sustituyó en el instrumental **antes de introducir tarjeta o confirmar un pago de navegador**. Ninguna clave secreta LIVE se cargó y todos los pagos comprobados fueron de sandbox.

Stripe CLI **1.55.2** recibe eventos originales y los reenvía al listener loopback `43129`; la aplicación verifica su firma. Se cruzaron las respuestas **200** del CLI con `StripeWebhookEvent=PROCESSED`, el estado `PAID`, los cargos del proveedor y las reservas consumidas. **No se usó una firma generada localmente para acreditar estas entregas.**

| Caso | Evidencia y resultado |
|---|---|
| Rechazo y reintento vía HTTP real + API sandbox | `pi_3UUwY5Fk1nGlnJwa0pbUntj0`: rechazo real, evento de fallo procesado y ningún pedido; reintento con la misma intención termina en un pedido pagado y un cargo válido. Dos solicitudes simultáneas de preparación y confirmación repetida no duplican intención, pedido, cobro ni consumo. |
| Checkout de navegador con 3DS | Desde producto/cesta hasta Payment Element con tarjeta de prueba `4000…3220`, reto real del sandbox y retorno “Pedido confirmado”. `pi_3UUwbzFk1nGlnJwa19F5JqMY`, 3DS **2.1.0**, `authentication_flow=challenge`, **`result=authenticated`**; evento `evt_3UUwbzFk1nGlnJwa1Z8Vu8jG` recibido originalmente. |
| Rechazo y reintento desde Payment Element | Tarjeta de prueba `4000…0002`: la UI muestra “Tu tarjeta ha sido rechazada”, conserva contacto/dirección y no crea pedido. Cambiar a `4242…4242` confirma **la misma** intención `pi_3UUwgMFk1nGlnJwa1kMqdvYQ`; una sola instantánea de checkout, pedido, cargo y reserva consumida. |
| Consistencia final | **3 pedidos de prueba pagados, 3 cargos de prueba válidos y 3 reservas consumidas**; stock ficticio inicial 10 → 7. Los intentos rechazados no añaden otro consumo. No son cobros reales. |

Evidencia local: [resultados API](../output/release-acceptance-20261026/payments-card.json), [rechazo de navegador](../output/release-acceptance-20261026/payments-verify-decline.json), [3DS y reintento](../output/release-acceptance-20261026/payments-verify-browser.json), [recepciones originales](../output/release-acceptance-20261026/original-webhooks.ndjson), [consistencia y acceso](../output/release-acceptance-20261026/final-check.json). Capturas: [reto 3DS](../output/playwright/release-acceptance-20261026/3ds-challenge.png), [confirmación](../output/playwright/release-acceptance-20261026/paid-confirmation.png), [rechazo](../output/playwright/release-acceptance-20261026/card-decline.png), [reintento confirmado](../output/playwright/release-acceptance-20261026/retry-confirmation.png). Las capturas corresponden a Chromium de escritorio; no acreditan un iPhone.

Métodos **no probados en este cierre**: Apple Pay, Google Pay, PayPal, Bizum, Klarna, Revolut Pay, Amazon Pay, transferencia y otros métodos regionales. Mostrar un botón o aparecer como disponible en la configuración no acredita una transacción. Apple Pay requiere dispositivo/cartera y registrar/verificar el dominio temporal en el sandbox; Stripe.js comunica que ese dominio no está registrado. Google Pay requiere una cartera/cuenta de prueba apropiada. No se ha utilizado una cuenta personal para validar carteras. PayPal y métodos regionales mostraron avisos de activación en Stripe.js; no se extrapolan al estado productivo ni se han cambiado las opciones del Dashboard. Las pruebas históricas de otros métodos conservan su fecha y alcance.

Los avisos de imágenes `data:` bloqueadas pertenecen al iframe ACS de prueba de Stripe y no impidieron el reto; no se relajó la CSP de CRONOX. Se conservan los logs iniciales del instrumental (arranques del túnel y configuración pública corregida) separados del resultado final.

### Historial del entorno de revisión de iPhone (prueba no realizada)

El acceso y la lista que siguen documentan lo preparado el 26/10. El titular omite la prueba física el 27/10; esta URL temporal no se vuelve a preparar ni se exige para publicar.

**URL:** [https://westminster-dec-ampland-overview.trycloudflare.com/](https://westminster-dec-ampland-overview.trycloudflare.com/).

Acceso protegido: copiar exclusivamente el valor `SANDBOX_ACCESS_CODE` de `cronox-backend/.env.release-acceptance-20261026` en “Código de acceso”. El archivo privado está ignorado por Git; el código no se incorpora a este informe ni a la URL. Después, pulsar “Abrir la web”. Se necesita mantener este ordenador encendido y los procesos de revisión activos; la URL desaparece al detener el túnel y no es un dominio estable de staging. La sesión de la puerta dura 12 horas y es independiente de la sesión de cliente.

Se comprobó el 401 sin acceso, rechazo de origen ajeno y 403 aun con acceso para administración, webhooks públicos y rutas privadas. El túnel solo expone rutas de cliente permitidas. El webhook entra por Stripe CLI en loopback, no por esa URL. No hay acceso a la base histórica ni modificación de producción.

El smoke del acceso protegido verificó popup → registro → abandono sin cuenta/suscripción/bienvenida; footer → registro compartido sin volver a pedir email → una cuenta y suscripción vinculadas, con una bienvenida en cola detenida; recarga de cuenta y logout explícito. Son comprobaciones de disponibilidad del entorno en Chromium, **no sustituyen la prueba física**.

Lista breve para el titular, en Safari normal y con direcciones distintas terminadas en `@example.test`:

1. Newsletter del footer o popup: introducir email, cerrar el registro; volver e introducirlo de nuevo. No debe anunciar suscripción completada antes de crear cuenta. Completar nombre y contraseña; no debe pedir otra vez el email. Probar también una contraseña inválida.
2. En Mi cuenta, recargar y cerrar/reabrir completamente Safari. Debe conservar sesión; después de “Cerrar sesión”, repetir y comprobar que ya no entra identificado. Para un email con cuenta, usar login, nunca crear otra contraseña desde la newsletter.
3. Añadir el producto ficticio M, cambiar cantidad y revisar favoritos/cesta. Abrir checkout como invitado sin hacer obligatoria la cuenta. Usar solo tarjetas de prueba si se desea repetir pago.
4. Girar el teléfono y revisar teclado, footer/desplegables, letras/números, logos/Instagram, precio y copyright de pedidos vacíos y páginas largas. Sin recortes, solapamientos ni desplazamiento horizontal.
5. Comunicar modelo de iPhone, versión de iOS y resultado de esos pasos. **No realizado; omitido por el titular el 27/10, sin resultado aprobado.** La recuperación por email está fuera de esta URL: no se habilitan envíos para esa comprobación.


## Historial: cierre Linux anterior a esta revisión

Este apartado conserva la evidencia de `bfc794cd`. Para el estado definitivo de dependencias y código, prevalece el cierre de `d92b7f06` descrito arriba.

Se revisaron el diff y los workflows efectivos de la rama predeterminada, coincidentes con los locales. `Deploy CRONOX` solo responde a pushes de `main`; la rama de verificación se ejecuta mediante `workflow_dispatch` con **`publish=false` explícito**. El job `deploy` exige `inputs.publish=true`. El otro workflow actual, de SSH, es exclusivamente manual y no se invoca. La API de Pages confirmó `build_type=workflow`, sin publicación legacy por push. No se cambió ninguna configuración remota.

La rama parte de `8867cd12df8f5f444e4a4376cbb478322311e9d2`, que se conserva en `main`. El primer commit incluye los 166 archivos pendientes de fuentes, pruebas, recursos tipográficos, informe y migración ensayada; se excluyen credenciales, perfiles y resultados temporales de `output`. El segundo añade la corrección y regresión HTTP descritas abajo.

- **Commit definitivo comprobado:** [`bfc794cd6574dcd887d8b0f5e2c846d8100b5573`](https://github.com/danir23007/Web_Cronox/commit/bfc794cd6574dcd887d8b0f5e2c846d8100b5573).
- **CI definitivo:** [Actions 40409808621](https://github.com/danir23007/Web_Cronox/actions/runs/40409808621), `workflow_dispatch`, `publish=false`, 26/10/2026 22:06–22:09 UTC (23:06–23:09 Europe/Madrid).
- Primera ejecución: [Actions 40408456804](https://github.com/danir23007/Web_Cronox/actions/runs/40408456804), SHA `467816bb0a13e2682982b2edd161f192cb85e768`, también correcta; la segunda sustituye ese resultado para el código final.
- **Entorno:** Ubuntu 24.04.5, Node 22.23.3; dependencias instaladas con ambos lockfiles mediante `npm ci`.
- **Resultado:** `verify-release=success`; **`deploy=skipped`, sin pasos ejecutados**.

| Comprobación Linux | Resultado |
|---|---|
| Preflight, mantenimiento y gates Node | **16 correctas, 0 omitidas** |
| Controlador Python, instalación, recuperación e interrupciones | **143 correctas, ninguna omitida** |
| Generación Prisma y tipos frontend/backend | Correctos |
| Suite completa de aplicación | **3.024 pruebas / 278 suites correctas** |
| Builds frontend y backend | Correctos |
| Guardia de credenciales y contenido exclusivo de sandbox | Correcta |
| Referencias aprobadas y generador de acreditaciones | Correctos |
| Exportaciones | **59 pruebas / 6 suites correctas**, smoke de artefactos y rutas compiladas correctos |

El controlador carga en Linux los módulos que no podían importarse en Windows: por eso su total es 143 y no los 130 casos descubiertos allí. No se desactivaron pruebas ni se rebajaron validaciones. No se repitieron auditorías de producción, pruebas de carga ni ensayos de migración ya completados. El commit posterior de cierre modifica exclusivamente este informe; no se atribuye una ejecución nueva de CI a ese cambio documental. El código y los recursos permanecen exactamente como en el SHA definitivo comprobado.

### Corrección surgida de los avisos de instalación

El CI inicial pasó, pero `npm ci` informó de dependencias vulnerables. La revisión acotada confirmó que `body-parser@2.3.0`, utilizado por `express.json` antes de autenticación, estaba afectado por [GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828), publicado el 22/10. Se reprodujo en un proceso hijo aislado: un frame gzip válido, terminador y bytes tardíos provocaban `Z_DATA_ERROR` no capturado y salida 1. No se probó contra producción.

Se fijó `body-parser` a **2.4.0** y su requisito `qs` a **6.16.1** mediante los overrides existentes y el lockfile; solo cambiaron tres paquetes instalados (incluido `content-type` 2.1.0). Se conserva la aceptación de cuerpos comprimidos, la validación y los límites. La regresión HTTP usa un proceso hijo y comprueba petición válida, bytes tardíos y rechazo 413 de un cuerpo descomprimido excesivo; después verifica la salud del mismo servidor. **11 pruebas focales correctas**, incluidas las 8 existentes de validación. La suite Linux definitiva repitió todas las comprobaciones con este cambio y las superó.

El cierre anterior dejó 18 avisos únicos pendientes de revisión. Esa revisión ya se ha completado en la [matriz de dependencias](release-dependencies-2026-10-26.md): parches compatibles aplicados y único aviso retenido de Prisma justificado individualmente. Los recuentos actuales y el CI nuevo figuran al principio de este informe.

La comparación de hashes conserva intactos 164 de los 166 archivos pendientes incorporados al primer commit; los otros dos son `package.json` (corrección HTTP) y este informe. No hay cambios inesperados. El SQL de `20261026180000_storefront_concurrency` mantiene SHA-256 `8ab1ad256ad0139ab7770b30355e1c2d40ecc3e15306a35d7a6e05d757c792bb`. El diff de código no tiene errores de espacios; se conserva literalmente el archivo de licencia original OFL, incluido su espacio final en la línea 21. No se modificaron workflows ni configuración remota.

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

## Verificaciones acumuladas de la versión

Resultados y logs: [output/release-readiness-20261026](../output/release-readiness-20261026/). Datos de registro, pedidos y pago exclusivamente ficticios. Bases temporales independientes; correo en memoria y trabajadores desactivados.

| Comprobación | Resultado |
|---|---|
| Jest completo, estado final de la aplicación | **3.036 pruebas, 279 suites** correctas en el Linux definitivo; cierre Windows previo: 3.021 / 277 |
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

## Conclusión de publicación

### Impedimentos reales

**No se ha confirmado un impedimento técnico para publicar el SHA d92b7f06.** Los avisos alcanzables de correo se han corregido, el CI definitivo está verde y tarjeta/3DS/rechazo/reintento funcionan contra el sandbox real con webhooks originales. No queda un fallo reproducido de aplicación sin corregir en el alcance de esta revisión. Es obligatorio conservar el orden de migración descrito arriba: el backend nuevo necesita las dos tablas nuevas antes de arrancar.

### Pendientes que requieren intervención del titular

- **iPhone físico:** no realizado; el titular ha decidido omitirlo y continuar el 27/10. No bloquea esta publicación autorizada ni se acredita mediante Chromium/WebKit.
- **Carteras y métodos alternativos:** no se acredita una prueba nueva. Apple Pay requiere dominio de sandbox registrado y dispositivo/cartera; Google Pay requiere cuenta/cartera; los restantes requieren completar su autorización de prueba y resolver los avisos de activación cuando corresponda. Si la aceptación del lanzamiento exige específicamente esos métodos, siguen siendo una condición de aceptación pendiente. No bloquean por sí mismos esta corrección, que no modifica su integración/configuración.
- La integración en `main` y la publicación están autorizadas el 27/10; requieren CI del SHA final y el procedimiento oficial, sin omitir sus controles.

### Limitaciones conocidas no bloqueantes

- Un aviso alto de deepmerge-ts en Prisma CLI, propagado a tres paquetes: no recibe objetos cíclicos de clientes, solo configuración local revisada. Migrar Prisma se planifica aparte; no se aplica un override mayor sin ensayarlo. Véase la matriz completa.
- Sigue sin evidencia suficiente la causa histórica del 400 de la fotografía. No invalida las correcciones demostradas de proxy/429 y mensajes de validación; no se afirma haber explicado aquel incidente.
- La revisión física usa un túnel temporal, producto ficticio y base vacía; no acredita capacidad del VPS ni almacenamiento de Safari a largo plazo. El correo real permanece fuera de las pruebas. Los checks previos conservan su alcance y fecha.
- Avisos del ACS de prueba de Stripe sobre imágenes data: y limitaciones de métodos no impidieron los pagos de tarjeta comprobados; no se rebajó CSP ni protección alguna para conseguirlos.

**Recomendación vigente:** continuar la publicación autorizada, con dependencias revisadas, pago de tarjeta validado y omisión expresa del iPhone físico. Mantener documentados los métodos de pago no acreditados. Exigir CI del SHA final y todos los controles del despliegue; no hace falta repetir auditorías completas ni migrar Prisma de forma precipitada.

## Pasos de publicación futura

1. Revisar y autorizar la integración de `verify/release-20261026-linux`, cuyo código tiene CI verde en `d92b7f0633d6b29a8a5d3f4f03fc6c89cd2a3f43`. El cierre posterior contiene exclusivamente documentación. No incluir perfiles de navegador ni archivos temporales de `output`. No se ha realizado merge ni push a `main` en esta tarea.
2. Tras esa autorización, seguir [el procedimiento autónomo existente](autonomous-deployment.md): comprobar estado de Pages, integrar y verificar el SHA concreto en `main`. Si la integración genera un SHA nuevo, exigir su CI verde; no atribuirle automáticamente el resultado de otro commit. El push por sí solo no publica. Exigir tipos, suite completa, builds, controller Linux, guards, recursos y smoke de exportaciones verdes.
3. Con autorización de publicación del SHA exacto, invocar **Deploy CRONOX → workflow_dispatch → publish=true**. No ejecutar un despliegue alternativo por SSH.
4. El controlador hace preflight, mantenimiento, parada, respaldo con restauración comprobada, instalación, migración, arranque pausado, health/ready y gates, activación normal y reapertura. Mantener este orden y las restricciones instaladas. No cambiar la confianza del proxy ni las cuotas durante el despliegue.
5. Consultar `sudo -n /usr/local/sbin/cronox-release status <SHA>` hasta resultado terminal. Ante fallo, seguir la fase y las reglas anteriores; conservar respaldo y diagnóstico. No reencolar bienvenidas ni ejecutar reparaciones históricas.

Después de publicar:

- Confirmar SHA, 104 migraciones terminadas, tablas nuevas, health/ready, PM2 online/loopback y web pública en ambos dominios. Verificar telemetría habitual y ausencia de errores de DB o contador.
- Navegar tienda, producto, cesta, cuenta, footer/legal y checkout; verificar las fuentes y `app.js?v=104`, sin caché antigua. Revisar una página corta y otra larga.
- Revisar login/logout, carrito y favoritos con una cuenta de revisión autorizada, sin compra ni alta ficticia en producción. Observar los contadores/429 y los nuevos identificadores de diagnóstico sin registrar datos sensibles.
- Para una prueba completa con escritura, usar el entorno aislado/sandbox; una prueba de correo o pago en producción requiere autorización propia.

Lista archivada de comprobación en iPhone físico (no realizada; ya no es requisito de esta publicación):

1. Safari normal, cerrar pestañas previas; probar footer y popup con direcciones de prueba distintas. Abandonar primero y confirmar que no hay alta; después completar y comprobar una sola cuenta/suscripción.
2. Probar nombre/contraseña inválidos, pérdida de conexión, reintento y cuenta existente mediante login. Confirmar que no pide de nuevo el correo y no reemplaza credenciales.
3. Cerrar completamente Safari y reabrir Mi cuenta; comprobar sesión, luego cerrar sesión expresamente y repetir. Probar dos pestañas y volver desde segundo plano.
4. Añadir/modificar cesta y favoritos; entrar al checkout como invitado. Revisar teclado, orientación, scroll y rechazo/reintento usando exclusivamente el proveedor de prueba.
5. Revisar footer, desplegables, tipografía y copyright en pedidos vacíos y contenido largo, sin recortes ni scroll horizontal.
