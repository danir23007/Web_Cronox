import { Injectable } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SafeUser = Omit<
  User,
  'passwordHash' | 'refreshTokenHash' | 'resetTokenHash' | 'resetTokenExp'
>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    name?: string;
    role?: Role;
  }) {
    return this.prisma.user.create({
      data,
    });
  }

  async updatePassword(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async setRefreshTokenHash(id: string, hash: string | null) {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: hash },
    });
  }

  async clearRefreshTokenHash(id: string) {
    return this.setRefreshTokenHash(id, null);
  }

  async setResetToken(id: string, hash: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: hash,
        resetTokenExp: expiresAt,
      },
    });
  }

  async clearResetToken(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: null,
        resetTokenExp: null,
      },
    });
  }

  toPublic(user: User): SafeUser {
    const { passwordHash, refreshTokenHash, resetTokenHash, resetTokenExp, ...safe } = user;
    return safe;
  }
}
