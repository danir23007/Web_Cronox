import { BadRequestException } from '@nestjs/common';

const ALLOWED_INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);
const ALLOWED_POST_PATHS = new Set(['p', 'reel', 'tv']);

export const normalizeInstagramPostUrl = (
  value: string | null | undefined,
): string | null => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split('/').filter(Boolean);
    const isValidPostId = /^[A-Za-z0-9_-]+$/.test(segments[1] || '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !ALLOWED_INSTAGRAM_HOSTS.has(url.hostname.toLowerCase()) ||
      !ALLOWED_POST_PATHS.has(segments[0]) ||
      !isValidPostId
    ) {
      throw new Error('unsafe');
    }
    return url.toString();
  } catch {
    throw new BadRequestException(
      'El enlace debe ser una publicacion HTTPS valida de Instagram',
    );
  }
};
