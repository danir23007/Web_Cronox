# Revisión funcional y de seguridad de CRONOX — 05/10/2026

## Resultado y alcance

Se revisaron el código de tienda y administración, NestJS, Prisma/PostgreSQL,
autenticación, pagos, correo, archivos y configuración local. Se corrigieron
nueve fallos adicionales confirmados en la primera revisión y se verificó la
reparación de productos y categorías en **localhost:3000**. La ampliación de
resistencia a tráfico y fallos temporales, sus correcciones y su verificación
posterior se integran al final de este informe. No se hizo commit, push ni despliegue.
No se modificó producción ni se enviaron correos, notificaciones o pagos reales.

La revisión no certifica ausencia de vulnerabilidades. La separación
ADMIN/SUPERADMIN queda **pospuesta por decisión del propietario**. El cambio de
email aprobado ya exige autorizar el buzón actual y verificar el nuevo, para
cuentas con y sin contraseña. La exportación ahora cancela SQL al vencer su plazo.
Siguen pendientes la verificación manual de soporte y las comprobaciones de
infraestructura/proveedores. El estado vigente, las pruebas y los avisos restantes
se encuentran en [la entrega de implementación](#implementación-aprobada-y-verificación-final).

Estado contrastado de nuevo con código, auditoría de dependencias y pruebas
aisladas: [implementación y verificación final](#implementación-aprobada-y-verificación-final).

Al comenzar se inspeccionó Git y se guardó el diff previo en
`output/playwright/security-review-2026-10-05/initial-working-tree.patch`.
No se encontraron instrucciones `AGENTS.md` aplicables. Se conservaron los
cambios sin commit de SEO, menú, categorías y documentación, además del trabajo
ya existente en administración y correo. No se rediseñaron pantallas ni se
cambiaron descuentos, plazos de sesión, consentimiento o campañas.

## Entornos y fidelidad de las pruebas

| Entorno | Qué se ejecutó | Límites |
| --- | --- | --- |
| `http://localhost:3000` | Aplicación real del repositorio, compilación actual, PostgreSQL `127.0.0.1:5433/cronox_dev`; Chromium escritorio y móvil | Correo y tareas externas desactivados por el arranque local; no se ejecutaron compras |
| `review-security.cjs` | PostgreSQL 17 nuevo en directorio temporal, puerto loopback aleatorio; servicios reales y servidor Nest con JWT, CSRF, validación y rutas reales | Esquema generado desde Prisma más el índice parcial de checkout; no es un replay de todas las migraciones. Email capturado en memoria, Stripe sin llamadas externas |
| Perfil/carrito visual aislado | HTML y assets originales servidos junto al Nest anterior; cuentas, direcciones y productos sintéticos; 1366 y 390 px | Se añade únicamente la URL de API local y una entrada de sesión de prueba al servidor desechable. No hay interceptación de respuestas de perfil/carrito |
| `review-mailbox.cjs` | PostgreSQL desechable, servidor SMTP/TLS loopback real y flujo de aplicación | IMAP y push simulados; no acredita recepción, reputación ni entrega en un proveedor externo |
| Categorías/actividad y visitantes | PostgreSQL desechable, servicios/rutas y migraciones relevantes | Algunas pruebas de rutas reemplazan autenticación por identidades sintéticas; los controles JWT reales se prueban por separado |
| Jest | 195 suites de servicios, controladores, políticas y DOM tras la ampliación | Muchos colaboradores/transportes son simulados; las pruebas de texto/DOM no equivalen a una integración completa |
| Playwright carrito y SEO | Navegadores reales con implementación frontend del repositorio | Sus servidores de fixture utilizan datos/API simulados. No se usan para acreditar localhost:3000 |

Los scripts nuevos limpian las variables de proveedores, fijan credenciales
ficticias y crean su propia base antes de cualquier escritura. Desactivan
trabajos, envío y Supabase. Cierran PostgreSQL al terminar; los directorios
temporales quedan disponibles para inspección. No se ejecutaron pruebas de
carga ni ataques contra producción o terceros.

## Productos y categorías en localhost:3000

Antes de reparar: `/api/products?limit=48` y `/api/categories` devolvían **500**;
`/api/gallery` devolvía **200**. La compilación y el cliente Prisma esperaban
`Category.group` y `Category.showInStoreFilters`, ausentes en PostgreSQL.
Prisma reprodujo **P2022** y el log PostgreSQL registró la columna inexistente.
El proceso no estaba ejecutando una compilación antigua.

Se relacionaron las conexiones del proceso con `cronox_dev`, dirección
`127.0.0.1`, puerto `5433`, antes de escribir. Tras una copia `pg_dump`, el
arranque protegido `npm --prefix cronox-backend run migrate:local` aplicó las
cuatro migraciones pendientes de seguimiento de enviados, cuota de cuenta,
grupos y visibilidad. El mismo PID pasó a responder 200 sin recompilar: evidencia
directa de que la causa era el esquema local. Ahora constan **76 migraciones**.

La comprobación final, después de compilar y reiniciar, obtiene siete productos,
seis categorías y galería con HTTP 200, sin errores JavaScript de página ni
respuestas simuladas. Los 401 de sesión/favoritos del visitante anónimo son
esperados y se distinguen de los errores del catálogo. Se verificaron clic en
toda la fila, selección y deselección múltiple, combinación entre grupos,
selección inicial por URL, Tab/Espacio/Escape, foco y estado accesible. Los inputs
siguen siendo nativos, ocultos visualmente y limitados al componente; texto
subrayado y alineado sin espacio reservado a casillas.

En la comprobación previa de esta misma reparación se ocultó y volvió a mostrar
Camisetas desde la administración local real, con PATCH 200 y persistencia al
recargar. Se restauró su valor inicial; no cambiaron las seis categorías ni las
21 asociaciones con productos. Las pruebas aisladas vuelven a cubrir categorías
nuevas, grupos y visibilidad pública frente al listado administrativo.

Detalle y evidencia: [diagnóstico local](local-catalog-2026-10-05.md).
El mismo fallo podría afectar a un despliegue cuyo código se actualice sin sus
migraciones. Generar Prisma o compilar no crea las columnas de la base.

## Fallos confirmados y corregidos

La gravedad siguiente valora el contexto de CRONOX y las condiciones necesarias,
no constituye una puntuación CVSS.

### 1. Enlaces antiguos tras cambiar el email — seguridad, alta

- **Reproducción:** emitir recuperación para una cuenta sintética, cambiar su
  email por el perfil y consumir el enlace recibido en el buzón anterior.
  Antes devolvía 201 y permitía cambiar la contraseña. Un enlace vigente conservaba
  autoridad sobre una cuenta que ya tenía otra dirección.
- **Cambio:** `me/me.service.ts` actualiza email y revoca enlaces pendientes de
  recuperación, lanzamiento y acceso de newsletter dentro de la misma transacción.
  `auth/auth.service.ts` comprueba además el email actual al persistir una solicitud
  encolada, para evitar que cree un enlace antiguo después del cambio. El envío
  queda fuera de la transacción que puede reintentarse.
- **Validación:** HTTP/JWT real: enlace anterior de recuperación 400, lanzamiento
  401; nuevo enlace funciona una sola vez incluso con dos peticiones simultáneas
  (201 y 400); invalida la sesión anterior. Prueba unitaria para emisión tardía
  dirigida al email antiguo. `identity-before.log` conserva el resultado previo.
- **Límite:** no se cambia el flujo de verificación del nuevo email; decisión
  separada pendiente abajo.

### 2. Reintentar checkout con la última unidad reservada — funcional, alta

- **Reproducción:** reservar la última unidad y repetir el mismo checkout.
  El stock disponible ya había bajado a cero por la reserva propia y la validación
  devolvía `INSUFFICIENT_STOCK_AT_CHECKOUT`.
- **Cambio:** `orders/orders.service.ts` cuenta para la comprobación previa las
  unidades aún reservadas por el mismo carrito y propietario, en snapshot activo
  sin pedido. No cuenta reservas ajenas, consumidas o liberadas. La adquisición
  atómica de stock conserva sus controles.
- **Validación:** PostgreSQL real, dos compradores y una unidad: un único ganador.
  Repetir reutiliza el snapshot; dos confirmaciones crean un pedido; total
  calculado por servidor; identidad del pago, importe y moneda incorrectos
  rechazados. Reembolso duplicado repone stock una vez; éxito tardío conserva
  REFUNDED; cancelación duplicada libera una vez. Invitado reutiliza su reserva,
  otro invitado es rechazado. Stripe está simulado en el límite del servicio para
  estas transiciones, sin cobro.

### 3. Pérdida de incrementos concurrentes del carrito — funcional, media

- **Reproducción:** partiendo de una unidad, dos altas simultáneas aceptadas
  dejaban dos unidades en vez de tres. Se sincronizaron las primeras lecturas
  en modo diagnóstico para reproducir el intercalado, usando PostgreSQL real.
- **Cambio:** `cart/cart.service.ts` utiliza transacciones serializables para
  crear, añadir, cambiar, eliminar, vaciar y fusionar carrito. El nuevo helper
  `prisma/serializable-transaction.ts` reintenta conflictos P2034 y, donde procede
  la creación concurrente, P2002; máximo cuatro intentos. No reintenta efectos
  externos ni oculta otros errores.
- **Validación:** las dos altas aceptadas dejan tres unidades. Pruebas de propiedad,
  fusión, stock y estados; navegador aislado cambia 2 → 3 → 2 mediante API real.
  La suite de navegador cubre doble interacción, recarga, respuestas tardías,
  cambio de cuenta y fallos de red con API simulada.

### 4. Direcciones concurrentes inconsistentes — funcional, media

- **Reproducción:** desde nueve direcciones, dos altas aceptadas producían once,
  superando el límite existente de diez. Dos altas marcadas por defecto podían
  dejar dos predeterminadas. El perfil también podía crear fuera de ese control.
- **Cambio:** `addresses/addresses.service.ts` y `me/me.service.ts` trasladan
  comprobación de límite, propiedad y selección por defecto a transacciones
  serializables. Comparten el límite ya existente.
- **Validación:** PostgreSQL real termina con diez como máximo y una predeterminada.
  Borrar una dirección ajena devuelve 404 y la conserva. Guardar la dirección
  principal desde el perfil devuelve 200 en escritorio/móvil y persiste.

### 5. Registro sin secuencia de socio — funcional, media

- **Reproducción:** base nueva sin `public.user_member_code_seq`: registro 500,
  Prisma P2010 con error PostgreSQL 42P01. El catch buscaba 42P01 en el nivel
  equivocado y la consulta fallida ya había abortado la transacción.
- **Cambio:** `users/member-code.util.ts` comprueba existencia con `to_regclass`
  antes de `nextval`, crea/sincroniza cuando falta y usa un bloqueo transaccional
  para serializar creación y resincronización entre registros.
- **Validación:** registro inicial correcto; recreación de la secuencia y dos
  registros concurrentes producen códigos distintos sin reutilizar el anterior.
  No se altera el formato de socio. En una base con permisos mínimos conviene
  preparar la secuencia mediante mantenimiento autorizado, no conceder DDL al
  usuario de ejecución por este motivo.

### 6. Multipart malformado podía terminar Node — seguridad, media en esta superficie

- **Reproducción:** dos campos multipart preparados contra un proceso hijo
  desechable con Multer 2.2.0 causaban `RangeError` no capturado y salida 1.
  CRONOX usaba esa versión a través del adaptador Nest para subidas; el acceso
  administrativo previo limita la superficie, pero no evita el fallo del parser.
- **Cambio:** override preciso de `multer` a **2.4.0** en `package.json` y lockfile.
  No se ejecutó `audit fix --force` ni se actualizaron masivamente dependencias.
- **Validación:** `review-upload-parser.cjs` obtiene rechazo controlado del mismo
  cuerpo y luego admite una subida normal en el mismo proceso; salida 0, sin
  excepción no capturada. Compilaciones y suite completas pasan.
- **Fuente:** el caso corresponde al [aviso GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm).
  El alias de buzones ya estaba en 2.4.0.

### 7. Log de firma Stripe inválida incluía contenido — privacidad, media

- **Reproducción:** una firma inválida con el SDK real hacía que el objeto de
  error registrado incluyera cuerpo y cabecera de firma. Aumentaba innecesariamente
  la información conservada en logs.
- **Cambio:** `payments/stripe.service.ts` registra una advertencia genérica sin
  el error, payload o firma. Sigue rechazando el webhook inválido.
- **Validación:** regresión comprueba que no se registra el objeto; HTTP real con
  firmas generadas localmente por el SDK rechaza firma inválida y cuerpo alterado
  (400), acepta evento sintético firmado (200) y deduplica su repetición en una
  fila. No se contacta Stripe. El pipeline mantiene el cuerpo crudo requerido por
  la [documentación de webhooks](https://docs.stripe.com/webhooks).

### 8. Email con tipo incorrecto provocaba 500 — validación, baja

- **Reproducción:** enviar un objeto como `email` a registro, login y recuperación
  ejecutaba `.trim()` antes de validar su tipo, produciendo 500.
- **Cambio:** los cuatro DTO de registro/login/recuperación solo normalizan
  strings; el validador rechaza los demás valores.
- **Validación:** las tres rutas devuelven 400; las credenciales normales siguen
  funcionando. Evidencia previa en `malformed-before.log`.

### 9. El perfil ocultaba la contraseña actual — funcional, media

- **Reproducción visual:** una cuenta con contraseña aparecía como «Sin contraseña
  establecida». `/api/me` no devolvía `hasPassword`; el perfil ocultaba el campo
  de contraseña actual necesario para cambiarla.
- **Cambio:** `users/users.service.ts` y `auth/auth.service.ts` conservan únicamente
  el booleano `hasPassword` al retirar el hash. No se expone la contraseña ni su hash.
- **Validación:** respuestas reales de registro, `/me` y `/auth/me` anuncian el
  estado correcto; cuenta sin contraseña devuelve false. Escritorio y móvil muestran
  «Contraseña establecida», el campo actual visible y obligatorio y el formulario
  correspondiente. Guardado de perfil y dirección con 200 y recarga persistente.
  Captura previa `profile-password-before.png` y posteriores `profile-1366.png`,
  `profile-390.png`. No se cambió el diseño del frontend.

## Controles y recorridos revisados

| Área | Evidencia y resultado | Alcance de la conclusión |
| --- | --- | --- |
| Catálogo, grupos, búsqueda, galería, ficha y SEO | Navegador real en 3000; categorías públicas; orden/IDs preservados; título, canonical y único JSON-LD; pruebas DOM de búsqueda, tallas, recomendaciones e imágenes | No se recorrieron manualmente todas las combinaciones del catálogo |
| Favoritos/carrito/checkout | Suites de frontend, servicios y API; propiedad de carrito y pedidos; cantidad/precio manipulados rechazados; reserva, cancelación y reembolso concurrentes | Navegador de carrito real con fixtures propios; pago externo no realizado |
| Identidad | Registro/login/logout/refresh/reset HTTP con JWT; inyección de rol 400, sesión antigua 401, reset de un uso; suites de caducidad y revocación por rol/estado | Plazos existentes conservados: acceso breve, ADMIN con inactividad, persistencia de otros roles según política |
| Autorización | Anónimo administrativo 401, USER 403; dirección ajena 404, pedido ajeno denegado; guard estricto SUPERADMIN y servicio de operaciones masivas rechazan ADMIN | Excepción importante del guard genérico descrita abajo; no se afirma separación completa |
| CSRF, CORS y cookies | Escritura desde origen ajeno y CSRF incorrecto 403; lectura de allowlist, doble cookie, HttpOnly/SameSite y Secure en producción | Reverse proxy, TLS y cabeceras efectivas de producción no inspeccionados |
| Edición masiva/inventario | Reenvío devuelve resultado previo y una entrada de auditoría; cambio de payload/stale preview 409; actor revocado 403; dos cambios de stock con la misma versión dejan un cambio y un conflicto | Servicios reales con PostgreSQL desechable |
| Newsletter, bienvenida y reposición | Suites de consentimiento, identidad del descuento, primer pedido, baja, temporizadores, exclusión de administradores y avisos; cupón personal ajeno rechazado en PG real | Transportes simulados; no se envió bienvenida ni aviso real |
| Buzones y campañas | 67 comprobaciones del script: permisos, adjuntos privados, cuotas compartidas, envío incierto, concurrencia, bajas, programación Madrid, limpieza/retención y reconciliación | SMTP/TLS loopback real; IMAP/push simulados |
| Visitantes/actividad | 30 comprobaciones: consentimiento, deduplicación y exclusión ADMIN/SUPERADMIN; rutas restringidas, paginación y errores; alcance del borrado administrativo | Datos sintéticos, no se eliminaron estadísticas reales |
| Entradas/XSS/SQL | Validación global whitelist/forbid, consultas Prisma parametrizadas, HTML de correo saneado/aislado, escape frontend, URLs de imágenes y JSON-LD; suites de sanitización y contenido | Lectura y casos de regresión; no fuzzing exhaustivo de todos los parsers |
| Archivos/SSRF | Lectura de límites, magic bytes JPEG/PNG/WebP, dimensiones y permisos; archivos privados cifrados AES-GCM fuera del árbol público, nombres generados y comprobaciones de ruta; proveedor/DNS de correo restringido | No se accedió a almacenamiento externo ni se certificó su ACL actual |

El navegador no puede confirmar un pedido pagado por sí mismo: las pruebas de
servicio dejan cero pedidos tras crear la reserva y exigen confirmación de pago
con identificador, importe y moneda correctos. Se probaron duplicados y orden
de eventos; no se confunde ese resultado con una compra extremo a extremo en
Stripe. Referencias: [webhooks](https://docs.stripe.com/webhooks) e
[idempotencia](https://docs.stripe.com/api/idempotent_requests).

## Resultados y reproducción

Desde la raíz del repositorio, con Node y PostgreSQL 17 instalados:

```powershell
npm --prefix cronox-backend run build
npm run admin:build
node cronox-backend/scripts/review-security.cjs
node cronox-backend/scripts/review-upload-parser.cjs
node cronox-backend/scripts/review-mailbox.cjs
node cronox-backend/scripts/review-admin-categories-activity.cjs
node cronox-backend/scripts/review-visitors.cjs
npm run test:cart:browser
npx playwright test --config playwright.seo.config.cjs
```

Para Jest, ejecutar `npm test -- --runInBand` **desde `cronox-backend`**. Algunos
tests leen recursos relativamente a ese directorio. El script nuevo usa por
defecto `C:/Program Files/PostgreSQL/17/bin`; `CRONOX_REVIEW_PG_BIN` permite otra
ubicación. No pasarle URL de una base existente. `--serve` permite revisar el
perfil sintético en navegador; cerrar escribiendo `stop` en su terminal.

| Comprobación de la primera revisión | Resultado | Artefacto en `output/playwright/security-review-2026-10-05/` |
| --- | --- | --- |
| Backend, incluida generación de Prisma | Correcto | `backend-build.log` |
| Assets administrador | Correcto, sin diff generado adicional | `admin-build.log` |
| Jest completo | **190 suites, 1.732 pruebas correctas** | `jest-final.log` |
| Seguimiento después del ajuste de tipos de reserva | **3 suites, 81 pruebas correctas** | `orders-final.log` |
| Integración seguridad/checkout/admin | Correcto, PG y HTTP reales aislados | `security-final.log` |
| Multipart | Malformado rechazado y siguiente subida normal correcta | `multer-final.log` |
| Buzones | **67 comprobaciones correctas** | `mailbox.log` |
| Categorías/actividad | Correcto | `categories-admin.log` |
| Visitantes | **30 comprobaciones correctas** | `visitors.log` |
| Carrito Chromium/Firefox/WebKit | **120 correctas, 3 omisiones existentes** por API móvil/CDP no soportada en esos navegadores | `cart-final.log` |
| SEO Chromium/WebKit | **12 correctas** | `seo-final.log` |
| Catálogo localhost:3000 | HTTP 200, 7 productos/6 categorías, 1366/390 px, teclado, 0 errores de página | `store-final.log`, `menu-*.png`, `selected-*.png` |
| Perfil/carrito visual aislado | Guardado/recarga, contraseña actual, dirección y cantidades correctos a ambos tamaños | `profile-browser.log`, `profile-*.png`, `cart-*.png` |

Los artefactos están ignorados por Git. Los registros «before» conservan
reproducciones anteriores a las correcciones; ejecutar ahora `--diagnose` no
restaura el código defectuoso. No se deshabilitaron tests para obtener estos
resultados. Se actualizaron expectativas obsoletas de versiones de assets,
placeholder, separación visual y página editorial para que correspondan al
código previo; se simula `load` de la imagen cuando el comportamiento espera
carga real, y se pulsa la confirmación de stock existente. La prueba de resize
del carrito espera la actualización observable de `visualViewport` antes de
hacer scroll: fallaba intermitentemente por adelantarse a ella. No se alteró el
layout de producción para satisfacer esas expectativas.

## Riesgos y decisiones pendientes de la revisión inicial

Este apartado conserva el diagnóstico inicial. Sus propuestas de email y sus
versiones de dependencias fueron sustituidas por la implementación aprobada
documentada al final; no describen el funcionamiento actual.

### Separación ADMIN/SUPERADMIN: decisión necesaria

`common/roles.utils.ts::hasAnyRole` concede acceso a ambos roles administrativos
antes de consultar la lista de `@Roles`. Por tanto, **`@Roles(SUPERADMIN)` por sí
solo no excluye ADMIN**. Con JWT real, un POST vacío a productos alcanza validación
y devuelve 400 para ambos roles; con el guard estricto de borrado de actividad,
ADMIN recibe 403. La edición masiva también verifica el rol estricto en servicio.

No es una hipótesis, pero la política permisiva está codificada expresamente en
tests y en documentación previa de acceso compartido. Cambiar globalmente el
helper retiraría funciones que hoy están concedidas a ADMIN. Se consultó esta
decisión durante la revisión y no se recibió respuesta.

**Propuesta concreta:** aprobar una matriz de operaciones compartidas y exclusivas;
hacer que `hasAnyRole` respete la lista; declarar explícitamente
`@Roles(ADMIN, SUPERADMIN)` en las compartidas y conservar solo SUPERADMIN en
las exclusivas. Añadir una prueba HTTP por grupo de permisos. Hasta resolverlo
no debe interpretarse una anotación genérica como barrera de superadministrador,
ni afirmarse que toda la separación pedida está garantizada. Riesgo potencial
alto si alguna operación compartida actualmente debía ser exclusiva.

### Cambio de email: decisión necesaria

El perfil permite cambiar email con la sesión activa sin confirmar la nueva
dirección ni reautenticar. Se conserva ese flujo por ser una decisión de producto;
los enlaces antiguos sí se revocan ya. **Propuesta:** mantener el email actual
hasta confirmar un enlace de un uso enviado al nuevo, exigir reautenticación
cuando la cuenta tenga contraseña y definir el equivalente para cuentas de enlace.
Necesita acordar la experiencia y plantillas; no se añadió silenciosamente una
restricción ni se envió correo para probarla.

### Base, almacenamiento y despliegue no inspeccionados

En PostgreSQL local, el usuario de aplicación es superusuario y omite RLS. No hay
grants de tablas detectados para PUBLIC/anon/authenticated. Algunas tablas privadas
tienen RLS (por ejemplo MailboxFile, EmailDelivery, ProductCost); User, Order y
sesiones no lo tienen en esta base local. Es PostgreSQL independiente, no una
verificación de la Data API de Supabase.

Si producción expone un esquema por Data API, es necesario revisar allí permisos,
RLS, roles, funciones y buckets con acceso autorizado; no basta inferirlos de
local. El código público usa la API propia; la clave de servicio queda en backend
en los usos inspeccionados. Para producción se recomienda separar rol de migración
y rol de ejecución con privilegios mínimos. No se modificaron roles/grants ni se
consultaron datos de producción. La distinción entre grants y RLS está descrita en
[la guía de Supabase](https://supabase.com/docs/guides/api/securing-your-api).

### Dependencias y secretos

`npm audit` inicial del backend informó 50 nodos afectados; tras el cambio preciso
de Multer informa **48: 44 high, 4 moderate, 0 critical**. El proyecto raíz no
presentó avisos. Estas cifras incluyen cadenas transitivas y no significan 48
exploits demostrados en CRONOX.

Quedan avisos de `qs` 6.15.3 en parsing urlencoded, `nodemailer` 9.0.5 del correo
transaccional (el alias de buzones es 10.0.13), `sharp` 0.34.5 y sus bibliotecas
nativas, `js-yaml` y transitivas de herramientas de test/build. Las subidas públicas
no ofrecen libre acceso a Sharp: hay autenticación y restricciones de formato;
no se identificó YAML de usuario procesado por las rutas de aplicación revisadas.
Eso reduce superficies concretas, pero no resuelve los avisos. Se requiere una
actualización dirigida por paquete con sus pruebas de correo, imagen y parsing;
no se declara explotabilidad remota confirmada sin reproducción. Se conservan
JSON de auditoría y lockfile para valorar versiones exactas.

Se escanearon heurísticamente 5.529 archivos de texto versionados con patrones
limitados de credenciales. El único match fue un JWT de fixture en una dependencia;
el único fichero de entorno versionado encontrado fue `.env.example`. No es un
escaneo exhaustivo de secretos ni del historial Git y no acredita ausencia de
credenciales fuera de los patrones. No se incluyeron secretos ni datos personales
reales en este informe.

## Archivos y requisitos para una publicación posterior

Cambios de aplicación: `addresses/addresses.service.ts`, `cart/cart.service.ts`,
`me/me.service.ts`, `auth/auth.service.ts`, cuatro DTO de auth,
`users/users.service.ts`, `users/member-code.util.ts`, `orders/orders.service.ts`,
`payments/stripe.service.ts`, nuevo helper transaccional y package/lockfile backend.
Regresiones: specs de direcciones/auth/Stripe, scripts `review-security*.cjs` y
`review-upload-parser.cjs`. `review-visitors.cjs` se adapta a las relaciones actuales
del esquema de correo; sus aserciones se conservan. También se ajustan los specs
de frontend y el test de resize descritos arriba. Los cambios anteriores de SEO
y del menú siguen presentes y se documentan en sus informes propios.

No se añadió una migración nueva en esta auditoría. Para publicar después de la
revisión del propietario: instalar el lockfile backend actualizado, comprobar
destino/backup y aplicar migraciones existentes por el procedimiento de despliegue,
generar Prisma y compilar backend/administrador. Verificar la secuencia de socio
y permisos de ejecución; no ejecutar el backfill de socios sin revisar sus efectos.
Reiniciar el proceso que sirve la aplicación y repetir la comprobación de catálogo,
permisos, identidad y pago de prueba en un entorno autorizado. Una base sin las
migraciones de categorías reproducirá el 500 aunque el build sea correcto.

Antes de esa publicación conviene resolver la matriz ADMIN/SUPERADMIN y revisar
los avisos restantes de dependencias de runtime. No se certificaron la configuración
del proxy/CDN, ACL de almacenamiento, secretos desplegados, entrega SMTP/IMAP real,
push externo ni checkout completo con SCA y Stripe. No se hizo ninguna de esas
operaciones para preparar este informe.

Para revisión local inmediata: abrir `http://localhost:3000/tienda`, usar categorías
con ratón y Tab/Espacio y revisar el diff por los grupos de archivos anteriores.
El servidor local queda arrancado mediante `start:dev`, con correo y trabajos
desactivados. Toda la propuesta permanece sin commit.

## Ampliación: tráfico automatizado, saturación y fallos temporales

### Conclusión y método

El incidente de la otra web se utilizó **solo como hipótesis**. CRONOX utiliza
JWT propios con Passport/Nest, `AuthSession` y `User` en PostgreSQL; no utiliza
Supabase Auth para identificar cada visita. En las rutas ensayadas, una petición
sin credenciales, con token malformado o caducado no produjo SQL de identidad.
No se observó el mecanismo anónimo descrito en aquella aplicación.

Sí se reprodujeron problemas propios: borrado de cookies al fallar PostgreSQL,
redirección administrativa a login ante el mismo fallo, lectura duplicada del
usuario, un segundo cliente Prisma, consultas simultáneas idénticas de SEO y
Pantalla Clave, renovaciones inútiles del visitante anónimo y retención de claves
caducadas en el almacenamiento del limitador. Se corrigieron sin modificar
plazos de sesión, permisos, categorías, diseño, reglas de venta ni cifras de
los límites existentes.

`scripts/review-security.cjs --resilience` crea otra base PostgreSQL 17 desechable
en loopback, con datos sintéticos y el `AppModule` real. No sustituye Prisma por
un mock: instrumenta eventos SQL y cuenta las instancias que crea la inyección
de dependencias. Cada pool de esta prueba tiene **2 conexiones**, espera de pool
de **1 segundo** y conexión de **1 segundo**, iguales antes y después. No son
valores impuestos a local ni propuestos automáticamente para producción.
El arranque sigue desactivando correo, trabajos y proveedores externos. No se
aplicaron migraciones ni cambios de configuración a ninguna base existente en
esta ampliación.

Se midieron cuatro peticiones secuenciales por combinación de credenciales y
ruta; después, dos ráfagas de doce peticiones concurrentes, un agotamiento real
de todos los pools de aplicación y una parada/reanudación real del PostgreSQL
aislado. La lentitud se indujo reteniendo durante 250 ms un bloqueo exclusivo
de la tabla correspondiente. La saturación ocupó cada conexión durante 1,6 s.
No se enviaron peticiones de carga a localhost:3000, producción o proveedores.

### Consultas y autenticación

| Caso, cuatro peticiones secuenciales salvo indicación | SQL antes → después | Identidad antes → después | HTTP |
| --- | --- | --- | --- |
| HTML `/tienda`, anónimo, usuario, token malformado o caducado | 4 → 4 por grupo | 0 → 0 | 200 |
| `/api/products?limit=48`, los mismos cuatro grupos | 28 → 28 por grupo | 0 → 0 | 200 |
| `/api/me` sin credenciales, malformadas o caducadas | 0 → 0 por grupo | 0 → 0 | 401 |
| `/api/me` con sesión de usuario válida | 16 → 12 | 16 → 12 | 200 |
| HTML y API inexistentes, los cuatro grupos | 0 → 0 por grupo/ruta | 0 → 0 | 404 |
| Renovación válida, dos peticiones | 19 → 17 | 17 → 15 | 200 |
| HTML administrativo válido, dos peticiones | 13 → 13 | 11 → 11 | 200 |
| Ficha SEO, cuatro peticiones | 12 → 12 | 0 → 0 | 200 |
| API de esa ficha, cuatro peticiones | 16 → 16 | 0 → 0 | 200 |

Los eventos SQL incluyen BEGIN/COMMIT y escrituras; no equivalen a llamadas al
ORM. «Identidad» cuenta consultas que mencionan `User` o `AuthSession`, incluidas
las necesarias para devolver el perfil. La compuerta estaba caliente durante
las muestras secuenciales: un primer HTML, incluso desconocido, puede necesitar
su consulta de configuración, que no es una consulta de identidad. Un error de
conexión puede ocurrir antes de emitirse un evento SQL; cero eventos durante una
caída no significa cero intentos de conexión.

La API de catálogo y el HTML SEO tienen necesidades diferentes. Se mantienen
sus consultas de producto, variantes, imágenes y categorías; no se inyectan
respuestas vacías ni se elimina el renderizado indexable para bajar la cifra.
La ficha SSR y su actualización interactiva todavía leen datos solapados. Una
hidratación compartida exigiría revisar campos, stock y actualización; no se
presenta esa optimización como realizada.

La estrategia JWT ahora utiliza el usuario que ya obtiene
`AuthSessionsService.validate/verify`, en vez de consultarlo de nuevo. Se
conservan firma **HS256**, caducidad, tipo de token, sesión persistida, versión,
cuenta activa, rol actual, revocación, hash de refresh y plazos por rol. No se
añadió una caché de autorizaciones. Las pruebas de HTTP real rechazan firma
incorrecta y HS384 tanto en acceso como en renovación con **401 y cero SQL de
identidad**. Los tokens con firma válida pero sesión revocada, cuenta no activa
(`PENDING_PASSWORD`, estado existente en el esquema de CRONOX)
o versión cambiada también reciben 401; los tests de cambio de rol e inactividad
siguen pasando. Se conserva el borrado de cookies cuando la sesión es inválida
de forma definitiva.

En navegador anónimo, la tienda pasó de 11 a 9 llamadas API: desaparecen el
segundo `/api/me`, CSRF y refresh innecesarios; aparece la lectura legítima de
carrito, antes interrumpida por el evento de fin de sesión del refresh fallido.
Ambas visitas hicieron **cero SQL de identidad**. El total pasó de 20 a 28 SQL,
porque `GET /api/cart` crea actualmente el carrito y su identificador de invitado
en la primera lectura. Por tanto, **no se afirma que el total de SQL anónimo haya
bajado**. Se conserva ese contrato y la cookie de carrito para no cambiar su
ciclo de vida. Diferir su creación hasta la primera alta es una propuesta
separada: requeriría definir una respuesta de carrito aún no persistido y probar
fusión, expiración y checkout; nunca devolver vacío al fallar un carrito existente.

### Fallos corregidos, efecto y evidencia

| Hallazgo confirmado | Efecto y corrección | Verificación |
| --- | --- | --- |
| Cookies borradas por una caída de DB; gravedad media de disponibilidad | `session-cookies.ts` solo limpia fallos definitivos de autenticación. `auth.service.ts` propaga errores de dependencia y evita probar refresh otra vez ante ellos. El middleware HTML devuelve 503 sin redirigir ni conceder acceso. | Antes: refresh 500 con ambas cookies eliminadas; admin HTML 307 y cookies eliminadas. Después: ambos 503, cookies conservadas; mismas cookies funcionan al recuperar DB. |
| Fallos Prisma de disponibilidad tratados como 500 genérico; media | Filtro específico para P1001/P1002/P1008/P1017/P2024/P2037: 503, `DEPENDENCY_UNAVAILABLE`, `Retry-After: 5`, `no-store`. Otros errores siguen su tratamiento de error normal. | Pool agotado: 500 → 503 aproximadamente en 1 s; productos/categorías caídos: 503, sin catálogo vacío ni éxito simulado. |
| Dos clientes/pools Prisma; media bajo saturación | `ProductModule` importa el módulo Prisma compartido y deja de crear su propia instancia. | Instrumentación del `AppModule`: **2 → 1** clientes de aplicación, excluyendo el cliente de control de la prueba. |
| Lectura redundante de usuario; baja de eficiencia | Las estrategias de acceso/refresh reutilizan el usuario validado con la sesión. | Perfil válido: **4 → 3 SQL por petición**, manteniendo invalidación inmediata. |
| Consultas idénticas simultáneas; media bajo lentitud | Pantalla Clave comparte la lectura pendiente y conserva su TTL de 1 s, invalidación y vencimiento. SEO comparte solo la promesa en curso, sin conservar un catálogo entre peticiones sucesivas. | Doce peticiones bajo bloqueo: **12 → 1 consultas** de compuerta y **12 → 1 consultas** de enlaces SEO, todas 200. Fallos no dejan una promesa rechazada permanente. |
| Refresh de visitantes sin credenciales; baja de carga innecesaria | El guard responde `AUTH_REQUIRED` sin buscar identidad y el transporte no intenta renovar esa ausencia. Si la comprobación previa responde 503, tampoco hace otro POST de refresh. | Navegador anónimo sin refresh; pruebas DOM de no cierre de sesión/reintento ante 503. Dos pestañas con acceso caducado realizan **una sola renovación** y ambas recuperan 200. |
| Claves de IP/operación caducadas retenidas; media de memoria | El storage instalado conservaba entradas tras caducar sus hits. Se sustituye por ventanas deslizantes con barrido de expirados y un temporizador compartido. No cambia los umbrales ni consulta DB. | Reproducción del paquete: 24 claves, cero hits activos, 24 claves retenidas. Nuevo storage: 100 claves → 0 tras caducar/barrer; un timer → 0. Un bloqueo no prolonga su vencimiento ni reinicia otra clave. |

Referencia cuantitativa de las muestras comparables (`before.json` y
`after-comparable.json`):

| Operación | Concurrencia | Mediana/máximo antes (ms) | Mediana/máximo después (ms) | Resultado |
| --- | ---: | ---: | ---: | --- |
| Perfil válido | 1 | 3,0 / 5,7 | 2,7 / 4,4 | Cuatro respuestas 200 por fase |
| Compuerta fría, bloqueo inducido de 250 ms | 12 | 254,7 / 255,5 | 258,6 / 258,7 | 12 consultas → 1; doce 200 |
| Enlaces SEO, bloqueo inducido de 250 ms | 12 | 262,9 / 266,3 | 261,3 / 264,1 | 12 consultas → 1; doce 200 |
| Petición protegida sin conexión libre | 1 | 1005,6 / 1005,6 | 1015,7 / 1015,7 | 500 → 503; no elimina sesión |
| HTML admin con PostgreSQL parado | 1 | 2017,2 / 2017,2 | 1003,1 / 1003,1 | 307 + borrado → 503 sin borrado |

En las dos ráfagas, el contador total incluye además el COMMIT de la transacción
que libera el bloqueo de control: 13 → 2 eventos. La reducción de trabajo no se
presenta como una mejora proporcional de latencia: todas las peticiones esperan
el mismo bloqueo. Son muestras pequeñas de una máquina de desarrollo, no un
benchmark de peticiones por segundo. En caída, otros tiempos variaron por el
estado del pool (por ejemplo, SEO ~1 → ~2 s); tampoco se afirma una reducción
general de latencia de errores.

En Chromium real a **1366 y 390 px**, con la página de cuenta ya cargada,
`/api/me`, refresh y escritura protegida de dirección devolvieron 503 durante
la parada. Permanecieron ambas cookies, los campos y la página, sin redirección
a login ni bucle de refresh. No se autorizó la escritura. Al reiniciar solo la
base, el mismo navegador recuperó su sesión. Se inspeccionaron las capturas;
cero excepciones JavaScript de página. Los errores HTTP deliberados sí aparecen
en consola/red y no se ocultaron. Las peticiones externas del navegador se
bloquearon; no se reemplazaron respuestas locales por mocks.

### Límites, IP compartida y varios procesos

Se conservan los límites ya declarados por operación/IP: login 10/min, registro
y varios enlaces 5/min, recuperación 3/min, restablecimiento 5/min, refresh
30/min, actividad 10/min; newsletter 5/15 min; espera de reposición 30/min;
exportación administrativa 5/min. El valor general es 100/min por controlador,
método e IP, configurable por entorno. Las búsquedas/paginación del catálogo
usan ese límite de API; servir HTML de login o estáticos no consume intentos de
login. No existe una nueva cuota total de clientes, visitas o ventas.

Once POST vacíos a login produjeron diez 400 y un 429, sin SQL; los intentos
malformados también consumen límite. Cambiar `X-Forwarded-For` con `trust proxy=0`
no permitió evitar el bloqueo. Tras la ventana real de 60 s, la misma petición
volvió a alcanzar validación (400). Durante el bloqueo se ejecutaron 15 tareas,
concurrencia máxima 8: doce intentos obtuvieron 429, mientras productos y perfil
obtuvieron 200 y añadir al carrito 201 **desde la misma IP**. Duración de la
muestra comparable: 28 ms, mediana 4,5 ms, máximo 21,9 ms. Esto acredita esa
combinación acotada, no una capacidad comercial o resistencia a DDoS.

No se usa el correo declarado como clave de un bloqueo global de cuenta; un
tercero no puede bloquearla por escribir su dirección en esos intentos. El
límite de login sí puede afectar a otro cliente de la misma NAT que intente
iniciar sesión durante la ventana. No se afirma que esa colisión desaparezca.
Antes de cambiar las cifras, medir rechazos reales por ruta y NAT; considerar
un presupuesto específico de intentos con señales fiables y conservar el uso
normal. No se impuso bloqueo adicional por cuenta, CAPTCHA ni lista de países.

El storage es **local al proceso**. Dos instancias independientes mantienen
contadores independientes (prueba explícita); un despliegue con N procesos puede
admitir hasta N presupuestos por ruta/IP, según reparto. No se ha comprobado la
configuración efectiva de PM2 ni el proxy desplegado. La solución distribuida,
si esa topología existe, debe estar en el proxy o en un almacén compartido
independiente de PostgreSQL, con política de fallo definida y ensayada. No se
añade una consulta a la base por cada comprobación de límite.

La configuración local usa `TRUST_PROXY=0` y solo escucha en loopback. El archivo
de entorno de despliegue presente en el repositorio no define `TRUST_PROXY` ni
HOST; los defaults son 0 y `0.0.0.0`. **No prueba los valores efectivos de
producción**, que pueden venir del gestor de procesos. Si el proxy real quedase
sin declarar, sus clientes compartirían la IP del proxy para el limitador.
Los tests de Express demuestran ambas caras: sin confianza se ignora XFF; con
un salto se toma el último remitente reenviado, pero un cliente que llegue
directamente al origen puede falsificarlo. No se activó confianza ciega.

### Conexiones, trabajos y límites de lo revisado

El cliente compartido elimina un pool duplicado. No se elevó el tamaño de pool
ni se aumentaron reintentos. `.env.local` no declara límites/tiempos explícitos
en la URL. La URL del archivo de despliegue declara `connection_limit=1` y
`pgbouncer=true`, sin `pool_timeout`/`connect_timeout` explícitos; no se abrió esa
conexión ni se certifica su configuración efectiva. Presupuestar conexiones
como procesos × pools × conexiones, más migraciones y otros clientes; elegir
esperas con mediciones, no copiando las dos conexiones del fixture.
Los parámetros corresponden al motor instalado Prisma 6; su semántica está
documentada en [Connection pool de Prisma ORM v6](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/connection-pool).

La inspección de código encontró defensas existentes que se conservan:

- Buzones: tick cada 5 s, exclusión `running`, lotes de dos envíos y dos
  sincronizaciones; leases persistidas con exclusión entre procesos, espera
  interactiva acotada y renovación de lease. Caché de fallos con vencimiento.
  Conexión/saludo del proveedor 15 s y socket 45 s. No se eliminan estados de
  entrega SMTP incierta para volver a enviar a ciegas.
- Newsletter y reposición: exclusión del trabajo en curso, reclamación de
  trabajos, lotes/reintentos limitados y estados persistidos. Las pruebas previas
  de correo cubren cuotas y concurrencia con SMTP loopback; no acreditan tiempos
  de un proveedor real.
- Mantenimiento de analítica, auditoría, presencia y limpieza de checkout:
  guardas contra solapamiento dentro del proceso. Checkout usa lotes de 100 y
  conserva comprobación del proveedor antes de liberar reservas. Las guardas en
  memoria no convierten todos los trabajos en exclusivos entre varios procesos.
- Exportaciones: límite de filas 5.000 y respuesta máxima de 30 s. Su
  `Promise.race` **no cancela el SQL subyacente**. El seguimiento posterior
  reproduce esta condición con PostgreSQL aislado y `pg_sleep`, sin datos reales;
  no se declara resuelta esa posible acumulación. Revisar timeout/cancelación de consulta y exclusión de
  trabajo costoso antes de aumentar workers. Evitar un timeout global que rompa
  transacciones legítimas de correo o pedidos.

El alta de carritos de invitado por GET, el crecimiento de colas persistidas si
un proveedor no drena y el volumen de IP distintas durante una ventana siguen
requiriendo observabilidad/capacidad. El nuevo barrido elimina entradas caducadas,
pero no garantiza memoria constante bajo un flujo arbitrario de IP nuevas.
No se aplicaron descartes de pedidos, correos, visitas o sesiones para imponer
un cupo global. No se midieron planes SQL ni volúmenes de tablas de producción.

### Salud y propuesta de monitorización (sin activar)

`GET /api/health` conserva **200 `{ "ok": true }` sin SQL**: indica que el proceso
responde. Aparece usado por scripts de comprobación pública y documentación de
verificación de despliegues del repositorio; no se accedió al monitor real.
No acredita PostgreSQL, Stripe, correo o almacenamiento.

Se añade `GET /api/ready`: comprueba `SELECT 1`, devuelve 200 `{ "ok": true }`
o 503 `{ "ok": false }`, sin detalles internos, con `no-store` y `Retry-After: 5`
en error. Comparte comprobación concurrente y resultado durante 1 s, tiene
deadline de respuesta de 1 s y permite **como máximo una consulta pendiente por
proceso**. Si el SQL tarda más, no se encolan nuevas consultas por cada sondeo.
El timeout HTTP no cancela el SQL pendiente. Una prueba de 30 sondeos verifica
la única consulta; otra fase comprueba que sigue sin acumular trabajo tras
superar el deadline. Ambos endpoints quedan fuera del limitador de usuario para
evitar falsos 429 del monitor; sus operaciones están acotadas.

Con la base aislada parada: health 200, ready 503; tras recuperarla: ready 200
sin reiniciar la aplicación. Esto mide conectividad, no la presencia de todas
las migraciones. El smoke de productos/categorías continúa siendo necesario.

Propuesta operativa, **no configurada ni enviada**:

1. Sondear ambos endpoints por HTTPS desde fuera del servidor cada 60 s, con
   timeout de 5 s, verificar código y booleano y registrar latencia. Durante
   incidencias no aumentar la frecuencia ni lanzar reintentos paralelos.
2. Abrir una única alerta tras tres fallos consecutivos y cerrarla tras dos
   éxitos; deduplicar mientras persista el incidente. Destinatarios y canal
   pendientes de elección, sin contratación ni avisos reales en esta revisión.
3. Health caído requiere revisar proceso/proxy/red. Health vivo y ready caído
   requiere revisar PostgreSQL, pool, conexiones y latencia; **no reiniciar en
   bucle el proceso por una dependencia externa**. El monitor no debe ejecutar
   migraciones ni aumentar el pool automáticamente.
4. Recoger tasas 429/503/5xx, latencia por ruta normalizada, espera de pool,
   conexiones ocupadas, memoria y edad del trabajo pendiente. Omitir cookies,
   Authorization, cuerpos, correos y parámetros de URLs en registros/alertas.
   Observar salud de correo/Stripe por sus estados persistidos sin enviar
   correos o efectuar pagos sintéticos desde cada sondeo.
5. Tras una futura publicación autorizada, comprobar catálogo y categorías,
   inicio/renovación de una sesión de prueba y recuperación en staging. Activar
   alertas de caída/recuperación allí antes de trasladar la configuración.

### Propuesta de infraestructura (sin aplicar)

- Inventariar proxy/CDN → Nginx → procesos y número de instancias. Restringir
  el puerto Node al proxy/loopback; configurar confianza solo para la ruta real.
  En un único Nginx de borde, sobrescribir XFF con su dirección de cliente
  verificada; si hay CDN, validar primero sus remitentes y cabecera de IP.
  Probar dos clientes distintos y XFF falsificada, tanto por proxy como contra
  el origen, que debe ser inaccesible desde Internet. No fijar `TRUST_PROXY=1`
  sin comprobar que todas las rutas tienen exactamente ese salto.
  Esta condición coincide con [la documentación de Express sobre proxies](https://expressjs.com/en/guide/behind-proxies/).
- Antes de bloquear, observar límites por **operación** en el proxy con tráfico
  legítimo de referencia y modo de registro. Dimensionar ráfagas y concurrencia
  según coste/latencia y NAT. No aplicar un contador común a navegación, checkout
  y login. La protección del proveedor debe absorber caudal de red, conexiones
  y tráfico distribuido que ya puede agotar el servidor antes de llegar a Nest.
  Nginx permite esa evaluación con `limit_req_dry_run on`; el código de rechazo
  puede fijarse a 429 con `limit_req_status`. Son opciones propuestas, no
  configuración aplicada: [módulo oficial limit_req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
- Conservar cuerpo bruto, firma e idempotencia de webhooks. Separar su política
  de las páginas y formularios y probar entrega/reintentos en staging. No añadir
  desafíos interactivos a webhooks, pagos o recursos esenciales de checkout.
- Cachear solo recursos públicos adecuados; no cachear sesiones, perfil, carrito,
  administración ni respuestas 503 como páginas correctas. Para HTML SEO con
  compuerta/preview, revisar cookies, invalidación y visibilidad antes de cachear.
  Preservar canonicals, robots y sitemaps. Un User-Agent «Googlebot» no es prueba
  de identidad ni motivo para eximir controles; tampoco se bloquean países o
  rangos copiando el incidente ajeno.
- Revisar presupuestos de conexiones y tiempos del pool/servidor con staging,
  consultas lentas y jobs simultáneos. No aumentar conexiones para encubrir una
  consulta bloqueada ni multiplicar workers sin considerar todos sus pools.

### Archivos, reproducción y verificación de la ampliación

Código de aplicación: `auth/session-cookies.ts`, `auth/auth.service.ts`, guard y
estrategias JWT, `products/product.module.ts`, `key-screen/key-screen.service.ts`,
middleware HTML y catálogo SEO, `app.module.ts`, `app.controller.ts`, nuevos
`readiness.service.ts`, `common/filters/database-availability.filter.ts` y
`common/guards/expiring-throttler.storage.ts`; transporte
`cronox-front/src/admin/session.ts` y su generado `cronox-front/assets/api.js`.
Se añaden regresiones de disponibilidad, cookies, compuerta, proxy y storage;
se amplían las de auth/SEO/DOM. Los fixtures de carrito y estadísticas incluyen
ahora el usuario que devuelve la validación de sesión real; no se suprimen sus
comprobaciones de permisos ni exclusión de administradores.

Reproducción local, desde la raíz salvo Jest:
detener antes los procesos de revisión y el watcher local que carguen Prisma
(Windows puede mantener bloqueada su DLL durante `prisma generate`). Al terminar,
volver a iniciar localhost con `npm --prefix cronox-backend run start:dev`.

```powershell
npm --prefix cronox-backend run build
npm run admin:build
node cronox-backend/scripts/review-security.cjs --resilience
node cronox-backend/scripts/review-security.cjs
npx playwright test --config playwright.cart.config.cjs
npx playwright test --config playwright.seo.config.cjs
# Jest: ejecutar desde cronox-backend
npm test -- --runInBand
```

El script crea y destruye su propio servidor/base; no acepta una URL de producción.
`--serve` deja abierto el fixture para navegador y `stop` lo cierra. Las rutas
`/__resilience/*` existen únicamente en ese script aislado, no en la aplicación.
`--quick` omite la espera de recuperación de límite; **no se utilizó para acreditar
esa recuperación**. Los tokens/cookies y SQL con parámetros no se guardan en los
resultados. El diff previo a la ampliación está en `before.patch`.

| Verificación posterior a los cambios | Resultado | Artefacto en `output/playwright/resilience-2026-10-05/` |
| --- | --- | --- |
| Backend con generación de Prisma / assets | Correcto | `backend-build.log`, `admin-build.log` |
| Jest completo | **195 suites, 1.749 pruebas correctas** | `jest-final.log` |
| Fixture de cuenta no activa corregido al enum real del esquema | **18 pruebas correctas** | `session-fixture-final.log` |
| HTTP/SQL/concurrencia/caída y recuperación | Correcto, PostgreSQL real aislado | `before.json`, `after-comparable.json`, `after.json`, `resilience-final.log` |
| Seguridad, checkout y administración aislados | Correcto después de los cambios de auth/pool | `security-final.log` |
| Carrito Chromium/Firefox/WebKit | **120 correctas, 3 omisiones existentes** | `cart-final.log` |
| SEO Chromium/WebKit | **12 correctas** | `seo-final.log` |
| Sesión Chromium, 1366/390 px y dos pestañas | Una renovación; cookies conservadas ante 503; recuperación | `browser-before.log`, `browser-after.log`, `session-outage-*.png` |
| Retención del storage original instalado | 24 claves retenidas después de expirar sus hits | `storage-before.cjs`, `storage-before.json` |
| localhost:3000 recompilado y reiniciado | Health/ready/productos/categorías/galería 200; siete productos, seis categorías; filtros de texto y teclado correctos, cero errores JS | `localhost-final.log`, `store-final.log`, `menu-*.png`, `selected-*.png` |

Los artefactos son locales e ignorados por Git. No sustituyen la revisión de
topología, configuración y volumen de producción. No se acredita capacidad más
allá de las **12 peticiones concurrentes** y la mezcla concreta probada; no se
afirma protección frente a cualquier ataque. Las decisiones de permisos y email
del encargo principal siguen pendientes. Toda la ampliación queda sin commit,
sin push y sin despliegue; no se activó monitorización ni protección externa.

## Seguimiento previo a la aprobación de los cambios

Registro histórico del seguimiento anterior. Las referencias a cambio inmediato
de email, dependencia vulnerable y SQL activo tras el timeout corresponden a ese
momento. El estado vigente se documenta en la siguiente entrega de implementación.

Seguimiento del 05/10/2026 tras contrastar nuevamente Git, código fuente,
compilación y evidencias. Se conserva el estado previo en
`output/playwright/security-followup-2026-10-05/before.patch`. No se encontraron
instrucciones AGENTS adicionales aplicables. Las correcciones de la revisión
inicial y de resistencia siguen presentes; no se repitieron ni se revirtieron.
Este seguimiento modifica documentación y scripts de comprobación, sin cambiar
permisos, flujo de email, versiones de dependencias ni código de producción.

### 1. ADMIN/SUPERADMIN: capacidad efectiva y propuesta

La política efectiva continúa siendo la descrita anteriormente:
`hasAnyRole` acepta inmediatamente ADMIN y SUPERADMIN aunque la lista solicitada
contenga solo SUPERADMIN. Tanto `AdminGuard` como `RolesGuard` utilizan ese helper.
Por ello una anotación `@Roles(SUPERADMIN)` no constituye por sí sola una frontera
entre esos dos roles. No concede acceso administrativo a USER o a un visitante;
el problema confirmado está en la separación interna de administradores.

| Operación actual | ADMIN | SUPERADMIN | Evidencia y alcance |
| --- | --- | --- | --- |
| Consultar pedidos y detalle de clientes | Sí | Sí | GET `/api/admin/orders` y `/api/admin/users/:id` → 200 para ambos con JWT real y datos sintéticos |
| Crear/editar productos, variantes, stock, categorías, cupones y notas | Sí según los guards actuales | Sí | Código de controladores sin guard exclusivo; POST vacío a productos/cupones → 400 para ambos, alcanza validación. No se presenta ese 400 como una escritura exitosa |
| Gestionar preparación/envío y solicitar reembolso de pedidos | Sí según la autorización actual | Sí | `AdminOrdersController` usa la comprobación genérica; el servicio conserva estados y condiciones del pedido/pago. No se ejecutó un reembolso externo |
| Consultar finanzas, inventario, auditoría y solicitudes de círculo | Sí | Sí | Controladores administrativos con política compartida; revisión de código, no ejecución manual de cada combinación |
| Editar usuarios y cambiar roles | No | Sí | `SuperAdminGuard` en PATCH; cuerpo vacío → ADMIN 403, SUPERADMIN 400 por validación |
| Edición masiva | No | Sí | Guard exclusivo y comprobación del usuario/estado en servicio; POST preview vacío → 403/400 |
| Exportaciones unificadas `/api/admin/exports/*`, compras presenciales y anulación manual | No | Sí | Guard exclusivo en controlador. La antigua exportación CSV `/api/admin/orders/export.csv` sigue compartida: no todas las exportaciones son exclusivas |
| Borrar auditoría | No | Sí | DELETE vacío → 403/400; el guard exclusivo precede a la validación |
| Buzones | Solo buzones asignados y permisos de lectura/envío concedidos; borradores propios | Acceso global; configuración y permisos exclusivos donde el servicio exige superadministrador | `MailboxAccessService` verifica rol, asignaciones, permiso de envío y propiedad; no depende únicamente del helper genérico |
| Plantillas de correo gestionado y lanzamiento | Sí según el guard genérico | Sí | Controladores anotados SUPERADMIN sin guard exclusivo; conservar sus validaciones y reglas de campañas |

**Riesgo confirmado:** una operación que el propietario considere exclusiva puede
quedar accesible a ADMIN si se protege solo con la anotación. Ejemplo: hoy puede
leer pedidos y superar la autorización del endpoint de creación de cupones;
también el endpoint de reembolso carece de una barrera exclusiva de rol. Esto no
demuestra que se haya abusado de esas funciones ni que sus validaciones de negocio
se puedan saltar. Los tests/documentos previos de acceso compartido hacen que
retirar capacidades sea una decisión de producto, pendiente de aprobación.

**Matriz recomendada para revisión:**

- ADMIN: atención y operación diaria —consultar clientes/pedidos necesarios,
  preparar envíos, marcar entrega, usar notas y buzones asignados—; conservar
  trazabilidad y las restricciones de propietario/asignación existentes.
- SUPERADMIN: roles y cuentas, precios/descuentos/cupones, alta/baja de catálogo,
  visibilidad/grupos de categorías, ajustes de stock, reembolsos/cancelaciones,
  exportaciones de datos personales/financieros, compras manuales, edición
  masiva, borrado de auditoría, credenciales/permisos de correo y configuración
  global de plantillas/campañas. Delegar cada excepción expresamente si el equipo
  necesita que ADMIN gestione catálogo o promociones.
- Implementación tras acordar esa matriz: `hasAnyRole` debe respetar la lista;
  marcar las compartidas `@Roles(ADMIN, SUPERADMIN)` y las exclusivas solo
  SUPERADMIN, con pruebas HTTP por operación. Revisar asimismo las rutas sin
  anotación y el CSV antiguo. No basta cambiar el menú o sustituir el helper sin
  inventariar las rutas compartidas.

Prueba actual: `review-security.cjs --pending-review`, PostgreSQL nuevo y JWT real;
`security-current.log` conserva los códigos. Ninguna escritura de prueba afecta
a localhost:3000 o producción.

### 2. Cambio de email: qué está corregido y qué falta

`PUT /api/me` autentica la sesión y exige CSRF; valida formato, normaliza email,
rechaza duplicados y actualiza `User.email` inmediatamente. No pide contraseña
actual ni prueba de posesión del buzón nuevo. No existe un estado de cambio
pendiente en este flujo. La misma sesión conserva acceso tras el cambio.

Ejemplo aislado reproducido: una cuenta cambia de `http-user@example.test` a
`http-changed@example.test` enviando solo el nuevo email y las credenciales de
sesión/CSRF; PUT y el GET posterior devuelven 200. No se envía confirmación al
nuevo buzón. Si una sesión válida cae en manos de otra persona, puede sustituir
el destino de recuperación por uno controlado por ella. Una errata legítima
puede dejar al cliente sin acceso al buzón utilizado para recuperar la cuenta.
CSRF protege contra peticiones de otros sitios, pero no prueba que el titular
posea la nueva dirección ni que una sesión robada sea del titular.

**Ya resuelto y verificado de nuevo:** el cambio invalida enlaces pendientes de
recuperación, lanzamiento y newsletter ACCESS de la dirección antigua; un enlace
de reset anterior recibe 400, lanzamiento 401; la emisión encolada comprueba el
email actual. No hay que repetir ni retirar esa corrección.

**Propuesta concreta pendiente:** mantener el email actual mientras se verifica
un cambio; exigir contraseña actual cuando exista, y una confirmación de un uso
en el buzón actual para cuentas sin contraseña. Enviar al buzón nuevo un enlace
de un uso con token aleatorio almacenado como hash, ligado a usuario, dirección
propuesta y versión de la solicitud. Propuesta de caducidad: 30 minutos, a acordar.
Reenviar invalida la solicitud anterior; cancelar/vencer conserva el email actual.
No trasladar recuperación ni correos de pedidos al nuevo buzón antes de confirmar.

Al confirmar: volver a comprobar unicidad y versión dentro de una transacción,
cambiar email y revocar enlaces antiguos conservando las correcciones existentes;
revocar otras sesiones y renovar la actual, con aviso al buzón anterior y registro
de metadatos. Si se perdió el buzón actual en una cuenta sin contraseña, definir
un procedimiento de soporte verificado antes de permitir el cambio. Es una
propuesta de experiencia/política y plantillas: no se implementó ni se envió
ningún correo real para aprobarla.

### 3. Dependencias: auditoría nueva y exposición concreta

`npm audit` ejecutado de nuevo conserva **48 nodos afectados: 44 high, 4 moderate,
0 critical**. Raíz frontend: **0**. Con `--omit=dev`, el grafo instalado informa
**9 nodos: 6 high y 3 moderate**. Ese segundo resultado también incluye CLI/peers
de Prisma y transitivas: no equivale a nueve vulnerabilidades explotables por HTTP.
Los JSON y el árbol exacto están en `security-followup-2026-10-05/`.

| Paquete instalado / avisos | Uso comprobado y condiciones | Corrección propuesta y validación |
| --- | --- | --- |
| `nodemailer` 9.0.5: parser de direcciones, resolución de contenido, dominios, DNS/TLS y arrays anidados | Correo transaccional y `recipientUnits`, compartido también por envíos de buzones. El alias y el Nodemailer de mailparser están ya en 10.0.13, pero no sustituyen este parser. DTO de destinatarios y rechazo de raw/path/href limitan entradas; no se demostró una explotación pública de todos los avisos | Prioridad alta: actualizar la dependencia principal a 10.0.13 como el alias ya instalado, revisar tipos/API y ejecutar cuota/recipients, MIME, SMTP loopback, estados UNKNOWN y colas. Evitar que solo se actualice el alias dejando el parser principal antiguo |
| `qs` 6.15.3: límites de arrays con comma y `isBuffer` | Express/body-parser procesa URL encoded con límite de 100 KB; Stripe también depende de qs. No se encontró `comma:true` ni un `qs.stringify` de datos hostiles en código propio. El segundo aviso requiere esa serialización/round-trip; no es equivalente a cualquier GET del catálogo | Actualización dirigida a 6.16.0 o posterior compatible y revisar todas las resoluciones. Probar filtros/paginación, formularios urlencoded y Stripe con firmas locales. No atribuir a CRONOX el PoC que necesita opciones que no utiliza |
| `sharp` 0.34.5: avisos de libvips y libheif | Procesa imágenes administrativas. El servicio valida firma binaria JPEG/PNG/WebP antes de Sharp, además de MIME, bytes y píxeles; GIF/TIFF/AVIF no se aceptan en esas subidas. Reduce los formatos alcanzables, pero no certifica los binarios desplegados ni elimina la necesidad de actualizar | Evaluar 0.35.5, sugerida por la auditoría actual, con binarios del SO objetivo. Probar originales, EXIF/rotación, WebP, transparencia, framing, backfill y límites. No bloquear formatos legítimos ni afirmar RCE confirmado en CRONOX |
| `js-yaml` 5.2.3 en Swagger; 4.3.1 y 3.15.1 en herramientas | No hay una ruta de aplicación encontrada que cargue YAML del usuario. El aviso de merges vacíos afecta al parser; anotar Swagger no significa que un visitante pueda enviar YAML a ese parser | Actualizar override de Swagger a 5.4.1; resolver ramas 4 a ≥4.3.2 y 3 a ≥3.15.2 mediante sus padres. Probar arranque/OpenAPI, build y Jest; no dejar el override antiguo como si cerrara avisos posteriores |
| `deepmerge-ts` 7.1.5 → `@prisma/config`/CLI Prisma; 8.0.2 de mailparser ya corregido | Aviso de grafos recursivos en combinación de configuración. No se observó paso de JSON del visitante a la configuración CLI | Actualización compatible de Prisma/config con cliente y generación coherentes. La propuesta automática de volver Prisma a 6.12.0 no se aplica a ciegas; resolver por árbol/versiones compatibles y probar build/migraciones aisladas |
| `brace-expansion`, `braces`, fast-uri, Browserslist/baseline y humanfs, con cadenas de Jest/ESLint/Nest CLI/ts-loader | Principalmente patrones, configuraciones, estadísticas y archivos del proceso de build/test. La rama ExcelJS de brace-expansion está en 2.1.7; las ramas vulnerables detectadas son otras. No se encontraron patrones/URI/archivos de visitantes pasados a estas herramientas | Resolver por paquetes padre, con parches compatibles y lockfile revisado. Ejecutar build/test/lint correspondientes y auditar instalación final. Son riesgos de herramientas/CI; no describirlos como 39 ataques distintos a la tienda |

Las versiones reparadas y las condiciones del parser están contrastadas con los
avisos oficiales: [Nodemailer addressparser](https://github.com/advisories/GHSA-v53p-9fqp-m79j),
[qs comma](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) y
[qs isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).
Para los nativos: [Sharp/libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
y [Sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c);
para Swagger, [js-yaml 5.4.1](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm).
La exposición de CRONOX se deduce del código y árbol local, no del título del aviso.

**Multer está resuelto:** override y alias siguen en 2.4.0 y no figura en la
auditoría nueva. No se repitió la actualización. En este seguimiento se presentan
las actualizaciones restantes por separado para revisión; no se ejecutó
`audit fix --force`, downgrade de Prisma ni actualización masiva sin pruebas.

### 4. Resistencia: completada dentro del alcance local y comprobaciones añadidas

La ampliación solicitada está implementada y documentada en la sección anterior.
Se ha vuelto a ejecutar su harness con la compilación actual. Permanecen las
correcciones de cookies/503, singleton Prisma, usuario reutilizado, lectura
concurrente compartida, ausencia de refresh anónimo, expiración del storage y
readiness. El incidente ajeno sigue siendo únicamente una hipótesis de investigación.

Mediciones antes/después conservadas: cero SQL de identidad en las rutas anónimas,
inválidas/caducadas e inexistentes ensayadas; perfil válido 4 → 3 SQL/petición;
dos pools → uno; doce lecturas concurrentes de compuerta/enlaces SEO → una;
refresh ante caída 500 y borrado de cookies → 503 y cookies conservadas.
Las dos pestañas comparten una renovación; escritorio/móvil conservan sesión y
recuperan al volver DB. El catálogo falla explícitamente, sin datos simulados.

Login mantiene diez intentos/minuto por operación/IP: el undécimo recibe 429 y
se recupera tras la ventana. Mientras doce intentos ya bloqueados recibían 429,
la misma IP consultó productos/perfil con 200 y añadió carrito con 201, dentro
de una mezcla de quince tareas con concurrencia ocho. No se añadió cupo global.
La tienda anónima hizo menos llamadas de renovación, pero su SQL total 20 → 28
incluye la lectura/creación de carrito: esa salvedad sigue vigente.

Comprobaciones que faltaban como integración y se completaron ahora:

| Prueba nueva | Resultado | Límite de la conclusión |
| --- | --- | --- |
| Dos procesos de SO con el storage compilado y la misma clave | Cada proceso admite sus dos hits de fixture y bloquea el tercero independientemente | Prueba que no existe presupuesto distribuido; no prueba la cantidad de workers desplegados. La cifra dos pertenece solo al fixture, no cambia límites de CRONOX |
| Doce GET `/api/ready` concurrentes con las dos conexiones ocupadas | Doce 503, **un intento SQL**, ~1,016 s; después recupera 200 | PostgreSQL real aislado; instrumentación cuenta también el intento que falla antes de emitir SQL |
| Timeout existente de exportación frente a consulta PostgreSQL de 31,5 s | El método de deadline devuelve 408 a **30,006 s**; `pg_stat_activity` confirma una consulta aún activa; termina a **31,512 s** | Se invoca el método real de timeout con SQL sintético, no una exportación HTTP completa con filas reales. Confirma que la respuesta no cancela SQL, sin afirmar que ya se acumulen exports en producción |

La última comprobación convierte el riesgo de cancelación en evidencia aislada;
**la corrección sigue pendiente**. Propuesta: ejecutar las lecturas de exportación
con un plazo de consulta del servidor acotado al trabajo/transacción y sin
reintentos automáticos al expirar; mantener seguimiento de trabajo hasta que SQL
termine y deduplicar el reintento del mismo export. Revisar sus consultas y
cancelación en staging antes de implementarlo. No poner un `statement_timeout`
global que pueda interrumpir pagos/correo, ni aumentar conexiones para ocultarlo.

Siguen sin acreditarse topología/valores efectivos del proxy/CDN/PM2, pools y
binarios desplegados, caudal de producción, entrega SMTP/Stripe externos ni
comportamiento bajo DDoS. Las propuestas de monitorización y protección del
proveedor están preparadas, sin activar. Guardas de jobs locales y leases de
buzones no garantizan que todos los jobs sean exclusivos entre varios procesos.
No se afirma capacidad por segundo ni más de doce peticiones concurrentes en
las mezclas ensayadas. No se copiaron límites de otra web.

### Verificación y archivos de este seguimiento

- `review-security.cjs --pending-review`: correcto; prueba matriz efectiva de
  roles, cambio inmediato de email y las regresiones de seguridad/checkout.
- `review-security.cjs --resilience --pending-review`: correcto; pruebas previas
  más dos procesos, readiness saturado y deadline/SQL de exportaciones.
- Localhost:3000: health, ready, productos, categorías y galería vuelven a dar
  200. Se conservan las pruebas visuales de escritorio/móvil y teclado ya
  realizadas; no se presenta este GET como una nueva prueba visual.
- Scripts comprobados con `node --check` y diff sin errores de whitespace.
  La suite completa previa sigue siendo 195 suites/1.749 pruebas, carrito
  120 + tres omisiones y SEO 12. No se anuncia como reejecutada en este seguimiento.

Archivos modificados: este informe, ampliaciones opcionales en
`scripts/review-security-http.cjs` y `scripts/review-resilience.cjs`, y nuevo
`scripts/review-resilience-extra.cjs`. Estos scripts no forman rutas de producción.
Evidencias nuevas en `output/playwright/security-followup-2026-10-05/`:
`security-current.log`, `resilience-current.log`, auditorías JSON y árbol de
dependencias. Los datos, destinatarios y credenciales son sintéticos; no se
imprimen sesiones/secretos. Se conserva la configuración local y no se cambian
datos reales, dependencias, permisos ni comportamiento de producto para
aprobar estas propuestas. Sin commit, push, despliegue ni envíos externos.

## Implementación aprobada y verificación final

Entrega del encargo posterior del 05/10/2026. Se conservaron SEO, categorías,
visibilidad administrativa, filtros de texto, correo y correcciones anteriores.
El diff de partida de esta implementación está en
`output/playwright/security-completion-2026-10-05/before.patch`.
Las secciones anteriores mantienen los diagnósticos históricos; este apartado
determina el estado vigente.

### ADMIN/SUPERADMIN: decisión pospuesta

Por decisión expresa del propietario no se cambia la matriz, `hasAnyRole`,
los roles ni sus guards. La tabla del seguimiento previo sigue describiendo
las capacidades actuales: ambos pueden consultar pedidos/clientes y gestionar
las operaciones compartidas; edición de usuarios/roles, edición masiva,
exportaciones unificadas y borrado de auditoría usan el guard exclusivo.
SUPERADMIN conserva todas las funciones administrativas disponibles, con sus
validaciones de datos, estado de pagos, identidad, asignaciones y propiedad.
USER, FRIEND y visitantes no ganan permisos administrativos.

Ejemplos HTTP repetidos con JWT real y PostgreSQL desechable:
ADMIN/SUPERADMIN reciben 200 al consultar pedidos y otro cliente; POST vacío
a productos/cupones alcanza validación (400 para ambos). PATCH de rol y
preview masivo: ADMIN 403, SUPERADMIN 400 por cuerpo inválido. No se confunde
alcanzar validación con ejecutar una escritura válida. Checkout/operaciones
administrativas aisladas y los siete módulos XLSX siguen funcionando.
El riesgo de confiar únicamente en `@Roles(SUPERADMIN)` continúa documentado;
la separación no se da por resuelta. La matriz propuesta queda como referencia
para una futura decisión, sin aplicarla ahora.

### Cambio de email: dos buzones, una solicitud

El perfil muestra el email vigente como solo lectura y un formulario separado
para solicitar otro. **No pide contraseña ni admite esa alternativa**, tampoco
para cuentas que sí tienen contraseña. Antes del formulario aparece el aviso
de ayuda con texto y enlace `support@cronox.es` / `mailto:support@cronox.es`,
según la aclaración del propietario. No existe recuperación automática desde
soporte: definir su comprobación manual continúa pendiente.

1. Una sesión válida y CSRF permiten solicitar el cambio. Se guarda una solicitud
   `PENDING_CURRENT`, y se envía únicamente al buzón actual desde el sender
   existente NOREPLY. El correo identifica la nueva dirección como texto escapado,
   incluye el botón de autorización, instrucciones/enlace de cancelación y soporte.
2. Abrir el enlace sirve HTML y permite inspeccionarlo, pero no cambia estado.
   Solo el botón y su POST explícito autorizan. La transacción pasa a
   `PENDING_NEW`; entonces se envía la verificación al nuevo buzón.
3. Otro botón/POST explícito verifica la nueva dirección. La transacción comprueba
   solicitud, etapa, email vigente, versión de sesión, caducidad y disponibilidad
   del email de nuevo; únicamente entonces actualiza `User.email`.
4. En la misma transacción se incrementa `sessionVersion`, se revocan todas las
   sesiones y los enlaces pendientes de reset, lanzamiento y newsletter ACCESS.
   Hay que iniciar sesión de nuevo. Se conserva la comprobación existente de
   email vigente al emitir enlaces encolados. Contraseña, rol, estado de cuenta,
   círculos y suscripción/tipo de newsletter permanecen intactos.

Las solicitudes caducan **una hora después de iniciarlas**, sin ampliar ese plazo
al autorizar o reenviar. Una nueva solicitud sustituye a la anterior. Cancelar
desde el perfil o con el enlace del correo conserva el email actual. Los enlaces
de autorización, verificación y cancelación están ligados al mismo UUID aleatorio;
son capacidades diferentes derivadas con HMAC y solo se guardan sus hashes SHA-256.
No son sesiones ni permiten iniciar sesión. Autorizar/finalizar usan transacciones
serializables con reintento de conflictos, nunca SMTP dentro del reintento SQL.
Dos confirmaciones simultáneas producen una operación correcta y otra rechazada;
un token de autorización no sirve como verificación y un enlace usado/sustituido
no se reutiliza.

Los tokens viajan en el fragmento de URL, no en query/path enviado al servidor;
la página lo elimina con `history.replaceState`, aplica `no-referrer` y no guarda
el token en almacenamiento del navegador. Tampoco incorpora analytics de URLs.
La página gestiona el segundo enlace abierto en la misma pestaña mediante
`hashchange`; cada etapa sigue exigiendo una acción. Ni el correo ni el servicio
registran tokens/cuerpo del mensaje. La tabla privada tiene RLS y revocación de
permisos de PUBLIC/anon/authenticated, como las otras tablas privadas de correo.
El backend necesita conservar acceso con su rol de ejecución autorizado.

La misma dirección pendiente se deduplica sin volver a enviar. Hay un minuto
entre solicitudes/reenvíos, cinco solicitudes por usuario en una hora y máximo
cinco envíos por etapa, persistidos en PostgreSQL; siguen las cuotas existentes
del buzón y límites específicos HTTP. No se impone un cupo de visitas/clientes/ventas.
Una sesión robada sin acceso al buzón actual no puede habilitar la etapa nueva
ni hacer envíos a direcciones nuevas. Estos límites no certifican protección
frente a tráfico distribuido; el limitador IP sigue siendo por proceso.

Si falla SMTP, la solicitud permanece pendiente y el perfil ofrece actualizar
estado, reenviar con el intervalo establecido o cancelar. Un resultado SMTP
incierto queda `UNKNOWN` y no provoca un reenvío automático. Reenviar conserva
la misma capacidad de la etapa, de un solo uso, evitando invalidar el mensaje
que pudo haber llegado. Si el fallo ocurre después de autorizar, se conserva
`PENDING_NEW`: no se vuelve a pedir autorización ni se cambia aún el email.
Si el nuevo email pasa a pertenecer a otra cuenta, la finalización devuelve 409
y mantiene el original.

Pruebas: cuentas con contraseña, sin contraseña, FRIEND y SUPERADMIN; ambas
etapas, no alternativa de contraseña, GET/inspección sin consumo, deduplicación,
caducidad, cancelación, sustitución, reutilización, tokens cruzados, concurrencia,
unicidad final, fallo temporal/entrega incierta, reenvíos limitados, escape HTML,
NOREPLY y soporte. PostgreSQL nuevo y SMTP **simulado/capturado en memoria**;
no prueba entrega de un proveedor externo. Se verifica también que anon y
authenticated no pueden leer la tabla privada.

### Dependencias: versiones reales y avisos abiertos

Actualizaciones dirigidas en `cronox-backend/package.json` y `package-lock.json`:

| Paquete/copia | Antes de este encargo | Estado final |
| --- | --- | --- |
| Nodemailer transaccional y parser de `recipientUnits` | 9.0.5 | 10.0.13; el alias `mailbox-nodemailer` también es 10.0.13 |
| qs, incluidas Express/body-parser | 6.15.3 | Override 6.16.0 en todas las copias |
| Sharp / libvips | 0.34.5 | Sharp 0.35.5; binario local libvips 8.18.7 comprobado |
| js-yaml de Swagger | 5.2.3 | 5.4.1 |
| js-yaml de herramientas | 3.15.1 / 4.3.1 | Overrides por rama 3.15.2 / 4.3.2 |
| brace-expansion | Copias 1.1.18 / 2.1.4 / 5.0.9; otra 2.1.7 ya correcta | Overrides por rama 1.1.21 / 2.1.7 / 5.0.12 |

No se utilizó `audit fix --force`. Los overrides conservan cada rama principal.
El npm 10.9.4 local falló al guardar el árbol de overrides de brace-expansion
(`Cannot read properties of undefined (reading 'spec')`); se completó con npm 11
mediante npx, sin cambiar npm global. Los manifiestos y lockfile coinciden;
`npm ls --all --json` no reporta problemas de resolución.

Auditoría final: **42 nodos afectados, 40 high y 2 moderate; cero critical**.
`--omit=dev`: **3 high**, correspondientes a `deepmerge-ts` 7.1.5,
`@prisma/config` y `prisma`. Son nodos/cadenas del aviso, no tres exploits
demostrados. Esta cadena está en la herramienta Prisma/configuración; no se
encontró una ruta HTTP que pase objetos recursivos arbitrarios a esa mezcla.
La corrección requiere pasar a deepmerge-ts 8 mediante una versión compatible
de Prisma/config o evaluar un override principal con pruebas de configuración
y migraciones. `npm audit` propone Prisma 6.12.0 como corrección disruptiva:
no se aplica ese downgrade ni una sustitución principal sin validar su contrato.
El `deepmerge-ts` usado por mailparser sigue en 8.0.2; no se confunden las copias.

El resto pertenece a herramientas de test/build/lint: el aviso raíz de
`braces` 3.0.3 se propaga por micromatch/fast-glob/ts-loader y numerosas entradas
Jest/TypeScript ESLint; también quedan fast-uri 3.1.5, baseline-browser-mapping
2.9.19 y @humanfs/node 0.16.7. No se acreditó un endpoint que permita al visitante
ejecutar globs de herramientas, recurrir humanfs sobre árboles ajenos o usar
fast-uri como validador de URL; el backend revisado usa URL WHATWG en sus controles.
Esto limita aplicabilidad, no elimina los avisos. Propuestas: actualizar padres
de braces/micromatch a versiones corregidas compatibles; evaluar fast-uri ≥3.1.8,
baseline-browser-mapping ≥2.11.0 y @humanfs/node ≥0.16.8 en sus cadenas de herramientas,
con build/lint/tests antes de ampliar overrides. No se cambian aquí masivamente
Jest, Prisma o Nest ni se declara todo el árbol libre de avisos.

La auditoría completa, la de ejecución, árbol completo y pruebas de resolución
están en `security-completion-2026-10-05/`. Verificación funcional adicional:
parser real de destinatarios (grupos/duplicados/límites), adjunto MIME inline,
rechazo de archivos/URLs externos, parsing de formularios y prototipos, JPEG/PNG/WebP,
rotación/redimensionado/recodificación y rechazo de imagen inválida. La integración
de buzones vuelve a pasar con IMAP simulado y SMTP/TLS de loopback.
Versiones corregidas contrastadas con los avisos de
[Nodemailer](https://github.com/advisories/GHSA-v53p-9fqp-m79j),
[qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g),
[Sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
[js-yaml](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) y
[brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).

### Exportaciones: PostgreSQL detiene el trabajo

Se elimina el `Promise.race` que dejaba SQL activo. Las lecturas de los siete
módulos unificados se ejecutan en una transacción RepeatableRead propia del
export, con `statement_timeout` local a esa transacción. Antes de cada consulta
se calcula el tiempo restante del plazo SQL total de 30 segundos; las lecturas
concurrentes del export se ordenan sobre su conexión, evitando que cada una
reciba otros 30 segundos. Se reemplazan las dos transacciones anidadas de
inventario/círculos por lecturas dentro de la misma instantánea externa.

PostgreSQL cancela la consulta; Prisma revierte/libera la transacción y el servicio
devuelve 408. No se usa `pg_cancel_backend`, no se toca otra conexión, no se
cambia el pool ni un timeout de base global. La construcción del XLSX y auditoría
siguen sus reglas originales fuera de la transacción de lectura; los límites
de filas y filtros permanecen.

Prueba final con PostgreSQL desechable: siete exportaciones normales con XLSX;
exportación real de productos bloqueada por `LOCK TABLE Product IN ACCESS EXCLUSIVE
MODE` del fixture, timeout a **30.007–30.010 ms**, cero consultas de exportación esperando
ese lock tras el timeout; exportación concurrente de usuarios y SELECT ordinario
correctos mientras productos espera. Tras liberar el lock, catálogo público 200,
conexiones utilizables y `SHOW statement_timeout` fuera de la transacción devuelve
`0`. Prueba adicional con dos transacciones: una consulta lenta expira con 408
y la otra termina correctamente. La ampliación con pool de dos conexiones también
confirma cancelación (30.010 ms, cero SQL activo), doce readiness concurrentes
con un intento SQL y recuperación posterior 200.

### Verificación, archivos y publicación futura

- Jest completo: **195 suites / 1.749 pruebas correctas**. Se adaptan mocks de
  transacciones de export a callbacks reales; no se omite el helper SQL en tests.
- Revisión posterior de los cambios finales: 16 suites / 147 pruebas correctas
  de exportaciones, correo, consentimiento y verificación de medios; 67 comprobaciones
  de la integración de buzones. No hubo omisiones nuevas para hacer pasar las pruebas.
- Builds backend (incluida generación Prisma) y frontend/admin; regresiones
  de correo, imágenes, exportaciones, acceso, checkout y resiliencia.
- Navegador real: perfil y confirmaciones en escritorio 1366 y móvil 390,
  solicitud sin contraseña, autorización, verificación, segundo enlace en la
  misma pestaña, botones por teclado, foco visible, soporte y cierre de sesiones.
  Capturas revisadas; pantallas de confirmación sin overflow horizontal.
- **localhost:3000**, compilación actual: siete productos, seis categorías y
  galería 200, filtros múltiples, selección/deselección, URL y teclado correctos,
  casillas ocultas accesiblemente; cero respuestas públicas simuladas y cero
  errores JavaScript. En la prueba se bloquean imágenes externas para mantener
  aislamiento; sus errores de red deliberados no son errores del catálogo.

Archivos de implementación: Prisma schema y dos migraciones nuevas;
`me/email-change.service.ts`, `me/email-change.controller.ts`, `me.module.ts` y
restricción de actualización directa en `me.service.ts`; servicio/tipos/plantilla
de email; perfil HTML/JS, API TypeScript y bundle; nueva página/JS/CSS de
confirmación y ruta pública exenta del gate; helper y servicio de exportaciones;
manifiesto/lock y adaptación de tests/scripts. Scripts de revisión nuevos:
`review-security-completion.cjs` y `review-dependency-paths.cjs`. La comprobación
de versión de `profile.js` se actualiza al nuevo cache-buster; se conserva el
resto de verificaciones de optimización de medios.

Evidencias en `output/playwright/security-completion-2026-10-05/`: logs Jest/build,
`completion-verified-pg.log` (101 comprobaciones de email/privacidad),
`security-http-final.log`, `resilience-final.log`, `dependency-final-paths.log`,
auditorías/árbol, `store-local3000-final.log` y capturas.
Los scripts de revisión/fuentes de fixtures no añaden rutas a la aplicación
desplegable. El SQL lento y los límites pequeños de concurrencia pertenecen
solo al entorno desechable, no representan capacidad medida de producción.

Antes de migrar se confirmó `DATABASE_URL` y `DIRECT_URL` en
**127.0.0.1:5433/cronox_dev**, con correo/trabajos desactivados, y se guardó
`local-before-email.dump`. Se aplicaron únicamente allí las migraciones
`20261005190000_email_change_authorization` y
`20261005200000_email_change_private`; los entornos de pruebas se crean desde cero
en loopback. No se modificó producción ni se efectuó envío/pago/notificación real.

Para una publicación futura: aplicar ambas migraciones al destino que el
propietario autorice, regenerar Prisma y publicar juntos backend/HTML/assets;
asegurar acceso del rol backend a la tabla privada, `FRONTEND_URL` correcto y
configuración existente del buzón NOREPLY. Verificar entrega en staging/capturador
y realizar el procedimiento habitual de copia/restauración. No publicar solo el
frontend ni reutilizar una compilación antigua: la API y la tabla nueva son
necesarias. El proceso manual de soporte, matriz futura de roles, avisos restantes,
proxy/pools/topología reales y capacidad frente a DDoS siguen pendientes.

En ese encargo no se hizo commit, push ni despliegue. Cambios preparados para revisión local.

Reproducción segura de las comprobaciones adicionales (desde la raíz):

```powershell
node cronox-backend/scripts/review-security.cjs --completion
node cronox-backend/scripts/review-security.cjs --pending-review
node cronox-backend/scripts/review-security.cjs --resilience --pending-review
node cronox-backend/scripts/review-dependency-paths.cjs
node cronox-backend/scripts/review-mailbox.cjs
```

Los tres primeros y buzones crean su propio PostgreSQL desechable; requieren
los binarios PostgreSQL 17 locales y una compilación vigente. No se deben sustituir
por una URL de producción. En Windows, cerrar los procesos locales que carguen
el cliente Prisma antes de ejecutar `npm --prefix cronox-backend run build` evita
el bloqueo EPERM del DLL durante `prisma generate`; la generación y el build
completo se verificaron con esos procesos cerrados y luego se reabrió localhost:3000.

## Cierre autorizado para commit — 2026-10-05

Tras la aprobación del resultado local, el propietario autoriza incluir todo el
trabajo pendiente en la rama actual. Los resultados finales y los comandos de
publicación están en [Preparación y publicación posterior](release-preflight-2026-10-05.md).
Se comprobaron las 78 migraciones contra `127.0.0.1:5433/cronox_dev`, se guardó
una copia y `migrate:local` confirmó cero pendientes; no hubo nuevas aplicaciones
en este cierre. Producción sigue sin consultar ni modificar.

Instalación desde lockfiles, Prisma y builds correctos; Jest 195/1749, SEO 12,
email/privacidad 101 y visitantes 30 correctos. El script de visitantes ahora
inyecta la caída en el validador vigente de sesiones, conservando la exigencia
de 503. El diff permitió restaurar cinco optional chains corruptos del ascenso
de círculo en el perfil; las ocho suites afectadas pasan 127 pruebas y el flujo
de perfil/cambio de email vuelve a verificarse en navegador aislado.
No se cambia el comportamiento de los permisos de ADMIN: su decisión sigue
pospuesta. SUPERADMIN conserva sus funciones y validaciones. El soporte del
cambio de email usa `support@cronox.es` en texto y enlaces.

Se repitió la ampliación de resiliencia en PostgreSQL desechable: doce probes
de readiness con pool agotado comparten un único intento, devuelven 503 en
unos 1.024 ms y recuperan 200; exportación SQL termina con 408 en 30.016 ms,
sin consultas retenidas. Dos procesos tienen presupuestos independientes;
doce intentos bloqueados comparten IP con peticiones legítimas 200/200/201.
No se borran cookies por 503, y las identidades inválidas no consultan SQL.
Son medidas locales, no una prueba de capacidad ni protección DDoS de producción.

localhost:3000 sirve el backend recompilado: catálogo/categorías/galería 200,
filtros y accesibilidad correctos en escritorio/móvil, cero errores JavaScript
y cero respuestas públicas simuladas. Se conserva la verificación anterior de
visibilidad administrada y categorías dinámicas; no cambia ese código al cerrar.
Se mantienen abiertos la matriz futura de roles, soporte manual, avisos de
dependencias restantes y la validación de topología/configuración real.
No se realiza push, despliegue, indexación, correo, pago ni notificación reales.
