# Recuperación de pagos Stripe

La firma se verifica sobre el cuerpo original antes de guardar el evento. El payload verificado queda en una tabla privada. El worker procesa eventos pendientes y recupera leases vencidos tras reinicio, independientemente de las tareas comerciales opcionales. `CRONOX_LOCAL_DEV=true`, `STRIPE_WEBHOOK_WORKER_ENABLED=false` y `CRONOX_ROUTE_SMOKE_MODE=true` lo desactivan; no deben usarse en un servicio que recibe pagos reales sin otro worker activo. El modo de revisión local también bloquea las acciones POST de recuperación.

Cada transacción comercial comprueba y bloquea el token del lease. El pedido, las reservas y las tareas auxiliares se confirman juntos. Un fallo de conexión posterior al commit puede repetirse sin crear otro pedido ni devolver stock. Los eventos de reembolso y disputa siguen usando el historial firmado y sus marcas de consumo/devolución.

Un error temporal queda `FAILED` y se reintenta. Una contradicción de importe, vínculo, caducidad o reservas queda `REVIEW`. No se reembolsa automáticamente por un error de persistencia: este no demuestra que el pedido no exista. La revisión debe comprobar el pedido, snapshot, reservas y pago en Stripe antes de decidir entre reparar/reintentar o realizar un reembolso explícito en Stripe. Su webhook conciliará el reembolso y devolverá el stock una sola vez. Nunca fabricar un evento de éxito ni cambiar una reserva sólo para forzar la aceptación de un pago.

## Incidencias y recuperación explícita

- `GET /admin/payments/recovery`: sólo SuperAdmin autenticado; devuelve hasta 100 eventos y 100 auxiliares pendientes, sin payload ni direcciones.
- `POST /admin/payments/recovery/event/:id/retry`: sólo SuperAdmin, CSRF habitual; reencola `FAILED`/`REVIEW` con payload ya verificado. La transacción registra actor y destino en AuditLog. No admite eventos procesados ni trabajo actualmente reclamado.
- `POST /admin/payments/recovery/event/:id/resolve-refunded`: cierra una incidencia después de una compensación explícita. Exige un `charge.refunded` firmado, completo y ya procesado del mismo PaymentIntent, snapshot reembolsado, ninguna reserva retenida/consumida y pedido reembolsado si existe. Audita el actor y evento justificante. No crea un pedido para ocultar el incidente y no llama a Stripe.
- `POST /admin/payments/recovery/effect/:id/retry`: sólo tareas en revisión. Para correo exige JSON `{"acknowledgeUncertainDelivery":true}` después de revisar el recibo de transporte. Este permiso reconoce la posibilidad de una entrega anterior; no equivale a una prueba de no entrega.
- El antiguo botón de confirmación consulta/procesa la cola durable. No crea otro envío para un pedido histórico sin recibo ni salta una revisión pendiente.

`CheckoutEffect.COMPLETED` significa resultado registrado: `accepted` (SMTP aceptó), `queued` (la cola de correo persistente asume la entrega) o `not_needed`. No prueba recepción por el cliente. Una caída después de enviar pero antes de guardar el resultado se conserva en `REVIEW/DELIVERY_OUTCOME_UNKNOWN`, sin reenvío automático. Un rechazo de confirmación cuyo error no conserva certeza también requiere revisión conservadora. La configuración de contraseña incierta conserva la supresión del servicio de autenticación; su recuperación normal usa la solicitud de restablecimiento de contraseña, sin borrar marcas de seguridad a mano.

Los registros se conservan aunque posteriormente se elimine un pedido de prueba, para no perder evidencia de una entrega incierta. No se añaden correos retroactivos automáticamente a pedidos históricos.

## Eventos históricos sin payload

La migración marca los eventos antiguos no procesados como `REVIEW/LEGACY_VERIFIED_PAYLOAD_REQUIRED`. Un evento histórico `PROCESSED` permanece terminado. Sólo una nueva entrega con firma válida puede rellenar el payload ausente; después se aplica el mismo flujo idempotente. Si Stripe ya no permite reenviarlo, la incidencia requiere conciliación humana y una decisión de cumplimiento/reembolso; no se reconstruye un evento desde la cesta actual.

El inventario local no modifica datos ni llama a proveedores:

```powershell
# DATABASE_URL se suministra por el perfil local, sin imprimir credenciales.
node scripts/review-stripe-recovery.cjs --database=nombre_local_exacto
```

Ejecuta una transacción `READ ONLY`, comprueba host loopback y nombre real de base. No aplica reparaciones. Para corregir una incidencia se usa el endpoint autenticado anterior después de resolver su causa, conservando la auditoría.

La entrega duplicada y el orden de llegada no son garantías de Stripe; véase la [documentación oficial de webhooks](https://docs.stripe.com/webhooks). No se han cambiado la versión del SDK ni de la API.

## Estado del worker y puesta en servicio

Las rutas anteriores llevan el prefijo global `/api`. GET `/api/admin/payments/recovery` incluye ahora `worker`: activación/motivo de desactivación, inicio, sondeo en curso, inicio y fin del último sondeo y código fijo de fallo. No incluye conexiones privadas. El estado es de la instancia que responde y se reinicia con ella; hay que supervisar cada instancia. Una lista vacía no prueba que el worker funcione. La fecha del último fallo es histórica y el código se limpia al completar otro sondeo; los errores de eventos individuales siguen visibles en sus registros aunque el sondeo global finalice.

Hay logs explícitos de arranque y desactivación. Poll de 5 s, lease de 60 s con renovación cada 20 s y reintento temporal a partir de 15 s. El ensayo de prepublicación utiliza AppModule compilado y temporizadores reales: FAILED visible → PROCESSED con dos intentos, sin invocar tick manualmente; otro evento queda REVIEW. Handler simulado, PostgreSQL real; no prueba proveedor sandbox.

Las dos migraciones finales llevan transacción explícita. La [secuencia de publicación, recuperación y supervisión](audit-prepublication-2026-10-17.md#3-migraciones-compatibilidad-y-recuperación) exige respaldo/restauración comprobados, escritores antiguos detenidos y mantenimiento hasta completar los controles. `BACKGROUND_JOBS_ENABLED=false` no desactiva este worker; usar su flag específico durante la verificación. Activarlo puede tramitar obligaciones y comunicaciones pendientes: revisar colas y política de envío antes. No drenar correos reales con EMAIL_ENABLED=false ni volver al procesador antiguo después de migrar para recuperar servicio con pagos abiertos.
