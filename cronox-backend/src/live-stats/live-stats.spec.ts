import { ValidationPipe } from '@nestjs/common';
import { PresenceDto, LiveStatsController } from './live-stats.controller';
import { LivePaymentObservation } from './live-payment-observation';
import { LiveStatsService } from './live-stats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAccessStrategy } from '../auth/strategies/jwt-access.strategy';

describe('live stats security and observation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it.each([{ section:'/admin?token=secret' }, { section:'home', userId:1 }, { section:'home', role:'ADMIN' }, { section:'product', productId:-1 }, { section:'product', productId:1.2 }])('rejects untrusted identity/path/data %j', async body => {
    await expect(pipe.transform(body,{type:'body',metatype:PresenceDto})).rejects.toThrow();
  });
  it('protects aggregate access with authentication and an admin role', () => {
    expect(Reflect.getMetadata('__guards__',LiveStatsController.prototype.snapshot)).toEqual([JwtAuthGuard,AdminGuard]);
    expect(Reflect.getMetadata('__guards__',LiveStatsController.prototype.presence)).toEqual([OptionalJwtAuthGuard]);
  });
  it.each(['ADMIN','SUPERADMIN'])('never records %s presence or touches auth activity', async role => {
    const db={ $executeRaw:jest.fn() }, service=new LiveStatsService(db as any);
    await service.signal({user:{id:1,role},cookies:{cronox_cookie_consent:JSON.stringify({version:'2',analytics:true})}} as any,{clearCookie:jest.fn()} as any,{section:'home'});
    expect(db.$executeRaw).not.toHaveBeenCalled();
    process.env.JWT_ACCESS_SECRET ||= 'local-test-only-secret-at-least-32-characters';
    const user={id:1,role,accountState:'ACTIVE',sessionVersion:1};
    const sessions={validate:jest.fn().mockResolvedValue({lastActivityAt:new Date(),user}),touch:jest.fn()};
    const strategy=new JwtAccessStrategy({findById:async()=>user,toSafeUser:(v:any)=>v} as any,sessions as any);
    await strategy.validate({res:{setHeader:jest.fn()}} as any,{sub:1,sv:1,sid:'s',type:'access'});
    expect(sessions.touch).not.toHaveBeenCalled();
  });
  it('does not record a visitor without consent',async()=>{
    const db={$executeRaw:jest.fn()};
    await new LiveStatsService(db as any).signal({cookies:{}} as any,{clearCookie:jest.fn()} as any,{section:'home'});
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('projects only provider PaymentIntent observations, with timestamp and terminal-state guards',async()=>{
    const updateMany=jest.fn().mockResolvedValue({count:1});
    const observer=new LivePaymentObservation({checkoutSnapshot:{updateMany}} as any);
    await observer.record({type:'charge.refunded'} as any);expect(updateMany).not.toHaveBeenCalled();
    await observer.record({type:'payment_intent.processing',created:100,livemode:true,data:{object:{id:'pi_local_fixture',status:'processing'}}} as any);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{paymentStatus:'processing',paymentStatusAt:new Date(100000),paymentLiveMode:true}}));
    expect(updateMany.mock.calls[0][0].where.AND).toHaveLength(2);
  });
});
