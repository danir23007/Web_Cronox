import { Injectable } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuthUser = User;

export type SafeUser = {
  id: number;
  email: string;
  name?: string | null;
  role: Role;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmailForAuth(email: string): Promise<AuthUser | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByIdForAuth(id: number): Promise<AuthUser | null> {
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

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async setRefreshHash(id: number, hash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: hash },
    });
  }

  async clearRefreshHash(id: number): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { refreshTokenHash: null },
    });
  }

  async setResetToken(id: number, hash: string, exp: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: hash,
        resetTokenExp: exp,
      },
    });
  }

  async clearResetToken(id: number): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        resetTokenHash: null,
        resetTokenExp: null,
      },
    });
  }

  toSafeUser(user: AuthUser): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
