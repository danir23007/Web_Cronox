import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeCountry,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../common/country';
import { UsersService } from '../users/users.service';
import { normalizeEmail } from '../common/email';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpsertAddressDto } from './dto/upsert-address.dto';

export type MeProfile = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  memberCode: string;
  circleLevel: number;
  createdAt: Date;
};

export type MeAddress = {
  id: number;
  name: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  zip: string;
  country: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type MeOrder = {
  id: number;
  createdAt: Date;
  status: OrderStatus;
  total: number;
  currency: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippingCarrier: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
};

const NAME_REGEX = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'-]+$/u;
const LETTERS_REGEX = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u;

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService, private readonly usersService: UsersService) {}

  async getProfile(userId: number): Promise<MeProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const memberCode = await this.usersService.ensureMemberCode(userId);

    return this.toProfile({ ...user, memberCode });
  }

  async updateProfile(userId: number, dto: UpdateMeDto): Promise<MeProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const ensureValidName = (value?: string | null) => {
      if (value == null || value === '') return;
      if (!NAME_REGEX.test(value)) {
        throw new BadRequestException('El nombre y el apellido no pueden contener números.');
      }
    };

    const data: Prisma.UserUpdateInput = {};
    const memberCode = await this.usersService.ensureMemberCode(userId);

    if (dto.firstName !== undefined) {
      ensureValidName(dto.firstName);
      data.firstName = dto.firstName;
    }

    if (dto.lastName !== undefined) {
      ensureValidName(dto.lastName);
      data.lastName = dto.lastName;
    }

    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      const fullName = [dto.firstName ?? user.firstName, dto.lastName ?? user.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      data.name = fullName || null;
    }

    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      const existing = await this.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          NOT: { id: userId },
        },
      });

      if (existing) {
        throw new ConflictException('El email ya está en uso');
      }

      data.email = email;
    }

    if (Object.keys(data).length === 0) {
      return this.toProfile({ ...user, memberCode });
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
      });

      return this.toProfile({ ...updated, memberCode });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El email ya está en uso');
      }
      throw error;
    }
  }

  async getDefaultAddress(userId: number): Promise<MeAddress | null> {
    const address = await this.prisma.address.findFirst({
      where: { userId, isDefault: true },
      orderBy: { updatedAt: 'desc' },
    });

    return address ? this.toAddress(address) : null;
  }

  async upsertDefaultAddress(userId: number, dto: UpsertAddressDto): Promise<MeAddress> {
    const existingDefault = await this.prisma.address.findFirst({
      where: { userId, isDefault: true },
    });

    let phone = dto.phone;

    if (phone) {
      if (LETTERS_REGEX.test(phone)) {
        throw new BadRequestException('El teléfono solo puede contener números.');
      }

      phone = phone.replace(/[^\d+]/g, '');

      if (!phone) {
        phone = undefined;
      }
    }

    const country = normalizeCountry(dto.country);
    if (!country) {
      throw new BadRequestException(UNSUPPORTED_COUNTRY_MESSAGE);
    }

    const data: Prisma.AddressUncheckedCreateInput = {
      userId,
      name: dto.name,
      phone: phone ?? null,
      line1: dto.line1,
      line2: dto.line2 ?? null,
      city: dto.city,
      state: dto.state ?? null,
      zip: dto.zip,
      country,
      isDefault: true,
    };

    if (!existingDefault) {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
        return tx.address.create({ data });
      });

      return this.toAddress(created);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, NOT: { id: existingDefault.id } },
        data: { isDefault: false },
      });

      return tx.address.update({
        where: { id: existingDefault.id },
        data: {
          name: dto.name,
          phone: phone ?? null,
          line1: dto.line1,
          line2: dto.line2 ?? null,
          city: dto.city,
          state: dto.state ?? null,
          zip: dto.zip,
          country,
          isDefault: true,
        },
      });
    });

    return this.toAddress(updated);
  }

  async getOrders(userId: number): Promise<MeOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        total: true,
        currency: true,
        trackingNumber: true,
        trackingUrl: true,
        shippingCarrier: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });

    return orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      total: order.total instanceof Decimal ? Number(order.total.toString()) : Number(order.total),
      currency: order.currency,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      shippingCarrier: order.shippingCarrier,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
    }));
  }

  private toProfile(user: {
    id: number;
    email: string;
    firstName: string | null;
    lastName: string | null;
    memberCode: string | null;
    circleLevel: number | null;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      memberCode: user.memberCode ?? '',
      circleLevel: Number(user.circleLevel ?? 1),
      createdAt: user.createdAt,
    } as MeProfile;
  }

  private toAddress(address: {
    id: number;
    userId: number;
    name: string;
    phone: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    zip: string;
    country: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const { userId, ...rest } = address;
    return {
      ...rest,
      country: normalizeCountry(rest.country) ?? rest.country,
    } as MeAddress;
  }
}
