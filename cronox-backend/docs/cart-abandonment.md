# Recuperación de carritos abandonados

Implementación local: finalidad `CART_ABANDONED` («Carrito abandonado»), remitente `NOREPLY`, cinco borradores por círculo y trabajador Nest con episodios persistentes en PostgreSQL. No se activa por migrar, inicializar el gestor ni publicar una plantilla. No se han activado envíos en producción.

## Actividad y plazo

Cuenta como actividad una modificación efectiva de productos o cantidades, aceptar un precio o tirada nuevos mediante la revisión existente, una combinación de cesta con productos al iniciar sesión, una apertura explícita del cajón desde su icono, una visita visible a la página de cesta o recuperar un enlace autenticado. Las visitas visibles se registran una vez por apertura/retorno a la pestaña; las actualizaciones automáticas de autenticación y `GET /cart` no cuentan. Los procesos internos, las consultas de administración, los reintentos de una operación ya aplicada y las actualizaciones sin cambios no generan episodios.

La modificación y su episodio se confirman en la misma transacción. Se usa una única lectura del reloj de PostgreSQL para fijar `activityAt` y `dueAt = activityAt + 23 horas`. La fecha no depende de la zona horaria ni de mantener el navegador abierto. Una nueva actividad cancela el episodio pendiente anterior y crea otro; vaciar la cesta cancela sin crear otro.

El trabajador comprueba vencimientos cada **10 segundos**, hasta diez episodios por ciclo, sin solapar ciclos dentro del proceso. Nunca reclama antes de `dueAt`; vuelve a comprobarlo antes del envío. Esto no garantiza el segundo exacto: normalmente se añade el tiempo hasta la siguiente revisión, más preparación y SMTP. La carga, bloqueos, caídas y reintentos pueden añadir más retraso. Los errores seguros se reintentan a los cinco minutos, hasta tres intentos; una espera por cuota, pausa o plantilla sin publicar no consume intentos. Un pago pendiente se revisa de nuevo a los cinco minutos.

## Elegibilidad y pagos

Solo cuentas `USER`/`FRIEND`, activas, propietarias de la cesta, con productos comprables. Se exige `User.newsletterSubscribed`, una `NewsletterSubscription` de la misma dirección vinculada a esa cuenta y con `subscribedAt`, y ausencia en `MailboxSuppression`. No se suscribe ni se infiere consentimiento de una compra, registro o mera identificación.

Se reutiliza también `KeyScreenService.shouldGatePublicHtml`: si la Pantalla Clave mantiene cerrada la tienda, el recordatorio se aplaza hasta que vuelva a estar accesible.

Inmediatamente antes de SMTP se bloquean la cesta y la cuenta y se releen los productos, consentimiento, bajas y compras. La creación de un checkout comparte ahora el bloqueo de cesta; los cambios de cesta y la confirmación de pedidos ya lo utilizaban. Se excluyen las compras completadas del episodio y se aplaza cualquier checkout no terminal del propietario, aunque haya vencido localmente. Esto incluye reservas, creación/binding de PaymentIntent, reemplazos, recuperación pendiente, disputas y transferencias bancarias.

Se reutiliza la conciliación existente: `CheckoutReservationCleanupService` consulta/cancela el pago remoto antes de liberar la reserva y crea el pedido si ya está pagado. Los webhooks disponen de recuperación persistente. El recordatorio no considera una fecha de expiración ni un webhook retrasado como prueba de impago y no cancela pagos por su cuenta. Solo los estados terminales impagados `EXPIRED`, `REPLACED`, `PAYMENT_CANCELLED` y `PAYMENT_CREATION_FAILED` permiten continuar; un estado desconocido bloquea. Si la conciliación no puede resolver un pago, el recordatorio permanece aplazado.

## Concurrencia y resultados inciertos

La reclamación con `FOR UPDATE SKIP LOCKED` cambia atómicamente `QUEUED` a `PROCESSING` y queda confirmada antes de cualquier SMTP. La clave primaria identifica el episodio y un índice parcial permite una sola fila pendiente por cesta. El bloqueo final serializa el envío con cambios, recuperación y checkout. `SENT`, `CANCELLED`, `FAILED` y `UNCERTAIN` no vuelven automáticamente a la cola. El tiempo por sí solo nunca rearma un envío.

El transporte real es **SMTP/Nodemailer**; no ofrece una clave de idempotencia de proveedor. Un `Message-ID` no garantizaría deduplicación. Se reutilizan su auditoría, cuotas y clasificación de errores: solo un rechazo demostrado antes de aceptación admite reintento. Si se pierde la respuesta, falla la confirmación local después de enviar o un proceso muere con una reclamación, se conserva como `UNCERTAIN` y **no se reenvía** automáticamente. Las reclamaciones interrumpidas pasan a revisión a los cinco minutos. Se prioriza evitar duplicados: un envío incierto puede no haber llegado y requerir intervención. No se afirma entrega exactamente una vez.

El SMTP se limita a ocho segundos y debe finalizar dentro del presupuesto del bloqueo. No se utiliza la cola genérica de mensajes ya renderizados, pues cada reintento necesita comprobar otra vez la cesta, los pagos y el consentimiento.

Consulta operativa, solo lectura:

```sql
SELECT id, "cartId", status, attempts, "activityAt", "dueAt", "readyAt",
       "claimedAt", "sentAt", "messageId", "errorCode"
FROM "CartAbandonment"
WHERE status IN ('UNCERTAIN', 'FAILED', 'QUEUED')
ORDER BY "readyAt";
```

Investigar `UNCERTAIN` con la auditoría `EmailDelivery` y los registros del servidor SMTP. No restablecer su estado sin demostrar que no hubo aceptación; un reenvío ciego puede duplicar el correo. No se incluye un restablecimiento automático de estos casos.

## Plantillas, identidad y recuperación

Inicializar **Correos → No-reply** añade los cinco borradores sin alterar diseños, versiones o publicaciones previas. La finalidad utiliza el editor, vistas de edición y previa, firma predeterminada compartida, logo, bloques de productos y publicación por círculo existentes. Hay un footer de marca y un enlace de baja obligatorio que utiliza el mecanismo cifrado de campañas existente. La baja necesita confirmación; los escáneres de enlaces no la ejecutan por un GET.

El envío usa exclusivamente la versión publicada del círculo del destinatario. Guardar un borrador posterior no cambia lo publicado. Sin publicación válida, se aplaza el episodio. Además de la validación al publicar, antes de SMTP se comprueba que los productos, precios, imágenes disponibles, recuperación y baja siguen presentes en el HTML renderizado. No hay descuentos ni urgencia añadidos.

`/cesta?recover=<UUID aleatorio>` no contiene identidad personal y no autentica. El backend exige sesión y comprueba la propiedad del episodio enviado y de la cesta; el enlace caduca a los 30 días. La página conserva el destino durante el login y, si la sesión redirige a inicio, mediante un destino local fijo guardado durante una hora en la pestaña. Un enlace ajeno o vencido da un resultado genérico y deja disponible la cesta de la cuenta actual.

No se restaura ningún contenido antiguo: siempre se conserva la cesta actual, incluidos cambios posteriores al correo. Se recalculan ofertas y precios con `resolveWebPrice`, se comprueban talla activa, tirada, moneda y stock y se usa la revisión de cambios existente de la tienda. El correo muestra únicamente artículos actualmente comprables y cantidades limitadas al stock disponible; no reserva existencias. El checkout sigue siendo la validación final.

## Consentimiento y activación de producción

Revisión realizada: el formulario de compra ofrece una casilla independiente «Enviarme novedades y ofertas por correo electrónico»; la política contempla comunicaciones comerciales con consentimiento y ahora explicita los recordatorios. Se adopta la vía conservadora de consentimiento vigente, sin utilizar la excepción de relación contractual previa. Los [artículos 21 y 22 de la LSSI](https://www.boe.es/eli/es/l/2002/07/11/34/con) regulan autorización y retirada para comunicaciones comerciales. Antes de activar, el responsable debe comprobar que la evidencia y el alcance de los consentimientos existentes cubren este uso; el código no convierte la mera existencia de una cuenta en autorización.

Pasos de despliegue:

1. Ejecutar el despliegue habitual de migraciones (`npm run prisma:migrate:deploy`) y compilación. La migración es aditiva, privada, con borrado en cascada al eliminar la cuenta/cesta; no modifica datos ni crea episodios históricos.
2. Inicializar No-reply, revisar la vista previa y publicar «Carrito abandonado» en los círculos que deban recibirlo. La firma predeterminada se reutiliza si existe.
3. Configurar `CART_ABANDONMENT_START_AT` con una fecha ISO-8601 explícita con zona, preferiblemente el momento futuro de lanzamiento. No se utiliza `Cart.updatedAt` para backfill. Solo nuevas actividades registradas desde ese instante generan episodios.
4. Tras revisar los consentimientos, establecer `CART_ABANDONMENT_ENABLED=true`, `BACKGROUND_JOBS_ENABLED` distinto de `false` y mantener el proceso backend residente. Requiere el correo existente habilitado, SMTP No-reply, `EMAIL_SMTP_PAUSED` distinto de `true`, el llavero `MAILBOX_ENCRYPTION_*`, `FRONTEND_URL` y `API_PUBLIC_URL` públicos correctos. Los trabajadores de conciliación de reservas y webhooks deben seguir operativos.
5. Revisar los estados, la auditoría SMTP y la baja con una cuenta de prueba controlada antes de habilitarlo para clientes. Esta entrega no realiza ese envío ni cambia variables de producción.

Para detener envíos, usar `CART_ABANDONMENT_ENABLED=false` y reiniciar los procesos; la pausa SMTP existente también se respeta. Los episodios permanecen en base de datos. Al reactivar se procesarán los pendientes elegibles desde la fecha de inicio configurada, no todos los carritos históricos.

## Validación

```text
npm test -- --runInBand cart-abandonment.spec cart-recovery.dom.spec
npm run test:cart-abandonment:db
npm run typecheck
npm run build
```

La prueba de base de datos crea y elimina una base **local desechable**, conserva una cesta histórica de prueba durante la migración y ejecuta el SQL real con un reloj controlado. Verifica 23 horas menos 1 ms y el vencimiento exacto, nuevas actividades, operaciones repetidas, lecturas automáticas, exclusiones, todos los estados de pago pendientes, concurrencia, reintentos, interrupciones, consentimiento, bajas, recuperación y el gestor real de publicación/edición. SMTP y cualquier consulta externa de pago se sustituyen por dobles; no se utilizan clientes reales. El resultado queda en `test-results/cart-abandonment/results.json` en la raíz del repositorio.
