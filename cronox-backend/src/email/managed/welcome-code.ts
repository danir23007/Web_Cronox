import { BadRequestException } from '@nestjs/common';

export const EXAMPLE_WELCOME_CODE = /CRX-EJEMPLO|BIENVENIDA10|C[ÓO]DIGO DE EJEMPLO/i;
export function requireWelcomeCode(value: unknown, realSend = false): string {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!code || EXAMPLE_WELCOME_CODE.test(code) || (realSend && /VISTA-PREVIA|NO-VALIDO/i.test(code))) {
    throw new BadRequestException({ code: 'WELCOME_CODE_REQUIRED', message: 'La bienvenida requiere el código personal real del cliente. Revisa su asignación antes de reintentar.' });
  }
  return code;
}
