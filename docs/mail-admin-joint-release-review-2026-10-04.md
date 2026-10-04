# CRONOX: revisión conjunta y publicación pendiente

**Actualización de requisitos, 4 de octubre de 2026:** verificación de producción exclusivamente de lectura, posterior a la revisión local. El VPS y `origin/main` ya contienen `667d106`; GitHub registra un despliegue exitoso anterior a esta comprobación. Esta actualización no hizo push, despliegue, migraciones, reinicios, cambios de configuración ni envíos. Las secciones iniciales conservan el resultado histórico de la revisión local; el estado actual y el procedimiento corregido aparecen al final.

Revisión del 4 de octubre de 2026 sobre `f41f075`, que incluye como ancestros `d6d460c` y `2372d60`. El árbol inicial estaba limpio y no había commits posteriores a conservar. Se inspeccionó el código final y las instrucciones disponibles; no se encontraron archivos `AGENTS.md` en el repositorio ni sus directorios superiores. Ningún push, despliegue o acceso a producción.

## Resultado y correcciones

Los recorridos modificados pasan las verificaciones locales integradas. Se corrigió un defecto introducido en la clasificación SMTP del primer trabajo: el código `ECONNECTION` se consideraba siempre un rechazo confirmado. Nodemailer también emite ese código con comando `CONN` al cerrar una conexión después de transmitir DATA. Esa pérdida de respuesta debe ser incierta: no permite retirar la contraseña inicial generada ni reintentar automáticamente.

El transporte ahora conserva `UNKNOWN` y propaga `deliveryUnknown` para esas pérdidas de conexión y resultados con destinatarios aceptados, incluso si un cierre con fase ambigua incluye código 421. Los rechazos explícitos de una fase SMTP identificada, fallos DNS/conexión rechazada y errores comprobados de configuración/autenticación siguen siendo seguros para el tratamiento de rechazo existente. Se añadieron siete casos de prueba y una prueba SMTP real de loopback que recibe DATA y destruye la conexión antes de responder; llega como incierta al servicio de correo y su historial no contiene contraseña ni token.

Se corrigieron también las instrucciones de `.env.example` que todavía pedían SMTP Info para newsletter y reposición; ahora indican No-reply y documentan sus límites locales configurables. No se cambian valores de despliegue, credenciales ni activaciones.

## Verificación del conjunto

| Área | Evidencia y resultado local |
| --- | --- |
| Finalidades retiradas | Catálogo, importación, consulta/publicación y envío rechazan las seis finalidades. El trabajador de lanzamiento no arranca, `tick/sendBatch` no envían y `arm/resume` rechazan. El remitente manual comprueba nuevamente plantilla, finalidad y cuenta antes de SMTP. Las familias automáticas antiguas no aparecen en los selectores. Los renderizadores históricos e internos se conservan. |
| No-reply | SMTP loopback verifica autenticación y remitente de sobre para acceso newsletter, bienvenida con descuento y reposición. Disponibilidad, publicaciones y transporte usan No-reply. Descuento, firmas y personalizaciones conservados; ninguna dirección real modificada. |
| Contraseñas | Cuentas elegibles ACTIVE USER/FRIEND y sin contraseña; generación criptográfica de 7–8 letras minúsculas, hash bcrypt y actualización condicional con bloqueo por cuenta. Contraseñas existentes intactas. Comillas e instrucciones en el correo, sin secretos en historial. Concurrencia, rechazo confirmado, reintento, interrupción e incertidumbre cubiertos. Perfil expone `hasPassword`, exige contraseña actual cuando existe y rota sesiones. Registro/cambio/restablecimiento comparten mínimo 7 caracteres y máximo 72 bytes UTF-8, sin requisitos de composición. |
| Bandeja | Consulta filtrada antes de contar y paginar; carpetas especiales IMAP con nombres arbitrarios y banderas de borrador/envío; acceso explícito a Sent/Drafts y selección personalizada. Lista vacía de no leídos, lectura con lector conservado, contadores, sincronización, debounce y descarte de respuestas antiguas pasan. |
| Campañas | Info exclusivo; nombre interno separado de MIME; abrir/editar/contar/exportar no guardan. Guardado incompleto explícito, paso del mismo borrador a Salidas, cancelación y Historial. Sin Revisar campaña; validación automática y backend, fechas futuras Europe/Madrid y confirmación obligatoria. Concurrentes y respuesta perdida no duplican campañas. Resolución compartida, XLSX real, celdas de texto, consentimiento y círculos revalidados. Versiones y contenido confirmado permanecen fijados. |
| Menú y buzones | Una apertura visible con fijación/clic, hover temporal, prioridad del foco y supresión de reapertura al cerrar. Teclado, navegación y móvil táctil en ambas páginas del administrador. Añadir buzón blanco/negro abre creación; selectores abren el buzón existente. No-reply con guion, direcciones y nombres personalizados conservados. |

Se ejecutaron:

- `npm run build:compiled --prefix cronox-backend` y `npm run admin:build`: correctos.
- Batería completa Jest: **176 suites y 1686 pruebas aprobadas; 10 suites y 12 pruebas fallidas**, de 186 suites/1698 pruebas. La batería completa no está verde.
- `node cronox-backend/scripts/review-mailbox.cjs`: **56 comprobaciones aprobadas**, PostgreSQL desechable, IMAP simulado y SMTP exclusivamente loopback; regresiones de correo, campañas, versiones, cuotas y notificaciones.
- `verify-mail-migration-local.cjs`: ambas migraciones reales en orden, dentro de una transacción local revertida, con diseños/publicaciones en conflicto y colas anteriores. Conserva campaña personalizada, asuntos, UNKNOWN, SMTP_ACCEPTED, versiones e historial; cancela pendientes retirados y con enrutamiento anterior. La columna nueva queda nullable para los borradores anteriores.
- `verify-mail-purposes-local.cjs`: remitentes SMTP, cuota atómica concurrente, descuento, ausencia de secretos, verificación sin envío y respuesta DATA perdida.
- `verify-newsletter-jobs-local.cjs`: cuentas, login, tokens válidos/usados/caducados/alterados, concurrencia, reintento e incertidumbre, roles y sesiones, mediante emisor simulado.
- Playwright CLI: `inbox-campaign-controls.browser.js`, `sidebar-mail-settings.browser.js` y `profile-review.js`. Bandeja/editor/modal y menú/configuración a 1366/390 px, claro/oscuro, con contexto táctil para el administrador móvil. Perfil: establecer/cambiar, ojos, 6/7 caracteres, error recuperable, CSRF y doble pulsación, con ambas preferencias de color del navegador. El perfil conserva su presentación pública habitual.
- Revisión visual de capturas de escritorio/móvil, temas, formularios y confirmaciones; sin desbordamiento horizontal. Evidencias locales en `output/playwright/joint-*.log` y capturas de esos scripts. API de navegador simulada y recursos externos bloqueados; no representan una conexión al entorno de producción.

## Los 12 fallos anteriores

Se creó un worktree separado de `9cc66b4`, padre del primer trabajo, y se ejecutaron allí las diez suites que fallan con las mismas dependencias. Resultado: **12 fallos y 204 pruebas aprobadas de 216**. Se reprodujeron los mismos nombres y discrepancias que en la batería actual; el worktree se retiró al terminar sin tocar el checkout principal. No se modificaron expectativas para ocultarlos.

| Suite / grupo | Qué falla | También en `9cc66b4` | Efecto en esta publicación |
| --- | --- | --- | --- |
| `gallery-page.dom.spec.ts` (2) | Lista de páginas con drawer incluye `sobre-cronox.html` fuera de la lista esperada; callback asíncrono de favoritos intenta `querySelector` después de cerrar la ventana de prueba. | Sí, ambos. | Navegación pública/aislamiento del test; no es el menú lateral del administrador. Pendiente revisar ese recorrido y la vida útil del fixture. |
| `storefront-final-refinement.spec.ts` (1) | Espacio bajo la marca en checkout: 88 px frente al `clamp(20px, 3vh, 36px)` esperado. | Sí. | Diseño de checkout, fuera de los cambios de correo/perfil. Pendiente decidir/corregir el requisito visual. |
| `media-framing.dom.spec.ts` (1) | Espera exactamente `responsive-images.js?v=3`. | Sí. | Expectativa de versión en páginas públicas; no demuestra un fallo de encuadre en estos cambios. No se rebajó la versión ni se cambió la expectativa. |
| `responsive-design.dom.spec.ts` (1) | Espera exactamente `assets/checkout.css?v=20`. | Sí. | Versión de CSS de checkout, no el tema/responsividad del correo. Pendiente reconciliar con la versión/requisito vigente. |
| `cookie-consent.spec.ts` (1) | Espera exactamente `assets/cookie-consent.js?v=4`, pero las páginas cargan una versión posterior. | Sí. | No es un fallo de la lógica de consentimiento de campaña; esa resolución pasa. Pendiente revisar el contrato del test público. |
| `stock-status.dom.spec.ts` (1) | Tras guardar stock bajo, la tarjeta conserva `in-stock` en vez de `low-stock` en el fixture. | Sí. | Inventario del administrador, no bandeja/campañas. Es una comprobación funcional pendiente; no se clasifica como simple versión obsoleta. |
| `storefront-product-order.dom.spec.ts` (1) | La comprobación de recursos espera exactamente `assets/checkout.js?v=19`. | Sí. | Contrato de caché del checkout; no el orden de mensajes ni los recursos de Correo. Pendiente reconciliar las versiones. |
| `product-recommendations.dom.spec.ts` (1) | La siguiente flecha no desactiva la primera imagen como espera el fixture. | Sí. | Carrusel recomendado de producto, fuera del menú y las plantillas de correo. Pendiente comprobación funcional; no se declara resuelto. |
| `product-image-resolver.behavior.spec.ts` (2) | Espera logo como último recurso, pero el resolvedor usa `product-image-unavailable.svg`. | Sí, ambos. | Contrato de imagen de producto, ajeno a plantillas remitentes. No se sustituyó la imagen ni la expectativa solo para pasar. |
| `storefront-performance.dom.spec.ts` (1) | Badge del carrito vacío frente a `3` después de la espera del fixture. | Sí. | Carrito público/rendimiento, fuera del alcance. Pendiente distinguir actualización real y temporización de prueba. |

Estos fallos no afectan directamente a las funciones modificadas según las comprobaciones específicas; siguen abiertos y no se certifica el resto de la tienda como correcto. Si el proceso de publicación exige toda Jest en verde, constituyen además un bloqueo de ese proceso.

## Migraciones y límites

Orden: `20261004120000_mail_purposes_noreply` y después `20261004130000_campaign_internal_name`. Ambas ya estaban aplicadas en `127.0.0.1:5433/cronox_dev`. Se volvieron a ejecutar sobre fixtures locales anteriores dentro de una transacción revertida. No se ejecutó `migrate dev`, `db push` ni una migración de producción.

La primera conserva documentos, descuentos e historial; archiva lo retirado, elimina sus punteros de publicación, traslada personalizaciones y crea versiones nuevas de enrutamiento. Ante colisión gana la publicación existente en No-reply y se conserva la alternativa de Info. Las plantillas trasladadas dejan sus familias de Info. Los pendientes afectados se cancelan/fallan sin borrar filas. UNKNOWN y envíos aceptados no se convierten en pendientes. La segunda añade únicamente `campaignName TEXT`, sin relleno ni cambios de estados/asuntos.

Los tres correos trasladados consumen el presupuesto No-reply de `EmailDelivery`, con bloqueo transaccional compartido y ventanas móviles de 1/24 horas. Se cuentan intentos registrados, también fallidos o inciertos, conservadoramente. Las campañas de Info cuentan sus entregas, envíos manuales del mismo buzón y `EmailDelivery` de Info; `reserve=0`, sin reservar capacidad para No-reply. Los límites de campaña y su pausa mínima son restricciones de la aplicación, no evidencia del contrato.

**Dato pendiente:** límites contratados por buzón y, si existen, por dominio/cuenta, destinatarios por envío y tasas de SMTP, además del proveedor activo Hostinger Email/Titan. Deben comprobarse en hPanel → Emails → buzón/plan contratado y en sus condiciones o soporte. No se consultó esa cuenta ni se verificó el contrato. Los valores 100/h y 1000/24h son defaults locales de protección, no límites confirmados del proveedor. No marcar `MAILBOX_CAMPAIGN_PROVIDER_VERIFIED=true` ni activar entrega basándose en ellos.

## Límites oficiales comprobados el 4 de octubre de 2026

La documentación actual de [Hostinger Mail](https://www.hostinger.com/support/4625828-parameters-and-limits-of-hostinger-email/) publica los siguientes límites generales, por buzón independiente, con ventana diaria móvil de 24 horas:

| Producto público, no contrato de CRONOX | Mensajes salientes/24 h | Destinatarios por mensaje |
| --- | ---: | ---: |
| Business Starter | 1000 | 100 |
| Business Standard | 3000 | 100 |
| Business Premium | 3000 | 100 |
| Free/trial y versiones gratuitas antiguas | 100 | 100 |

La página no fija una cuota horaria universal. Son parámetros públicos, no prueba del plan adquirido. Para identificar el contrato: hPanel → Emails → dominio → Mailboxes → **View limits**; obtener captura del producto/plan y límites de Info y No-reply, indicando si son buzones independientes o alias. Ocultar información de facturación ajena, usuarios adicionales y cualquier secreto. Preguntar a soporte por cómputo de destinatarios, ventanas, tasas horarias/minuto, límites de dominio y uso desde SMTP autenticado del VPS si esos datos no aparecen.

Como alternativa contractual, [Titan vendido por Hostinger](https://www.hostinger.com/support/5326155-parameters-and-limits-of-titan-email-at-hostinger/) publica Free 50/h–300/día, Business 200/h–500/día y Enterprise 300/h–1000/día; Free añade 1000/h–2000/día por dominio. [Titan directamente](https://support.titan.email/hc/en-us/articles/360038836914-How-many-emails-can-I-send-and-receive) usa otra nomenclatura y algunas cuotas distintas para cuentas gratuitas/pruebas; computa un destinatario como una unidad y limita el dominio pagado por la suma de buzones activos. No se mezclan sus tablas con el contrato de Hostinger. El máximo por mensaje de Titan queda pendiente de la ficha contractual.

[Hostinger permite newsletters solicitadas y mensajes transaccionales](https://www.hostinger.com/support/1583510-is-mass-mailing-supported-at-hostinger/) dentro de las cuotas, con consentimiento, bajas y control de picos; no exige retirar las campañas autorizadas por el simple hecho de ser campañas. [Titan](https://support.titan.email/hc/en-us/articles/20641601188761-Best-practices-while-sending-bulk-emails) añade restricciones por rebotes/quejas. La [guía SMTP de VPS](https://www.hostinger.com/support/7854530-is-smtp-port-25-blocked-on-hostinger-vps/) menciona 5 correos/minuto: su aplicabilidad al SMTP autenticado de los buzones debe confirmarse, no se convierte automáticamente en cuota contractual de estos buzones.

No hay conexión autenticada a hPanel disponible en esta revisión. Configuración y tablas del VPS indican Hostinger, pero **no acreditan Starter/Standard/Premium ni límites contratados**.

## Producción: evidencia exclusivamente de lectura

Se utilizó la clave SSH existente y la identidad de servidor fijada por el repositorio. SQL ejecutado dentro de transacciones `READ ONLY`, sin arrancar Nest, trabajadores o servicios auxiliares. No se abrieron mensajes ni se conectó a SMTP/IMAP. Las credenciales solo se comprobaron en memoria, devolviendo booleanos, sin imprimirlas.

| Comprobación | Resultado observado |
| --- | --- |
| Rama local | `main`, HEAD `667d106`, limpio antes de esta documentación; conserva los tres commits revisados. Sin cambios de código nuevos: no se repitieron pruebas locales. |
| Remoto y VPS | `origin/main` y checkout `/var/www/cronox/Web_Cronox` coinciden con `667d10686d9378bebe6648ae524a1fefd55fd09c`. El checkout del VPS tiene cambios de instalación en dependencias y un archivo de respaldo; no se limpió ni sobrescribió. |
| Despliegue anterior | [Deploy CRONOX, ejecución 37174405981](https://github.com/danir23007/Web_Cronox/actions/runs/37174405981), evento push, success. Iniciada el 4/10 a las 05:33 Europe/Madrid. Artefactos del backend fechados hacia las 05:38 y con la corrección SMTP y nombre de campaña presentes. No se inició esa ejecución en este encargo. |
| Proceso y salud | Proceso Node de root iniciado a las 05:38:46 Europe/Madrid. `/api/health`, por loopback y HTTPS público: HTTP 200 y resultado positivo. Salud solo acredita respuesta del backend, no SMTP, colas ni backup. |
| PM2 | Existen daemons de root y deploy; el de deploy no lista aplicaciones. El sudo autorizado solo permite `pm2 restart cronox` y `pm2 save`, no status/jlist; **no se ejecutaron restart/save**. Estado detallado, número de reinicios, logs y entorno efectivo del PM2 de root no verificables con estos permisos. |
| Migraciones | Las dos nuevas figuran finished, no rolled back; columna `campaignName` presente. Cero migraciones abiertas/fallidas. Ya estaban aplicadas antes de esta lectura: no se aplicó ninguna. |
| Info y No-reply | Dos registros independientes, proveedor hostinger, activos y estado almacenado CONNECTED; hosts SMTP/IMAP coherentes. Cuentas SMTP correspondientes a Info y No-reply, credenciales resolubles y keyring vigente válido. CONNECTED es estado almacenado, no prueba nueva de autenticación. |
| Directorio privado | `MAILBOX_PRIVATE_DIR` configurado fuera del frontend; la comprobación produce **EACCES**, no ENOENT. El usuario deploy no puede verificar existencia, escritura ni lectura efectiva del usuario de ejecución. No se concluye que falte el directorio. |
| Colas | Campañas y entregas de campaña: 0; envíos manuales: 5 SMTP_ACCEPTED y 0 pendientes; newsletter: 2 SENT y 0 pendientes; reposición: 1 WAITING, susceptible de activarse si hay stock y se cumplen condiciones. Lanzamiento global COMPLETED; 0 pendientes vinculados a finalidades/familias retiradas o enrutamiento anterior. Ningún destinatario o contenido consultado. |
| Publicaciones | No hay punteros de publicación para las finalidades retiradas o las tres trasladadas; el servicio puede usar sus plantillas de respaldo. No se creó ni cambió ninguna publicación. |
| Backup | `pg_dump` y `pg_restore` disponibles. El script no contiene backup; no se observaron copias en los dos directorios convencionales examinados ni tarea de backup en `/etc/cron.d`. No acredita ausencia de copias en otras ubicaciones, cron de root, snapshots VPS o servicio de base de datos. Fecha, retención y restauración comprobada siguen pendientes. |

### Presencia de variables en el archivo del backend

No se imprimieron valores secretos. El entorno efectivo del proceso puede contener overrides no visibles en el archivo; la siguiente evidencia es **del archivo**, no una lectura del entorno del PM2 de root.

| Nombres | Presencia |
| --- | --- |
| `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `BCRYPT_SALT_ROUNDS` | Presentes |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_INFO_USER`, `SMTP_INFO_PASS`, `SMTP_NOREPLY_USER`, `SMTP_NOREPLY_PASS` | Presentes |
| `MAILBOX_ENCRYPTION_KEY_ID`, `MAILBOX_ENCRYPTION_KEYS`, `MAILBOX_PRIVATE_DIR`, `API_PUBLIC_URL`, `FRONTEND_URL` | Presentes; URLs HTTPS |
| `EMAIL_ENABLED`, `MAILBOX_WORKER_ENABLED`, `MAILBOX_SEND_ENABLED` | Presentes; habilitados en el archivo |
| `SMTP_NOREPLY_HOURLY_LIMIT`, `SMTP_NOREPLY_DAILY_LIMIT` | Ausentes: defaults del código 100/h y 1000/24 h, si no hay overrides |
| `MAILBOX_CAMPAIGN_DAILY_LIMIT`, `MAILBOX_CAMPAIGN_HOURLY_LIMIT`, `MAILBOX_CAMPAIGN_INTERVAL_SECONDS`, `MAILBOX_CAMPAIGN_PROVIDER_VERIFIED`, `MAILBOX_CAMPAIGN_ENABLED` | Ausentes: campañas no autorizadas por la política predeterminada; límites diarios/horarios inválidos y verificación desactivada |
| `NEWSLETTER_EMAIL_WORKER_ENABLED`, `WAITLIST_EMAIL_WORKER_ENABLED`, `BACKGROUND_JOBS_ENABLED` | Ausentes: los trabajadores de newsletter y reposición están habilitados por defecto, salvo overrides |

### Compatibilidad de cuotas y datos pendientes

Acceso newsletter, bienvenida con descuento y reposición usan No-reply y su presupuesto atómico. Restablecimiento/configuración inicial también pertenecen a esa cuenta y consumen ese presupuesto. Las campañas solo usan Info; `reserve=0`. Los envíos manuales de Info se incluyen en la comprobación de capacidad de campaña.

No puede certificarse que la configuración actual respete el contrato: si es Free/trial, el default No-reply de 1000/24 h supera la tabla pública de 100. Si es Business Starter, coincide con el máximo diario público, pero no deja margen por otros canales. Faltan datos contractuales y de uso en webmail, alias y clientes externos. El presupuesto automático No-reply no agrega los `MailboxSend` del correo integrado; estos tienen un límite separado de 20 solicitudes/h por usuario, que no sustituye una cuota compartida por buzón o destinatario. Los diarios/horarios de Info protegen la campaña, pero no convierten todos los remitentes manuales en un presupuesto contractual unificado.

Propuesta **sin aplicar números ni configuración**: elegir presupuesto No-reply y capacidad Info menores o iguales al menor límite contractual confirmado, descontando otros canales del mismo buzón, y comprobar suma por dominio si corresponde. Mantener el máximo local de campaña 3000/día y pausa mínima 30 s; reducir cuota/ritmo cuando el contrato lo exija. Si existen ráfagas máximas por minuto, cuotas compartidas o múltiples emisores del mismo buzón, los límites actuales no demuestran protección total: presupuestar esos canales o preparar un control compartido antes de habilitarlos. No reservar capacidad de Info para No-reply. Por destinatario y mensaje, confirmar la unidad contractual y mantener el máximo de destinatarios por debajo de ella. No se propone una cifra final sin esa evidencia.

## Procedimiento real de Actions y VPS

`.github/workflows/deploy.yml` se dispara automáticamente con **cualquier push a main**, también si solo cambia documentación. Concurrencia `cronox-production`, sin cancelación de una ejecución activa. No hay aprobación de producción declarada en ese YAML. La fase previa instala dependencias, genera Prisma, compila frontend/backend y ejecuta comprobaciones de exportaciones; **no ejecuta toda Jest**. Los 12 fallos anteriores no bloquean ese workflow concreto.

`.github/scripts/deploy-production.sh` comprueba SSH y que el SHA sigue siendo main; invoca una sola vez `/var/www/cronox/deploy.sh`, comprueba SHA final y que la ruta de exportación protegida devuelve 401/429. No reintenta el script tras una desconexión ambigua.

El script real del VPS, leído sin ejecutarlo, hace: `git fetch origin main` → `git reset --hard origin/main` → `npm ci` raíz → `npm run admin:build` → `npm ci` backend → `npx prisma generate` → `npx prisma migrate deploy` → `npm run build` → `sudo /usr/bin/pm2 restart cronox` → `sudo /usr/bin/pm2 save` → salud loopback. **Las migraciones se aplican mientras el proceso anterior todavía puede estar trabajando.** No hay backup, pausa de colas de correo ni fase de revisión antes del restart. El reinicio vuelve a usar los flags disponibles; si no están definidos, newsletter/reposición arrancan por defecto. No ejecutar un push ni ese script para resolver los requisitos de esta verificación.

## Veredicto actualizado

**Pendiente de confirmar el contrato y cuotas de ambos buzones, entorno efectivo de PM2, permisos de almacenamiento/backup y pausa de correo en el procedimiento de despliegue.** El código `667d106` y ambas migraciones ya están instalados según la evidencia obtenida; eso no equivale a validar todos los requisitos operativos ni a autorizar campañas. No procede volver a aplicar esas migraciones. La documentación nueva quedará únicamente en un commit local.

## Pasos exactos para el encargo posterior

1. Obtener la ficha contractual descrita arriba y acceso administrativo de lectura a PM2 de root, almacenamiento privado y respaldo. Verificar `pm2 describe cronox`/estado mediante salida filtrada, identidad del proceso, variables necesarias y posibles overrides sin volcar `pm2 env` o jlist sin filtrar. Confirmar lectura/escritura del directorio privado por el usuario real del backend y descifrado con las claves conservadas; documentar último backup, retención, ubicación y restauración aislada.
2. Preparar una modificación revisable del procedimiento de publicación con una barrera específica del correo **antes** de que Actions pueda desplegar cambios. No basta con poner flags después del push: main dispara el despliegue. Para una futura publicación, el operador debe activar la pausa específica y comprobarla antes del push autorizado, o introducir una fase de pausa/aprobación en el flujo real. Esta verificación no modifica workflow, script, PM2 ni entorno.
3. Usar solo `NEWSLETTER_EMAIL_WORKER_ENABLED=false` y `WAITLIST_EMAIL_WORKER_ENABLED=false` para pausar acceso/bienvenida y reposición; `MAILBOX_SEND_ENABLED=false` y `MAILBOX_CAMPAIGN_ENABLED=false` para el envío manual/campañas. Estos no apagan los pagos ni el correo transaccional de pedidos. Dejar `EMAIL_ENABLED` y `BACKGROUND_JOBS_ENABLED` como estén: no usar esos interruptores globales como pausa rutinaria. Para la migración de caché, `MAILBOX_WORKER_ENABLED=false` pausa también IMAP/caché/avisos del administrador; evaluar solo si esa migración lo requiere. Proteger temporalmente las acciones de confirmar/programar para que no crezcan las colas mientras se revisan.
4. Los flags del archivo no cambian el proceso ya iniciado. Activar esa pausa mediante un reinicio controlado autorizado con entorno efectivo verificado; evaluar el breve corte del único backend observado, sin detener indiscriminadamente otros servicios. Antes de reiniciar, esperar/revisar envíos PROCESSING; no matar una entrega y asumir rechazo. No rearmar lanzamiento ni convertir UNKNOWN/UNCERTAIN en PENDING. El WAITING de reposición observado debe mantenerse y ser revisado antes de volver a habilitar su trabajador.
5. Hacer backup PostgreSQL consistente y archivos privados antes de cualquier futura migración, con claves en el gestor de secretos. Desde una sesión protegida del VPS con la conexión ya cargada, `pg_dump --format=custom --file=<ruta_privada_del_backup> --dbname="$DATABASE_URL"`; comprobar con `pg_restore --list` y restaurar en destino aislado. No hacer dump dentro del directorio servido. Mantener pedidos/pagos operativos; la copia online PostgreSQL es consistente, pero no permite restaurar después ignorando las nuevas operaciones de negocio.
6. Preparar cuotas explícitas y límites por canal según contrato; no marcar verificado el proveedor solo porque una cifra cabe en un default. Mantener campañas desactivadas hasta terminar esos requisitos. No cambiar contraseñas de buzones, activaciones, permisos ni preferencias para desbloquear el despliegue.
7. Con pausa y backup verificados, autorizar en otro encargo el push del SHA revisado. El orden real ya descrito compila frontend, genera Prisma, aplica **solo pendientes** y compila/reinicia backend. El orden de las dos migraciones revisadas es 120000 y 130000; están aplicadas, por lo que no deben repetirse manualmente. Si ese orden deja al proceso antiguo incompatible con nuevas migraciones, usar una ventana breve específica de la aplicación o preparar un release aislado: no desplegar con lectores incompatibles. No editar/copiar artefactos a mano sobre el proceso activo.
8. Después de la publicación: comprobar SHA, Actions, PM2 con permisos de lectura, salud local/pública, estados de migración, presencia/configuración efectiva de variables y colas mediante SELECT. Revisar el administrador sin abrir mensajes reales: temas, menú, configuración, bandeja de metadatos, filtros y listas. No pulsar marcar leído, borrar, enviar, programar ni confirmar. Pruebas de escritura/SMTP/IMAP siguen exclusivamente en servicios de prueba.
9. Reactivar, en un paso separado autorizado, solo los trabajadores de correo que correspondan a la configuración anterior y cuotas verificadas; revisar primero WAITING/QUEUED/PROCESSING/UNCERTAIN y campañas programadas por su estado persistido. Mantener finalidades retiradas canceladas y campaña desactivada si no se cumplen sus requisitos. Observar contadores, cuotas y resultados sin disparar mensajes para comprobarlos.

## Recuperación ante fallos

- Sin contrato, pausa o backup comprobado, no iniciar publicación/activación de campañas. Mantener la pausa específica acordada; pedidos y pagos no se desactivan globalmente. Este encargo no aplicó esa pausa a los envíos existentes.
- Migración fallida: revisar `_prisma_migrations`, causa y estado real antes de reparar o reintentar; no usar `migrate dev`, `db push` ni marcar aplicada por conveniencia. Conservar los datos y el keyring.
- Fallo de compilación/restart después de migrar: conservar la base y publicar una corrección compatible; no arrancar trabajadores del backend anterior contra el enrutamiento nuevo. Identificar con PM2 el estado real antes de repetir nada. Una desconexión de Actions/SSH no prueba que no se desplegara: comprobar SHA, procesos y colas antes de otra ejecución.
- Restauración solo con un plan coherente de archivos y PostgreSQL, aplicación aislada y reconciliación de pedidos/pagos posteriores al backup. Después de aceptación SMTP no rebobinar el historial sin reconciliar con el proveedor: podría duplicar envíos. No volver a poner UNKNOWN/UNCERTAIN en pendiente ni retirar la contraseña inicial de una entrega incierta.
- Reintento de confirmación perdida con la misma clave de idempotencia y comprobación del estado persistido; no crear otra campaña para resolver el timeout.

Las acciones de este procedimiento son pendientes y requieren el encargo posterior; durante esta comprobación solo se hicieron lecturas de producción y edición local de documentación.
