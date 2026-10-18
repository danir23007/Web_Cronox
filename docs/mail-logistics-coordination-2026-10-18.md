# Contraseña tras la compra y comunicaciones logísticas — revisión local

Implementación iniciada el 18/10/2026, sobre `166f7e2`. La autorización del 19/10 sustituye el límite local y comprende commit, push, migración y publicación por el procedimiento existente. Véase la [reconciliación y cierre de implementación](shipping-mail-release-2026-10-19.md). Las comprobaciones usan datos ficticios, PostgreSQL local y proveedores simulados. No se han generado etiquetas, recogidas, envíos contratados ni cargos.

## Configuración de contraseña

`GuestOrderAccountService` determina el escenario dentro de la transacción del pago confirmado, bajo los bloqueos de email/credenciales existentes. `CheckoutEffect.accountScenario` lo conserva junto al pedido. La recuperación de webhooks lee ese resultado y comprueba que usuario y pedido coinciden; no reclasifica por antigüedad, número de compras o una lectura posterior.

| Resultado persistido | Finalidad | Asunto |
| --- | --- | --- |
| `NEW_ACCOUNT` | `PASSWORD_SETUP_NEW_ACCOUNT` | CRONOX · Tu cuenta está lista: configura tu contraseña |
| `EXISTING_PASSWORDLESS` | `PASSWORD_SETUP_EXISTING_ACCOUNT` | CRONOX · Configura tu contraseña y consulta tu pedido |
| `NOT_NEEDED` | Ninguna de las anteriores | Cuenta con contraseña: no se envía configuración |

Ambos mensajes incluyen el pedido asociado, el botón **Configurar contraseña** y acceso a `/recuperar-contrasena`. El segundo explica que el pedido está asociado a su cuenta, sin afirmar que se acaba de crear. Comprar sigue sin exigir sesión y nunca establece ni sobrescribe una contraseña. Si se establece una contraseña antes de consumir el efecto, se omite el aviso.

Se conserva el token aleatorio almacenado como hash, de un uso, con caducidad de una hora, invalidación transaccional y protección de credenciales. La reclamación y marca de entrega existentes impiden que separar finalidades permita enviar las dos por la misma operación. El estado incierto de SMTP sigue requiriendo revisión; no se promete entrega exactamente una vez. Un enlace caducado no puede establecer contraseña; una petición explícita de recuperación permite obtener otro. La página de restablecimiento mantiene visible esa salida.

Los efectos antiguos pendientes sin escenario pasan a `REVIEW / PASSWORD_SETUP_CONTEXT_MISSING`. No se deduce su escenario ni se reproducen mensajes históricos. La bienvenida, descuento, confirmación del pedido y sus reglas permanecen en sus flujos existentes.

## Plantillas gestionadas

Las dos finalidades nuevas se incorporan al catálogo, a las carpetas de los cinco círculos y a sus respaldos Handlebars. La publicación se selecciona por remitente/finalidad; no existe selección automática por círculo del cliente. La importación crea únicamente lo que falta (`upsert update: {}`). Una plantilla inicial antigua se clona para conservar estructura, colores y personalizaciones compatibles, adaptando los textos de creación, la acción y los datos imprescindibles. Los originales y sus versiones se conservan.

Mientras no exista publicación de la nueva finalidad se puede leer y adaptar la publicación antigua, sin escribir ni republicarla. El texto plano se regenera del documento adaptado para evitar conservar afirmaciones antiguas. Una publicación específica nueva tiene prioridad. Si falta una acción segura, pedido o contenido obligatorio, o una plantilla de cuenta existente afirma que se ha creado la cuenta, se utiliza el respaldo correcto. Los asuntos de configuración son los indicados arriba.

Se reutilizan `ORDER_SHIPPED` y `ORDER_DELIVERED`, con sus diseños y publicaciones existentes; se añaden `ORDER_OUT_FOR_DELIVERY`, `ORDER_INCIDENT` y `ORDER_RETURNED`. Todos usan `ORDERS` (cuenta `orders@cronox.es`). Las variables de transportista, código y enlace son condicionales cuando una confirmación manual aún no tiene seguimiento. Una publicación incompatible con los datos necesarios usa respaldo. Las antiguas finalidades `INITIAL_PASSWORD_SETUP` y `ORDER_TRACKING` permanecen identificadas como heredadas; el flujo automático nuevo no produce el correo genérico de seguimiento.

## Estado comercial, transporte y correos

No se amplía el enum comercial. `Order.status` conserva pagos, disputas, cancelaciones y reembolsos. `trackingCategory`, `trackingState`, código, fechas locales e historial representan el transporte por revisión.

| Suceso | Estado comercial elegible | Transporte e historial | Comunicación lógica |
| --- | --- | --- | --- |
| Asociar código/PDF, prerregistro o etiqueta | Sin cambio | Referencia; pendiente de entregar a Correos | Ninguna |
| Marcar Enviado manualmente | `SHIPPED` | Evento manual auditado | `ORDER_SHIPPED` |
| Admisión física oficial | `PAID/PROCESSING → SHIPPED` | `ADMITTED` y fecha original | El mismo aviso de enviado, si no existe |
| Primer tránsito físico reconocido sin admisión | `PAID/PROCESSING → SHIPPED` | Tránsito; no inventa fecha de admisión | Enviado sujeto al corte y deduplicación |
| En reparto | Conserva `SHIPPED` | `OUT_FOR_DELIVERY` | `ORDER_OUT_FOR_DELIVERY` |
| Entregado a destinatario/autorizado | `DELIVERED` | `DELIVERED` | `ORDER_DELIVERED`, también coordinado con respaldo manual |
| Incidencia del paquete | Sin cambio financiero | `INCIDENT` | `ORDER_INCIDENT` |
| Entregado de vuelta al remitente | Sin reembolso automático | `RETURNED` | `ORDER_RETURNED` |
| Escaneo intermedio o desconocido | Solo evidencia oficial reconocida puede promover | Conserva historial | Ningún correo por escaneo |
| Fallo técnico/429 de la API | Sin cambio logístico | Error de consulta y próximo intento | Ninguna incidencia del paquete |

La interpretación usa únicamente `uniqueCode` exactos revisados contra la [matriz oficial](https://www.correos.es/content/dam/correos/documentos/herramientas/m%C3%B3dulos/integracion-por-ficheros/integraci%C3%B3n-api/Matriz_eventos_20251009.xlsx), con [filas y hash conservados](integrations/correos/matrix-reviewed-subset-20251009.json) y [contrato Trackpub](integrations/correos/contract-notes-2026-10-14.md). No se usa coincidencia de palabras, fase o prefijos. La matriz se volvió a contrastar el 18/10; hash `1006b40afd62e0465d0f4c2470b73770e85c773093f6dfac26d25ac724b2c974`.

- Admisión: `A010000V`, `A050000V`, `A050020V`.
- Tránsito: `C010000V`, `E020000V`, `F010000V`, `G010000V`.
- Reparto: `H020000V`, `H250000V`.
- Entrega al destinatario: `I010000V`.
- Devolución efectiva al remitente: `I020000V`, `I01H230V`.
- Incidencias revisadas: `O07A010R`, `O07A030R`, `O200000R`.

Los demás códigos se conservan sin atribuirles una equivalencia automática. Las fechas locales sin zona de Trackpub se muestran como tales; no se añade una `Z` ficticia.

El estado comercial no retrocede por una admisión tardía tras entregar. La proyección del transportista usa cronología, no una fase máxima permanente: una incidencia o devolución posterior puede mostrarse tras la entrega, manteniendo `DELIVERED` comercial. Un marcado manual conserva el estado oficial ya conocido. Se conserva la ventana de comprobación de correcciones de envíos terminales: por defecto siete días, con comprobación diaria; fuera de ella sigue disponible la consulta manual.

Quedan excluidos de sincronización/avisos los estados pendientes de pago, cancelados, reembolsados o en disputa, las compras presenciales y las recogidas `PICKUP/LOCAL_PICKUP`. Un suceso de transporte no llama a cobros, reembolsos, movimientos de stock ni finanzas.

## Un solo outbox y auditoría

El marcado manual ya no envía SMTP desde `AdminOrdersService`: persiste evento y `OrderTrackingNotification` en la misma transacción del estado, manteniendo el bloqueo de fila. Trackpub usa la misma función de creación y el mismo outbox/worker. Cada trabajo registra origen, evento, revisión, transición, estado de envío, intentos y, si corresponde, motivo de supresión.

`SHIPPED` y `DELIVERED` tienen clave lógica por pedido compartida entre ambos orígenes y revisiones. Reparto y devolución se coalescen por revisión; las incidencias, por código exacto dentro de esa revisión, para no enviar cada escaneo repetido de la misma incidencia. La historia completa permanece disponible. No se emite un genérico más un específico por el mismo hito.

La primera asociación de un código puede conservar un aviso manual `PENDING/RETRY`: archiva la fila anterior y crea evento/trabajo de la revisión nueva con la misma clave lógica, conservando intentos y próximo intento. No reabre `SENT`, `UNKNOWN` ni un intento en curso. Las sustituciones posteriores exigen confirmación/revisión vigente, cancelan trabajo anterior pendiente y no reutilizan eventos de otra revisión. Los avisos ya registrados bloquean duplicados del mismo hito comercial, aunque el número se sustituya.

El worker reclama cada trabajo atómicamente y vuelve a comprobar elegibilidad y revisión bajo bloqueo antes del SMTP, con plazo acotado. Un fallo SMTP no revierte el estado del pedido, ya confirmado en otra transacción. La cuota o rechazo probado permiten reintento con espera; aceptación incierta, caída tras comenzar SMTP o reclamación caducada pasan a `UNKNOWN`, sin reenvío automático. Una referencia a un evento inconsistente se cancela para revisión. El correo logístico con plazo no se deriva a una segunda cola genérica de SMTP.

## Primera sincronización e históricos

La migración establece una única vez `LOGISTICS_EMAIL_CUTOFF`. Los registros anteriores se preservan y los avisos heredados de enviado/entregado reciben prioridad lógica. Los antiguos trabajos pendientes de otros hitos se cancelan para revisión. No se reinicia el corte al arrancar.

En una vinculación nueva, `trackingFlowStartedAt` permite que la primera admisión del nuevo flujo sí promueva y avise, incluso con hora local del mismo día o sin fecha. No admite fechas claramente anteriores al corte. Para vinculaciones antiguas se exige un hito inequívocamente posterior al corte: una hora local se evalúa con todo el margen de zonas ±14 horas; los casos históricos, ambiguos o sin fecha se registran `SUPPRESSED`, sin correo.

La primera historia avanzada no manda cada movimiento intermedio. Considera enviado/entregado y, de los hitos reparto/incidencia/devolución, únicamente el estado relevante más reciente. Un pedido ya enviado/entregado al incorporarlo no vuelve a comunicar ese hito por inferencia del estado actual. Un trabajo legítimo ya creado por la acción manual prevalece sobre esa supresión.

Administración incorpora **Revisar históricos (sin envío)**: `GET /api/admin/orders/tracking-bulk/review?page=1`, solo SUPERADMIN, páginas de 50. Lee exclusivamente historial persistido y muestra estado, último hito fiable, comunicaciones registradas/potenciales y motivos. No consulta Correos ni crea trabajos. Sin historial almacenado declara que no hay evidencia; no simula conocer el estado real del transportista.

La tabla añade filtro logístico y muestra ambos estados. Se conservan edición/asociación masiva y protecciones existentes. El perfil muestra transporte, número de pedido distinto del seguimiento, enlace oficial e historial desplegable de la revisión vigente. `GET /api/me/orders/:id/tracking` exige titularidad y no expone etiquetas privadas, auditoría interna ni estado de entrega de emails.

## Configuración comprobada y activación pendiente

Base local comprobada: `127.0.0.1:5433/cronox_dev`. Migraciones `20261018180000_correos_fulfillment` y `20261018220000_mail_event_coordination` aplicadas con `migrate:local`; no se han modificado migraciones anteriores. Antes se creó un `pg_dump` y se restauró en otra base temporal: 111 tablas y 23 secuencias comparadas, cero diferencias en datos, índices, propietarios, privilegios efectivos y RLS. El respaldo y su verificación están ignorados en `test-results/correos-audit/local-backup-1792352877020`; contienen datos privados y no deben publicarse.

En el perfil local efectivo: `EMAIL_ENABLED=false`, `BACKGROUND_JOBS_ENABLED=false`, `CORREOS_TRACKING_ENABLED=false`, `CORREOS_EMAIL_ENABLED=false`; `ORDER_LOGISTICS_EMAIL_ENABLED` no definido y, por tanto, desactivado por el respaldo anterior. Cero trabajos logísticos pendientes. `.env.example` declara el nuevo interruptor explícitamente `false`; el arranque local también elimina valores heredados de ese interruptor. No se han editado `.env` ni `.env.local`.

| Control | Efecto |
| --- | --- |
| `CORREOS_TRACKING_ENABLED=true` | Permite consultas Trackpub y sincronización del worker |
| `ORDER_LOGISTICS_EMAIL_ENABLED=true` | Habilita los cinco avisos automáticos del transportista; los manuales dependen del correo transaccional y jobs, no de este interruptor |
| Nuevo flag ausente | Compatibilidad: usa `CORREOS_EMAIL_ENABLED`; un `false` explícito nuevo siempre prevalece |
| `EMAIL_ENABLED=true`, jobs no desactivados, smoke apagado | También necesarios para despachar avisos |

El mismo worker puede despachar avisos manuales con Trackpub y ambos flags Correos desactivados; no se añade otro trabajador. El 19/10 se corrigió expresamente el filtrado por origen para garantizarlo. Al habilitar despacho automático se procesarán sus trabajos pendientes válidos, por lo que hay que revisar el outbox antes de activarlo.

Producción no se ha consultado ni cambiado durante esta implementación. La última auditoría de la tarea anterior, documentada en [Correos: cierre productivo](correos-fulfillment-2026-10-18.md#cierre-productivo-verificado), verificó el commit funcional `036d1c2`, ambos flags Correos desactivados, cuatro credenciales presentes y ningún envío/evento/aviso vinculado. Esa evidencia no acredita que esta reorganización esté desplegada ni que Trackpub esté autorizado y funcional hoy.

Para activar en una tarea posterior faltan: publicar este código/migración, disponer del par legítimo **ID CRONOX + código de Correos**, verificar la autorización Developers/Trackpub y su cuota con una consulta controlada, revisar históricos/outbox/publicaciones y comprobar la configuración SMTP ORDERS efectiva antes de habilitar los interruptores. El titular ha confirmado que todavía no tiene etiqueta real. La presencia de credenciales y el anterior 200 de Identidad no sustituyen esa prueba. Nada de ello se ha activado ni probado con un envío real en esta tarea.

## Validación reproducible

```powershell
npm test --prefix cronox-backend -- --runInBand --silent
npm run typecheck --prefix cronox-backend
npm run build:compiled --prefix cronox-backend
npx.cmd tsc --noEmit -p tsconfig.admin.json
node cronox-backend/scripts/test-correos-tracking-db.cjs
git diff --check
```

Resultados finales y evidencias locales:

- Jest: 268 suites y 2.869 pruebas (informe `test-results/correos-audit/mail-coordination-final.json`).
- Typecheck backend, compilación Nest y typecheck admin completados.
- PostgreSQL real: 34 comprobaciones; aplica ambas migraciones a una base temporal, comprueba schema diff cero, restricciones/RLS, dos clientes concurrentes, pago/efectos duraderos, escenarios de cuenta, hash/caducidad/uso único/recuperación, estados, deduplicación manual/Correos, asociación/sustitución, errores y revisión sin escrituras. Proveedores externos y SMTP simulados; base temporal eliminada.
- Pruebas de transporte: cuota, rechazo probado, resultado incierto, aceptación seguida de fallo al registrar, expiración de reclamación y reinicio sin duplicación; historial seguro y permisos HTTP.
- Chromium con páginas/JS/plantillas reales y API ficticia, a 1440×1100 y 390×844: tabla/filtro, perfil/historial/enlace, los dos correos de contraseña y los cinco logísticos. Capturas ignoradas `output/playwright/mail-*.png`. La tabla administrativa conserva desplazamiento horizontal en móvil; el perfil usa filas adaptadas. No acredita render en todos los clientes de correo ni una sesión real en producción.

El EPERM quedó resuelto el 19/10: el único propietario de la DLL era el servidor local de revisión CRONOX (PID 20768, puerto 3000). Se detuvo solo ese proceso y se completaron la generación real y el prebuild con Prisma Client 6.19.3. La instancia se restaura con el compilado final; véase el informe del 19/10.
