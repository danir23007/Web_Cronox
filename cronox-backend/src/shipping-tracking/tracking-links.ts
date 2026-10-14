import { BadRequestException } from '@nestjs/common';

// Trackpub also accepts domestic references: do not assume every ID is S10.
export function normalizeCorreosTrackingNumber(input: string | null): string | null {
  if (input === null || input.trim() === '') return null;
  const number = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,80}$/.test(number)) {
    throw new BadRequestException('El seguimiento de Correos debe contener entre 5 y 80 letras o numeros, sin espacios');
  }
  return number;
}

// Public Correos localizador, never the credential-protected Trackpub endpoint.
export function buildCorreosTrackingUrl(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  return `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${encodeURIComponent(input.trim())}`;
}
