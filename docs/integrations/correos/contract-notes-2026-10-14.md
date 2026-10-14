# Contrato Correos consultado el 14 de octubre de 2026

## Fuentes y procedencia

- [Página oficial de integración API](https://www.correos.es/es/es/empresas/ecommerce/refuerza-la-logistica-de-tu-ecommerce/integracion-api): enlaza las guías de autenticación y la matriz de eventos.
- [Trackpub publicado por Correos en Anypoint Exchange](https://anypoint.mulesoft.com/exchange/portals/sociedad-estatal-correos/c9ca99ed-6681-402c-811e-5ebc907e6b46/trackpub/): versión pública del artefacto 2.0.4. La especificación interna conserva `info.version: 2.0.1`; no se ha corregido esa discrepancia del proveedor.
- [Descarga oficial del OpenAPI](https://anypoint.mulesoft.com/exchange/files/api/v1/organizations/c9ca99ed-6681-402c-811e-5ebc907e6b46/assets/c9ca99ed-6681-402c-811e-5ebc907e6b46/trackpub/2.0.4/oas/zip): HTTP 200 sin credenciales. SHA-256 original de `trackpub.yaml` del ZIP: `4b763e8b2c1c0f9a8951194d407389d494db913c0ba9cc99b6be55077bd2a2ad`. La copia `trackpub-2.0.4.yaml` sustituye sus seis ejemplos de cabeceras `client_id`, `client_secret` y `Authorization` por placeholders y elimina espacios al final de línea; SHA-256 de la copia redactada: `147caa16c2824cae517515814da450ad444c29a017c7966a22ce01ccb88b35f3`. El esquema y los ejemplos de respuesta permanecen literales.
- [Matriz oficial de eventos, 09/10/2025](https://www.correos.es/content/dam/correos/documentos/herramientas/m%C3%B3dulos/integracion-por-ficheros/integraci%C3%B3n-api/Matriz_eventos_20251009.xlsx): HTTP 200; SHA-256 del XLSX `1006b40afd62e0465d0f4c2470b73770e85c773093f6dfac26d25ac724b2c974`. Hoja `Sheet1`, 781 filas de eventos. `matrix-reviewed-subset-20251009.json` conserva las once filas revisadas y los nombres originales de sus columnas.
- [Obtención y uso de Token para acceder a las APIs de Correos](https://www.correos.es/content/dam/correos/documentos/herramientas/m%C3%B3dulos/integracion-por-ficheros/integraci%C3%B3n-api/Obtenci%C3%B3n%20y%20uso%20de%20Token%20para%20acceder%20a%20las%20APIs%20de%20Correos%20v1_ES_EN.pdf), páginas 2 y 3.
- [Uso OAuth 2.0 para acceder a las APIs de Correos](https://www.correos.es/content/dam/correos/documentos/herramientas/m%C3%B3dulos/integracion-por-ficheros/integraci%C3%B3n-api/Uso%20OAuth%202.0%20para%20acceder%20a%20las%20APIs%20de%20Correos%20v1_ES_EN.pdf), página 2.

Los ejemplos de credenciales y Bearer del proveedor se han redactado incluso siendo públicos, para evitar guardar claves o tokens de ejemplo en Git. La copia no contiene credenciales de CRONOX, tokens obtenidos ni respuestas de un envío real.

## Autenticación

La guía confirma `POST https://apioauthcid.correos.es/Api/Authorize/Token`, formulario `client_credentials`, credenciales de CorreosID y `scope`. Indica `Content-Type: application/x-www-form-urlencoded` y cabecera `Accept-Language`. La respuesta contiene `idToken`, `tokenType` y `expiresIn`; este último se expresa en **minutos**. El ejemplo 30 corresponde a treinta minutos. No existe refresh token: se solicita otro token.

La guía OAuth distingue las credenciales de Identidad de las credenciales obtenidas al solicitar acceso a la API en Developers. Trackpub exige estas últimas en `client_id` y `client_secret`, además de `Authorization: Bearer <token>`.

Un 401 o 403 puede indicar token caducado; si todavía es válido también puede indicar un token incorrecto para esa API. CRONOX no debe interpretar un 403 persistente como motivo para renovar indefinidamente. Leer `exp` para limitar la caché no constituye validación criptográfica.

## Petición y respuesta documentadas

El OpenAPI especifica servidor `https://api1.correos.es/support/trackpub/api/v2`, operación `GET /search/{shippingCode}`, sin cuerpo. `languageCode` es un parámetro opcional; incluye `ES`. La descripción menciona un máximo de 100 envíos por petición, pero no define su codificación en el parámetro: esta integración consulta un único seguimiento por petición.

HTTP 200 devuelve un **objeto** `SearchResponseDTO`. Entre las propiedades documentadas están:

| Propiedad | Tipo / significado documentado |
| --- | --- |
| `code` | string, código del envío |
| `events` | array de eventos |
| `eventResume` | string, descripción resumen del evento |
| `eventUniqueCode` | string, código único de evento |
| `has_incidence` | string, indicador de incidencia; ejemplo `N` |
| `error` | array con `codError` y `desError`, ambos string |

Cada evento contiene, entre otros, `eventDate`, `eventHours`, `eventCode`, `eventDes`, `phase`, `phaseDes`, `summaryText`, `expandedText`, `uniqueCode`, `motiveCode`, `situationCode`, `razonCode`, `razonDes`, `location`, `unit`, `province` y `country`, todos string. No se declaran campos `required`, enumeraciones de errores ni un formato de fecha formal.

El esquema también puede incluir datos personales, direcciones, teléfonos, documentación y datos económicos ajenos a la finalidad del seguimiento. La integración debe seleccionar únicamente los campos necesarios; no devolver ni registrar el objeto completo.

El ejemplo oficial del envío mezcla `PRE-ADMISION`, fase `1` y texto de fase `ENTREGADO`. Es un ejemplo de forma, no una secuencia logística coherente. La proyección mínima se conserva en `search-response-official-example.json`; el código único de ese ejemplo es desconocido y debe permanecer sin clasificar.

## Fechas, orden y campos incompletos

Los ejemplos usan `eventDate: "25/03/2022"` y `eventHours: "12:09:16"`. No hay zona horaria, offset ni garantía UTC en el OpenAPI ni en la matriz. Conservar ambos literales y ordenar por sus componentes de calendario validados; no añadir una `Z` ni presentar una fecha UTC inventada. Los eventos sin fecha interpretable deben conservarse para revisión, sin desplazar un hito con fecha posterior verificable.

El dominio de `has_incidence` no está enumerado: solo se documenta el ejemplo `N`. No basta para interpretar cualquier valor distinto como una incidencia logística. Tampoco un error HTTP, `error[]`, una respuesta vacía o un envío no encontrado equivalen a una incidencia de transporte. No deben borrar eventos previamente guardados.

## Clasificación conservadora por código exacto

La matriz tiene `cod_unico` (columna C), código de fase (columna D, encabezado `des_fase`), etiqueta de fase (E, encabezado `fase`), visibilidad (F), resumen (G), descripción española (H) y `cod_evento2` (W). Se relaciona el campo documentado `uniqueCode`, «Código evento único», con `cod_unico`. Esta correspondencia debe contrastarse con la primera respuesta real de Trackpub; no se ha consultado todavía con las credenciales Developers de CRONOX.

El subconjunto revisado implementa únicamente:

| `uniqueCode` exacto | Categoría CRONOX |
| --- | --- |
| `A010000V` | ADMITTED |
| `H020000V`, `H250000V` | OUT_FOR_DELIVERY |
| `I010000V` | DELIVERED, destinatario/autorizado |
| `I020000V` | RETURNED, entregado al remitente |
| `O07A010R`, `O07A030R` | INCIDENT, no localizado/sustraído |

Las categorías son decisiones de integración sustentadas en esas filas exactas, no una taxonomía adicional atribuida al proveedor. El resto de códigos se conserva con sus datos originales y sin equivalencias deducidas del texto. Tener seguimiento/etiqueta o un evento de preadmisión no prueba admisión física.

No se puede concluir entrega al cliente ni fin de consultas únicamente por fase `4`: la matriz incluye en ella devoluciones al remitente (`I01H230V`), entrega a intermediario (`I01E410V`) y comienzo de devolución por caducidad de recogida (`X400000R`). El mismo `cod_evento2` agrupa situaciones distintas; tampoco sirve como sustituto del código único.

La matriz no define un protocolo de finalización irrevocable ni un plazo de correcciones. Cualquier ventana de comprobación posterior a entrega/devolución y su posterior parada automática es una política operativa configurable de CRONOX; no debe anunciarse como garantía de Correos. La consulta manual debe permitir revisar correcciones posteriores sin alterar pago, cancelación, devoluciones económicas ni stock del pedido.

## Límites y errores

La documentación pública confirma que Trackpub aplica Rate Limiting, pero no publica una cuota numérica por minuto/hora para este acceso. Frecuencia, concurrencia y espera entre consultas configuradas por CRONOX son límites propios. Respetar `Retry-After` cuando llegue y solicitar a Correos el nivel de uso concedido antes de activar producción.

El OpenAPI documenta HTTP 400, 401, 404 y 500, con objeto de error `title`/`body`. Que 403, 429 u otros 5xx no figuren allí no impide manejarlos de forma defensiva, sin interpretar su cuerpo como un evento. No se deben incluir cuerpos de error, cabeceras de autenticación ni URLs privadas con credenciales en logs o respuestas.

## Enlace público oficial

Formato verificado en el código público actual de Correos:

`https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=<numero-codificado>`

El [modelo público del localizador](https://www.correos.es/content/correos/es/es/herramientas/localizador.model.json) define `shippinglocatorhome.urlNavigate` como la ruta de detalle. El [bundle oficial consultado](https://www.correos.es/etc.clientlibs/correos/clientlibs/clientlib-react.min.e2afa838c9220b03be8010751d26502d.js) añade `?tracking-number=` al enviar la búsqueda y la vista de detalle lee ese parámetro mediante `URLSearchParams`. Se comprobó HTTP 200 sin redirección con un identificador ficticio; eso valida la ruta, no la existencia de un envío.

Codificar el número al formar la URL, mantener el enlace después de la entrega y no usar la URL privada Trackpub como destino del cliente.

## Pendiente de evidencia real

- Primera respuesta Trackpub con las credenciales Developers concedidas: objeto y tipo real de campos, correspondencia `uniqueCode`/matriz, campos vacíos/errores y cabeceras de cuota.
- Confirmación de zona horaria del proveedor y de semántica de fechas internacionales. Hasta entonces se conservan literales, sin convertirlos a UTC.
- Cuota concreta concedida, diccionario completo de códigos de error, valores posibles de `has_incidence` y política de correcciones/finalización del proveedor.
- Una respuesta real de admisión, reparto, entrega o incidencia para cada categoría que se pretenda dar por verificada en funcionamiento real. Los fixtures locales basados en contrato siguen siendo simulaciones.

No se ha solicitado JWT ni consultado un envío mediante Trackpub durante esta investigación; las únicas solicitudes fueron GET de documentación y recursos públicos.
