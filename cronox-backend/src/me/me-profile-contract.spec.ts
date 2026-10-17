import { Role } from '@prisma/client';
import { MeService } from './me.service';
import { UsersService } from '../users/users.service';

describe('profile responses preserve the authoritative account context', () => {
  const record = {
    id: 42, identityUid: 'b65bfb6e-3ed8-4594-848d-dbc7f91d65e3', email: 'fixture@example.test',
    name: 'Ana Fixture', firstName: 'Ana', lastName: 'Fixture', memberCode: '0042',
    role: Role.USER, password: 'never-expose-this-hash', circleLevel: 3,
    createdAt: new Date('2020-01-01'), updatedAt: new Date('2026-10-17'),
    newsletterSubscribed: true, firstOrderDiscountUsed: false, firstOrderDiscountCode: 'FIXTURE',
  };
  function service() {
    const tx = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue(record), update: jest.fn().mockResolvedValue({ ...record, firstName: 'Eva', role: Role.FRIEND }) } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(record) }, $transaction: jest.fn(async callback => callback(tx)) };
    const users = { ensureMemberCode: jest.fn().mockResolvedValue('0042'), toSafeUser: UsersService.prototype.toSafeUser };
    return new MeService(prisma as any, users as any);
  }
  it('returns identity and role on read without exposing credentials', async () => {
    const response = await service().getProfile(42);
    expect(response).toEqual(expect.objectContaining({ identityUid: record.identityUid, role: Role.USER, hasPassword: true, memberCode: '0042' }));
    expect(response).not.toHaveProperty('password');
  });
  it('returns the current role from the committed update, not a browser or earlier snapshot', async () => {
    const response = await service().updateProfile(42, { firstName: 'Eva' });
    expect(response).toEqual(expect.objectContaining({ identityUid: record.identityUid, role: Role.FRIEND, firstName: 'Eva', circleLevel: 3, memberCode: '0042' }));
    expect(response).not.toHaveProperty('password');
  });
});
