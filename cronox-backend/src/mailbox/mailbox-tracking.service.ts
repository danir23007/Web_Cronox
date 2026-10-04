import { Injectable, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from './mailbox-security';
import { hasAnalyticsConsent } from '../analytics/analytics-consent';
import {
  isAutomatedPushVisit,
  isPublicVisitPath,
} from '../analytics/visitor-history.service';

export function campaignDestination(
  value: string,
  origin = process.env.FRONTEND_URL || process.env.API_PUBLIC_URL || '',
) {
  try {
    const root = new URL(origin),
      url = new URL(value, root);
    if (
      url.origin !== root.origin ||
      url.username ||
      url.password ||
      !['http:', 'https:'].includes(url.protocol)
    )
      return null;
    if (
      !isPublicVisitPath(url.pathname) ||
      /auth|password|reset|verify|login|register|access|newsletter|launch|unsubscribe|logout|admin/i.test(
        url.pathname,
      )
    )
      return null;
    if (/token|secret|password|signature|session|auth|login|reset|verify/i.test(url.hash)) return null;
    if (
      [...url.searchParams.keys()].some((k) =>
        /token|secret|password|signature|session|auth|code|key|cx_campaign/i.test(
          k,
        ),
      )
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
export function effectiveness(accepted: number, attributed: number) {
  return accepted ? Math.round((attributed / accepted) * 10000) / 100 : null;
}
@Injectable()
export class MailboxTrackingService {
  constructor(readonly db: PrismaService) {}
  private pack(value: any) {
    return Buffer.from(
      encrypt(JSON.stringify(value), 'mailbox-campaign-visit'),
    ).toString('base64url');
  }
  private unpack(token: string) {
    try {
      if (token.length > 12000 || !/^[\w-]+$/.test(token)) throw Error();
      return JSON.parse(
        decrypt(
          Buffer.from(token, 'base64url').toString(),
          'mailbox-campaign-visit',
        ),
      );
    } catch {
      throw new BadRequestException('CAMPAIGN_LINK_INVALID');
    }
  }
  link(value: string, recipientToken?: string | null) {
    if (
      !recipientToken ||
      process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED !== 'true'
    )
      return value;
    const destination = campaignDestination(value);
    if (!destination) return value;
    const token = this.pack({ recipientToken, destination: destination.href });
    return (
      (process.env.API_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(
        /\/$/,
        '',
      ) +
      '/api/mailbox-access/' +
      token
    );
  }
  instrumentHtml(html: string, token?: string | null) {
    if (!token) return html;
    const doc = parseDocument(html);
    const visit = (node: any) => {
      if (node.name === 'a' && node.attribs?.href)
        node.attribs.href = this.link(node.attribs.href, token);
      node.children?.forEach(visit);
    };
    visit(doc);
    return render(doc);
  }
  instrumentText(text: string, token?: string | null) {
    if (!token) return text;
    return text.replace(/https?:\/\/[^\s<>"']+/g, (value) => {
      const url = value.replace(/[).,;!?]+$/, '');
      return this.link(url, token) + value.slice(url.length);
    });
  }
  redirect(token: string) {
    const data = this.unpack(token);
    const destination = campaignDestination(data.destination);
    if (!destination || typeof data.recipientToken !== 'string')
      throw new BadRequestException('CAMPAIGN_LINK_INVALID');
    // No database write, cookies or identity/session work occurs on a redirect.
    const arrival = this.pack({
      ...data,
      issuedAt: Date.now(),
      nonce: randomBytes(16).toString('hex'),
    });
    destination.searchParams.append('cx_campaign', arrival);
    return destination.href;
  }
  async arrive(req: Request, token: string, path: string, now = Date.now()) {
    if (
      process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED !== 'true' ||
      !hasAnalyticsConsent(req) ||
      (!req.user && req.cookies?.refresh_token) ||
      ['ADMIN', 'SUPERADMIN'].includes(req.user?.role || '') ||
      isAutomatedPushVisit(req) ||
      /preview|prefetch/i.test(
        req.get('purpose') || req.get('sec-purpose') || '',
      )
    )
      return { attributed: false };
    const data = this.unpack(token),
      destination = campaignDestination(data.destination);
    const ref = req.get('referer');
    if (
      !destination ||
      path !== destination.pathname ||
      !ref ||
      !Number.isFinite(data.issuedAt) ||
      now - data.issuedAt < 2000 ||
      now - data.issuedAt > 1800000
    )
      return { attributed: false };
    let source: URL;
    try {
      source = new URL(ref);
    } catch {
      return { attributed: false };
    }
    if (
      source.origin !== destination.origin ||
      source.pathname !== destination.pathname ||
      req.get('sec-fetch-site') === 'cross-site'
    )
      return { attributed: false };
    const changed = await this.db.mailboxCampaignDelivery.updateMany({
      where: {
        trackingToken: data.recipientToken,
        status: 'SMTP_ACCEPTED',
        visitedAt: null,
      },
      data: { visitedAt: new Date(now) },
    });
    return { attributed: changed.count > 0 };
  }
  async metrics(id: string) {
    const where = { campaignId: id };
    const [accepted, attributed, failed, uncertain, bounced, tracked] =
      await Promise.all([
        this.db.mailboxCampaignDelivery.count({
          where: { ...where, status: 'SMTP_ACCEPTED' },
        }),
        this.db.mailboxCampaignDelivery.count({
          where: {
            ...where,
            status: 'SMTP_ACCEPTED',
            visitedAt: { not: null },
          },
        }),
        this.db.mailboxCampaignDelivery.count({
          where: { ...where, status: 'FAILED' },
        }),
        this.db.mailboxCampaignDelivery.count({
          where: { ...where, status: 'UNKNOWN' },
        }),
        this.db.mailboxCampaignDelivery.count({
          where: { ...where, bouncedAt: { not: null } },
        }),
        this.db.mailboxCampaignDelivery.count({
          where: { ...where, trackingToken: { not: null } },
        }),
      ]);
    return {
      accepted,
      attributed,
      failed,
      uncertain,
      bounced,
      trackingAvailable: tracked > 0,
      effectiveness: tracked > 0 ? effectiveness(accepted, attributed) : null,
    };
  }
}
