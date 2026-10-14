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
        | 'OUT_FOR_DELIVERY'
        | 'DELIVERED'
        | 'RETURNED'
        | 'INCIDENT';
      description: string;
    }
  >
> = {
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
