import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UserAccountState } from '@prisma/client';
import * as QRCode from 'qrcode';
import { getPublicApiUrl } from '../common/config/environment';

// Existing tokens are preserved byte-for-byte. Prefix identifies this payload
// as an accreditation, never an authentication token or an external URL to fetch.
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
export const accreditationPayload = (token: string) => `CRX:1:${token}`;
export const accreditationName = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().split(/\s+/u).filter(Boolean).slice(0, 2).join(' ')
    : '';

export function parseAccreditationPayload(content: string): string {
  const invalid = () =>
    new BadRequestException({
      code: 'INVALID_QR',
      message: 'QR no válido o desconocido',
    });
  if (
    typeof content !== 'string' ||
    content.length > 512 ||
    content !== content.trim()
  )
    throw invalid();
  if (content.startsWith('CRX:1:')) {
    const token = content.slice(6);
    if (TOKEN.test(token)) return token;
    throw invalid();
  }
  // Legacy printed cards used the configured API origin and /api/m/:token.
  // Validate the entire canonical URL. Never navigate, redirect or fetch it.
  try {
    const url = new URL(content);
    const base = new URL(getPublicApiUrl());
    const prefix = base.pathname.replace(/\/$/, '') + '/api/m/';
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(prefix)
    )
      throw invalid();
    const token = url.pathname.slice(prefix.length);
    if (!TOKEN.test(token) || content !== `${getPublicApiUrl()}/api/m/${token}`)
      throw invalid();
    return token;
  } catch {
    throw invalid();
  }
}

export function assertUsableAccreditation(user: {
  accountState: UserAccountState;
  circleLevel: number;
}): void {
  if (
    user.accountState !== UserAccountState.ACTIVE ||
    !Number.isInteger(user.circleLevel) ||
    user.circleLevel < 1 ||
    user.circleLevel > 5
  ) {
    throw new UnprocessableEntityException({
      code: 'CREDENTIAL_UNUSABLE',
      message: 'Credencial no utilizable',
    });
  }
}

export function renderAccreditationQr(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    type: 'image/png',
    width: 592,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#49212c', light: '#e9d8c4' },
  });
}
