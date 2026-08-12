import { Role } from '@prisma/client';
import { GuestOrderAccountService } from './guest-order-account.service';

describe('GuestOrderAccountService', () => {
  let service: GuestOrderAccountService;
  let tx: any;

  beforeEach(() => {
    service = new GuestOrderAccountService();
    tx = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      address: { create: jest.fn() },
    };
  });

  it('links a mixed-case guest email to the existing User without changing profile or addresses', async () => {
    tx.user.findFirst.mockResolvedValue({ id: 41 });

    await expect(
      service.resolveUserForCompletedOrder(tx, {
        userId: null,
        customerEmail: '  Customer@Example.com ',
        shippingAddr: {
          firstName: 'Checkout',
          lastName: 'Recipient',
          line1: 'Calle Nueva 1',
          city: 'Madrid',
          zip: '28001',
          country: 'ES',
        },
        billingAddr: null,
      }),
    ).resolves.toEqual({ userId: 41, accountCreated: false });

    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'customer@example.com', mode: 'insensitive' },
      },
      select: { id: true },
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.address.create).not.toHaveBeenCalled();
    expect(tx.user.update).toBeUndefined();
  });

  it('leaves an authenticated checkout account untouched', async () => {
    await expect(
      service.resolveUserForCompletedOrder(tx, {
        userId: 9,
        customerEmail: 'member@example.com',
        shippingAddr: null,
        billingAddr: null,
      }),
    ).resolves.toEqual({ userId: 9, accountCreated: false });

    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('creates a passwordless USER and canonical default address from a new paid guest checkout', async () => {
    tx.user.findFirst.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 72 });
    tx.address.create.mockResolvedValue({ id: 80 });

    await expect(
      service.resolveUserForCompletedOrder(tx, {
        userId: null,
        customerEmail: ' NEW.Customer@Example.COM ',
        shippingAddr: {
          firstName: 'Daniel',
          lastName: 'Rivas Cruz',
          name: 'Daniel Rivas Cruz',
          phone: '+34 600-123-456',
          line1: 'Antonio Gades 49',
          line2: 'Portal C 3A',
          city: 'Madrid',
          state: 'Madrid',
          postalCode: '28051',
          country: 'ES',
        },
        billingAddr: null,
      }),
    ).resolves.toEqual({ userId: 72, accountCreated: true });

    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        email: 'new.customer@example.com',
        password: null,
        role: Role.USER,
        name: 'Daniel Rivas Cruz',
        firstName: 'Daniel',
        lastName: 'Rivas Cruz',
      },
      select: { id: true },
    });
    expect(tx.address.create).toHaveBeenCalledWith({
      data: {
        userId: 72,
        name: 'Daniel Rivas Cruz',
        phone: '+34600123456',
        line1: 'Antonio Gades 49',
        line2: 'Portal C 3A',
        city: 'Madrid',
        state: 'Madrid',
        zip: '28051',
        country: 'España',
        isDefault: true,
      },
    });
  });

  it('does not save an incomplete address while still creating the paid-order account', async () => {
    tx.user.findFirst.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: 73 });

    await expect(
      service.resolveUserForCompletedOrder(tx, {
        userId: null,
        customerEmail: 'guest@example.com',
        shippingAddr: { firstName: 'Guest', country: 'France' },
        billingAddr: null,
      }),
    ).resolves.toEqual({ userId: 73, accountCreated: true });

    expect(tx.address.create).not.toHaveBeenCalled();
  });
});
