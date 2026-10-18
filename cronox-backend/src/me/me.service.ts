import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus, User } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  normalizeCountry,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../common/country';
import { SafeUser, UsersService } from '../users/users.service';
import { normalizeEmail } from '../common/email';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpsertAddressDto } from './dto/upsert-address.dto';
import { serializableTransaction } from '../prisma/serializable-transaction';
import { validateAccountName } from '../common/account-name-policy';
import { ADDRESS_LIMIT } from '../addresses/addresses.service';
import { buildCorreosTrackingUrl } from '../shipping-tracking/tracking-links';

export type MeProfile = SafeUser & {
  hasPassword: boolean;
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
  excludedFromStatistics: boolean;
  id: number;
  createdAt: Date;
  status: OrderStatus;
  total: number;
  currency: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippingCarrier: string | null;
  shippingMethodCode?: string | null;
  source?: string;
  shippingRequired?: boolean;
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

    validateAccountName(dto.firstName, 'firstName', user.firstName);
    validateAccountName(dto.lastName, 'lastName', user.lastName);

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

    if (dto.email !== undefined && normalizeEmail(dto.email) !== user.email) {
      throw new BadRequestException('Solicita el cambio de email y confirma ambos buzones.');
    }

    if (Object.keys(data).length === 0) {
      return this.toProfile({ ...user, memberCode });
    }

    try {
      const updated = await serializableTransaction(this.prisma, async tx => {
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        validateAccountName(dto.firstName, 'firstName', current.firstName);
        validateAccountName(dto.lastName, 'lastName', current.lastName);
        const changed = await tx.user.update({ where: { id: userId }, data });
        if (changed.email !== current.email) {
          // Old mailbox links must not retain authority over the renamed account.
          const now = new Date();
          await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
          await tx.preRegistration.updateMany({ where: { userId, launchTokenUsedAt: null }, data: { launchTokenUsedAt: now } });
          await tx.newsletterMailJob.updateMany({ where: { userId, kind: 'ACCESS', tokenUsedAt: null }, data: { tokenUsedAt: now } });
        }
        return changed;
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

    const updated = await serializableTransaction(this.prisma, async (tx) => {
      const existingDefault = await tx.address.findFirst({ where: { userId, isDefault: true } });
      if (!existingDefault) {
        if (await tx.address.count({ where: { userId } }) >= ADDRESS_LIMIT) {
          throw new BadRequestException('Address limit reached');
        }
        return tx.address.create({ data });
      }
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
        excludedFromStatistics: true,
        trackingNumber: true,
        trackingUrl: true,
        shippingCarrier: true,
        shippingMethodCode: true,
        source: true,
        shippedAt: true,
        deliveredAt: true,
        trackingAdmissionLocalAt: true,
        trackingDeliveryLocalAt: true,
      },
    });

    return orders.map((order) => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      total: order.total instanceof Decimal ? Number(order.total.toString()) : Number(order.total),
      currency: order.currency,
      excludedFromStatistics: order.excludedFromStatistics,
      trackingNumber: order.trackingNumber,
      trackingUrl: /^correos$/i.test(order.shippingCarrier?.trim() || '')
        ? buildCorreosTrackingUrl(order.trackingNumber) : order.trackingUrl,
      shippingCarrier: order.shippingCarrier,
      shippingMethodCode: order.shippingMethodCode,
      source: order.source,
      shippingRequired: order.source !== 'IN_PERSON_ADMIN' && !['LOCAL_PICKUP', 'PICKUP'].includes(order.shippingMethodCode || ''),
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      trackingAdmissionLocalAt: order.trackingAdmissionLocalAt,
      trackingDeliveryLocalAt: order.trackingDeliveryLocalAt,
    }));
  }

  private toProfile(user: User): MeProfile {
    return {
      // GET /me and PUT /me replace the same browser account context. Return
      // the current safe identity/role, never merge potentially stale roles.
      ...this.usersService.toSafeUser(user),
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      memberCode: user.memberCode ?? '',
    };
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
