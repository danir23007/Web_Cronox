import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Address, Prisma } from '@prisma/client';
import {
  normalizeCountry,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../common/country';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

const ADDRESS_LIMIT = 10;

export type SafeAddress = {
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

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number): Promise<SafeAddress[]> {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    return addresses.map((address) => this.toSafeAddress(address));
  }

  async create(userId: number, dto: CreateAddressDto): Promise<SafeAddress> {
    const country = this.requireSupportedCountry(dto.country);

    const count = await this.prisma.address.count({ where: { userId } });

    if (count >= ADDRESS_LIMIT) {
      throw new BadRequestException('Address limit reached');
    }

    const data: Prisma.AddressUncheckedCreateInput = {
      userId,
      name: dto.name,
      phone: dto.phone ?? null,
      line1: dto.line1,
      line2: dto.line2 ?? null,
      city: dto.city,
      state: dto.state ?? null,
      zip: dto.zip,
      country,
      isDefault: dto.isDefault ?? false,
    };

    if (dto.isDefault === true) {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });

        return tx.address.create({ data: { ...data, isDefault: true } });
      });

      return this.toSafeAddress(created);
    }

    const created = await this.prisma.address.create({ data });

    return this.toSafeAddress(created);
  }

  async update(
    userId: number,
    id: number,
    dto: UpdateAddressDto,
  ): Promise<SafeAddress> {
    await this.getOwned(userId, id);

    if (dto.country !== undefined) {
      this.requireSupportedCountry(dto.country);
    }

    const data: Prisma.AddressUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.line1 !== undefined) data.line1 = dto.line1;
    if (dto.line2 !== undefined) data.line2 = dto.line2 ?? null;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state ?? null;
    if (dto.zip !== undefined) data.zip = dto.zip;
    if (dto.country !== undefined) {
      data.country = this.requireSupportedCountry(dto.country);
    }
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    if (dto.isDefault === true) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });

        return tx.address.update({
          where: { id },
          data: { ...data, isDefault: true },
        });
      });

      return this.toSafeAddress(updated);
    }

    const updated = await this.prisma.address.update({
      where: { id },
      data,
    });

    return this.toSafeAddress(updated);
  }

  async remove(userId: number, id: number): Promise<void> {
    await this.getOwned(userId, id);

    await this.prisma.address.delete({ where: { id } });
  }

  async setDefault(userId: number, id: number): Promise<SafeAddress> {
    await this.getOwned(userId, id);

    const [, updated] = await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      this.prisma.address.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);

    return this.toSafeAddress(updated);
  }

  async getOwned(userId: number, id: number): Promise<Address> {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
    });

    if (!address) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }

  private requireSupportedCountry(country: string): string {
    const normalized = normalizeCountry(country);
    if (!normalized) {
      throw new BadRequestException(UNSUPPORTED_COUNTRY_MESSAGE);
    }
    return normalized;
  }

  private toSafeAddress(address: Address): SafeAddress {
    const { userId, ...rest } = address;

    return {
      ...rest,
      country: normalizeCountry(rest.country) ?? rest.country,
    };
  }
}
