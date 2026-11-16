# Devolución al remitente: texto y motivo del evento

ORDER_RETURNED usa el asunto «CRONOX · Correos ha devuelto tu paquete del pedido
#{{orderId}}», el título «Correos ha devuelto tu paquete» y el texto solicitado de
devolución y contacto. El botón principal abre `mailto:support@cronox.es`. Debajo
figuran el código real y el enlace secundario a Correos, sin apariencia de botón.

La proyección de diseño aplica el cambio al editor, Preview, versiones activas
de los cinco círculos y respaldo de envío. Conserva la cabecera, logo, fondo y
estilos de título/superficies. No publica borradores, reescribe versiones ni
modifica el disparador, la identidad de evento o la deduplicación de los avisos.
El respaldo es exclusivo de ORDER_RETURNED; no cambia los otros correos logísticos.

## Origen del motivo

El contrato oficial retenido en `docs/integrations/correos/trackpub-2.0.4.yaml`
documenta `razonDes` como descripción de la razón del evento. La integración ya
usaba `razonCode`, `motiveCode` y `situationCode` para su huella, pero descartaba
`razonDes` y guardaba únicamente la descripción general en `label`.

Se conserva ahora la descripción concreta y legible de `razonDes` únicamente
para eventos RETURNED reconocidos, en `OrderTrackingEvent.returnReason`. La cola
lee el evento exacto de `job.eventId`, con comprobación de pedido y revisión;
solo usa motivos de ese evento RETURNED de Correos. No consulta eventos anteriores
ni interpreta códigos o estados como causas. Se omiten motivos vacíos, códigos
sin descripción, «Devuelto al remitente», «Por definir» y otros valores genéricos.

La migración `20261116090000_tracking_return_reason` añade una columna opcional.
Los registros históricos quedan NULL y no se completan por deducción. Las nuevas
lecturas de Correos conservan o actualizan la descripción del mismo evento, sin
crear una identidad nueva cuando cambia el texto. La línea condicional «Motivo
indicado por Correos: …» aparece inmediatamente después del primer párrafo.

## Comprobación

- 150 casos aprobados en ocho suites: contrato, motivo, cola, diseño, editor,
  versiones inmutables y envío con transporte en memoria.
- Cinco círculos con motivo, sin él, genérico, código sin descripción y vacío;
  asunto exacto, pedido en negrita, orden de párrafos, ambos enlaces y seguimiento
  real en la carga simulada. El enlace de Correos con parámetros se comprueba
  leyendo el atributo HTML, conservando la selección del diseño publicado.
- `verify-order-returned-local.cjs` comprueba los cinco documentos locales y sus
  versiones en transacción de solo lectura. HTML e informe quedan fuera de Git,
  en `output/playwright/order-returned/`. La instalación local tiene las cinco
  copias de esta finalidad en borrador y ninguna publicada.
- Sin revisión visual, capturas ni correos reales. La migración local aditiva
  se aplicó mediante el lanzador habitual, con correo y trabajos desactivados.

La publicación autorizada utiliza Deploy CRONOX, CI del commit exacto, respaldo,
migración aditiva y comprobaciones habituales de salud y revisión del servidor.
