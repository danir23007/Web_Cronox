import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService role safety', () => {
  const superAdmin = {
    id: 1,
    email: 'owner@example.test',
    name: null,
    firstName: null,
    lastName: null,
    circleLevel: 1,
    role: Role.SUPER_ADMIN,
    createdAt: new Date(),
  };

  let tx: any;
  let prisma: any;
  let service: AdminUsersService;

  beforeEach(() => {
    tx = {
      user: {
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(
        async (callback: (client: unknown) => Promise<unknown>) => callback(tx),
      ),
    };
    service = new AdminUsersService(prisma);
  });

  it('does not let the final super-admin demote itself to another admin role', async () => {
    tx.user.findUnique.mockResolvedValue(superAdmin);
    tx.user.count.mockResolvedValue(1);

    await expect(
      service.updateUserRole(1, Role.MODERATOR, 1),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { role: { in: [Role.SUPER_ADMIN, Role.SUPERADMIN] } },
    });
  });

  it('permits a super-admin demotion when another super-admin remains', async () => {
    tx.user.findUnique.mockResolvedValue(superAdmin);
    tx.user.count.mockResolvedValue(2);
    tx.user.update.mockResolvedValue({ ...superAdmin, role: Role.MODERATOR });

    await expect(
      service.updateUserRole(1, Role.MODERATOR, 1),
    ).resolves.toMatchObject({ id: 1, role: Role.MODERATOR });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
});
