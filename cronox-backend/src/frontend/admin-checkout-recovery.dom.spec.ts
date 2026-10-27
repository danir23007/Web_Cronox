import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(__dirname, '../../../cronox-front');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
describe('admin checkout reconciliation visibility', () => {
  it.each([403, 500, 200])('hides denied data or reports unavailable instead of stale stock for HTTP %s', async status => {
    const dom = new JSDOM(readFileSync(join(root, 'admin.html'), 'utf8'), { runScripts:'outside-only', url:'https://admin.example.test' });
    const win = dom.window as any;
    win.fetch = jest.fn(async () => ({ ok:status===200, status, text:async()=>JSON.stringify({}) }));
    win.eval(readFileSync(join(root,'assets/admin-orders.js'),'utf8'));
    win.document.querySelector('#checkoutRecoveryRefresh').click(); await flush();
    expect(win.document.querySelector('#checkoutRecoveryPanel').hidden).toBe(status===403);
    if(status!==403)expect(win.document.querySelector('#checkoutRecoveryStatus').textContent).toContain('No disponible');
    expect(win.document.querySelector('#checkoutRecoveryRows').children.length).toBe(0);
    dom.window.close();
  });
  it('shows retained inventory and worker failure, safely escaping references, without a force-release action', async () => {
    const dom = new JSDOM(readFileSync(join(root,'admin.html'),'utf8'), {runScripts:'outside-only',url:'https://admin.example.test'});
    const win=dom.window as any;
    win.fetch=jest.fn(async()=>({ok:true,status:200,text:async()=>JSON.stringify({reservationCount:1,reservationWorker:{enabled:false},reservations:[{
      id:'<img id="unsafe-recovery">',status:'PAYMENT_BOUND',stripePaymentIntentId:'pi_fixture',expiresAt:'2026-10-27T12:00:00Z',reservationRetryAt:'2026-10-27T12:00:05Z',stockReservations:[{quantity:2}],
    }]})}));
    win.eval(readFileSync(join(root,'assets/admin-orders.js'),'utf8'));
    win.document.querySelector('#checkoutRecoveryRefresh').click();await flush();
    expect(win.document.querySelector('#checkoutRecoveryStatus').textContent).toContain('detenida');
    expect(win.document.querySelector('#checkoutRecoveryRows').textContent).toContain('<img id="unsafe-recovery">');
    expect(win.document.querySelector('#unsafe-recovery')).toBeNull();
    expect(win.document.querySelectorAll('#checkoutRecoveryRows button').length).toBe(0);
    dom.window.close();
  });
});
