import {
  MailboxTrackingService,
  campaignDestination,
  effectiveness,
} from './mailbox-tracking.service';
import {
  mailboxSenderKey,
  appendSent,
  skipSentImport,
  sentCutoff,
} from './mailbox-sent-policy';

describe('CRONOX campaign access and sent policies', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://cronox.es';
    process.env.API_PUBLIC_URL = 'https://cronox.es';
    process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED = 'true';
    process.env.MAILBOX_ENCRYPTION_KEY_ID = 'test';
    process.env.MAILBOX_ENCRYPTION_KEYS = JSON.stringify({
      test: Buffer.alloc(32, 9).toString('base64'),
    });
  });
  afterEach(() => {
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  });
  it.each([
    'https://external.test/tienda',
    'mailto:a@example.test',
    'tel:1234',
    '/api/mailbox-unsubscribe/x',
    '/reset-password.html?token=x',
    '/newsletter-access.html?token=x',
    '/tienda?code=x',
    '/tienda?access_token=x',
    'https://user:pass@cronox.es/tienda',
    '//evil.test/tienda',
    '/admin.html',
    '/#reset-password?token=x',
  ])('excludes sensitive/external destination %s', (value) => {
    expect(campaignDestination(value)).toBeNull();
    expect(new MailboxTrackingService({} as any).link(value, 'opaque')).toBe(
      value,
    );
  });
  it('preserves encoded destination, repeated query values and fragment without exposing recipient data', () => {
    const tracking = new MailboxTrackingService({} as any);
    const destination =
      'https://cronox.es/producto/camiseta?size=M&color=negro&color=blanco#details';
    const link = tracking.link(destination, 'opaque-recipient');
    expect(link).not.toContain('opaque-recipient');
    const final = new URL(
      tracking.redirect(link.split('/api/mailbox-access/')[1]),
    );
    final.searchParams.delete('cx_campaign');
    expect(final.href).toBe(destination);
    expect(() => tracking.redirect('tampered')).toThrow();
  });
  it('instruments anchor buttons without changing image/external/authentication links', () => {
    const tracking = new MailboxTrackingService({} as any);
    const html = tracking.instrumentHtml(
      '<a class="button" href="/tienda?a=1&amp;b=2">Comprar</a><img src="https://cronox.es/a.png"><a href="https://other.test">Other</a><a href="/reset-password.html?token=x">Access</a>',
      'opaque',
    );
    expect(html).toContain('class="button"');
    expect(html).toContain('/api/mailbox-access/');
    expect(html).toContain('href="https://other.test"');
    expect(html).toContain('href="/reset-password.html?token=x"');
    expect(html).toContain('src="https://cronox.es/a.png"');
    expect(
      tracking.instrumentText(
        'Visita https://cronox.es/tienda. Email mailto:a@example.test',
        null,
      ),
    ).toContain('https://cronox.es/tienda.');
  });
  it('reports 50/100, excludes zero denominator and leaves untracked messages unchanged', () => {
    expect(effectiveness(100, 50)).toBe(50);
    expect(effectiveness(0, 0)).toBeNull();
    process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED = 'false';
    expect(
      new MailboxTrackingService({} as any).link('/tienda', 'opaque'),
    ).toBe('/tienda');
  });
  it('identifies configured keys, protects ambiguous accounts and treats only real Sent as sent', () => {
    process.env.SMTP_ORDERS_USER = 'dispatch@example.test';
    process.env.SMTP_INFO_USER = 'info@example.test';
    const box = {
      address: 'DISPATCH@example.test',
      sentCopy: 'append',
      name: 'Soporte',
    };
    expect(mailboxSenderKey(box)).toBe('ORDERS');
    expect(appendSent(box)).toBe(false);
    expect(skipSentImport(box, { path: 'Archive', specialUse: '\\Sent' })).toBe(
      true,
    );
    expect(skipSentImport(box, { path: 'Sent', specialUse: '\\Inbox' })).toBe(
      false,
    );
    process.env.SMTP_INFO_USER = 'dispatch@example.test';
    expect(mailboxSenderKey(box)).toBeNull();
    expect(sentCutoff(new Date('2026-10-04T12:00:00Z')).toISOString()).toBe(
      '2026-09-04T12:00:00.000Z',
    );
  });
});
