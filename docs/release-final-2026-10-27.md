# Revisión y publicación conjunta · 27/10/2026

Estado: preparación final de la publicación autorizada por el titular. El resultado del despliegue se añadirá al cierre. No se autoriza cobrar, borrar cuentas/eventos/puntos reales ni modificar ventas para probar.

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

Pendiente de completar con SHA, enlaces de CI/dispatch, recibo de respaldo restaurado, migraciones aplicadas, disponibilidad/cachés/permisos y dos lecturas frescas de los trabajadores. No se declara publicada la versión mientras esos controles no hayan terminado.
