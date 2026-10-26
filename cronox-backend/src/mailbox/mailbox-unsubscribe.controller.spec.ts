import { MailboxUnsubscribeController } from './mailbox-unsubscribe.controller';

describe('public campaign unsubscribe page', () => {
  it('uses the customer typeface without performing an unsubscribe or relaxing script protection', () => {
    const campaigns = { unsubscribe: jest.fn() };
    const controller = new MailboxUnsubscribeController(campaigns as never);
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn(), status: jest.fn() };
    res.type.mockReturnValue(res);
    res.status.mockReturnValue(res);
    controller.form('valid-token', res as never);
    expect(campaigns.unsubscribe).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('data-cronox-surface="customer"'));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('/assets/customer-typography.css?v=3'));
    expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'");
  });

  it('renders invalid link errors with the same local typeface, status 400 and no token reflection', () => {
    const campaigns = { unsubscribe: jest.fn() };
    const controller = new MailboxUnsubscribeController(campaigns as never);
    const res = { setHeader: jest.fn(), type: jest.fn(), send: jest.fn(), status: jest.fn() };
    res.type.mockReturnValue(res);
    res.status.mockReturnValue(res);
    controller.form('<script>alert(1)</script>', res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.type).toHaveBeenCalledWith('html');
    const html = res.send.mock.calls[0][0];
    expect(html).toContain('<h1>Enlace no válido.</h1>');
    expect(html).toContain('data-cronox-surface="customer"');
    expect(html).toContain('/assets/customer-typography.css?v=3');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('alert(1)');
    expect(campaigns.unsubscribe).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'");
  });
});
