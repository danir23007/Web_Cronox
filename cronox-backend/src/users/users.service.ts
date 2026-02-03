import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getNextSequentialMemberCode } from './member-code.util';

export type AuthUser = Omit<User, 'password'>;
export type AuthUserWithPassword = User;

export type SafeUser = {
  id: number;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  memberCode?: string | null;
  newsletterSubscribed?: boolean;
  firstOrderDiscountCode?: string | null;
  firstOrderDiscountUsed?: boolean;
  circleLevel: number;
  role: Role | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(data: {
    email: string;
    password: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    role?: Role;
    memberCode?: string;
    newsletterSubscribed?: boolean;
    firstOrderDiscountCode?: string;
    firstOrderDiscountUsed?: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const { memberCode, ...userData } = data;
      const ensuredCode = memberCode ?? (await getNextSequentialMemberCode(tx));

      return tx.user.create({
        data: { ...userData, memberCode: ensuredCode },
      });
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

  toSafeUser(user: AuthUser | AuthUserWithPassword): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      memberCode: (user as any).memberCode, // Prisma ya tiene este campo
      newsletterSubscribed: (user as any).newsletterSubscribed,
      firstOrderDiscountCode: (user as any).firstOrderDiscountCode,
      firstOrderDiscountUsed: (user as any).firstOrderDiscountUsed,
      circleLevel: Number((user as any).circleLevel ?? 1),
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async ensureMemberCode(userId: number): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      if (user.memberCode) return user.memberCode;

      const newCode = await getNextSequentialMemberCode(tx);

      const updated = await tx.user.update({
        where: { id: userId },
        data: { memberCode: newCode },
        select: { memberCode: true },
      });

      return updated.memberCode ?? newCode;
    });
  }
}
