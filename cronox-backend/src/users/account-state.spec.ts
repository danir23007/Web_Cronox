import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UserAccountState } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { ACCOUNT_STATE_LABELS, assertAccountState } from './account-state';
import { RegisterDto } from '../auth/dto/register.dto';
import { UsersController } from './users.controller';
import { UpdateAdminUserDto } from '../admin/users/dto/update-admin-user.dto';
import { AdminUserQueryDto } from '../admin/users/dto/admin-user-query.dto';
import { UsersService } from './users.service';
jest.mock('./account-welcome', () => ({ ensureAccountWelcome: jest.fn(async (tx, id) => tx.user.findUnique({ where:{id} })) }));
jest.mock('./member-code.util', () => ({ getNextSequentialMemberCode: jest.fn(async () => 'CRX-000001') }));

describe('account enablement contract', () => {
  const pipe = new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true });
  it('shares exactly two persisted states and frontend labels, with no inferred ACTIVE fallback', () => {
    expect(Object.values(UserAccountState)).toEqual(['ACTIVE','INACTIVE']);
    const dom = new JSDOM('', {runScripts:'outside-only'});
    dom.window.eval(readFileSync(path.resolve(__dirname,'../../../cronox-front/assets/account-state.js'),'utf8'));
    expect((dom.window as any).CRONOX_ACCOUNT_STATE.labels).toEqual(ACCOUNT_STATE_LABELS);
    expect((dom.window as any).CRONOX_ACCOUNT_STATE.label(null)).toBe('Estado desconocido');
    dom.window.close();
  });
  it.each(['PRE_REGISTERED','PENDING_PASSWORD','UNKNOWN'])('rejects %s in individual edits and filters', async accountState => {
    expect(()=>assertAccountState(accountState)).toThrow();
    await expect(pipe.transform({accountState,expectedUpdatedAt:new Date().toISOString()},{type:'body',metatype:UpdateAdminUserDto})).rejects.toThrow();
    await expect(pipe.transform({accountState},{type:'query',metatype:AdminUserQueryDto})).rejects.toThrow();
  });
  it.each(['ACTIVE','INACTIVE'])('public registration/profile cannot submit %s', async accountState => {
    await expect(pipe.transform({firstName:'Local',lastName:'Fixture',email:'fixture@example.test',password:'LocalFixturePassword1',accountState},{type:'body',metatype:RegisterDto})).rejects.toThrow();
    const profileDto = Reflect.getMetadata('design:paramtypes',UsersController.prototype,'updateMe')[1];
    await expect(pipe.transform({firstName:'Local',accountState},{type:'body',metatype:profileDto})).rejects.toThrow();
  });
  it('public registration cannot forge technical claim eligibility', async () => {
    await expect(pipe.transform({firstName:'Local',lastName:'Fixture',email:'fixture@example.test',password:'LocalFixturePassword1',registrationClaimable:true},{type:'body',metatype:RegisterDto})).rejects.toThrow();
  });
  it('no application writer or runtime contract references deprecated state values', () => {
    const root=path.resolve(__dirname,'..');
    const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
    for(const f of files(root).filter(f=>f.endsWith('.ts')&&!f.endsWith('.spec.ts'))) {
      expect({file:path.relative(root,f),hasLegacy:/\b(PRE_REGISTERED|PENDING_PASSWORD)\b/.test(readFileSync(f,'utf8'))}).toEqual({file:path.relative(root,f),hasLegacy:false});
    }
  });
  it('normal creation persists ACTIVE explicitly and ignores a forged internal state field', async () => {
    let row:any;
    const tx:any={ $executeRaw:jest.fn(),user:{findFirst:jest.fn(async()=>null),findUnique:jest.fn(async()=>row),create:jest.fn(async({data})=>row={id:1,...data})} };
    const service=new UsersService({$transaction:fn=>fn(tx)} as any);
    const created=await service.createUser({email:'fixture@example.test',password:'hash',accountState:'INACTIVE'} as any);
    expect(created.accountState).toBe('ACTIVE');
  });
  it('completion checks ACTIVE at the atomic write and never writes account state', async () => {
    const tx:any={$executeRaw:jest.fn(),user:{findUnique:jest.fn(async()=>({id:1,email:'fixture@example.test',memberCode:'CRX-000001',accountState:'INACTIVE'})),updateMany:jest.fn(async()=>({count:0}))}};
    const service=new UsersService({$transaction:fn=>fn(tx)} as any);
    expect(await service.completePasswordlessRegistration(1,{password:'hash',firstName:'Local',lastName:'Fixture'})).toBeNull();
    expect(tx.user.updateMany).toHaveBeenCalledWith({where:{id:1,password:null,accountState:'ACTIVE',registrationClaimable:true,role:{in:['USER','FRIEND']}},data:expect.not.objectContaining({accountState:expect.anything()})});
  });
});
