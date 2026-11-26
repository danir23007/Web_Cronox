# Audiencia de campañas y preferencias comerciales

## Auditoría de producción, sin escrituras

Se revisaron las 100 cuentas antes de modificar código o datos. Todas están ACTIVE. Distribución: USER 67, FRIEND 30, ADMIN 2 y SUPERADMIN 1; círculos 1: 90, 2: 9, 3: 0, 4: 0 y 5: 1. No hay emails inválidos ni repetidos, supresiones ni registros históricos de rechazo/baja. Hay 24 preferencias `newsletterSubscribed=true`, 76 false y 20 registros NewsletterSubscription con subscribedAt; los 20 están correctamente vinculados y corresponden a cuentas ya suscritas. Las cuatro preferencias true restantes se conservan como preferencia histórica de cuenta; no se inventa una fecha de aceptación.

El filtro de roles dejaba 21 destinatarios. Al retirarlo quedan **24 únicos**: 19 del círculo 1, cuatro del 2 y uno del 5. Las 76 exclusiones restantes corresponden exclusivamente a cuentas sin evidencia suficiente de suscripción vigente (53 USER y 23 FRIEND). Un false sin más evidencia no se interpreta como baja expresa ni como desincronización. Hay **cero cuentas que corregir con evidencia**, por lo que no se cambia ninguna preferencia ni estado de cuenta en producción.

La familia se identifica por `campaign:INFO:BLACK_FRIDAY_NUMBERS_2026`. Existe un único borrador de Info con los cinco círculos seleccionados, sin MailboxCampaign asociado ni programación. Su nombre guardado es «Black Friday · Los números no son casualidad»; se conserva. La audiencia se resuelve al consultar el borrador y no está almacenada en un contador: no necesita una escritura o un nuevo envío para recalcularse. Se conservan las cinco plantillas, contenido, foto, contador, asunto, preheader, enlaces, revisiones y publicaciones.

## Una misma selección

`resolveRecipients` carga las cuentas y supresiones sin filtro de rol. `campaignAudience` aplica estado, preferencia, supresión, dirección válida, círculo y deduplicación. Produce total de cuentas seleccionadas, destinatarios únicos y exclusiones con motivos. Una dirección elegible vinculada a círculos distintos sigue bloqueando la confirmación.

Recuento, resumen, Excel y confirmación utilizan ese plan. `eligible` vuelve a usar la misma resolución antes de cada entrega: los nuevos roles no se excluyen y las bajas/cambios de círculo posteriores siguen vetando la entrega. Las campañas ya confirmadas mantienen sus destinatarios congelados; no se amplía una programación existente. Los permisos del administrador remitente siguen comprobándose por separado.

«Nueva campaña» muestra total, válidos únicos y excluidos, con motivos y listado desplegable protegido por el acceso actual al buzón. El Excel mantiene la hoja Destinatarios y añade Excluidos. No se exponen estas listas en endpoints públicos.

## Elección explícita y bajas

El formulario compartido de registro normal/evento y los formularios de checkout invitado y preregistro muestran una casilla inicialmente marcada, desmarcable. Envían un booleano explícito. El DTO no toma `registrationSource=newsletter` ni un campo omitido como aceptación. Una suscripción histórica puede heredarse únicamente si no hay veto posterior.

Se reutiliza AuditLog para guardar la elección, fuente y fecha de forma transaccional; la dirección se identifica por hash y el ID de cuenta queda en metadatos privados. Un rechazo explícito crea una supresión DECLINED; una baja conserva UNSUBSCRIBED y un rebote confirmado conserva su motivo. Las aceptaciones históricas no anulan rechazos o bajas posteriores. No hay tablas nuevas ni migraciones.

El invitado transmite la elección al preparar el pago. El backend la guarda en AuditLog vinculada a su snapshot y la consume al crear la cuenta del pedido pagado. La elección participa en el fingerprint de preparación: desmarcar antes de pagar obliga a revalidar el snapshot. No se registra una aceptación anticipada por una petición separada del navegador. Si la cuenta ya existe, la compra nunca cambia su preferencia. Tampoco lo hacen el perfil, el login o repetir el registro de evento. El endpoint antiguo de suscripción exige ahora el booleano explícito; omitirlo no crea consentimiento.

La creación administrativa se revisó: no existe un endpoint de alta de cuentas en AdminUsersController, que consulta/edita cuentas existentes. El servicio interno de alta admite preferencia opcional; sin elección no inventa una, y cuando se aporta guarda su fuente administrativa. No se añade un flujo de altas ajeno a esta tarea.

## Revisión reproducible y conservación

`node scripts/audit-campaign-audience.cjs --production --backup-dir=../output/campaign-audience/<directorio-nuevo>` ejecuta una transacción RepeatableRead de **solo lectura**, sin iniciar Nest, SMTP ni trabajadores. Verifica el proyecto productivo y guarda un snapshot privado con creación exclusiva, además de un resumen sin emails/nombres de clientes. Las huellas de las plantillas/versiones y del borrador permiten comparar antes y después del despliegue. No incluye un modo de escritura: esta auditoría no justifica ninguna corrección de datos. Los respaldos y capturas locales quedan fuera del commit.

Resultado: **346 suites y 3.721 pruebas aprobadas**, tipos y compilaciones frontend/backend correctos, sintaxis/diff y guardia de seguridad de publicación correctos. Las pruebas cubren todos los roles (incluido uno futuro), permisos, círculos, direcciones, duplicados, desglose, Excel y retirada antes de entrega; elecciones true/false/omitida, fuentes, baja protegida e invitado nuevo/existente. Se mantienen las regresiones del checkout, importes y conciliación. Revisión con Chromium a 1440 y 390 px usando HTML/JS/CSS reales y API simulada con escrituras prohibidas: desglose desplegable, casilla marcada y posibilidad de desmarcarla, sin desbordamientos. No son pruebas de envío ni de compra reales.

Se publica mediante Deploy CRONOX con publish=true; se contrasta el SHA instalado, salud HTTP, audiencia recalculada y huellas intactas. Publicar la web no publica plantillas, programa campañas ni envía correos.
