# Revisión y publicación conjunta · 27/10/2026

**Publicación completada y web abierta.** Versión funcional instalada: **`09525386c1148393d687b8a533e2c85319a274fc`**. El controlador terminó `success/public_check` el 27/10/2026 a las **17:55:18 UTC / 18:55:18 Europe/Madrid**. No se hicieron cobros, borrados ni modificaciones de ventas de prueba en producción.

## Alcance revisado y dependencias

| Trabajo terminado | Contenido y evidencia conservada |
| --- | --- |
| Footer público | Tres marcas, columna en escritorio y fila centrada en móvil; Instagram conserva su destino, TikTok/YouTube sin acción. Separación adicional del grupo social de escritorio. Renderer/CSS compartidos y versiones de recursos de páginas públicas. |
| Compatibilidad móvil | Activos de acreditación sin espacio/bloque claro ajeno al símbolo, colores y bordes controlados, campos móviles a 16 px y correcciones de foco. Informe Xiaomi y procedimiento voluntario de diagnóstico conservados. |
| Reservas de checkout | Cesta sin reserva, presencia, protección inmutable de 360 segundos, cancelación verificada antes de liberar, recuperación durable e incidencias visibles. |
| Usuarios | Borrado seguro SUPERADMIN, permisos y confirmación, bloqueo con historial, revocación de acceso, recibo/auditoría; ordinal global separado de ID/CRX permanentes sin reutilización. |
| Mapa y puntos | Provincias iniciales, libro físico y web conciliados con Finanzas, beneficio neto, códigos INE y corrección histórica; retirada/borrado de puntos solo SUPERADMIN conservando trazabilidad. |
| Eventos QR | Borrado SUPERADMIN confirmado, transaccional y auditado, sin tocar cuentas/acreditaciones ni otros eventos; escaneos concurrentes protegidos. Terminado y sin migración propia. |

Se conserva además el commit previo `d6a04e61` de ajustes móviles, ya subido y con CI aprobado, que todavía no estaba publicado. No se descartan archivos de trabajo ni evidencias locales.

Los cambios de checkout, usuarios, mapa y puntos comparten `schema.prisma`, los controles de numeración y varios recursos administrativos. Su publicación requiere el mismo conjunto de migraciones, cliente generado y artefactos; no se despliegan como versiones intermedias. Eventos QR comparte la coordinación transaccional de círculos. Los cambios públicos se pueden revisar por separado, pero todos los artefactos se activan conjuntamente durante mantenimiento.

**Fuera de lo resuelto:** zoom espontáneo en el móvil afectado, que no se ha reproducido; pruebas físicas de wallets/3DS, cámara y suspensión/red móvil no realizadas. Son límites de validación explícitos, no funcionalidades incompletas activadas mediante atajos. No se publica un diagnóstico de zoom especulativo ni telemetría personal.

## Ajustes necesarios hallados en la revisión final

1. El control de numeración nuevo exigía la migración de identidades permanentes antes de que el controlador pudiera aplicarla. El preflight y el build ahora usan un modo **explícito previo a migración**: acepta únicamente el estado anterior completo, consecutivo y verificado o el nuevo estado permanente válido. Rechaza estados parciales. Antes de crear Nest/arrancar cualquier trabajador productivo se ejecuta el control estricto, que exige la migración terminada, recibo, cursor monotónico y ausencia de compactación. No se modifica el controlador privilegiado ni se omiten controles.
2. `CheckoutPresence` necesita privacidad explícita en Supabase. Se añade una migración posterior independiente con RLS y revocación de privilegios PUBLIC/anon/authenticated. No se editan los checksums ya aplicados en desarrollo.
3. El conciliador de reservas publica señales agregadas en `/var/lib/cronox-pm2/reservation-status.json`, únicamente si está configurado el directorio privado existente de recuperación. Escritura atómica 0600, PID/frescura, estado, cadencia y finalización/error de escaneo; sin clientes, pedidos, payloads ni credenciales. Permite contrastar el trabajador nuevo por SSH sin crear reservas productivas ni abrir un endpoint de diagnóstico.

## Migraciones, datos y recuperación

Preflight productivo de solo lectura: versión `7952ed37f84e41951b02b35a04a5b9e894772079`, 104 migraciones terminadas con checksums compatibles LF/CRLF, sin mantenimiento, 100 cuentas, 29 pedidos, 3 puntos/33 movimientos y 2 eventos. Cero reservas históricas con stock retenido. No se alteraron esos datos.

Cinco migraciones pendientes, en orden:

1. `20261027190000_checkout_presence_and_payment_window`.
2. `20261027210000_safe_user_deletion_permanent_ids`.
3. `20261027230000_point_territory_and_safe_removal`.
4. `20261027231000_point_place_normalization`.
5. `20261027233000_checkout_presence_private`.

Las columnas/relaciones son aditivas. La segunda migra la semántica de identidad: deshabilita compactación, protege identidades y eleva el cursor sin renumerar cuentas. No es compatible asumir que volver al backend anterior restaura el comportamiento correcto. La normalización provincial es conservadora y no altera importes. La nueva referencia a pedido es nullable y única; no vincula ventas existentes automáticamente.

En desarrollo están aplicadas las cinco. Antes de la última se creó `output/release-final-20261027/local-before.dump`, 597750 bytes, SHA-256 `d1c7fb2a6143d19760d5ba8e0789f3556f09c42c8c6067b6ae78a87a5f3b574e`, catálogo verificado. Está ignorado por Git.

Publicación: se usa exclusivamente **Deploy CRONOX**, push para CI y `workflow_dispatch publish=true` para publicar el SHA exacto de main. El controlador instalado coordina mantenimiento, parada de escritores, respaldo privado de aplicación/configuración y PostgreSQL, **restauración y comparación aislada antes de instalar**, builds, Prisma/migraciones, arranque pausado, activación de trabajos habituales, verificación del worker y reapertura. Pages debe seguir en modo workflow. No se cambian protecciones, credenciales, permisos root ni método de despliegue.

Recuperación: ante desconexión se consulta el diario del **mismo SHA**, sin repetir solicitud ni migraciones. Antes de instalar/migrar, `recover SHA` solo puede reabrir la versión anterior si el controlador acredita HEAD e historial intactos. Desde instalación/migración, se conserva mantenimiento y se prepara una corrección hacia delante compatible con el esquema; no se arrancan escritores antiguos ni se revierten migraciones automáticamente. Los respaldos permiten una recuperación administrada revisada; no se usan reset, db push, seed ni restauraciones destructivas como atajo.

## Verificación adicional justificada

- Se aprovechan las matrices previas de footer/móvil, los 152 tests de mapa/puntos y las pruebas previas de usuarios, checkout y QR. No se repite localmente toda la batería.
- Control de numeración y orden de mantenimiento: siete pruebas Node, incluidos estado anterior aceptado solo antes de migrar y estados parciales rechazados.
- Trabajadores, telemetría y protecciones locales: 34 pruebas Jest. Tipos frontend/backend y build frontend correctos; recursos de acreditación: cinco hashes aprobados y 19 activos verificados.
- PostgreSQL desechable: checkout con migraciones SQL reales y nuevos permisos de presencia; eliminación de usuarios y de QR con relaciones/restricciones reales y pruebas de concurrencia. Los resultados quedan en `output/release-final-20261027/`; no hay pruebas destructivas sobre datos productivos.
- CI del proyecto mantiene por obligación su batería completa Linux, exportaciones, compilaciones y controles de secretos; se usará su resultado sobre el SHA candidato exacto antes del dispatch.

El primer CI (`40552347803`) detuvo la publicación con cinco tests fallidos y 3072 aprobados. Se actualizaron dos mocks para la consulta real de ordinales globales, el contrato de disponibilidad que ahora incluye la reserva de la propia cesta y la comprobación de versión del checkout. El fixture de navegación ahora cierra el acceso antes de pulsar la barra de fondo, igual que exige un diálogo modal real; ya no abre artificialmente dos trampas de foco a la vez. Las 109 comprobaciones focales de estas suites, incluido el servicio real de carrito, pasan. No se desactivó ninguna aserción de stock, permisos o foco ni se cambió la funcionalidad para saltar CI. El nuevo SHA debe superar otra vez el workflow requerido.

### Pago real en modo test desde el formulario

Chromium con Payment Element real, datos ficticios y PostgreSQL habitual local. La configuración estática de producción contiene su clave pública live: **no se modifica**. Solo ese contexto de navegador local recibe la clave pública test del perfil privado, mientras el backend ya utiliza claves test y rechaza pagos live. No se simula Stripe.js ni se interceptan las API de checkout/pago/webhook.

El botón «Pagar ahora» completó la compra y mostró «Pedido confirmado». Se comprobó después:

- Pedido local ficticio **9**, único para el intento test; importe sintético 12,95 € y `livemode=false`.
- Inicio `2026-10-27T17:31:12.759Z`, vencimiento `17:37:12.759Z`: exactamente **360000 ms**.
- Evento original `payment_intent.succeeded` de Stripe CLI, firma aceptada HTTP 200 y recibo durable PROCESSED. No se confirmó mediante API ni se fabricó un evento para completar esta prueba.
- Reserva CONSUMED y stock 5→4, sin doble descuento. Producto ficticio desactivado al finalizar; historial del pago test conservado. Correo/trabajos generales desactivados en local.
- El bloqueo hCaptcha 429 de la prueba anterior **no se reprodujo en este intento**. No se resolvieron ni eludieron desafíos; no se afirma que desaparezca en todos los navegadores.

Esto completa la prueba pendiente de tarjeta desde formulario. No acredita 3DS físico, wallets, PayPal/app bancaria ni webhook público en producción. El zoom móvil continúa pendiente según `mobile-zoom-device-check.md`.

## Publicación y comprobaciones finales

- Commits: `76a365e2` (footer/móvil), `3be9d543` (integración administrativa/checkout) y `09525386` (fixtures de integración). Avance normal de main, sin force push ni descarte de trabajo. El commit móvil previo `d6a04e61` está incluido.
- **[CI del SHA publicado · 40553377300](https://github.com/danir23007/Web_Cronox/actions/runs/40553377300): correcto.** 3077 pruebas / 284 suites, más 59 pruebas / 6 suites de exportaciones; tipos, Prisma, builds, recursos y guardias de secretos aprobados. El primer CI fallido quedó documentado y no desplegó.
- **[Deploy CRONOX · 40554055301](https://github.com/danir23007/Web_Cronox/actions/runs/40554055301): correcto.** Un único dispatch `publish=true`, con el mismo SHA contrastado contra main. Su CI obligatorio volvió a pasar; deploy terminó success. No hubo recuperación ni canal alternativo por SSH.
- Controlador: preflight → mantenimiento observado 503 en ambos dominios → escritores detenidos → respaldo/restauración/comparación → instalación/builds → cinco migraciones → arranque pausado → activación/verificación → reapertura/public_check. No se modificó el controlador privilegiado.
- Respaldo productivo: `database.dump` **2084086 bytes**, `application.tar.gz` **270725393 bytes**, roles y recibos de hashes privados. **301 objetos restaurados y comparados, cero diferencias**. `backup-verified.json`, `backup-sha256.json` y las dos verificaciones permanecen en el diario privado del controlador para este SHA. No se descargan ni publican los datos del respaldo.

### Migraciones registradas en producción

| Migración | SHA-256 aplicado |
| --- | --- |
| `20261027190000_checkout_presence_and_payment_window` | `02e5785fc9e37bf0d2071d68700c83b7536579a9f874475689e6cb0684f2d643` |
| `20261027210000_safe_user_deletion_permanent_ids` | `787f0e20c5790be8b6c8d336338de6f9134d2f55d1f6629aac821febb5eb3199` |
| `20261027230000_point_territory_and_safe_removal` | `afc07b819a07cdff9dbd21c070d8e36ab2daa9b336a9e285dd2b52898648b6d5` |
| `20261027231000_point_place_normalization` | `236fccd6097c4dc0689f0c549391dec0a70199f020f6016331a7b2e616ff2648` |
| `20261027233000_checkout_presence_private` | `e4aa9cac6cdf32c55ecd09b7df44eef74ce9b7371b928ce7d8d2d90f523b4fbe` |

Hay **109 migraciones terminadas**, sin fallidas ni revertidas. Las 104 filas históricas permanecen idénticas, incluidos sus checksums; las cinco nuevas se contrastaron contra el contenido Git admitiendo únicamente la representación LF/CRLF documentada. El control estricto de numeración devuelve `USER_NUMBERING_RELEASE_READY`; el trigger de compactación está ausente.

### Contraste independiente

| Capa | Resultado |
| --- | --- |
| Identidad y arranque | HEAD productivo exacto; PM2 cronox online, PID **208552**, estable entre las lecturas posteriores. Mantenimiento retirado. |
| Disponibilidad | Health y ready 200 en apex/www; portada apex 200 y redirección www 308 exacta al dominio canónico. 25 peticiones de disponibilidad/páginas/permisos aprobadas. |
| Recursos y caché | 16 activos revisados: JS/CSS coinciden con fuente publicada normalizando solo LF/CRLF; PNG de acreditación coincide por bytes. HTML no-store y versiones de recursos nuevas. Sin secretos ni contenido de sandbox en artefactos. |
| Datos conservados | Mismas 100 identidades (ID, UUID, CRX, QR público y fecha de creación). Huellas completas idénticas de 29 pedidos, 55 líneas, 33 movimientos de puntos, 22 ventas físicas, 49 variantes, 2 eventos y 40 participaciones. En PointSale se compara la proyección histórica, excluyendo únicamente la nueva columna nullable. |
| Finanzas reales, solo lectura | Servicios compilados ejecutados con transacciones PostgreSQL **READ ONLY**: provincias iniciales 52, comunidades 19, totales del mapa iguales a Finanzas y agrupación territorial equivalente; los tres puntos productivos concilian detalle/Finanzas para el mismo período. No se imprimen datos de clientes ni se alteran operaciones. |
| Permisos | Endpoints administrativos sin sesión devuelven 401. Metadatos de los controladores compilados confirman JWT/Admin/SUPERADMIN para los tres borrados. 40 controles de SELECT/INSERT/UPDATE/DELETE denegados a anon/authenticated sobre las cinco tablas privadas revisadas, con RLS activo. Cero recibos de borrado de usuarios productivos. |
| Trabajador webhook | Habilitado, mismo PID, sin error. Escaneo avanza de **17:57:01.876Z a 17:58:41.638Z**. |
| Trabajador reservas | Habilitado, mismo PID, sin error. Escaneo avanza de **17:57:02.207Z a 17:58:45.217Z**; poll 1000 ms/reintento 5000 ms. Archivo privado 0600 y fresco. Cero reservas con unidades retenidas en las lecturas. No se creó una reserva productiva para probar. |
| Política y logs | Comunicaciones y trabajos conservan exactamente sus controles anteriores. No se activó modo local/test en producción. Error log PM2 permanece en 63178 bytes, sin entradas nuevas. Archivo histórico privado de main.ts conserva su huella; no hay modificaciones de fuente ajenas al SHA. Se conservan las dependencias generadas por la automatización. |
| Footer en navegador | Chromium 1366/390 px, fuentes y logos decodificados, sin scroll horizontal. Altura escritorio **207,984375 px antes y después**. Logos separados en escritorio; fila móvil con márgenes de 20 px y ojo centrado en el viewport de contenido. Instagram conserva destino; TikTok/YouTube son spans sin href/rol/tabindex ni cursor interactivo. Desplegable SOPORTE abre y muestra contenido sin desbordamiento. Cero imágenes rotas del footer. |

La primera captura informativa se intentó en Privacidad, que conserva su plantilla sin este footer; se corrigió la selección de página de prueba y se verificó el footer compartido en la portada. No fue una regresión ni se añadió un footer nuevo a páginas que no lo utilizaban. Las capturas finales del elemento están en `output/playwright/release-final-footer-only-1366.png` y `release-final-footer-only-390.png`; no se usa la carga diferida de galería como evidencia de una comprobación terminada de esa galería.

No hay una sesión administrativa productiva legítima disponible en esta revisión: no se fabricaron sesiones ni se suplantó una cuenta para obtener capturas. La navegación autenticada dentro del administrador conserva la evidencia local/aislada y de CI; en producción se contrastaron servicios reales en solo lectura, permisos compilados y rechazo HTTP anónimo. No se presenta esto como un borrado ni una navegación autenticada probados en producción.

**Pendientes explícitos:** zoom móvil no reproducido, contraste físico Xiaomi de todos los efectos de color/bordes, wallets/3DS y otros retornos bancarios en dispositivo físico, suspensión/red móvil y cámara física. El pago test desde formulario sí está completado como se describe arriba. El antiguo hCaptcha 429 no se reprodujo en ese intento; no se ha desactivado ni se promete que desaparezca universalmente.

Evidencias privadas/locales: `output/release-final-20261027/` (CI/dispatch/controlador, respaldo local, consultas antes/después, migraciones, privilegios, conciliación económica, workers, HTTP/recursos y navegador). Los archivos privados, respaldos, claves y estados de navegador están excluidos de Git. Ninguno de los 168 archivos pendientes capturados al inicio desapareció. Las diferencias sobre esa captura corresponden a las ampliaciones revisadas de controles, privacidad/pruebas y documentación, incluidas las notas finales de publicación en los informes anteriores.

Este cierre es documental. La versión funcional publicada sigue siendo **09525386**, sin necesidad de otra publicación por guardar este resultado.
