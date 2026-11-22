import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LabelPreviewDto,
  LabelSelectionDto,
  LabelsQueryDto,
} from './labels.dto';
import {
  labelDocument,
  labelSvg,
  labelPdf,
  validateLabelTemplate,
} from './label-document';
import { defaultLabelTemplate, automaticLabelTemplate } from './label-template';
import { labelPresentation, automaticLabelContent } from './label-presentation';
import { upgradeLabelTemplate } from './label-template-upgrade';
import { SaveLabelTemplateDto, LabelTemplateDefinitionDto } from './labels.dto';

@Injectable()
export class AdminLabelsService {
  constructor(private readonly prisma: PrismaService) {}
  async template() {
    const saved = await this.prisma.labelTemplateSettings.findUnique({
      where: { id: 'global' },
    });
    const converted = saved
      ? upgradeLabelTemplate(
          saved.definition as unknown as LabelTemplateDefinitionDto,
        )
      : null;
    return {
      template: converted?.template ?? defaultLabelTemplate(),
      defaults: defaultLabelTemplate(),
      revision: saved?.revision ?? 0,
      saved: !!saved && !converted?.changed,
      needsMigration: converted?.changed ?? false,
      migrationValid: converted?.valid ?? true,
      notice: converted?.notice ?? '',
    };
  }
  async saveTemplate(dto: SaveLabelTemplateDto, actorId?: number) {
    validateLabelTemplate(dto.template);
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.labelTemplateSettings.findUnique({
          where: { id: 'global' },
          select: { revision: true },
        });
        if (current) {
          const updated = await tx.labelTemplateSettings.updateMany({
            where: { id: 'global', revision: dto.revision },
            data: {
              definition: dto.template as unknown as Prisma.InputJsonValue,
              revision: { increment: 1 },
              updatedBy: actorId,
            },
          });
          if (updated.count !== 1)
            throw new ConflictException(
              'La plantilla ha cambiado en otro dispositivo. Carga la versión guardada antes de volver a editar.',
            );
        } else {
          if (dto.revision !== 0)
            throw new ConflictException(
              'La versión de plantilla no es vigente. Recarga la plantilla.',
            );
          await tx.labelTemplateSettings.create({
            data: {
              id: 'global',
              definition: dto.template as unknown as Prisma.InputJsonValue,
              revision: 1,
              updatedBy: actorId,
            },
          });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Otro administrador acaba de guardar la plantilla. Carga la versión guardada.',
        );
      throw error;
    }
    return this.template();
  }
  async resetTemplate(revision: number, actorId?: number) {
    return this.saveTemplate(
      { revision, template: defaultLabelTemplate() },
      actorId,
    );
  }
  private async definition(dto: LabelPreviewDto) {
    if (dto.template || dto.layout)
      throw new BadRequestException(
        'Etiquetas utiliza el diseño automático fijo de 62 × 35 mm; no admite diseños o medidas enviados desde el navegador.',
      );
    return automaticLabelTemplate();
  }
  async list(query: LabelsQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(query.active ? { isActive: query.active === 'true' } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              {
                variants: {
                  some: { sku: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * 50,
        take: 50,
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          isActive: true,
          images: {
            where: { isActive: true },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
            select: { url: true },
          },
          activeLotId: true,
          inventoryLots: {
            orderBy: { number: 'asc' },
            select: {
              id: true,
              name: true,
              profile: true,
              profilePending: true,
              archived: true,
              slices: { select: { variantId: true, available: true } },
              physicalBarcodes: { select: { variantId: true, code: true } },
            },
          },
          variants: {
            orderBy: { size: 'asc' },
            select: {
              id: true,
              size: true,
              sku: true,
              stockQty: true,
              isActive: true,
              physicalBarcode: { select: { code: true } },
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: items.map((product) => ({
        ...product,
        labelPresentation: labelPresentation(product),
      })),
      page: query.page,
      totalPages: Math.max(1, Math.ceil(total / 50)),
      total,
      layout: automaticLabelTemplate().layout,
    };
  }
  private ids(dto: LabelSelectionDto) {
    if (
      !dto.lines?.length ||
      dto.lines.length > 200 ||
      dto.lines.some(
        (l) =>
          !Number.isInteger(l.variantId) ||
          l.variantId < 1 ||
          l.variantId > 2147483647 ||
          !Number.isInteger(l.quantity) ||
          l.quantity < 1 ||
          l.quantity > 500,
      )
    )
      throw new BadRequestException(
        'Selecciona entre 1 y 200 variantes y entre 1 y 500 etiquetas por variante.',
      );
    const ids = dto.lines.map((l) => l.variantId).sort((a, b) => a - b);
    if (
      new Set(
        dto.lines.map((l) => JSON.stringify([l.variantId, l.lotId ?? null])),
      ).size !== ids.length
    )
      throw new BadRequestException(
        'La selección contiene variantes duplicadas.',
      );
    if (dto.lines.reduce((n, l) => n + l.quantity, 0) > 2000)
      throw new BadRequestException(
        'El límite es de 2000 etiquetas por solicitud.',
      );
    return [...new Set(ids)];
  }
  async generate(dto: LabelSelectionDto) {
    const ids = this.ids(dto);
    return this.prisma.$transaction(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (variants.length !== ids.length)
        throw new BadRequestException(
          'Alguna variante ya no existe. Actualiza la lista.',
        );
      await this.validateLots(tx, dto);
      const legacyIds = dto.lines
        .filter((l) => !l.lotId)
        .map((l) => l.variantId);
      if (legacyIds.length)
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "PhysicalBarcode" ("variantId") SELECT v.id FROM "ProductVariant" v WHERE v.id IN (${Prisma.join(legacyIds)}) ORDER BY v.id ON CONFLICT ("variantId") DO NOTHING`,
        );
      for (const line of [...dto.lines]
        .filter((l) => l.lotId)
        .sort(
          (a, b) =>
            a.variantId - b.variantId || a.lotId!.localeCompare(b.lotId!),
        )) {
        await tx.$executeRaw`INSERT INTO "PhysicalLotBarcode" ("variantId","lotId") VALUES (${line.variantId},${line.lotId!}) ON CONFLICT ("variantId","lotId") DO NOTHING`;
      }
      const items = await tx.physicalBarcode.findMany({
        where: { variantId: { in: legacyIds } },
        orderBy: { variantId: 'asc' },
      });
      const lotItems = dto.lines.some((l) => l.lotId)
        ? await tx.physicalLotBarcode.findMany({
            where: {
              OR: dto.lines
                .filter((l) => l.lotId)
                .map((l) => ({ variantId: l.variantId, lotId: l.lotId })),
            },
          })
        : [];
      const selected = [...items, ...lotItems].filter((i) =>
        dto.lines.some(
          (l) =>
            l.variantId === i.variantId &&
            (l.lotId ?? null) === ('lotId' in i ? i.lotId : null),
        ),
      );
      if (selected.length !== dto.lines.length)
        throw new ConflictException(
          'La selección ha cambiado durante la generación. Actualiza la lista y vuelve a intentarlo.',
        );
      return { items: selected };
    });
  }
  private async validateLots(
    db: Prisma.TransactionClient,
    dto: LabelSelectionDto,
  ) {
    if (!dto.lines.some((l) => l.lotId)) return [];
    const lots = await db.inventoryLot.findMany({
      where: {
        id: { in: dto.lines.flatMap((l) => (l.lotId ? [l.lotId] : [])) },
      },
      include: {
        product: {
          select: { activeLotId: true, variants: { select: { id: true } } },
        },
      },
    });
    for (const line of dto.lines.filter((l) => l.lotId)) {
      const lot = lots.find((l) => l.id === line.lotId);
      const profile = lot?.profile as {
        name?: string;
        variants?: { id: number }[];
      } | null;
      const belongs = lot?.product.variants.some(
        (v) => v.id === line.variantId,
      );
      if (
        !lot ||
        !belongs ||
        (lot.product.activeLotId !== lot.id &&
          (lot.profilePending ||
            !profile?.variants?.some((v) => v.id === line.variantId)))
      )
        throw new BadRequestException(
          'La tirada no contiene esa variante o su ficha est? pendiente de confirmar.',
        );
    }
    return lots;
  }
  private async selectedLines(dto: LabelPreviewDto) {
    const ids = this.ids(dto);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        size: true,
        product: { select: { name: true } },
        physicalBarcode: { select: { code: true } },
      },
    });
    if (variants.length !== ids.length)
      throw new BadRequestException(
        'Alguna variante ya no existe. Actualiza la lista.',
      );
    const lots = await this.validateLots(this.prisma, dto);
    const identities = dto.lines.some((l) => l.lotId)
      ? await this.prisma.physicalLotBarcode.findMany({
          where: {
            OR: dto.lines
              .filter((l) => l.lotId)
              .map((l) => ({ variantId: l.variantId, lotId: l.lotId })),
          },
        })
      : [];
    const lines = dto.lines.map((line) => {
      const v = variants.find((v) => v.id === line.variantId)!;
      const code = line.lotId
        ? identities.find((i) => i.variantId === v.id && i.lotId === line.lotId)
            ?.code
        : v.physicalBarcode?.code;
      if (!code)
        throw new ConflictException({
          code: 'LABEL_CODES_MISSING',
          message:
            'Faltan códigos. Genera los códigos de la selección antes de ver o imprimir.',
        });
      return automaticLabelContent(
        line.lotId &&
          lots.find((l) => l.id === line.lotId)?.product.activeLotId !==
            line.lotId
          ? {
              name:
                (
                  lots.find((l) => l.id === line.lotId)!.profile as {
                    name: string;
                  }
                ).name || v.product.name,
            }
          : v.product,
        v,
        code,
        line.quantity,
      );
    });
    return lines;
  }
  async preview(dto: LabelPreviewDto) {
    const lines = await this.selectedLines(dto);
    const template = await this.definition(dto);
    return {
      html: labelDocument(lines, template),
      firstLabelSvg: labelSvg(lines[0], template),
      quantity: lines.reduce((n, l) => n + l.quantity, 0),
    };
  }
  async pdf(dto: LabelPreviewDto) {
    return labelPdf(await this.selectedLines(dto), await this.definition(dto));
  }
  async resolve(code: string) {
    if (!/^CR[XL]\d{10}$/.test(code))
      throw new BadRequestException('Código interno no válido.');
    {
      const identity = await this.prisma.physicalLotBarcode.findUnique({
        where: { code },
        select: {
          code: true,
          lotId: true,
          variant: {
            select: {
              id: true,
              productId: true,
              size: true,
              sku: true,
              isActive: true,
            },
          },
        },
      });
      if (identity) return identity;
    }
    const identity = await this.prisma.physicalBarcode.findUnique({
      where: { code },
      select: {
        code: true,
        variant: {
          select: {
            id: true,
            productId: true,
            size: true,
            sku: true,
            isActive: true,
          },
        },
      },
    });
    if (!identity?.variant)
      throw new NotFoundException('Código inexistente o variante retirada.');
    return identity;
  }
}
