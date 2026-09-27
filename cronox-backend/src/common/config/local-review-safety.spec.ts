import { localReviewSafety } from './local-review-safety';
describe('local historical review safety', () => {
  const previous = process.env.CRONOX_LOCAL_DEV;
  afterEach(() => { if (previous === undefined) delete process.env.CRONOX_LOCAL_DEV; else process.env.CRONOX_LOCAL_DEV = previous; });
  it.each(['/api/checkout/payment-intent','/api/payments/create-payment-intent','/api/payments/webhook','/api/webhooks/stripe','/api/admin/orders/1/refund','/api/admin/orders/1/mark-shipped','/api/admin/orders/1/confirmation-email','/api/orders','/api/newsletter/subscribe'])('blocks %s before handlers run', path => {
    process.env.CRONOX_LOCAL_DEV='true'; const next=jest.fn(); const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
    localReviewSafety({method:'POST',path} as any,res as any,next);
    expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
  });
  it.each([['GET','/api/admin/orders'],['PATCH','/api/products/1'],['POST','/api/cart/items'],['POST','/api/auth/login']])('preserves %s %s', (method,path) => {
    process.env.CRONOX_LOCAL_DEV='true';const next=jest.fn();localReviewSafety({method,path} as any,{} as any,next);expect(next).toHaveBeenCalled();
  });
  it('does not alter deployment behavior',()=>{delete process.env.CRONOX_LOCAL_DEV;const next=jest.fn();localReviewSafety({method:'POST',path:'/api/checkout/payment-intent'} as any,{} as any,next);expect(next).toHaveBeenCalled();});
});
