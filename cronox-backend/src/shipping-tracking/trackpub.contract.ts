import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CorreosApiError } from './trackpub.client';
import { CORREOS_EVENT_CODES } from './correos-event-codes';

export type TrackingCategory = 'ADMITTED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNED' | 'INCIDENT';
export type TrackingEvent = {
  fingerprint: string; eventTime: Date | null; eventLocalDate: string | null;
  eventSortKey: string | null; code: string | null; label: string | null; category: TrackingCategory | null;
};
const text = (value: unknown, max = 600): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

// The OAS specifies a local DD/MM/YYYY date + HH:mm:ss, but NO time zone.
// Keep that representation; never invent an absolute UTC timestamp.
export function correosLocalDate(day: string | null, time: string | null) {
  if (!day || !time || !/^\d{2}\/\d{2}\/\d{4}$/.test(day) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;
  const [date, month, year] = day.split('/').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date || hour > 23 || minute > 59 || second > 59) return null;
  return { local: `${day} ${time}`, sort: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}T${time}` };
}

/** Contract: official Trackpub 2.0.4 OAS SearchResponseDTO, retained in docs. */
@Injectable()
export class TrackpubContract {
  readonly ready = true;
  parse(payload: unknown, expectedNumber?: string): TrackingEvent[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new CorreosApiError('INVALID_TRACKPUB_RESPONSE');
    const body = payload as Record<string, unknown>;
    if (expectedNumber && text(body.code) && text(body.code)?.toUpperCase() !== expectedNumber.toUpperCase()) throw new CorreosApiError('TRACKING_NUMBER_MISMATCH');
    if (!('events' in body) && !('error' in body)) throw new CorreosApiError('INVALID_TRACKPUB_RESPONSE');
    if (body.error !== undefined && !Array.isArray(body.error)) throw new CorreosApiError('INVALID_TRACKPUB_RESPONSE');
    if (Array.isArray(body.error) && body.error.length) {
      const first = body.error[0] as Record<string, unknown>;
      const code = text(first?.codError, 32);
      // Carrier API errors are synchronization failures, never logistics events.
      throw new CorreosApiError(code && /^[a-z0-9_-]+$/i.test(code) ? `TRACKPUB_REPORTED_${code}` : 'TRACKPUB_REPORTED_ERROR');
    }
    if (body.events === undefined) return [];
    if (!Array.isArray(body.events) || body.events.length > 1000) throw new CorreosApiError('INVALID_TRACKPUB_RESPONSE');
    const events = body.events.map((item): TrackingEvent => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CorreosApiError('INVALID_TRACKPUB_EVENT');
      const event = item as Record<string, unknown>;
      const code = text(event.uniqueCode, 80);
      const local = correosLocalDate(text(event.eventDate), text(event.eventHours));
      const label = text(event.eventDes) || text(event.summaryText) || code;
      const mapped = code ? CORREOS_EVENT_CODES[code as keyof typeof CORREOS_EVENT_CODES] : undefined;
      // A corrected description does not create a new event/email for the same ID/date.
      const identity = [code, text(event.eventCode, 80), text(event.eventDate), text(event.eventHours), text(event.razonCode, 80), text(event.motiveCode, 80), text(event.situationCode, 80)];
      if (!identity.some(Boolean) && !label) throw new CorreosApiError('INVALID_TRACKPUB_EVENT');
      return { fingerprint: createHash('sha256').update(JSON.stringify(identity.some(Boolean) ? identity : [label])).digest('hex'),
        eventTime: null, eventLocalDate: local?.local || [text(event.eventDate), text(event.eventHours)].filter(Boolean).join(' ') || null,
        eventSortKey: local?.sort || null, code, label, category: mapped?.category as TrackingCategory || null };
    });
    return [...new Map(events.map(event => [event.fingerprint, event])).values()]
      .sort((a, b) => (a.eventSortKey || '').localeCompare(b.eventSortKey || '') || a.fingerprint.localeCompare(b.fingerprint));
  }
}
