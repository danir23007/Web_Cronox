import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
describe('Admin push service worker', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../cronox-front/mailbox-sw.js'),
    'utf8',
  );
  function fixture() {
    const handlers: any = {},
      shown: any[] = [],
      opened: any[] = [];
    const self: any = {
      addEventListener: (kind: string, handler: any) =>
        (handlers[kind] = handler),
      registration: {
        showNotification: async (title: any, options: any) => {
          shown.push({ title, ...options });
        },
      },
      clients: { openWindow: async (url: string) => opened.push(url) },
    };
    runInNewContext(source, { self });
    return { handlers, shown, opened };
  }
  it('keeps every visit separate and routes paid orders/waitlist/mail safely', async () => {
    const f = fixture();
    for (const data of [
      {
        title: 'CRONOX · Visitas',
        tag: 'cronox-event-visits:one',
        url: '/admin.html#section-dashboard',
      },
      {
        title: 'CRONOX · Visitas',
        tag: 'cronox-event-visits:two',
        url: '/admin.html#section-dashboard',
      },
      {
        title: 'CRONOX · Pedidos',
        tag: 'cronox-event-paidOrders:123',
        url: '/admin.html#section-orders?order=123',
      },
      {
        title: 'CRONOX · Waitlist',
        tag: 'cronox-event-waitlist:id',
        url: '/admin.html#section-waitlist',
      },
      {
        title: 'CRONOX · Correo',
        url: '/admin.html?mail=12345678-1234-1234-1234-123456789abc#section-inbox',
      },
    ]) {
      let wait;
      f.handlers.push({
        data: { json: () => ({ ...data, body: 'Synthetic' }) },
        waitUntil: (p: any) => (wait = p),
      });
      await wait;
      expect(f.shown.at(-1).data.url).toBe(data.url);
      expect(f.shown.at(-1).title).toBe(data.title);
    }
    expect(f.shown[0].tag).not.toBe(f.shown[1].tag);
    let wait;
    f.handlers.notificationclick({
      notification: { close() {}, data: f.shown[2].data },
      waitUntil: (p: any) => (wait = p),
    });
    await wait;
    expect(f.opened[0]).toBe('/admin.html#section-orders?order=123');
  });
  it('rejects external URLs and unrecognized titles', async () => {
    const f = fixture();
    let wait;
    f.handlers.push({
      data: {
        json: () => ({
          url: 'https://evil.example/',
          title: 'Injected',
          body: 'test',
        }),
      },
      waitUntil: (p: any) => (wait = p),
    });
    await wait;
    expect(f.shown[0].data.url).toBe('/admin.html#section-inbox');
    expect(f.shown[0].title).toBe('CRONOX · Correo');
  });
});
