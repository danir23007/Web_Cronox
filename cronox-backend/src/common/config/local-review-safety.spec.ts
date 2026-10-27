import { localReviewSafety } from './local-review-safety';
describe('local historical review safety', () => {
  const previous = process.env.CRONOX_LOCAL_DEV;
  afterEach(() => { if (previous === undefined) delete process.env.CRONOX_LOCAL_DEV; else process.env.CRONOX_LOCAL_DEV = previous; });
  it.each(['/api/checkout/payment-intent','/api/payments/create-payment-intent','/api/payments/webhook','/api/webhooks/stripe','/api/admin/orders/1/refund','/api/admin/orders/1/mark-shipped','/api/admin/orders/1/confirmation-email','/api/admin/payments/recovery/event/evt/retry','/api/admin/payments/recovery/event/evt/resolve-refunded','/api/orders','/api/newsletter/subscribe'])('blocks %s before handlers run', path => {
    process.env.CRONOX_LOCAL_DEV='true'; const next=jest.fn(); const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
    localReviewSafety({method:'POST',path} as any,res as any,next);
    expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
  });
  it.each([['GET','/api/admin/orders'],['PATCH','/api/products/1'],['POST','/api/cart/items'],['POST','/api/auth/login'],['POST','/api/admin/orders/1/statistics-exclusion'],['POST','/api/admin/users/1/in-person-purchases'],['PATCH','/api/admin/users/1/in-person-purchases/2']])('preserves %s %s', (method,path) => {
    process.env.CRONOX_LOCAL_DEV='true';const next=jest.fn();localReviewSafety({method,path} as any,{} as any,next);expect(next).toHaveBeenCalled();
  });
  it('does not alter deployment behavior',()=>{delete process.env.CRONOX_LOCAL_DEV;const next=jest.fn();localReviewSafety({method:'POST',path:'/api/checkout/payment-intent'} as any,{} as any,next);expect(next).toHaveBeenCalled();});
  it.each(['/api/admin/users/1/in-person-purchases/2/void', '/api/admin/users/1/in-person-purchases/invalid'])('keeps unrelated manual lifecycle routes blocked: %s', path => {
    process.env.CRONOX_LOCAL_DEV = 'true';
    const next = jest.fn(), res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    localReviewSafety({ method: 'PATCH', path } as import('express').Request, res as unknown as import('express').Response, next);
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
});

describe('checkout test activation preserves historical-operation restrictions', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  it('opens only the explicit test checkout routes, with live keys still rejected', () => {
    Object.assign(process.env, { CRONOX_LOCAL_DEV: 'true', CRONOX_LOCAL_CHECKOUT_TEST: 'true', NODE_ENV: 'development', DATABASE_URL: 'postgresql://local@127.0.0.1/db', STRIPE_SECRET_KEY: 'sk_test_fixture' });
    for (const path of ['/api/checkout/reservation','/api/checkout/payment-start','/api/checkout/payment-intent','/api/webhooks/stripe']) {
      const next = jest.fn(); localReviewSafety({ method:'POST', path } as any, {} as any, next); expect(next).toHaveBeenCalled();
    }
    for (const path of ['/api/admin/orders/1/refund','/api/admin/orders/1/mark-shipped','/api/newsletter/subscribe']) {
      const next=jest.fn(), res={status:jest.fn().mockReturnThis(),json:jest.fn()};
      localReviewSafety({method:'POST',path} as any,res as any,next);expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
    }
    process.env.STRIPE_SECRET_KEY='sk_live_fixture';
    const next=jest.fn(), res={status:jest.fn().mockReturnThis(),json:jest.fn()};
    localReviewSafety({method:'POST',path:'/api/checkout/payment-intent'} as any,res as any,next);expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
  });
});
