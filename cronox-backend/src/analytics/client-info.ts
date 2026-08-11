import { DeviceClass } from '@prisma/client';
import type { Request } from 'express';

export type ParsedClientInfo = {
  browserFamily: string;
  browserMajorVersion: string | null;
  osFamily: string;
  deviceClass: DeviceClass;
};

export function parseClientInfo(req: Request): ParsedClientInfo {
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 512);
  const mobileHint = String(req.headers['sec-ch-ua-mobile'] ?? '');
  const platformHint = String(req.headers['sec-ch-ua-platform'] ?? '')
    .replace(/["']/g, '')
    .slice(0, 40);

  const browserMatchers: Array<[string, RegExp]> = [
    ['Edge', /Edg\/(\d+)/],
    ['Opera', /(?:OPR|Opera)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ];
  const browser = browserMatchers
    .map(([family, pattern]) => ({ family, match: ua.match(pattern) }))
    .find((candidate) => candidate.match);

  const osFamily = platformHint ||
    (/Android/i.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua)
        ? 'iOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/i.test(ua)
            ? 'macOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Other');

  const deviceClass = /iPad|Tablet/i.test(ua)
    ? DeviceClass.TABLET
    : mobileHint === '?1' || /Mobile|Android|iPhone|iPod/i.test(ua)
      ? DeviceClass.MOBILE
      : ua
        ? DeviceClass.DESKTOP
        : DeviceClass.OTHER;

  return {
    browserFamily: browser?.family ?? 'Other',
    browserMajorVersion: browser?.match?.[1]?.slice(0, 12) ?? null,
    osFamily,
    deviceClass,
  };
}
