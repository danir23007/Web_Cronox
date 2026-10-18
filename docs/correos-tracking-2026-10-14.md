# Seguimiento de Correos en CRONOX

**Actualización 18/10/2026:** el [flujo de admisión, aviso único y gestión por lotes](correos-fulfillment-2026-10-18.md) está publicado y sustituye el comportamiento de estados/avisos descrito en este informe histórico. Ambos flags de Correos continúan desactivados: todavía no hay etiqueta real para validar Trackpub. El nuevo documento recoge el corte persistente, las pruebas y el despliegue comprobado.

Integración de seguimiento mediante Trackpub: los envíos, etiquetas y recogidas siguen gestionándose manualmente en Correos. No se crea un segundo pedido ni se reutiliza el número CRONOX como identificador del transportista. Subir el PDF es opcional: guardar el número, mostrar su enlace y consultar Trackpub funcionan sin etiqueta.

## Funcionamiento

- Administración conserva el editor existente de preparación del pedido. El seguimiento de Correos genera su enlace público oficial, incrementa una revisión y registra número anterior/nuevo, actor e identidad inmutable. Asignar número o PDF no marca el paquete como admitido ni modifica pago, estado del pedido o stock.
- Una corrección invalida el lease de la consulta anterior y cancela avisos anteriores aún pendientes. La respuesta solo se aplica si coinciden pedido, número, revisión y token de lease. El PDF se conserva, pero se avisa si corresponde a otra revisión.
- PDF privado de hasta 10 MiB: directorio absoluto fuera del repositorio y de cualquier raíz pública, nombre aleatorio, firma PDF y SHA-256, acceso exclusivamente SUPERADMIN, descarga adjunta sin caché. No se expone una URL de almacenamiento al cliente. El directorio debe incluirse en el respaldo operativo junto con la base.
- «Mi cuenta → Pedidos» consulta exclusivamente `where: {userId}` de la sesión autenticada. Mantiene número de pedido y seguimiento separados, incluido el enlace después de entregar. Sin seguimiento muestra «Pendiente de enviar» cuando corresponde; cancelados, reembolsados, entregados, compras presenciales y recogidas locales tienen textos específicos.
- Historial, última sincronización correcta y error de consulta son datos separados. Un error HTTP, respuesta vacía, referencia aún no encontrada o código desconocido no elimina el historial ni se convierte en una incidencia logística.

## Contrato y límites de interpretación

Se consultaron el [OpenAPI oficial de Trackpub](https://anypoint.mulesoft.com/exchange/portals/sociedad-estatal-correos/c9ca99ed-6681-402c-811e-5ebc907e6b46/trackpub/), la matriz pública de eventos y las guías de Identidad. Fuentes, hashes, subconjunto exacto de códigos y limitaciones están en [las notas del contrato](integrations/correos/contract-notes-2026-10-14.md).

El parser utiliza el objeto `SearchResponseDTO` documentado, no un esquema inventado. Selecciona solo campos de seguimiento; no conserva ni devuelve el objeto completo, que puede contener información personal innecesaria. El enlace público usa `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=...`.

La categoría se obtiene únicamente de siete códigos únicos revisados: admisión, dos códigos de reparto, entrega al destinatario, devolución al remitente y dos incidencias explícitas. Los restantes se muestran sin inferencias por texto o fase. La relación entre `uniqueCode` real y la matriz debe contrastarse con el primer envío.

Correos no especifica zona horaria en las fechas del contrato. Se guarda el literal y una clave de calendario validada para ordenar; el timestamp absoluto permanece nulo. No se garantiza el orden absoluto entre husos de envíos internacionales hasta obtener esa precisión del proveedor. Los eventos sin fecha válida se conservan sin desplazar el último estado fechado ni generar avisos.

`expiresIn=30` está documentado en minutos. El token queda solo en memoria del servidor, con renovación compartida por proceso y margen de un minuto; `exp`, cuando existe, limita la caché, sin interpretarse como validación criptográfica. Un 401 provoca una sola renovación/repetición; un 403 persistente se informa sin bucles. Cada petición tiene timeout y tamaño máximo. Los errores se registran mediante códigos, sin cuerpos ni cabeceras privadas.

## Sincronización y avisos

Los valores siguientes son decisiones de CRONOX, **no cuotas confirmadas por Correos**: consulta cada 30 minutos, consulta manual con espera mínima de 60 segundos, concurrencia global de dos solicitudes y separación de un segundo. Debe confirmarse con Correos la cuota concedida antes de activar el worker.

Leases persistentes por pedido evitan solapar consulta manual y automática. Slots advisory de PostgreSQL limitan la concurrencia entre procesos PM2; una fila compartida impone separación y conserva la pausa `Retry-After` de 429/503. Los fallos se reprograman con espera exponencial de 1 minuto hasta 24 horas, respetando una espera mayor del proveedor. No hay bucles de reintento inmediatos salvo una renovación por 401. Una caída libera el slot y el lease permite recuperación posterior.

Solo se consultan pedidos online elegibles, con número y transportista Correos, pagados/en preparación/enviados/entregados. No se consultan pendientes de pago, cancelados, reembolsados, en disputa, compras presenciales ni recogidas locales. Correos no cambia esos estados ni reservas o movimientos de stock.

Después de una entrega al destinatario o una devolución al remitente identificadas por código exacto, se comprueba una vez al día durante siete días desde su primera observación; posteriormente cesa la consulta automática. Es una política configurable de ahorro de consultas, **no una garantía de irrevocabilidad de Correos**. La actualización manual continúa disponible y un nuevo evento no terminal reactiva la planificación normal.

La primera respuesta válida establece una referencia: si contiene historial antiguo no genera correos retrospectivos. Una primera respuesta vacía establece referencia vacía; cuando aparecen eventos se considera únicamente el último hito fechado en esa primera incorporación, para no enviar una secuencia antigua completa. Después solo se encolan eventos nuevos con fecha no anterior al último evento conocido. Se permiten hitos distintos en el mismo segundo y nuevas incidencias posteriores. La huella del evento y su outbox único impiden repetir el mismo aviso.

Los avisos usan el buzón ORDERS y la nueva finalidad/plantilla editable `ORDER_TRACKING`, integrada con el editor y el transporte existentes. Incluyen pedido, número de seguimiento, estado y enlace público. Requieren `CORREOS_EMAIL_ENABLED=true`, además de correo y trabajos habilitados globalmente.

El outbox se crea dentro de la transacción de eventos. Solo un proceso reclama cada aviso; se valida de nuevo revisión y elegibilidad antes de enviar. El bloqueo del pedido serializa el envío con una corrección. El SMTP de estos avisos usa socket propio con plazo absoluto de 20 segundos, destrucción efectiva al vencer y bloqueo transaccional de 60 segundos. No afecta al transporte habitual de otros correos.

Tras aceptación se registra `SENT`. Un rechazo seguro o espera de cuota se reprograma; si el proceso cae durante SMTP o el resultado es ambiguo, queda `UNKNOWN`, sin reenvío automático. SMTP no ofrece una transacción atómica con PostgreSQL: es preferible revisión manual a duplicar un mensaje posiblemente aceptado. Un correo ya aceptado antes de una corrección no puede retirarse.

Para resolver `UNKNOWN`, consultar de forma privada el outbox y `EmailDelivery`, contrastar pedido/revisión, hora y registros del buzón ORDERS. Si el proveedor confirma aceptación, registrar la resolución sin reenviar; solo volver a poner en cola tras confirmar que no se envió y que sigue vigente la misma revisión. Nunca deducir rechazo solo de la ausencia de respuesta. No hay acción pública que fuerce esos reenvíos.

## Configuración privada

Nombres y valores de ejemplo en [cronox-backend/.env.example](../cronox-backend/.env.example). La configuración privada local está en `cronox-backend/.env.local`, con los dos pares de credenciales y el directorio privado de etiquetas. Las copias idénticas de esos cinco valores se retiraron de `.env` después de verificarlas y conservarlas en un respaldo privado fuera del repositorio; el resto de variables se conserva.

| Variable | Procedencia / función |
| --- | --- |
| `CORREOS_IDENTITY_CLIENT_ID` | ID de Correos Identidad |
| `CORREOS_IDENTITY_CLIENT_SECRET` | Secreto de Correos Identidad |
| `CORREOS_DEVELOPERS_CLIENT_ID` | ID concedido para Trackpub en Developers |
| `CORREOS_DEVELOPERS_CLIENT_SECRET` | Secreto concedido para Trackpub en Developers |
| `CORREOS_TRACKING_ENABLED` | `false` hasta preparar migración y verificar el acceso real |
| `CORREOS_EMAIL_ENABLED` | `false` durante pruebas y primera revisión de la integración |
| `CORREOS_LABEL_PRIVATE_DIR` | Directorio absoluto persistente, fuera del repositorio y raíces HTTP, privado para el backend y el operador autorizado |
| `CORREOS_SYNC_INTERVAL_SECONDS` | `1800` |
| `CORREOS_MANUAL_COOLDOWN_SECONDS` | `60` |
| `CORREOS_SYNC_CONCURRENCY` | `2` |
| `CORREOS_REQUEST_SPACING_MS` | `1000` |
| `CORREOS_TIMEOUT_MS` | `10000` |
| `CORREOS_TERMINAL_RECHECK_DAYS` | `7` |

Guardar credenciales únicamente en el entorno privado del backend. Usar `cronox-backend/.env.local` también para el comprobador local; está excluido de Git por la regla `.env.*`. No pegar secretos en el chat. `start:local` y `start:dev` seleccionan expresamente ese archivo: el cargador limpia los valores heredados y aplica después los locales, incluidos los vacíos. No se debe dejar una asignación vacía posterior que oculte una credencial. `start:prod` directo conserva otra prioridad: entorno del proceso por encima del archivo `CRONOX_ENV_FILE` o `.env`; no carga automáticamente `.env.local`. Correo, seguimiento y trabajos locales permanecen desactivados.

## Migración y publicación

Migración aditiva: `20261016120000_correos_tracking`. Añade revisión, datos de sincronización y cinco tablas privadas con RLS y revocación de acceso público. Se ejecuta en una transacción con `lock_timeout=5s` y `statement_timeout=60s`; un fallo revierte los cambios de esa transacción. No reescribe estados de pago ni modifica stock. Conserva los números ya guardados; su primera consulta no envía historial antiguo.

Antes de publicar, respaldar y comprobar restauración de la base y del directorio privado de PDF. Mantener ambos flags Correos en `false`. Aplicar migración antes de arrancar código nuevo, porque Prisma consulta las columnas nuevas incluso con el worker deshabilitado:

```bash
# Desde cronox-backend, en el entorno autorizado y con su configuración privada.
npm run prisma:migrate:deploy
npm run prisma:generate
npm run build:compiled
```

Preparar el directorio privado con permisos 0700/directorio, 0600/archivos (ACL equivalente en Windows), accesible para el backend; incluirlo en backups. Revisar salud, permisos y UI antes de habilitar consultas. Confirmar cuota, primer resultado real y clasificación; habilitar avisos únicamente después de revisar esos datos y la plantilla de ORDERS.

Recuperación: primero desactivar worker y avisos, detener sus procesos y comprobar que no queda SMTP en vuelo. La migración es aditiva: puede volver al código anterior conservando las columnas/tablas y sus datos. No eliminar tablas del outbox ni restaurar una base antigua sobre pedidos posteriores para resolver un fallo de seguimiento. Los `SENDING` interrumpidos pasan a `UNKNOWN` al recuperar, no a envío automático. Para una reversión inmediata, se han conservado configuración y runtime anteriores (incluidos Prisma y frontend), con hashes y comprobación del contenido del archivo; la espera de salud tras el reinicio es acotada. No se ha necesitado ejecutar la recuperación. Una restauración de configuración posterior a esta ventana requiere revisar antes cualquier cambio nuevo; no sobrescribirlo con una copia antigua.

### Publicación realizada el 14/10/2026

- Código publicado: `458c9153b954a0fdd5b952704074a3fcb12edbc5`. [CI y despliegue](https://github.com/danir23007/Web_Cronox/actions/runs/38606163958) correctos: **2.448 pruebas en 240 suites**, además de 59 comprobaciones HTTP/Excel en seis suites, typecheck, compilaciones y controles de exclusión de secretos/contenido privado. El push inicial ejecutó solo CI; la publicación se inició expresamente después de preparar el respaldo y la configuración.
- Respaldo consistente de las 100 tablas públicas de la aplicación, configuración privada y runtime anteriores. Restauración real en PostgreSQL aislado mediante socket Unix: coinciden contenido, propietarios, permisos y RLS; sin workers ni escrituras en la base de producción. Los archivos de respaldo y los operadores están fuera del repositorio, bajo directorios privados del usuario de despliegue. No incluye una copia nueva del entorno del PM2 root: no se modificó su configuración ni se utilizó `--update-env`.
- Migración `20261016120000_correos_tracking` aplicada a las **17:26:48 UTC**, antes de arrancar el código nuevo. Checksum verificado; cinco tablas nuevas con RLS y sin acceso de `PUBLIC`, `anon` o `authenticated`. La migración aditiva permite conservar el servicio anterior durante la instalación; no se necesitó una ventana de mantenimiento.
- Se trasladaron exclusivamente las cuatro credenciales de `.env.local` a `cronox-backend/.env` del servidor mediante SSH con identidad y host comprobados. El archivo privado conserva sus demás variables, incluidas las de correo general y trabajos; permisos 0600. El reinicio existente preserva el entorno PM2. No se copiaron los perfiles locales completos, evidencias ni herramientas privadas de pruebas.
- Etiquetas: `/home/deploy/cronox-private/shipping-labels`, persistente y fuera de repositorio, releases y raíces públicas; propietario `deploy`, modo 0700. Lectura/escritura/borrado comprobados como `deploy`; el backend existente corre como root y tiene acceso por permisos Unix. Esto no equivale a haber iniciado un proceso de prueba root ni a haber leído su entorno privado. El directorio inicial vacío también se respaldó. Incluir este directorio junto con la base en los respaldos futuros.
- `CORREOS_TRACKING_ENABLED=false` y `CORREOS_EMAIL_ENABLED=false` conservados. Cero consultas registradas, eventos, etiquetas y avisos de Correos tras publicar. Salud y disponibilidad HTTP 200 en `cronox.es` y `www.cronox.es`; recursos JS publicados con hashes idénticos a los archivos desplegados. Los cuerpos de `/cuenta` y `/checkout` corresponden a las plantillas nuevas; sus cabeceras son las generadas por el middleware SEO existente. El administrador anónimo sigue siendo redirigido al inicio de sesión.
- Auditoría real de solo lectura con servicios compilados sobre los **22 pedidos existentes y 22 cuentas vinculadas**: identificadores y datos corresponden al pedido correcto, aislamiento exacto por comprador, sin campos privados de etiquetas/auditoría en la respuesta del cliente. Ningún pedido tiene seguimiento ni hay un caso existente adecuado para mostrar «Pendiente de enviar»; esos estados y el enlace están comprobados en pruebas locales, no mediante un envío ficticio en producción. Cuatro rutas privadas reales devuelven HTTP 401 sin sesión. Metadata y 25 decisiones de roles comprobadas sobre los guards compilados con contextos en memoria; esto no es navegación autenticada real en producción.
- Identidad desde el VPS: **una única petición real**, scope `TPB`, **HTTP 200** y JWT obtenido a las **17:30:11 UTC**. Token solo en memoria, sin mostrarlo ni guardarlo. **Cero consultas Trackpub y cero correos de prueba**. Esto no valida todavía la autorización Developers ni la respuesta de un envío real.
- El checkout local quedó limpio. Perfiles privados, respaldos y evidencias permanecen excluidos de Git. Se conservaron sin publicar la copia antigua remota `main.ts.cronox-before-stripe` y el respaldo de las diferencias generadas de dependencias que ya existían en el servidor.

## Primer envío real — procedimiento preparado, pendiente

1. Crear el primer envío real en el portal de Correos, como hasta ahora. Guardar su número en el pedido correcto de CRONOX; **el PDF es opcional**. Mantener ambos flags Correos desactivados durante esta preparación.
2. Con autorización para consultar ese envío real, ejecutar desde `cronox-backend` del servidor, utilizando exclusivamente su archivo privado existente:

   ```bash
   node scripts/verify-correos-trackpub.cjs --env .env --tracking NUMERO_REAL_DE_CORREOS
   ```

   El comprobador solicita JWT y consulta Trackpub; no inicia la aplicación ni conecta a base o SMTP. Muestra únicamente resultado agregado, sin secretos, identificadores ni respuesta cruda. Una referencia sin trazabilidad puede devolver un error documentado: no sustituirla por un envío ficticio para declarar acceso validado.
3. Revisar privadamente la respuesta real en un entorno controlado: `code` debe corresponder al envío, fechas/campos y códigos únicos deben concordar con el contrato y la matriz. Obtener de Correos zona horaria y cuota si siguen sin documentarse. No guardar respuestas con datos personales en Git ni en informes públicos.
4. Tras validar Developers, cuota, contrato y que los números existentes sean envíos reales, cambiar privadamente **solo** `CORREOS_TRACKING_ENABLED=true`, conservar `CORREOS_EMAIL_ENABLED=false` y reiniciar mediante el procedimiento de PM2 existente. Este cambio habilita tanto consultas manuales como automáticas para todos los pedidos elegibles; no es una activación limitada a un solo pedido. Comprobar el primer historial, enlace público, última sincronización y errores separados en administración y en la sesión del comprador correspondiente. El primer historial es la referencia, no una novedad masiva.
5. Contrastar hitos posteriores y el outbox, revisar la plantilla y el buzón ORDERS antes de autorizar `CORREOS_EMAIL_ENABLED=true` y reiniciar. Comprobar con ese primer envío real la recepción del aviso, su pedido/revisión y su único registro `SENT`; investigar `UNKNOWN` según el procedimiento anterior. La prueba de SMTP en loopback no valida la recepción en un buzón real ni la configuración de Correos Developers. No alterar los flags generales de correo o trabajos para activar Correos.

## Evidencias locales

- Suite final completa: **2.447 pruebas correctas en 239 suites**, sin fallos. Typecheck backend/administración y compilación del backend correctos. El perfil de Jest usa claves inertes; las pruebas de arranque de workers emplean reloj, base y remitente simulados.
- **17 comprobaciones con PostgreSQL real local** en el runner aislado y **4 pruebas SMTP reales de loopback**, sin buzones externos: saludo retenido, plazo vencido antes de conectar, DATA sin acuse y cierre del propietario TLS real tras STARTTLS. La base desechable fue eliminada y los servidores visuales/SMTP de revisión se cerraron.
- Pruebas unitarias: autenticación/minutos/`exp`, renovación concurrente, 401/403/429/5xx, timeout, tamaño y JSON; parser contra fixture del contrato oficial, fechas, desconocidos, orden y deduplicación.
- Pruebas de permisos HTTP y PDF: anónimo/cliente/ADMIN rechazados, SUPERADMIN autorizado; datos privados fuera de respuestas del cliente, firma/tamaño/hash y revisión obsoleta.
- PostgreSQL real local desechable: migración desde esquema HEAD y diferencia de esquema cero, RLS, dos clientes/pools, lease, corrección en vuelo, eventos, outbox, reinicios, etiquetas y aislamiento entre compradores. Se eliminó la base temporal. Transportista simulado y SMTP sustituido; evidencia agregada en `test-results/correos-tracking-db/results.json`, excluida de Git.
- UI revisada con Chromium y datos ficticios en escritorio/móvil y teclado. Capturas privadas en `output/playwright/correos-{admin,profile}-{desktop,mobile}.png`; no es prueba de dispositivo físico.

Validación real de Identidad realizada el 14/10/2026: una única petición `POST /Api/Authorize/Token`, scope `TPB`, devolvió **HTTP 200** y un JWT con estructura válida. Se usó el cliente del backend y las credenciales de Identidad cargadas desde `.env.local`. El token solo existió en memoria del proceso: no se mostró ni se persistió. Evidencia agregada privada: `test-results/correos-identity/jwt-check.json`.

También se verificaron la carga del par Developers, el directorio privado, lectura/escritura/borrado de un archivo de comprobación, exclusión de Git y conservación de flags locales desactivados. Cargar el par Developers no valida su autorización en Trackpub. No hubo consultas de envíos, conexiones SMTP ni conexiones a bases durante esta comprobación. El acceso Developers real, la respuesta de un envío real, los hitos reales, la cuota y la recepción de avisos reales siguen pendientes.
