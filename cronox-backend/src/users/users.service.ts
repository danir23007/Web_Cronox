import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuthUser = User;

export type SafeUser = {
  id: number;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  memberCode?: string | null;
  circleLevel: number;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(data: {
    email: string;
    passwordHash: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    role?: Role;
    memberCode?: string;
  }) {
    const { memberCode, ...userData } = data;
    const ensuredCode = memberCode ?? (await this.generateUniqueMemberCode());

    return this.prisma.user.create({
      data: { ...userData, memberCode: ensuredCode },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateProfile(
    id: number,
    update: { name?: string; firstName?: string; lastName?: string },
  ): Promise<SafeUser> {
    const data: Prisma.UserUpdateInput = {};

    // Nos aseguramos de que el usuario tenga memberCode
    const memberCode = await this.ensureMemberCode(id);

    if (update.name !== undefined) {
      data.name = update.name;
    }

    if (update.firstName !== undefined) {
      data.firstName = update.firstName;
    }

    if (update.lastName !== undefined) {
      data.lastName = update.lastName;
    }

    if (Object.keys(data).length === 0) {
      const user = await this.findById(id);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return this.toSafeUser(user);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
    });

    return this.toSafeUser({ ...updated, memberCode });
  }

  toSafeUser(user: AuthUser): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      memberCode: (user as any).memberCode, // Prisma ya tiene este campo
      circleLevel: Number((user as any).circleLevel ?? 1),
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private async generateUniqueMemberCode(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = ''; // ← inicializado para que TS no se queje
    let exists = true;

    while (exists) {
      const random = Array.from({ length: 6 })
        .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
        .join('');

      code = `CRX-${random}`;

      const found = await this.prisma.user.findUnique({
        where: { memberCode: code },
        select: { id: true },
      });

      exists = !!found;
    }

    return code;
  }

  async ensureMemberCode(userId: number): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.memberCode) return user.memberCode;

    const newCode = await this.generateUniqueMemberCode();

    await this.prisma.user.update({
      where: { id: userId },
      data: { memberCode: newCode },
    });

    return newCode;
  }
}
