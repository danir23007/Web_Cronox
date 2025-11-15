import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShippingMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingMethodDto } from './dto/create-shipping-method.dto';
import { UpdateShippingMethodDto } from './dto/update-shipping-method.dto';

export type ShippingMethodResponse = {
  id: number;
  name: string;
  priceCents: number;
  price: string;
  countries: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ShippingMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(country?: string): Promise<ShippingMethodResponse[]> {
    const normalizedCountry = this.normalizeCountry(country);
    const where: Prisma.ShippingMethodWhereInput = {
      isActive: true,
      AND: normalizedCountry
        ? [
            {
              OR: [
                { countries: { isEmpty: true } },
                { countries: { has: normalizedCountry } },
              ],
            },
          ]
        : undefined,
    };

    const methods = await this.prisma.shippingMethod.findMany({
      where,
      orderBy: { price: 'asc' },
    });

    return methods.map((method) => this.toResponse(method));
  }

  async listAll(): Promise<ShippingMethodResponse[]> {
    const methods = await this.prisma.shippingMethod.findMany({ orderBy: { id: 'asc' } });
    return methods.map((method) => this.toResponse(method));
  }

  async create(dto: CreateShippingMethodDto): Promise<ShippingMethodResponse> {
    const countries = this.normalizeCountries(dto.countries);

    const created = await this.prisma.shippingMethod.create({
      data: {
        name: dto.name,
        price: dto.priceCents,
        countries,
        isActive: dto.isActive ?? true,
      },
    });

    return this.toResponse(created);
  }

  async update(id: number, dto: UpdateShippingMethodDto): Promise<ShippingMethodResponse> {
    const countries = dto.countries ? this.normalizeCountries(dto.countries) : undefined;
    const data: Prisma.ShippingMethodUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.priceCents !== undefined) {
      data.price = dto.priceCents;
    }
    if (countries !== undefined) {
      data.countries = countries;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const updated = await this.prisma.shippingMethod
      .update({
        where: { id },
        data,
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException('SHIPPING_METHOD_NOT_FOUND');
        }
        throw error;
      });

    return this.toResponse(updated);
  }

  async remove(id: number): Promise<void> {
    await this.prisma.shippingMethod
      .delete({ where: { id } })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new NotFoundException('SHIPPING_METHOD_NOT_FOUND');
        }
        throw error;
      });
  }

  async getActiveMethodById(id: number, country?: string): Promise<ShippingMethod> {
    const method = await this.prisma.shippingMethod.findUnique({ where: { id } });

    if (!method || !method.isActive) {
      throw new NotFoundException('SHIPPING_METHOD_NOT_FOUND');
    }

    const normalizedCountry = this.normalizeCountry(country);
    if (normalizedCountry && !this.isCountryAllowed(method, normalizedCountry)) {
      throw new BadRequestException('SHIPPING_METHOD_NOT_AVAILABLE_FOR_COUNTRY');
    }

    return method;
  }

  async getMethodByIdOrThrow(id: number): Promise<ShippingMethod> {
    const method = await this.prisma.shippingMethod.findUnique({ where: { id } });

    if (!method) {
      throw new NotFoundException('SHIPPING_METHOD_NOT_FOUND');
    }

    return method;
  }

  toResponse(method: ShippingMethod): ShippingMethodResponse {
    return {
      id: method.id,
      name: method.name,
      priceCents: method.price,
      price: this.formatPrice(method.price),
      countries: method.countries,
      isActive: method.isActive,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
    };
  }

  private normalizeCountries(countries?: string[]): string[] {
    if (!countries?.length) {
      return [];
    }

    const normalized = countries.map((code) => this.normalizeCountry(code)).filter(Boolean) as string[];
    return Array.from(new Set(normalized));
  }

  private normalizeCountry(country?: string): string | undefined {
    if (!country || typeof country !== 'string') {
      return undefined;
    }

    const trimmed = country.trim().toUpperCase();
    return trimmed || undefined;
  }

  private isCountryAllowed(method: ShippingMethod, country: string): boolean {
    if (!method.countries.length) {
      return true;
    }

    return method.countries.includes(country.toUpperCase());
  }

  private formatPrice(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
