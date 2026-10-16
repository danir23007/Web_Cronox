import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, User, UserAccountState } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { getNextSequentialMemberCode } from './member-code.util';
import { normalizeEmail } from '../common/email';
import { ensureAccountWelcome } from './account-welcome';
import { validateAccountName } from '../common/account-name-policy';
import { canCompletePublicRegistration } from './account-state';

export type AuthUser = Omit<User, 'password'> & { hasPassword: boolean };
export type AuthUserWithPassword = User;

export type SafeUser = {
  hasPassword: boolean;
  id: number;
  identityUid: string;
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
    validateAccountName(data.firstName, 'firstName');
    validateAccountName(data.lastName, 'lastName');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + normalizeEmail(data.email)}))`;
      // Opt-in may have created a passwordless account after register's initial read.
      const existing = await tx.user.findFirst({ where: { email: { equals: normalizeEmail(data.email), mode: 'insensitive' } } });
      if (existing) {
        if (!canCompletePublicRegistration(existing)) throw new ConflictException('El email ya esta registrado');
        const claimed = await tx.user.updateMany({ where: { id: existing.id, accountState: UserAccountState.ACTIVE,
          password: null, registrationClaimable: true, role: { in: [Role.USER, Role.FRIEND] } }, data: { password: data.password, name: data.name,
          firstName: data.firstName, lastName: data.lastName, registrationClaimable: false } });
        if (claimed.count !== 1) throw new ConflictException('El email ya esta registrado');
        return ensureAccountWelcome(tx, existing.id);
      }
      const { memberCode, ...userData } = data;
      const ensuredCode = memberCode ?? (await getNextSequentialMemberCode(tx));

      const user = await tx.user.create({
        data: {
          ...userData,
          accountState: UserAccountState.ACTIVE,
          registrationClaimable: false,
          email: normalizeEmail(userData.email),
          memberCode: ensuredCode,
        },
      });
      return ensureAccountWelcome(tx, user.id, true);
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email: { equals: normalizeEmail(email), mode: 'insensitive' },
      },
    });
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateProfile(
    id: number,
    update: { name?: string; firstName?: string; lastName?: string },
  ): Promise<SafeUser> {
    const current = await this.findById(id);
    if (!current) throw new NotFoundException('User not found');
    validateAccountName(update.firstName, 'firstName', current.firstName);
    validateAccountName(update.lastName, 'lastName', current.lastName);
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
      hasPassword: 'password' in user ? Boolean(user.password) : user.hasPassword,
      id: user.id,
      identityUid: user.identityUid,
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cronox:user-identity:' + userId}))`;
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

  async completePasswordlessRegistration(
    id: number,
    data: {
      password: string;
      name?: string;
      firstName: string;
      lastName: string;
    },
  ) {
    validateAccountName(data.firstName, 'firstName');
    validateAccountName(data.lastName, 'lastName');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cronox:user-identity:' + id}))`;
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + normalizeEmail(existing.email)}))`;
      const memberCode = existing.memberCode ?? await getNextSequentialMemberCode(tx);
      const updated = await tx.user.updateMany({
        where: {
          id,
          accountState: UserAccountState.ACTIVE,
          registrationClaimable: true,
          role: { in: [Role.USER, Role.FRIEND] },
          password: null,
        },
        data: { password: data.password, name: data.name, firstName: data.firstName, lastName: data.lastName, memberCode, registrationClaimable: false },
      });
      if (updated.count !== 1) return null;
      return ensureAccountWelcome(tx, id);
    });
  }

  async ensurePublicMemberToken(userId: number): Promise<string> {
    // A unique collision aborts a PostgreSQL transaction. Retry a fresh one,
    // retaining the per-user lock so concurrent first reads share one token.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cronox:user-identity:' + userId}))`;
          const user = await tx.user.findUnique({ where: { id: userId }, select: { publicMemberToken: true } });
          if (!user) throw new NotFoundException('User not found');
          if (user.publicMemberToken) return user.publicMemberToken;
          const token = randomBytes(24).toString('base64url');
          const updated = await tx.user.update({
            where: { id: userId },
            data: { publicMemberToken: token },
            select: { publicMemberToken: true },
          });
          return updated.publicMemberToken ?? token;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    throw new Error('Could not allocate a unique public membership token');
  }
}
