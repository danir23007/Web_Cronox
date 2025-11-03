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

  async findById(id: number) {
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

  async updatePassword(id: number, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async setRefreshTokenHash(id: number, hash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: hash },
    });
  }

  async clearRefreshTokenHash(id: number) {
    return this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: null },
    });
  }

  async setResetToken(id: number, hash: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: hash,
        resetTokenExp: expiresAt,
      },
    });
  }

  async clearResetToken(id: number) {
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
