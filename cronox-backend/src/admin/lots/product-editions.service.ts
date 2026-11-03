import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VariantSize } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveEditionDto } from './edition.dto';
import { buildProductSearchText, normalizeSearchKeywords } from '../../products/product-search';
import { assertSizesMatchSystem, PRODUCT_SIZE_SYSTEMS } from '../../products/product-size-system';
import { receiptSlices } from '../../inventory-lots/lot-costs';
import { projectLotStock } from '../../inventory-lots/lot-ledger';
import { receiptDate, receiptDay } from './receipt-date';
type Tx = Prisma.TransactionClient;
// JSON stores the complete editable commercial configuration, never identity,
// global visibility, sold quantities or mutable stock counters.
type Profile = Record<string, any>;
@Injectable()
export class ProductEditionsService {
  constructor(private readonly db: PrismaService) {}
  private async lock(tx: Tx, productId: number) {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${productId} FOR UPDATE`;
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE "productId"=${productId} ORDER BY id FOR UPDATE`;
    return product;
  }
  private async capture(tx: Tx, productId: number): Promise<Profile> {
    const [row] = await tx.$queryRaw<Array<{ profile: Profile }>>`SELECT cronox_lot_profile(${productId}::int) AS profile`;
    const allowed: readonly string[] = PRODUCT_SIZE_SYSTEMS[row.profile.sizeSystem] ?? [];
    row.profile.variants = row.profile.variants.filter((variant: Profile)=>allowed.includes(variant.size));
    return row.profile;
  }
  private async audit(tx: Tx, lotId: string, actor: number, reason: string, before: unknown, after: unknown) {
    await tx.inventoryLotAudit.create({ data: { id: randomUUID(), lotId, actorId: actor, reason, before: before == null ? Prisma.JsonNull : before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue } });
  }
  private async result(tx: Tx, productId: number) {
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const lots = await tx.inventoryLot.findMany({ where: { productId }, orderBy: { number: 'asc' }, include: { slices: true, history: { orderBy: { createdAt: 'desc' } } } });
    const live = await this.capture(tx, productId);
    return { product: { id: product.id, slug: product.slug, isActive: product.isActive, activeLotId: product.activeLotId }, lots: lots.map(lot => {
      const profile = (lot.id === product.activeLotId ? live : lot.profile ?? {}) as Profile;
      return { ...lot, receivedAt: receiptDay(lot.receivedAt), profile: { ...profile, id: product.id, slug: product.slug, isActive: product.isActive, updatedAt: lot.id === product.activeLotId ? product.updatedAt.toISOString() : undefined, privateCost: { unitCostCents: profile.unitCostCents ?? null },
        categories: (profile.categoryIds ?? []).map((categoryId: number) => ({ categoryId })),
        variants: (profile.variants ?? []).map((v: Profile) => ({ ...v, stockQty: lot.slices.filter(s => s.variantId === v.id).reduce((n,s) => n+s.available,0) })) } };
    }) };
  }
  async list(productId: number) { return this.db.$transaction(tx => this.result(tx, productId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }); }
  async duplicate(productId: number, sourceId: string, revision: number, key: string, actor: number) {
    if (!key || key.length < 16 || key.length > 100) throw new BadRequestException('Clave de operación inválida.');
    return this.db.$transaction(async tx => {
      const product = await this.lock(tx, productId);
      const requestKey = 'edition:' + key;
      const replay = await tx.inventoryLot.findUnique({ where: { requestKey } });
      if (replay) { if (replay.productId !== productId || replay.requestHash !== sourceId+':'+revision) throw new ConflictException('Clave reutilizada.'); return { id: replay.id, ...(await this.result(tx,productId)) }; }
      const source = await tx.inventoryLot.findFirst({ where: { id: sourceId, productId } });
      if (!source || source.revision !== revision) throw new ConflictException('La tirada cambió. Recarga antes de duplicar.');
      const profile = product.activeLotId === sourceId ? await this.capture(tx,productId) : source.profile as Profile;
      const max = await tx.inventoryLot.aggregate({ where: { productId }, _max: { number: true } });
      const number = (max._max.number ?? 0)+1, id = randomUUID();
      await tx.inventoryLot.create({ data: { id, productId, number, name: 'Lote '+number, costQuality: 'UNKNOWN', profile, requestKey, requestHash: sourceId+':'+revision } });
      await this.audit(tx,id,actor,'Duplicar configuración sin stock ni gastos',null,{ sourceId, number });
      return { id, ...(await this.result(tx,productId)) };
    });
  }
  private async project(tx: Tx, productId: number, lotId: string, profile: Profile) {
    const scalar: Profile = {};
    for (const key of ['name','description','price','currency','collection','searchKeywords','cardImagePositionX','cardImagePositionY','cardImageZoom','sizeSystem','lastUnitsThreshold']) if (profile[key] !== undefined) scalar[key]=profile[key];
    const current = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const images: Profile[] = profile.images ?? [];
    scalar.imageUrl = images.find(i => i.isActive !== false && i.isPrimary)?.url ?? images.find(i => i.isActive !== false)?.url ?? null;
    scalar.searchText = buildProductSearchText({ ...current, ...scalar });
    await tx.product.update({ where: { id: productId }, data: { ...scalar, activeLotId: lotId } });
    await tx.productCategory.deleteMany({ where: { productId } });
    if (profile.categoryIds?.length) await tx.productCategory.createMany({ data: profile.categoryIds.map((categoryId: number) => ({ productId, categoryId })), skipDuplicates: true });
    // Projection rows may be replaced; the files and every edition's own image
    // metadata remain in its profile. No storage deletion is performed here.
    await tx.productImage.deleteMany({ where: { productId } });
    for (const image of images) {
      const data: Profile = { productId };
      for (const key of ['url','storageKey','mimeType','fileSize','width','height','variants','alt','sortOrder','isPrimary','isActive','galleryPositionX','galleryPositionY','galleryZoom','galleryFit']) if (image[key] != null) data[key]=image[key];
      await tx.productImage.create({ data: data as Prisma.ProductImageUncheckedCreateInput });
    }
    await tx.productVariant.updateMany({ where: { productId }, data: { isActive: false } });
    for (const variant of profile.variants ?? []) await tx.productVariant.update({ where: { id: variant.id }, data: { isActive: variant.isActive !== false, price: variant.price ?? null } });
    await tx.productCost.upsert({ where: { productId }, create: { productId, unitCostCents: profile.unitCostCents ?? null }, update: { unitCostCents: profile.unitCostCents ?? null } });
    for (const v of await tx.productVariant.findMany({ where: { productId }, select: { id: true } })) await projectLotStock(tx,v.id);
  }
  async activate(productId: number, lotId: string, revision: number, actor: number) {
    return this.db.$transaction(async tx => {
      const product = await this.lock(tx,productId);
      const lot = await tx.inventoryLot.findFirst({ where: { id: lotId, productId } });
      if (!lot || lot.revision !== revision || !lot.profile) throw new ConflictException('La tirada cambió. Recarga antes de activar.');
      if (product.activeLotId !== lotId) {
        if (product.activeLotId) await tx.inventoryLot.update({ where: { id: product.activeLotId }, data: { profile: await this.capture(tx,productId) } });
        await this.project(tx,productId,lotId,lot.profile as Profile);
        await this.audit(tx,lotId,actor,'Activar tirada', { activeLotId: product.activeLotId },{ activeLotId: lotId });
      }
      return this.result(tx,productId);
    });
  }
  async save(productId: number, lotId: string, dto: SaveEditionDto, actor: number, key?: string) {
    if (key && !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new BadRequestException('Clave de guardado inválida.');
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    return this.db.$transaction(async tx => {
      const product = await this.lock(tx,productId);
      const lot = await tx.inventoryLot.findFirst({ where: { id: lotId, productId }, include: { slices: { include: { allocations: true } } } });
      if (lot && key) {
        const previous = await tx.inventoryLotAudit.findFirst({ where: { lotId, after: { path: ['saveRequestKey'], equals: key } } });
        if (previous) {
          if (previous.actorId !== actor || (previous.after as Profile).saveRequestHash !== requestHash) throw new ConflictException('Esta clave de guardado ya corresponde a otros datos.');
          return this.result(tx,productId);
        }
      }
      if (!lot || lot.revision !== dto.revision) throw new ConflictException('La tirada cambió. Recarga antes de guardar.');
      if (product.activeLotId === lotId && dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== product.updatedAt.getTime()) throw new ConflictException('La ficha activa cambió en otra sesión. Recarga antes de sobrescribirla.');
      if (dto.isActive !== undefined && dto.expectedVisibility !== undefined && product.isActive !== dto.expectedVisibility) throw new ConflictException('La visibilidad del producto cambió en otra sesión. Recarga antes de modificarla.');
      const lotDate = dto.receivedAt === undefined ? lot.receivedAt : receiptDate(dto.receivedAt);
      const movementDate = dto.receiptReceivedAt === undefined ? lotDate : receiptDate(dto.receiptReceivedAt);
      if (dto.freightTotalCents != null && dto.freightTotalCents !== 0) throw new BadRequestException('El coste por unidad de este editor ya incluye el transporte. No añadas un transporte separado.');
      const before = product.activeLotId === lotId ? await this.capture(tx,productId) : lot.profile as Profile;
      const profile: Profile = { ...before };
      for (const key of ['name','description','price','currency','collection','cardImagePositionX','cardImagePositionY','cardImageZoom','sizeSystem','lastUnitsThreshold','unitCostCents','categoryIds']) if (dto[key] !== undefined) profile[key]=dto[key];
      if (dto.searchKeywords) profile.searchKeywords=normalizeSearchKeywords(dto.searchKeywords);
      if (dto.galleryImages) profile.images=dto.galleryImages.map(({ id, ...image }) => image);
      if (!String(profile.name ?? '').trim() || !Number.isSafeInteger(profile.price) || profile.price<=0) throw new BadRequestException('Nombre y precio válidos obligatorios.');
      if ((profile.images ?? []).length > 30 || (profile.images ?? []).filter((i: Profile) => i.isActive && i.isPrimary).length > 1) throw new BadRequestException('Revisa la galería y su imagen principal.');
      const variants = dto.variants ?? before.variants;
      assertSizesMatchSystem(profile.sizeSystem, variants.map((v: Profile) => v.size));
      if (new Set(variants.map((v: Profile) => v.size)).size !== variants.length) throw new BadRequestException('Tallas duplicadas.');
      const received: Array<{ variantId: number; quantity: number; productionCents: number | null }> = [];
      profile.variants=[];
      for (const input of variants) {
        const variant = await tx.productVariant.upsert({ where: { productId_size: { productId, size: input.size as VariantSize } }, create: { productId, size: input.size as VariantSize, sku: 'edition-'+productId+'-'+input.size, stockQty: 0, isActive: false }, update: {} });
        const original = before.variants?.find((v: Profile) => v.size === input.size);
        profile.variants.push({ id: variant.id, size: variant.size, sku: variant.sku, price: input.price === undefined ? original?.price ?? null : input.price, isActive: input.isActive ?? original?.isActive ?? true });
        const available = lot.slices.filter(s => s.variantId===variant.id).reduce((n,s)=>n+s.available,0);
        const target = input.stockQty ?? input.stock ?? available;
        const expected = dto.expectedStocks?.find(v=>v.size===input.size)?.available;
        if ((input.stockQty !== undefined || input.stock !== undefined) && expected === undefined) throw new ConflictException('Recarga las existencias de esta tirada antes de guardar.');
        if (expected !== undefined && target===expected) continue;
        if (expected !== undefined && available!==expected) throw new ConflictException('El stock cambió mientras editabas. Recarga antes de registrar la recepción.');
        if (!Number.isSafeInteger(target) || target < available || target>100000) throw new BadRequestException('Las entradas no pueden retirar stock. Usa el ajuste de inventario para bajas justificadas.');
        if (target>available) received.push({ variantId: variant.id, quantity: target-available, productionCents: profile.unitCostCents ?? null });
      }
      const other = dto.otherTotalCents === undefined ? 0 : dto.otherTotalCents;
      if (!received.length && ((other ?? 0) > 0 || dto.receiptReceivedAt !== undefined)) throw new BadRequestException('Para registrar una fecha de entrada o gastos adicionales, añade unidades. La fecha de la tirada se puede corregir sin cambiar el stock.');
      const receipt = received.length ? { id: key ?? randomUUID(), receivedAt: receiptDay(movementDate), lines: received, freightTotalCents: 0, otherTotalCents: other, unitCostIncludesFreight: true } : null;
      if (received.length) {
        if (!movementDate) throw new BadRequestException('Indica la fecha de recepción de esta entrada de unidades.');
        const slices=receiptSlices(received,0,other);
        for (const s of slices) await tx.inventoryLotSlice.create({ data: { id: randomUUID(), lotId, variantId:s.variantId, received:s.quantity,available:s.quantity,productionCents:s.productionCents,freightCents:s.freightCents,otherCents:s.otherCents } });
        for (const line of received) await tx.stockMovement.create({ data: { variantId:line.variantId,delta:line.quantity,reason:'lot_receipt',note:'Lote: '+lotId,userId:actor } });
      }
      const complete = profile.unitCostCents != null && other != null;
      const hasReceipts = lot.slices.some(slice => slice.received > 0);
      await tx.inventoryLot.update({ where: { id:lotId }, data: { profile, receivedAt: lotDate, revision:{increment:1}, ...(received.length ? { costQuality:hasReceipts ? lot.costQuality : complete?'CONFIRMED':'UNKNOWN', freightTotalCents:hasReceipts ? lot.freightTotalCents : 0, otherTotalCents:other == null || (hasReceipts && lot.otherTotalCents == null) ? null : (lot.otherTotalCents ?? 0)+other } : {}), notes:dto.notes ?? lot.notes } });
      if (dto.isActive !== undefined) await tx.product.update({ where: { id:productId },data:{isActive:dto.isActive} });
      if (product.activeLotId===lotId) await this.project(tx,productId,lotId,profile);
      await this.audit(tx,lotId,actor,'Guardar ficha de tirada y entradas documentadas',{profile:before,receivedAt:receiptDay(lot.receivedAt)},{profile,receivedAt:receiptDay(lotDate),receipt,received,freightTotalCents:0,otherTotalCents:received.length?other:0,...(key?{saveRequestKey:key,saveRequestHash:requestHash}:{})});
      return this.result(tx,productId);
    });
  }
}
