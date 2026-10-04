import { BadRequestException } from '@nestjs/common';
import { addresses } from './mailbox-security';

export function circles(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > 5 ||
    value.some((v) => !Number.isInteger(v) || v < 1 || v > 5)
  )
    throw new BadRequestException('MAILBOX_INVALID_CIRCLES');
  return [...new Set(value)].sort();
}
export function canonicalRecipient(value: string): string | null {
  try {
    const list = addresses(value, false);
    return list.length === 1 ? list[0].toLowerCase() : null;
  } catch {
    return null;
  }
}
// Resolve Madrid wall time independently of the host/browser timezone. A repeated
// autumn hour requires an explicit UTC offset; a nonexistent spring hour is invalid.
export function madridInstant(
  local: string,
  offset?: string,
  now = new Date(),
): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new BadRequestException('MAILBOX_INVALID_MADRID_DATE');
  const naive = Date.parse(local + ':00Z');
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const matches = [1, 2]
    .map((h) => ({ date: new Date(naive - h * 3600000), offset: `+0${h}:00` }))
    .filter(
      (v) =>
        Number.isFinite(v.date.getTime()) &&
        formatter.format(v.date).replace(' ', 'T') === local,
    );
  if (!matches.length)
    throw new BadRequestException('MAILBOX_MADRID_TIME_DOES_NOT_EXIST');
  if (matches.length > 1 && !offset)
    throw new BadRequestException('MAILBOX_MADRID_TIME_AMBIGUOUS');
  const chosen = offset ? matches.find((v) => v.offset === offset) : matches[0];
  if (!chosen) throw new BadRequestException('MAILBOX_INVALID_MADRID_OFFSET');
  if (chosen.date <= now)
    throw new BadRequestException('MAILBOX_SCHEDULE_IN_PAST');
  return chosen.date;
}
export function assertResolved(...contents: string[]) {
  if (contents.some((s) => /\{\{/.test(s)))
    throw new BadRequestException('MAILBOX_TEMPLATE_VARIABLES_UNRESOLVED');
}
export function campaignPolicy() {
  const integer = (name: string, fallback: number, max: number) => {
    const v = Number(process.env[name] || fallback);
    return Number.isInteger(v) && v > 0 && v <= max ? v : 0;
  };
  const daily = integer('MAILBOX_CAMPAIGN_DAILY_LIMIT', 0, 3000);
  const hourly = integer('MAILBOX_CAMPAIGN_HOURLY_LIMIT', 0, 3000);
  const rawHourly = process.env.MAILBOX_CAMPAIGN_HOURLY_LIMIT;
  const hourlyValid = !rawHourly || (Number(rawHourly) === 0 || hourly > 0);
  const reserve = 0; // Capacity belongs to Information; no reservation for other mailboxes.
  const interval = integer('MAILBOX_CAMPAIGN_INTERVAL_SECONDS', 30, 86400);
  const enabled = process.env.MAILBOX_CAMPAIGN_ENABLED === 'true';
  const verified = process.env.MAILBOX_CAMPAIGN_PROVIDER_VERIFIED === 'true';
  const origin = process.env.API_PUBLIC_URL || '';
  const reasons = [
    !enabled && 'Campañas desactivadas en el servidor.',
    !verified && 'Pendiente confirmar plan, límites y alineación en Hostinger.',
    (!daily || !interval || interval < 30 || !hourlyValid) &&
      'Faltan límites válidos (pausa mínima: 30 segundos).',
    !/^https:\/\//.test(origin) && 'Falta URL HTTPS pública para la baja.',
  ].filter(Boolean) as string[];
  return {
    ready: !reasons.length,
    reasons,
    daily,
    hourly,
    reserve,
    interval,
    origin,
  };
}
