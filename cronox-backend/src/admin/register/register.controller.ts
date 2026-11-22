import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import {
  accreditationName,
  assertUsableAccreditation,
  parseAccreditationPayload,
} from '../../membership/accreditation-identity';
import { labelPresentation } from '../labels/label-presentation';
import { normalizeEmail } from '../../common/email';
import { isEmail } from 'class-validator';
import { createHash } from 'node:crypto';
import { resolveWebPrice, webOfferLots } from '../../products/web-offer';

class RegisterItem {
  @IsInt() @Min(1) variantId!: number;
  @IsOptional() @IsString() @MaxLength(100) lotId?: string | null;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}
export class Quote {
  @IsOptional() @IsString() @MaxLength(100) pointId?: string | null;
  @IsOptional() @IsInt() @Min(1) userId?: number | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RegisterItem)
  items!: RegisterItem[];
}
class Credential {
  @IsString() @MaxLength(512) content!: string;
}
class Barcode {
  @Matches(/^CR[XL][0-9]{10}$/) code!: string;
}
class Search {
  @IsOptional() @IsString() @MaxLength(120) q = '';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset = 0;
}
const details = {
  variants: { orderBy: { id: 'asc' } },
  inventoryLots: {
    where: { archived: false },
    orderBy: { number: 'asc' },
    select: {
      ...webOfferLots.select,
      id: true,
      name: true,
      number: true,
      profilePending: true,
      profile: true,
      slices: { select: { variantId: true, available: true } },
    },
  },
} satisfies Prisma.ProductInclude;
type Product = Prisma.ProductGetPayload<{ include: typeof details }>;
type Edition = {
  name?: string;
  currency?: string;
  price?: number;
  variants?: { id: number; price?: number; isActive?: boolean }[];
};

export function registerOptions(product: Product, now = new Date()) {
  if (!product.isActive || product.currency !== 'EUR') return [];
  return product.variants.flatMap((variant) => {
    const base = {
      productId: product.id,
      variantId: variant.id,
      size: variant.size.replace('US_', 'US '),
      image: product.imageUrl,
    };
    const row = (
      name: string,
      lotId: string | null,
      lotName: string | null,
      stock: number,
      price: number,
    ) => {
      const presentation = labelPresentation({ name });
      const pricing = resolveWebPrice(
        {
          price,
          isActive: product.isActive,
          activeLotId: lotId ?? product.activeLotId,
          inventoryLots: product.inventoryLots,
        },
        { price, isActive: true },
        now,
      );
      return {
        ...base,
        name: presentation.modelName,
        color: presentation.color,
        lotId,
        lotName,
        stock,
        unitPriceCents: pricing.effectivePrice,
        previousPriceCents: pricing.previousPrice,
        priceRefreshAfterMs: pricing.priceRefreshAfterMs,
      };
    };
    if (!product.lotManaged)
      return variant.isActive
        ? [
            row(
              product.name,
              null,
              null,
              variant.stockQty,
              variant.price ?? product.price,
            ),
          ]
        : [];
    return product.inventoryLots.flatMap((lot) => {
      const live = lot.id === product.activeLotId;
      if (!live && lot.profilePending) return [];
      const profile = lot.profile as Edition | null;
      const editionVariant = profile?.variants?.find(
        (v) => v.id === variant.id,
      );
      if (
        live
          ? !variant.isActive
          : !editionVariant ||
            editionVariant.isActive === false ||
            profile?.currency !== 'EUR'
      )
        return [];
      const price = live
        ? (variant.price ?? product.price)
        : (editionVariant?.price ?? profile?.price);
      if (!Number.isSafeInteger(price) || price! < 0) return [];
      const balance = lot.slices
        .filter((s) => s.variantId === variant.id)
        .reduce((n, s) => n + s.available, 0);
      return [
        row(
          live ? product.name : (profile?.name ?? product.name),
          lot.id,
          lot.name,
          live ? Math.min(variant.stockQty, balance) : balance,
          price!,
        ),
      ];
    });
  });
}
const customerFields = {
  email: true,
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  memberCode: true,
  accountState: true,
  circleLevel: true,
} as const;
const pointFields = {
  id: true,
  name: true,
  city: true,
  venue: true,
  startsOn: true,
} as const;
function customerSummary(
  user: Prisma.UserGetPayload<{ select: typeof customerFields }> | null,
) {
  if (!user) throw new NotFoundException('Acreditación desconocida.');
  assertUsableAccreditation(user);
  return {
    id: user.id,
    email: user.email,
    name:
      accreditationName(
        user.name || [user.firstName, user.lastName].filter(Boolean).join(' '),
      ) || 'Cliente',
    memberCode: user.memberCode,
  };
}
@Controller('admin/register')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class RegisterController {
  constructor(private readonly db: PrismaService) {}
  @Get('points') @Header('Cache-Control', 'no-store') points() {
    return this.db.salePoint.findMany({
      where: { deletedAt: null, archived: false },
      select: pointFields,
      orderBy: { name: 'asc' },
    });
  }
  @Post('customer') @Header('Cache-Control', 'no-store') async customer(
    @Body() data: Credential,
  ) {
    const value = data.content.trim();
    if (value.includes('@') && !value.includes('://')) {
      const email = normalizeEmail(value);
      if (!isEmail(email))
        throw new BadRequestException(
          'Introduce un correo electrónico válido.',
        );
      const matches = await this.db.user.findMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: customerFields,
        take: 2,
      });
      if (!matches.length)
        throw new NotFoundException(
          'No se ha encontrado ninguna cuenta con ese correo',
        );
      if (matches.length !== 1)
        throw new ConflictException(
          'Hay varias cuentas con ese correo. Revisa los datos del cliente.',
        );
      return customerSummary(matches[0]);
    }
    const where: Prisma.UserWhereUniqueInput =
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
        ? { identityUid: value }
        : /^(?:CRX-)?[0-9]{6}$/.test(value)
          ? { memberCode: value }
          : { publicMemberToken: parseAccreditationPayload(value) };
    return customerSummary(
      await this.db.user.findUnique({ where, select: customerFields }),
    );
  }
  @Get('catalog') @Header('Cache-Control', 'no-store') async catalog(
    @Query() query: Search,
  ) {
    const contains = { contains: query.q.trim(), mode: 'insensitive' } as const;
    const products = await this.db.product.findMany({
      where: {
        isActive: true,
        currency: 'EUR',
        OR: [
          { name: contains },
          { slug: contains },
          { variants: { some: { sku: contains } } },
        ],
      },
      include: details,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 25,
      skip: query.offset,
    });
    return {
      more: products.length > 24,
      products: products.slice(0, 24).map((p) => ({
        id: p.id,
        ...labelPresentation(p),
        image: p.imageUrl,
        options: registerOptions(p),
      })),
    };
  }
  @Post('barcode') @Header('Cache-Control', 'no-store') async barcode(
    @Body() data: Barcode,
  ) {
    const lotRecord = await this.db.physicalLotBarcode.findUnique({
      where: { code: data.code },
      select: {
        lotId: true,
        variant: { select: { id: true, product: { include: details } } },
      },
    });
    const record =
      lotRecord ??
      (await this.db.physicalBarcode.findUnique({
        where: { code: data.code },
        select: {
          variant: { select: { id: true, product: { include: details } } },
        },
      }));
    if (!record?.variant)
      throw new NotFoundException('Código de prenda desconocido.');
    const options = registerOptions(record.variant.product).filter(
      (o) =>
        o.variantId === record.variant!.id &&
        o.stock > 0 &&
        (!('lotId' in record) || o.lotId === record.lotId),
    );
    if (!options.length)
      throw new ConflictException('La talla no está disponible para vender.');
    return options;
  }
  @Post('quote') @Header('Cache-Control', 'no-store') quote(
    @Body() data: Quote,
  ) {
    return this.db.$transaction((tx) => quoteRegister(tx, data), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
}

export async function quoteRegister(tx: Prisma.TransactionClient, data: Quote) {
  const point =
    data.pointId == null
      ? null
      : await tx.salePoint.findFirst({
          where: { id: data.pointId, archived: false, deletedAt: null },
          select: pointFields,
        });
  if (data.pointId != null && !point)
    throw new ConflictException('Este punto de venta ya no está disponible.');
  const customer =
    data.userId == null
      ? null
      : customerSummary(
          await tx.user.findUnique({
            where: { id: data.userId },
            select: customerFields,
          }),
        );
  const ids = data.items.map((i) => i.variantId);
  const products = await tx.product.findMany({
    where: { variants: { some: { id: { in: ids } } } },
    include: details,
  });
  const now = new Date();
  const options = products.flatMap((p) => registerOptions(p, now));
  const lines = new Map<
    string,
    (typeof options)[number] & { quantity: number; subtotalCents: number }
  >();
  for (const item of data.items) {
    const opt = options.find(
      (o) => o.variantId === item.variantId && o.lotId === (item.lotId ?? null),
    );
    if (!opt)
      throw new ConflictException(
        'La variante o tirada elegida ya no está disponible.',
      );
    const key = JSON.stringify([opt.variantId, opt.lotId]);
    const quantity = (lines.get(key)?.quantity ?? 0) + item.quantity;
    if (quantity > 999 || quantity > opt.stock)
      throw new ConflictException(
        `Disponibles: ${opt.stock} · ${opt.name}, talla ${opt.size}.`,
      );
    lines.set(key, {
      ...opt,
      quantity,
      subtotalCents: quantity * opt.unitPriceCents,
    });
  }
  const items = [...lines.values()];
  const totalCents = items.reduce((n, i) => n + i.subtotalCents, 0);
  if (!Number.isSafeInteger(totalCents))
    throw new BadRequestException('Importe fuera de rango.');
  const revision = createHash('sha256')
    .update(
      JSON.stringify({
        pointId: point?.id ?? null,
        userId: customer?.id ?? null,
        items: items.map((i) => [
          i.variantId,
          i.lotId,
          i.quantity,
          i.unitPriceCents,
          i.previousPriceCents,
        ]),
      }),
    )
    .digest('hex');
  return {
    revision,
    point,
    customer,
    items,
    totalCents,
    units: items.reduce((n, i) => n + i.quantity, 0),
  };
}
