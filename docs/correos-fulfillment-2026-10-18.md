# Correos: admisión, aviso de envío y lotes — 18/10/2026

## Resultado y límite operativo

Este cambio reutiliza Trackpub, el worker, la vinculación sobre `Order`, la cola `OrderTrackingNotification`, la plantilla `order-tracking.hbs` y el remitente transaccional ORDERS. No crea envíos ni etiquetas en Correos. El PDF sigue siendo opcional.

Auditoría independiente de producción por SSH, solo lectura: versión funcional `121736dd70d5f31e2757c158bc1250706a0a23ad`, cero pedidos con seguimiento, cero eventos y cero avisos; las cuatro credenciales están presentes y `CORREOS_TRACKING_ENABLED=false`, `CORREOS_EMAIL_ENABLED=false`. No existe un envío legítimo vinculado para verificar Developers/Trackpub. El HTTP 200 de Identidad documentado el 14/10 **no acredita una consulta de seguimiento**. No se ha enviado correo de prueba, creado una etiqueta ni consultado un código inventado.

Por esta dependencia externa, publicar el código conserva ambos interruptores desactivados. La activación requiere consultar un envío real asociado expresamente al pedido correcto, contrastar los códigos de respuesta con la matriz y revisar la cuota concedida. No presentar el flujo como operativo hasta cerrar esa verificación.

## Uso en administración

Solo SUPERADMIN, con sesión, identidad vigente y protección CSRF en las escrituras.

1. Individual: Pedidos → Gestionar → transportista Correos → código → Guardar. El enlace se construye hacia el localizador oficial. Guardar no marca enviado ni genera aviso. Sustituir o quitar un código existente requiere confirmación explícita y revisión vigente; queda auditoría del actor y de ambos códigos.
2. Lote: «Asociar códigos por lote». Pegar o importar CSV/TSV de dos columnas, sin comillas CSV, con pares explícitos `ID de pedido CRONOX;código Correos`, una fila por pedido. Se admite tabulador o coma como separador. Máximo 100 filas y archivo de 64 KiB. Cabecera opcional `orderId,trackingNumber`.
3. «Cargar filas», editar la tabla y «Validar y previsualizar». Cada fila informa del error o de su resultado. IDs/códigos repetidos invalidan todas las filas en conflicto. Se comprueban pedido, estado, presencial/recogida, código duplicado y revisión. «Guardar filas válidas de la vista previa» guarda exclusivamente las filas válidas indicadas; cualquier edición invalida la vista previa. Las sustituciones se realizan individualmente.
4. Las casillas, «Seleccionar solo los pedidos de esta página» y el contador se limitan a la página visible. Cambiar de página/filtro o recargar limpia la selección. «Sincronizar seguimiento seleccionados» congela esos IDs y muestra actualizado/sin cambios/error por pedido. Procesa peticiones acotadas por pedido para mostrar progreso y evitar una petición HTTP larga. No busca pedidos por ID de usuario, destinatario, nombre o email.
5. La acción manual existente se llama «Marcar enviado manualmente (sin verificar Correos)». Exige confirmación, permiso SUPERADMIN y auditoría de estado/actor. Sigue siendo una intervención manual con su aviso transaccional existente; no equivale a confirmación del transportista. No se ha añadido acción masiva manual.

## Estados y fechas

- Código/etiqueta y preadmisión: «Pendiente de entregar a Correos»; pedido PAID/PROCESSING intacto, sin correo.
- Admisión física: `A010000V`, `A050000V` o `A050020V` exactos → SHIPPED. Matriz oficial descargada otra vez el 18/10, SHA-256 `1006b40afd62e0465d0f4c2470b73770e85c773093f6dfac26d25ac724b2c974`, idéntica a la versión revisada. Las filas nuevas se conservan literalmente en `docs/integrations/correos/matrix-reviewed-subset-20251009.json`.
- Una primera respuesta de tránsito `C010000V`, `E020000V`, `F010000V`, `G010000V`, o reparto `H020000V`/`H250000V`, también acredita envío físico. Se busca la admisión en todo el historial. Sin ella se marca enviado sin inventar fecha ni emitir automáticamente un aviso de fecha ambigua.
- Entrega al destinatario/autorizado `I010000V` → DELIVERED. Devolución al remitente `I020000V` e incidencias `O07A010R`/`O07A030R` conservan su significado distinto. No se deducen eventos de textos o fases. Los códigos no revisados se conservan sin clasificar.
- La proyección del estado físico no retrocede por eventos repetidos, atrasados o preadmisiones contradictorias. Se conserva el código y el enlace tras entregar. Una consulta vacía o fallida conserva el historial.
- Trackpub no documenta zona horaria: `eventTime` permanece null, se conservan las fechas locales validadas de Correos en los eventos y los hitos `trackingAdmissionLocalAt`/`trackingDeliveryLocalAt`, visibles para administrador y comprador. `trackingLastSuccessAt` es la consulta, nunca la fecha de admisión. `shippedAt`/`deliveredAt` solo se completan con un instante fiable, sin sobrescribir valores previos. No se añade una Z inventada a horas locales.
- Cancelados, reembolsados, disputados, pendientes de pago, presenciales y recogidas quedan fuera. La elegibilidad se vuelve a comprobar bajo bloqueo tras la llamada externa. No se invocan cobros, stock, promociones ni reparaciones financieras desde el seguimiento.

## Cola, corte y reintentos

La migración aditiva `20261018180000_correos_fulfillment` crea el corte persistente `CorreosTrackingGate.SHIPPED_EMAIL_CUTOFF` una sola vez, conserva todas las asociaciones, añade hitos/revisión y dos índices: código Correos único entre pedidos y un único aviso SHIPPED por pedido/revisión. Duplicados históricos bloquearían la instalación, sin elegir ni borrar asociaciones. Cancela avisos pendientes del flujo antiguo de otros hitos; no cambia aceptaciones SMTP previas.

La transición y su aviso se confirman en la misma transacción bajo bloqueo de pedido. Solo se encola categoría SHIPPED y el remitente descarta categorías antiguas. No hay correos automáticos de reparto, entrega o incidencias. Correos, ID CRONOX, código y botón oficial son obligatorios; una plantilla gestionada que pierda esos campos usa la plantilla de respaldo.

Pedidos creados y vinculados después del corte pueden avisar al recibir admisión exacta. Una fecha claramente histórica se retiene incluso en estos pedidos. Para pedidos anteriores, la admisión debe quedar inequívocamente después del corte: instante fiable o fecha local cuyo intervalo completo de posibles offsets ±14 horas sea posterior. Falta de fecha/zona, primera consulta ya entregada y admisión antigua quedan en `trackingNotificationReview`, visible en listado/detalle; no se reencolan al repetir consultas. No se reinicia el corte al reiniciar workers. Revisar estos casos privadamente; no existe un botón que los drene masivamente.

El outbox reclama mediante actualización condicional; la revisión y la elegibilidad se verifican antes de SMTP. El bloqueo se mantiene durante un transporte acotado a 20 s. Rechazos demostrados reintentan con espera 1, 2, 4… minutos hasta 24 horas; la cuota del buzón conserva su `retryAt`. Solo una aceptación confirmada pasa a SENT. Resultado SMTP incierto o caída tras posible aceptación → UNKNOWN para conciliación, sin reenvío ciego. El detalle muestra estado e intentos de la cola. Una nueva revisión invalida consultas y avisos anteriores.

## Programación

Worker del servidor cada 10 segundos; consulta cada envío elegible cada 30 minutos por defecto (`CORREOS_SYNC_INTERVAL_SECONDS=1800`), independientemente de navegadores abiertos. Concurrencia global entre procesos 2, separación de consultas 1 s, enfriamiento manual 60 s. Son límites operativos propios, no una cuota atribuida a Correos. `Retry-After` 429/503 se persiste para todos los procesos. Fallos: 1, 2, 4… minutos hasta 24 horas. Token en memoria, renovación compartida entre peticiones y un reintento tras 401; un 403 persistente no genera renovaciones infinitas. Tras entrega/devolución se revisa diariamente durante 7 días, configurable; después sigue disponible la consulta manual.

## Validación y publicación

Runner `node cronox-backend/scripts/test-correos-tracking-db.cjs`: PostgreSQL local desechable, dos clientes/pools y proveedores simulados. Comprueba migración real, diferencia de esquema cero, privacidad RLS, admisión, ausencia de aviso por preadmisión, deduplicación, bloqueo, sustitución en vuelo, almacenamiento PDF opcional, cuotas compartidas, recuperación UNKNOWN, separación de compradores, recogidas/presenciales, primera entrega avanzada, ausencia de regresiones/fechas inventadas, histórico retenido, cancelación en vuelo, recuperación 429, lotes, revisiones y carreras de asociación/envío de avisos. Elimina exclusivamente su base temporal. Prohíbe HTTP externo y SMTP real.

Pruebas locales: **2.840 pruebas Jest en 265 suites, todas correctas**; **25 comprobaciones PostgreSQL correctas**, base temporal eliminada; typecheck de backend/administración y ambos builds correctos. Contrato oficial, tokens/renovación/errores, política del corte, reintentos del aviso, límites y permisos HTTP de lotes y comportamiento DOM (selección de página, ID de pedido frente a usuario, vista previa, doble clic, modificación posterior y errores literales). Revisión Chromium con CSV ficticio, escritorio y móvil 390 px; no es prueba en un teléfono físico ni una sesión productiva. La generación local del cliente escribió los tipos pero informó del bloqueo EPERM de la DLL de Windows en uso; el cliente generado pasó typecheck, build y las pruebas con dos conexiones reales. No se detuvieron procesos ajenos. CI/Linux vuelve a generar el cliente antes de las pruebas.

El titular confirmó que todavía no dispone de una etiqueta real. No se necesita otra autorización para publicar la interfaz y las protecciones con ambos flags de Correos desactivados; falta el dato real para la prueba externa, no un permiso para hacer el trabajo restante.

La publicación usa únicamente `Deploy CRONOX`, con CI del SHA exacto, mantenimiento, parada de escritores, respaldo y restauración/comparación aislada, migración y reapertura mediante el controlador ya instalado. No se sustituye ese procedimiento por npm/migraciones/PM2 manuales. Las comprobaciones productivas posteriores se añaden al cierre de este documento.

Fuentes: [integración API de Correos](https://www.correos.es/es/es/empresas/ecommerce/refuerza-la-logistica-de-tu-ecommerce/integracion-api), [Trackpub oficial](https://anypoint.mulesoft.com/exchange/portals/sociedad-estatal-correos/c9ca99ed-6681-402c-811e-5ebc907e6b46/trackpub/), [contrato y límites conservados](integrations/correos/contract-notes-2026-10-14.md). El procedimiento de impresión/colocación de la etiqueta en oficina depende del contrato de Correos: este cambio no acredita que la oficina ofrezca ese servicio concreto.
