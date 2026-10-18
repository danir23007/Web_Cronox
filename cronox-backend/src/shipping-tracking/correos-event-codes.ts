/**
 * Reviewed exact `cod_unico` values from Correos' public Matrix 2025-10-09.
 * Source and verbatim rows: docs/integrations/correos/matrix-reviewed-subset-20251009.json.
 * Match Trackpub `uniqueCode` only; phase, text and eventCode are insufficient.
 */
export const CORREOS_EVENT_CODES: Readonly<
  Record<
    string,
    {
      category:
        | 'ADMITTED'
        | 'IN_TRANSIT'
        | 'OUT_FOR_DELIVERY'
        | 'DELIVERED'
        | 'RETURNED'
        | 'INCIDENT';
      description: string;
    }
  >
> = {
  I01H230V: { category: 'RETURNED', description: 'Envío devuelto al remitente en oficina' },
  O200000R: { category: 'INCIDENT', description: 'Envío con posible demora en la entrega por problemas climatológicos' },
  A050000V: { category: 'ADMITTED', description: 'El envío ha tenido admisión en origen' },
  A050020V: { category: 'ADMITTED', description: 'El envío ha tenido admisión en el centro logístico de origen' },
  C010000V: { category: 'IN_TRANSIT', description: 'El envío ha salido del centro logístico internacional de origen y se ha cursado a destino' },
  E020000V: { category: 'IN_TRANSIT', description: 'Finalizada tramitación de importación, envío en curso hacía el destinatario' },
  F010000V: { category: 'IN_TRANSIT', description: 'El envío ha salido de la centro logístico internacional de destino para su entrega' },
  G010000V: { category: 'IN_TRANSIT', description: 'El envío ha entrado en la unidad responsable de su entrega' },
  A010000V: {
    category: 'ADMITTED',
    description: 'El envío ha tenido admisión en origen',
  },
  H020000V: {
    category: 'OUT_FOR_DELIVERY',
    description: 'Envío en reparto para su entrega',
  },
  H250000V: {
    category: 'OUT_FOR_DELIVERY',
    description: 'En reparto para su entrega al destinatario',
  },
  I010000V: {
    category: 'DELIVERED',
    description: 'Envío entregado al destinatario o autorizado',
  },
  I020000V: {
    category: 'RETURNED',
    description: 'Se ha entregado el envío al remitente',
  },
  O07A010R: {
    category: 'INCIDENT',
    description: 'Envío no localizado',
  },
  O07A030R: {
    category: 'INCIDENT',
    description: 'Envío sustraído',
  },
};
