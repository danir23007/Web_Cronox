import {
  Injectable,
  PayloadTooLargeException,
  RequestTimeoutException,
} from '@nestjs/common';
import {
  CircleUpgradeRequestStatus,
  CircleUpgradeSocialNetwork,
  OrderStatus,
  Prisma,
  Role,
  UserAccountState,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExcelSheetDefinition,
  ExcelWorkbookService,
} from './excel-workbook.service';
import { AdminExportQueryDto } from './dto/admin-export-query.dto';

const MAX_EXPORT_ROWS = 5000;
const TAKE_WITH_LIMIT_SENTINEL = MAX_EXPORT_ROWS + 1;
const EXPORT_TIMEOUT_MS = 30_000;

export type ExportModule =
  | 'usuarios'
  | 'pedidos'
  | 'productos'
  | 'inventario'
  | 'circulos'
  | 'codigos'
  | 'actividad';

export type ExportRequestMetadata = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

const AUDIT_ACTION: Record<ExportModule, string> = {
  usuarios: 'admin.users.export',
  pedidos: 'admin.orders.export',
  productos: 'admin.products.export',
  inventario: 'admin.inventory.export',
  circulos: 'admin.circles.export',
  codigos: 'admin.promo_codes.export',
  actividad: 'admin.audit.export',
};

@Injectable()
export class AdminExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excel: ExcelWorkbookService,
  ) {}

  async export(
    module: ExportModule,
    query: AdminExportQueryDto,
    actorId: number,
    request: ExportRequestMetadata,
  ) {
    const effective =
      query.scope === 'all' ? ({ scope: 'all' } as AdminExportQueryDto) : query;
    const sheets = await this.withTimeout(this.loadSheets(module, effective));
    sheets.forEach((sheet) => this.assertSize(sheet.name, sheet.rows.length));
    const rowCount = sheets.reduce(
      (total, sheet) => total + sheet.rows.length,
      0,
    );
    this.assertSize('exportación completa', rowCount);
    const filterNames =
      query.scope === 'filtered'
        ? Object.entries(query)
            .filter(
              ([key, value]) =>
                key !== 'scope' && value !== undefined && value !== '',
            )
            .map(([key]) => key)
        : [];
    const generatedAt = new Date();
    const buffer = await this.excel.build(
      `CRONOX · ${this.moduleLabel(module)}`,
      sheets,
      filterNames.length > 0,
      generatedAt,
    );
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: AUDIT_ACTION[module],
        actionType: AUDIT_ACTION[module],
        targetType: module,
        metadata: {
          scope: query.scope,
          filterNames,
          rowCount,
          request: {
            ...(request.ip ? { ip: request.ip } : {}),
            ...(request.userAgent ? { userAgent: request.userAgent } : {}),
            ...(request.requestId ? { requestId: request.requestId } : {}),
          },
        },
      },
    });

    return {
      buffer,
      filename: this.excel.timestampedFilename(module, generatedAt),
      rowCount,
    };
  }

  private loadSheets(module: ExportModule, query: AdminExportQueryDto) {
    switch (module) {
      case 'usuarios':
        return this.users(query);
      case 'pedidos':
        return this.orders(query);
      case 'productos':
        return this.products(query);
      case 'inventario':
        return this.inventory(query);
      case 'circulos':
        return this.circles(query);
      case 'codigos':
        return this.promoCodes(query);
      case 'actividad':
        return this.audit(query);
    }
  }

  private async users(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const where: Prisma.UserWhereInput = {};
    const search = query.q || query.search;
    if (search) {
      where.OR = [
        ...['email', 'name', 'firstName', 'lastName', 'phone'].map((field) => ({
          [field]: { contains: search, mode: 'insensitive' },
        })),
        ...(Number.isSafeInteger(Number(search))
          ? [{ id: Number(search) }]
          : []),
      ] as Prisma.UserWhereInput[];
    }
    if (query.email)
      where.email = { contains: query.email, mode: 'insensitive' };
    if (query.phone)
      where.phone = { contains: query.phone, mode: 'insensitive' };
    if (query.role) where.role = query.role;
    if (query.accountState) where.accountState = query.accountState;
    if (query.circle) where.circleLevel = query.circle;
    const sort = ['createdAt', 'email', 'id'].includes(query.sort ?? '')
      ? query.sort!
      : 'createdAt';
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ [sort]: query.order ?? 'desc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        accountState: true,
        circleLevel: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return [
      {
        name: 'Usuarios',
        columns: [
          { header: 'ID usuario', key: 'id', width: 12 },
          { header: 'Nombre', key: 'name', width: 28 },
          { header: 'Email', key: 'email', width: 34 },
          { header: 'Teléfono de cuenta', key: 'phone', width: 22 },
          { header: 'Rol', key: 'role', width: 16 },
          { header: 'Estado', key: 'state', width: 18 },
          { header: 'Círculo', key: 'circle', width: 12 },
          {
            header: 'Alta',
            key: 'createdAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
          {
            header: 'Actualización',
            key: 'updatedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: rows.map((user) => ({
          id: user.id,
          name:
            user.name ||
            [user.firstName, user.lastName].filter(Boolean).join(' '),
          email: user.email,
          phone: user.phone,
          role: this.roleLabel(user.role),
          state: this.accountStateLabel(user.accountState),
          circle: user.circleLevel,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })),
      },
    ];
  }

  private async orders(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const where: Prisma.OrderWhereInput = {};
    const statuses = query.status
      ?.split(',')
      .filter((value): value is OrderStatus =>
        Object.values(OrderStatus).includes(value as OrderStatus),
      );
    if (statuses?.length) where.status = { in: statuses };
    if (query.userId) where.userId = Number(query.userId);
    if (query.email)
      where.customerEmail = { contains: query.email, mode: 'insensitive' };
    const createdAt = this.dateFilter(query);
    if (createdAt) where.createdAt = createdAt;
    if (query.minTotal || query.maxTotal) {
      where.total = {
        ...(query.minTotal ? { gte: new Prisma.Decimal(query.minTotal) } : {}),
        ...(query.maxTotal ? { lte: new Prisma.Decimal(query.maxTotal) } : {}),
      };
    }
    const sort = ['createdAt', 'total', 'status'].includes(query.sort ?? '')
      ? query.sort!
      : 'createdAt';
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: [{ [sort]: query.order ?? 'desc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
    });
    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId: { in: orders.map((order) => order.id) } },
      orderBy: [{ orderId: 'asc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
    });
    const itemRows = orderItems.map((item) => ({
      orderId: item.orderId,
      itemId: item.id,
      productId: item.productId,
      title: item.title,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
      lineTotal: Number(item.lineTotal),
    }));
    return [
      {
        name: 'Pedidos',
        columns: [
          { header: 'ID pedido', key: 'id', width: 12 },
          { header: 'ID usuario', key: 'userId', width: 12 },
          { header: 'Email cliente', key: 'email', width: 34 },
          { header: 'Estado', key: 'status', width: 18 },
          {
            header: 'Subtotal',
            key: 'subtotal',
            width: 15,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Impuestos',
            key: 'tax',
            width: 15,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Tipo IVA',
            key: 'taxRate',
            width: 12,
            numberFormat: '0.00%',
          },
          {
            header: 'Envío',
            key: 'shipping',
            width: 15,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Descuento',
            key: 'discount',
            width: 15,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Total',
            key: 'total',
            width: 15,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          { header: 'Moneda', key: 'currency', width: 10 },
          { header: 'Transportista', key: 'carrier', width: 20 },
          { header: 'Tracking', key: 'tracking', width: 24 },
          {
            header: 'Creado',
            key: 'createdAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
          {
            header: 'Actualizado',
            key: 'updatedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: orders.map((order) => ({
          id: order.id,
          userId: order.userId,
          email: order.customerEmail,
          status: this.orderStatusLabel(order.status),
          subtotal: Number(order.subtotal),
          tax: Number(order.taxAmount),
          taxRate: Number(order.taxRate),
          shipping: order.shippingCost / 100,
          discount: order.discountCents / 100,
          total: Number(order.total),
          currency: order.currency,
          carrier: order.shippingCarrier,
          tracking: order.trackingNumber,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        })),
      },
      {
        name: 'Artículos',
        columns: [
          { header: 'ID pedido', key: 'orderId', width: 12 },
          { header: 'ID línea', key: 'itemId', width: 12 },
          { header: 'ID producto', key: 'productId', width: 12 },
          { header: 'Artículo', key: 'title', width: 36 },
          {
            header: 'Precio unitario',
            key: 'unitPrice',
            width: 18,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Cantidad',
            key: 'quantity',
            width: 12,
            numberFormat: '#,##0',
          },
          {
            header: 'Total línea',
            key: 'lineTotal',
            width: 18,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
        ],
        rows: itemRows,
      },
    ];
  }

  private async products(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const where = await this.productWhere(query);
    let products = await this.prisma.product.findMany({
      where,
      orderBy: [
        { createdAt: query.sortDir ?? query.order ?? 'desc' },
        { id: 'asc' },
      ],
      take: TAKE_WITH_LIMIT_SENTINEL,
      include: {
        categories: { include: { category: true } },
      },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { productId: { in: products.map((product) => product.id) } },
      orderBy: [{ productId: 'asc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
      include: { product: { select: { name: true } } },
    });
    if (query.sortBy === 'stock') {
      const totals = new Map<number, number>();
      variants.forEach((variant) => {
        if (!variant.isActive || variant.stockQty <= 0) return;
        totals.set(
          variant.productId,
          (totals.get(variant.productId) ?? 0) + variant.stockQty,
        );
      });
      const direction = query.sortDir === 'asc' ? 1 : -1;
      products = [...products].sort(
        (left, right) =>
          direction *
            ((totals.get(left.id) ?? 0) - (totals.get(right.id) ?? 0)) ||
          left.id - right.id,
      );
    }
    return [
      {
        name: 'Productos',
        columns: [
          { header: 'ID producto', key: 'id', width: 12 },
          { header: 'Nombre', key: 'name', width: 32 },
          { header: 'Slug', key: 'slug', width: 30 },
          { header: 'Categorías', key: 'categories', width: 30 },
          { header: 'Colección', key: 'collection', width: 20 },
          {
            header: 'Precio',
            key: 'price',
            width: 15,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          { header: 'Moneda', key: 'currency', width: 10 },
          { header: 'Activo', key: 'active', width: 12 },
          { header: 'Palabras de búsqueda', key: 'keywords', width: 40 },
          {
            header: 'Creado',
            key: 'createdAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
          {
            header: 'Actualizado',
            key: 'updatedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: products.map((product) => ({
          id: product.id,
          name: product.name,
          slug: product.slug,
          categories: product.categories
            .map(({ category }) => category.name)
            .join(', '),
          collection: product.collection,
          price: product.price / 100,
          currency: product.currency,
          active: product.isActive ? 'Sí' : 'No',
          keywords: product.searchKeywords.join(', '),
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
        })),
      },
      {
        name: 'Variantes',
        columns: [
          { header: 'ID variante', key: 'id', width: 12 },
          { header: 'ID producto', key: 'productId', width: 12 },
          { header: 'Producto', key: 'product', width: 32 },
          { header: 'Talla', key: 'size', width: 10 },
          { header: 'SKU', key: 'sku', width: 24 },
          {
            header: 'Precio específico',
            key: 'price',
            width: 18,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Stock actual',
            key: 'stock',
            width: 14,
            numberFormat: '#,##0',
          },
          { header: 'Activa', key: 'active', width: 12 },
          {
            header: 'Actualizada',
            key: 'updatedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: variants.map((variant) => ({
          id: variant.id,
          productId: variant.productId,
          product: variant.product.name,
          size: variant.size,
          sku: variant.sku,
          price: variant.price == null ? null : variant.price / 100,
          stock: variant.stockQty,
          active: variant.isActive ? 'Sí' : 'No',
          updatedAt: variant.updatedAt,
        })),
      },
    ];
  }

  private async inventory(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const productWhere = await this.productWhere(query);
    const variantWhere: Prisma.ProductVariantWhereInput = {
      product: productWhere,
    };
    const [variants, movements] = await this.prisma.$transaction(
      [
        this.prisma.productVariant.findMany({
          where: variantWhere,
          orderBy: { id: 'asc' },
          take: TAKE_WITH_LIMIT_SENTINEL,
          include: { product: { select: { id: true, name: true } } },
        }),
        this.prisma.stockMovement.findMany({
          where: { variant: variantWhere },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: TAKE_WITH_LIMIT_SENTINEL,
          include: {
            variant: { include: { product: { select: { name: true } } } },
          },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return [
      {
        name: 'Inventario actual',
        columns: [
          { header: 'ID variante', key: 'id', width: 12 },
          { header: 'ID producto', key: 'productId', width: 12 },
          { header: 'Producto', key: 'product', width: 32 },
          { header: 'Talla', key: 'size', width: 10 },
          { header: 'SKU', key: 'sku', width: 24 },
          {
            header: 'Stock actual',
            key: 'stock',
            width: 14,
            numberFormat: '#,##0',
          },
          { header: 'Activa', key: 'active', width: 12 },
          {
            header: 'Actualizada',
            key: 'updatedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: variants.map((variant) => ({
          id: variant.id,
          productId: variant.product.id,
          product: variant.product.name,
          size: variant.size,
          sku: variant.sku,
          stock: variant.stockQty,
          active: variant.isActive ? 'Sí' : 'No',
          updatedAt: variant.updatedAt,
        })),
      },
      {
        name: 'Movimientos',
        columns: [
          { header: 'ID movimiento', key: 'id', width: 28 },
          { header: 'ID variante', key: 'variantId', width: 12 },
          { header: 'Producto', key: 'product', width: 32 },
          { header: 'Talla', key: 'size', width: 10 },
          { header: 'SKU', key: 'sku', width: 24 },
          {
            header: 'Variación',
            key: 'delta',
            width: 12,
            numberFormat: '+#,##0;-#,##0;0',
          },
          { header: 'Motivo', key: 'reason', width: 36 },
          { header: 'ID pedido', key: 'orderId', width: 12 },
          {
            header: 'Fecha',
            key: 'createdAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: movements.map((movement) => ({
          id: movement.id,
          variantId: movement.variantId,
          product: movement.variant.product.name,
          size: movement.variant.size,
          sku: movement.variant.sku,
          delta: movement.delta,
          reason: movement.reason,
          orderId: movement.orderId,
          createdAt: movement.createdAt,
        })),
      },
    ];
  }

  private async circles(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const date = this.dateFilter(query);
    const userSearch = query.q
      ? {
          OR: [
            {
              email: { contains: query.q, mode: Prisma.QueryMode.insensitive },
            },
            { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {};
    const requestSearch = query.q
      ? {
          OR: [
            {
              username: {
                contains: query.q,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              usernameNormalized: {
                contains: query.q.toLocaleLowerCase('en-US'),
              },
            },
            { user: userSearch },
          ],
        }
      : {};
    const requestWhere: Prisma.CircleUpgradeRequestWhereInput = {
      ...(query.status &&
      Object.values(CircleUpgradeRequestStatus).includes(
        query.status as CircleUpgradeRequestStatus,
      )
        ? { status: query.status as CircleUpgradeRequestStatus }
        : {}),
      ...(date ? { createdAt: date } : {}),
      ...requestSearch,
      ...(query.userCircle
        ? { user: { ...userSearch, circleLevel: query.userCircle } }
        : {}),
      ...(query.socialNetwork &&
      Object.values(CircleUpgradeSocialNetwork).includes(query.socialNetwork)
        ? { socialNetwork: query.socialNetwork }
        : {}),
      ...(query.attemptsMin !== undefined || query.attemptsMax !== undefined
        ? {
            requestNumber: {
              ...(query.attemptsMin !== undefined
                ? { gte: query.attemptsMin }
                : {}),
              ...(query.attemptsMax !== undefined
                ? { lte: query.attemptsMax }
                : {}),
            },
          }
        : {}),
      ...(query.requestType === '2-3' ? { fromCircle: 2, toCircle: 3 } : {}),
      ...(query.requestType === '3-4' ? { fromCircle: 3, toCircle: 4 } : {}),
    };
    const includeLegacyPromotions = !query.requestType;
    const [users, upgrades, promotions] = await this.prisma.$transaction(
      [
        this.prisma.user.findMany({
          where: {
            ...userSearch,
            ...(query.circle ? { circleLevel: query.circle } : {}),
          },
          orderBy: { id: 'asc' },
          take: TAKE_WITH_LIMIT_SENTINEL,
          select: {
            id: true,
            email: true,
            name: true,
            circleLevel: true,
            updatedAt: true,
          },
        }),
        this.prisma.circleUpgradeRequest.findMany({
          where: requestWhere,
          orderBy: [
            {
              [query.sortBy === 'attempts' ? 'requestNumber' : 'createdAt']:
                query.sortDir ?? 'desc',
            },
            { id: 'asc' },
          ],
          take: TAKE_WITH_LIMIT_SENTINEL,
          include: { user: { select: { email: true } } },
        }),
        this.prisma.circlePromotionRequest.findMany({
          where: {
            ...(!includeLegacyPromotions ? { id: { in: [] } } : {}),
            ...(query.status
              ? { status: query.status.toLocaleLowerCase('en-US') }
              : {}),
            ...(date ? { createdAt: date } : {}),
            ...(query.q ? { user: userSearch } : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: TAKE_WITH_LIMIT_SENTINEL,
          include: { user: { select: { email: true } } },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return [
      {
        name: 'Círculos',
        columns: [
          { header: 'ID usuario', key: 'id', width: 12 },
          { header: 'Nombre', key: 'name', width: 28 },
          { header: 'Email', key: 'email', width: 34 },
          { header: 'Círculo', key: 'circle', width: 12 },
          {
            header: 'Actualizado',
            key: 'updatedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          circle: user.circleLevel,
          updatedAt: user.updatedAt,
        })),
      },
      {
        name: 'Solicitudes',
        columns: [
          { header: 'ID solicitud', key: 'id', width: 38 },
          { header: 'Tipo', key: 'type', width: 18 },
          { header: 'ID usuario', key: 'userId', width: 12 },
          { header: 'Email', key: 'email', width: 34 },
          { header: 'Desde círculo', key: 'from', width: 14 },
          { header: 'A círculo', key: 'to', width: 14 },
          { header: 'Estado', key: 'status', width: 18 },
          { header: 'Red social', key: 'network', width: 16 },
          { header: 'Usuario social', key: 'username', width: 24 },
          {
            header: 'Creada',
            key: 'createdAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
          {
            header: 'Procesada',
            key: 'processedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: [
          ...upgrades.map((item) => ({
            id: item.id,
            type: `${item.fromCircle} → ${item.toCircle}`,
            userId: item.userId,
            email: item.user.email,
            from: item.fromCircle,
            to: item.toCircle,
            status: item.status,
            network: item.socialNetwork,
            username: item.username,
            createdAt: item.createdAt,
            processedAt: item.processedAt,
          })),
          ...promotions.map((item) => ({
            id: String(item.id),
            type: '2 → 3',
            userId: item.userId,
            email: item.user.email,
            from: 2,
            to: 3,
            status: item.status,
            network: null,
            username: null,
            createdAt: item.createdAt,
            processedAt: null,
          })),
        ],
      },
    ];
  }

  private async promoCodes(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const where: Prisma.PromoCodeWhereInput = {};
    if (query.q || query.search)
      where.code = { contains: query.q || query.search, mode: 'insensitive' };
    if (query.isActive) where.isActive = query.isActive === 'true';
    const codes = await this.prisma.promoCode.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
    });
    const redemptions = await this.prisma.promoCodeRedemption.findMany({
      where: { promoCodeId: { in: codes.map((code) => code.id) } },
      orderBy: [{ promoCodeId: 'asc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
      include: {
        user: { select: { email: true } },
        promoCode: { select: { code: true } },
      },
    });
    return [
      {
        name: 'Códigos',
        columns: [
          { header: 'ID', key: 'id', width: 10 },
          { header: 'Código', key: 'code', width: 24 },
          { header: 'Tipo', key: 'type', width: 16 },
          {
            header: 'Porcentaje',
            key: 'percentage',
            width: 14,
            numberFormat: '0.00%',
          },
          {
            header: 'Importe fijo',
            key: 'fixedAmount',
            width: 16,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          {
            header: 'Compra mínima',
            key: 'minimum',
            width: 16,
            numberFormat: '#,##0.00 [$€-es-ES]',
          },
          { header: 'Activo', key: 'active', width: 12 },
          { header: 'Un uso/usuario', key: 'single', width: 16 },
          { header: 'Usos', key: 'uses', width: 10 },
          { header: 'Límite', key: 'limit', width: 10 },
          {
            header: 'Inicio',
            key: 'startsAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
          {
            header: 'Caducidad',
            key: 'expiresAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: codes.map((code) => ({
          id: code.id,
          code: code.code,
          type: code.type === 'PERCENT' ? 'Porcentaje' : 'Importe fijo',
          percentage: code.type === 'PERCENT' ? code.value / 100 : null,
          fixedAmount: code.type === 'FIXED' ? code.value / 100 : null,
          minimum: code.minCartValue == null ? null : code.minCartValue / 100,
          active: code.isActive ? 'Sí' : 'No',
          single: code.singleUsePerUser ? 'Sí' : 'No',
          uses: code.usageCount,
          limit: code.usageLimit,
          startsAt: code.startsAt,
          expiresAt: code.expiresAt,
        })),
      },
      {
        name: 'Usos',
        columns: [
          { header: 'ID uso', key: 'id', width: 12 },
          { header: 'Código', key: 'code', width: 24 },
          { header: 'ID usuario', key: 'userId', width: 12 },
          { header: 'Email', key: 'email', width: 34 },
          { header: 'ID pedido', key: 'orderId', width: 12 },
          {
            header: 'Canjeado',
            key: 'redeemedAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
        ],
        rows: redemptions.map((use) => ({
          id: use.id,
          code: use.promoCode.code,
          userId: use.userId,
          email: use.user.email,
          orderId: use.orderId,
          redeemedAt: use.redeemedAt,
        })),
      },
    ];
  }

  private async audit(
    query: AdminExportQueryDto,
  ): Promise<ExcelSheetDefinition[]> {
    const where: Prisma.AuditLogWhereInput = {};
    const and: Prisma.AuditLogWhereInput[] = [];
    if (query.actionType)
      and.push({
        OR: [
          { actionType: query.actionType },
          { actionType: null, action: query.actionType },
        ],
      });
    if (query.targetType) and.push({ targetType: query.targetType });
    const date = this.dateFilter(query);
    if (date) and.push({ createdAt: date });
    if (query.q)
      and.push({
        OR: [
          { targetId: { contains: query.q, mode: 'insensitive' } },
          { action: { contains: query.q, mode: 'insensitive' } },
          { actor: { email: { contains: query.q, mode: 'insensitive' } } },
        ],
      });
    if (and.length) where.AND = and;
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: TAKE_WITH_LIMIT_SENTINEL,
      include: { actor: { select: { id: true, email: true, name: true } } },
    });
    return [
      {
        name: 'Actividad',
        columns: [
          { header: 'ID', key: 'id', width: 12 },
          {
            header: 'Fecha',
            key: 'createdAt',
            width: 20,
            numberFormat: 'yyyy-mm-dd hh:mm',
          },
          { header: 'ID administrador', key: 'actorId', width: 16 },
          { header: 'Administrador', key: 'actor', width: 34 },
          { header: 'Acción', key: 'action', width: 30 },
          { header: 'Tipo objetivo', key: 'targetType', width: 20 },
          { header: 'ID objetivo', key: 'targetId', width: 22 },
          { header: 'Motivo', key: 'reason', width: 40 },
        ],
        rows: items.map((item) => ({
          id: item.id,
          createdAt: item.createdAt,
          actorId: item.actorId,
          actor: item.actor?.email || item.actor?.name || null,
          action: item.actionType || item.action,
          targetType: item.targetType,
          targetId: item.targetId,
          reason: item.reason,
        })),
      },
    ];
  }

  private async productWhere(
    query: AdminExportQueryDto,
  ): Promise<Prisma.ProductWhereInput> {
    const where: Prisma.ProductWhereInput = {};
    const search = query.q || query.search;
    if (search)
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { searchText: { contains: search, mode: 'insensitive' } },
        {
          variants: {
            some: { sku: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    if (query.category || query.categoryId) {
      const category = query.category ?? String(query.categoryId);
      const categoryId = query.categoryId ?? Number(category);
      where.categories = {
        some: {
          category: {
            OR: [
              ...(Number.isSafeInteger(categoryId) ? [{ id: categoryId }] : []),
              { slug: category },
              { name: { equals: category, mode: 'insensitive' } },
            ],
          },
        },
      };
    }
    if (query.isActive) where.isActive = query.isActive === 'true';
    const createdAt = this.dateFilter(query);
    if (createdAt) where.createdAt = createdAt;
    const stockState = query.stockState ?? query.stockStatus;
    if (stockState) {
      const total = query.stockState
        ? Prisma.sql`COALESCE(SUM(v."stock"), 0)`
        : Prisma.sql`COALESCE(SUM(CASE WHEN v."isActive" THEN GREATEST(v."stock", 0) ELSE 0 END), 0)`;
      const condition =
        stockState === 'in_stock'
          ? Prisma.sql`${total} > 0`
          : stockState === 'low'
            ? Prisma.sql`${total} > 0 AND ${total} <= 5`
            : Prisma.sql`${total} = 0`;
      const rows = await this.prisma.$queryRaw<
        Array<{ id: number }>
      >(Prisma.sql`
        SELECT p.id
        FROM "Product" p
        LEFT JOIN "ProductVariant" v ON v."productId" = p.id
        GROUP BY p.id
        HAVING ${condition}
      `);
      where.id = { in: rows.map((row) => row.id) };
    }
    return where;
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new RequestTimeoutException(
              'La exportación superó el tiempo máximo de 30 segundos. Aplica filtros y vuelve a intentarlo.',
            ),
          ),
        EXPORT_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private dateFilter(
    query: AdminExportQueryDto,
  ): Prisma.DateTimeFilter | undefined {
    if (!query.dateFrom && !query.dateTo) return undefined;
    const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;
    const dateOnlyEnd = Boolean(
      query.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo),
    );
    if (dateTo && dateOnlyEnd) dateTo.setUTCDate(dateTo.getUTCDate() + 1);
    return {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(dateTo ? (dateOnlyEnd ? { lt: dateTo } : { lte: dateTo }) : {}),
    };
  }

  private assertSize(sheet: string, count: number) {
    if (count > MAX_EXPORT_ROWS)
      throw new PayloadTooLargeException(
        `La hoja ${sheet} supera el máximo de ${MAX_EXPORT_ROWS} registros. Aplica filtros o un rango de fechas.`,
      );
  }

  private moduleLabel(module: ExportModule) {
    return {
      usuarios: 'Usuarios',
      pedidos: 'Pedidos',
      productos: 'Productos',
      inventario: 'Inventario',
      circulos: 'Círculos',
      codigos: 'Códigos',
      actividad: 'Actividad',
    }[module];
  }

  private roleLabel(role: Role) {
    return (
      {
        USER: 'Usuario',
        FRIEND: 'Friend',
        ADMIN: 'Admin',
        SUPERADMIN: 'Super Admin',
      } as Record<Role, string>
    )[role];
  }
  private accountStateLabel(state: UserAccountState) {
    return state;
  }
  private orderStatusLabel(status: OrderStatus) {
    return (
      {
        PENDING: 'Pendiente',
        PAID: 'Pagado',
        DISPUTED: 'En disputa',
        PROCESSING: 'En preparación',
        DELIVERED: 'Entregado',
        CANCELLED: 'Cancelado',
        REFUNDED: 'Reembolsado',
        SHIPPED: 'Enviado',
      } as Record<OrderStatus, string>
    )[status];
  }
}
