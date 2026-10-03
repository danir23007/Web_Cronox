# Notificaciones push del administrador

Ampliación local del 03/10/2026, integrada junto al trabajo anterior de Correo en main, sin push ni despliegue. No se cambian claves VAPID, credenciales ni dispositivos de producción. No se envían avisos reales ni se crean pedidos/visitas/solicitudes ficticios en producción. El usuario informa de que los avisos de correo ya llegan al móvil; los tipos nuevos requieren su propia prueba física.

## Uso

1. Abre **Admin → Notificaciones push**. El botón Notificaciones de Correo conduce al mismo apartado; hay una sola configuración.
2. Selecciona el dispositivo de tu cuenta, por ejemplo el iPhone. Se muestran nombre, estado y fecha de registro. Puedes configurarlo desde el ordenador sin registrar una suscripción nueva allí.
3. **Correos nuevos** conserva la selección por buzón y privacidad de remitente/asunto según permisos. El interruptor general pausa correo sin perder la selección.
4. Marca independientemente Pedidos pagados, Nuevas visitas a la web y Nuevas solicitudes en la waitlist. Empiezan desmarcadas; solo notifican eventos posteriores a activarlas. Pedidos exige SUPERADMIN, como su endpoint; las otras secciones mantienen ADMIN/SUPERADMIN.
5. Guarda y espera la confirmación del servidor. Un fallo conserva lo editado y muestra error sin afirmar éxito. Se detectan revisiones concurrentes y se pide recargar. Volver al apartado muestra lo persistido.

Desactivar el dispositivo detiene todos sus avisos. Configuración avanzada conserva registro, permisos del navegador e instrucciones. Registrar de nuevo la misma suscripción de la misma cuenta actualiza su sesión y conserva preferencias, nombre y buzones; no hace falta hacerlo si ya funciona.

## Eventos

- Pago: trigger transaccional al guardar PAID con fecha de pago, usando paidAt UTC o purchasedAt para IN_PERSON_ADMIN. No se dispara por checkout o PENDING. El ID único del pedido evita duplicados de webhook/conciliación. El corte de activación excluye históricos/backdated. Antes de enviar se verifica estado pagado/fulfillment, ausencia de anulación/reembolso y permiso SUPERADMIN. Solo incluye número, importe y moneda; abre el pedido con la autenticación existente.
- Visita: usa el INSERT deduplicado de DailyVisitor después de validar página pública, consentimiento e identidad. UPDATE, recarga, cambio de página y reconciliación de login no crean otro aviso. Bots/automatización identificados por user-agent se excluyen únicamente del push, sin modificar cifras del histórico. Administradores y navegación del panel no son notificables; se revalidan exclusiones posteriores antes del envío. Hay un aviso separado por visita válida notificable, sin resumen, IP ni datos personales. Abre Home, donde están las visitas.
- Waitlist: trigger de INSERT de una RestockRequest WAITING guardada correctamente. El join existente no inserta otra solicitud activa para cuenta/talla. Abrir, fallar o cancelar no produce evento. Incluye solo producto y talla y abre Waitlist.
- Correo: conserva deduplicación/digest existentes, selección por buzón, privacidad y permisos. Integra su configuración en la misma pantalla; no reinicia históricos ni claves.

Los eventos nuevos guardan deliveries solo para dispositivos activos con la opción ya activada. Cada delivery registra la época de activación; desmarcar y volver a marcar nunca recupera los pendientes antiguos. Se comprueban sesión, rol, negocio, opción y época antes de transportar, también después de DNS. Una sesión revocada no recibe avisos.

## Cola y fallos

Reutiliza MailboxPushDevice, cifrado, VAPID, validación DNS/destinos, service worker y MailboxWorkerService. El trabajador conserva MAILBOX_WORKER_ENABLED, BACKGROUND_JOBS_ENABLED y protección de smoke mode. Funciona sin navegador abierto. No se activaron trabajadores reales durante las pruebas.

MailboxPushEvent y MailboxPushDelivery son la outbox persistente privada. Pagos/waitlist se encolan en su transacción; visitas usan un savepoint en la actual. No hay red dentro del negocio. Si almacenar el aviso falla, se permite guardar el pago/visita/solicitud; ese aviso puede perderse si falla la outbox, sin comprometer el negocio.

El lease del dispositivo excluye concurrencia y su liberación exige propiedad. ACCEPTED no se repite. Rechazos explícitos 429/500/502/503/504 tienen pausa exponencial y máximo cinco intentos. 404/410 desactivan la suscripción. Resultado de red ambiguo o proceso interrumpido queda UNKNOWN sin reenvío automático. El tag/topic conserva identidad en reintentos; las visitas distintas tienen tags distintos. ACCEPTED indica aceptación del proveedor, no recepción física. iOS puede retrasar o silenciar avisos.

## Migraciones y publicación posterior

Nuevas migraciones de push, sin modificar las anteriores:

- `20261003120000_admin_push_events`: preferencias, outbox con RLS y triggers.
- `20261003123000_admin_push_payment_utc`: comparación UTC independiente de la zona de PostgreSQL y transición desde PENDING.
- `20261003130000_admin_push_manual_paid`: fecha de ventas presenciales confirmadas, manteniendo exclusión de históricos.

Las correcciones están separadas porque la primera ya estaba aplicada en local. Solo se aplicaron en `127.0.0.1:5433/cronox_dev`, sin reset ni borrado; 69 migraciones al día. También se conserva `20261003100000_mailbox_circle_campaigns` de la entrega anterior.

En una publicación posterior, el despliegue existente ejecutará `prisma migrate deploy` antes del reinicio; deben publicarse backend y frontend conjuntamente. Conservar variables, claves y almacenamiento actuales, sin repetir la preparación. Campañas sigue bloqueado hasta resolver los requisitos de Hostinger. Esta tarea no hace push ni despliega.

## Validación y recepción física pendiente

Resultado: compilaciones frontend/backend aprobadas, 14 suites Jest con 145 tests, 41 grupos de integración de Correo/campañas/push y 30 comprobaciones independientes del histórico de visitantes. Ambas revisiones de navegador (Correo y push) aprobaron en escritorio y móvil.

Integración con PostgreSQL efímero y push interceptado: permisos/propiedad, persistencia/conflictos, defaults, conservación de registro, pagos/duplicados/refunds/históricos/presenciales, visitas/consentimiento/admin/bots/login, waitlist repetida/cancelada/fallida, preferencias pendientes/reenable/revocación durante DNS, concurrencia/reintentos/UNKNOWN, y fallo de outbox sin rollback de pagos/visitas/waitlist. Se conserva la integración anterior de correo y campañas. Jest prueba service worker, destinos y tags. Playwright revisa 1440/390 px, selección del iPhone, guardado fallido 503 y ausencia de desbordamiento. Capturas/resultados quedan fuera de Git. Ninguna simulación acredita recepción física.

Después de publicar:

1. Abre el icono CRONOX del iPhone e inicia sesión. Selecciona su registro actual; no lo vuelvas a registrar si está activo y funciona. Si está desactivado, regístralo desde ese móvil y concede el permiso del sistema.
2. Desde el ordenador selecciona ese mismo iPhone, marca un tipo y guarda. Bloquea el móvil; revisa también Centro de notificaciones y modos de concentración.
3. Correo: espera un correo nuevo legítimo en el buzón seleccionado. No repetir las cuatro pruebas anteriores.
4. Visitas: realiza una única visita real pública desde un navegador no administrador con consentimiento y una identidad/día nueva. Recargar no produce otro evento. Esa visita real quedará registrada; no generar tráfico ficticio ni modificar estadísticas.
5. Waitlist: espera una solicitud real. Si realmente quieres una talla agotada, solicita una vez con tu cuenta normal; quedará activa. No crear solicitudes ficticias solo para probar.
6. Pagos: espera el siguiente pago real o venta presencial confirmada, sin hacer cobros de prueba.
7. Comprueba recepción y destino al pulsar cada aviso, manteniendo autenticación/permisos. Una casilla marcada no prueba recepción; cada tipo nuevo queda pendiente hasta observarlo físicamente. Puedes desmarcarlos después.

Revisión local: `npm run admin:watch`.
