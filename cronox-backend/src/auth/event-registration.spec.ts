import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { recordEventRegistration } from '../users/event-registration';

describe('event registration attribution', () => {
  const account = { id: 7, identityUid: 'real-identity', role: 'USER', email: 'fixture@example.test', password: 'hash', accountState: 'ACTIVE' };
  const setup = () => {
    const users: any = { findByEmail: jest.fn().mockResolvedValue(null), createUser: jest.fn().mockResolvedValue(account), toSafeUser: (u: any) => u };
    const mail: any = { isEnabled: jest.fn().mockReturnValue(false), sendPasswordReset: jest.fn() };
    const service = new AuthService(users, {} as any, {} as any, mail, {} as any, { create: async () => ({ accessToken: 'fake' }) } as any);
    jest.spyOn(service as any, 'hashPassword').mockResolvedValue('hash');
    return { service, users, mail };
  };
  const dto = { firstName: 'Usuario', lastName: 'Prueba', email: account.email, password: 'SecurePassword1!', registrationSource: 'event' as const };
  it('uses the existing account creation path with a backend-only event flag and no newsletter opt-in', async () => {
    const { service, users } = setup(); await service.register(dto);
    expect(users.createUser).toHaveBeenCalledWith(expect.objectContaining({ eventRegistration: true, email: account.email }));
    expect(users.createUser.mock.calls[0][0]).not.toHaveProperty('newsletterSubscribed');
  });
  it.each(['hash', null])('does not claim, modify or annotate an existing account with password %s', async password => {
    const { service, users, mail } = setup(); users.findByEmail.mockResolvedValue({ ...account, password });
    await expect(service.register(dto)).rejects.toThrow();
    expect(users.createUser).not.toHaveBeenCalled(); expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });
  it('does not give the normal registration an event attribution', async () => {
    const { service, users } = setup(); const { registrationSource, ...normal } = dto;
    await service.register(normal); expect(users.createUser.mock.calls[0][0]).not.toHaveProperty('eventRegistration');
  });
  it('persists one system observation by stable identity without updating any existing note', async () => {
    const tx: any = { adminNote: { upsert: jest.fn() } };
    await recordEventRegistration(tx, account);
    const operation = tx.adminNote.upsert.mock.calls[0][0];
    expect(operation.create).toMatchObject({ content: 'Usuario de evento', targetType: 'user', targetId: '7', authorAdminId: null });
    expect(operation.where.id).toContain(account.identityUid); expect(operation.update).toEqual({});
  });
  it('retains all normal required fields and rejects invented sources and weak passwords', async () => {
    expect(await validate(plainToInstance(RegisterDto, dto))).toEqual([]);
    for (const patch of [{ lastName: undefined }, { password: 'short' }, { registrationSource: 'event-admin' }]) {
      expect((await validate(plainToInstance(RegisterDto, { ...dto, ...patch }))).length).toBeGreaterThan(0);
    }
  });
});
