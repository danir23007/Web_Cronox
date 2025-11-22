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
  }) {
    return this.prisma.user.create({
      data,
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateProfile(id: number, update: { name?: string; firstName?: string; lastName?: string }): Promise<SafeUser> {
    const data: Prisma.UserUpdateInput = {};

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

    return this.toSafeUser(updated);
  }

  toSafeUser(user: AuthUser): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
