import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserAccountState } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequiredJwtSecret } from '../../common/config/environment';
import { ProductService } from '../../products/product.service';
import { AdminUsersService } from '../users/admin-users.service';
import { AdminUserQueryDto } from '../users/dto/admin-user-query.dto';
import { AdminProductQueryDto } from '../products/dto/admin-product-query.dto';
import { BulkExecuteDto, BulkPreviewDto } from './admin-bulk.dto';
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sorted = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);
@Injectable()
export class AdminBulkService {
  private jwt = new JwtService();
  constructor(
    private db: PrismaService,
    private users: AdminUsersService,
    private products: ProductService,
  ) {}
  private async actor(tx: Prisma.TransactionClient, id: number) {
    const user = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        accountState: true,
        sessionVersion: true,
      },
    });
    if (user?.role !== 'SUPERADMIN' || user.accountState !== 'ACTIVE')
      throw new ForbiddenException('Solo SUPERADMIN puede editar en bloque.');
    return user;
  }
  async select(
    kind: 'users' | 'products',
    query: AdminUserQueryDto | AdminProductQueryDto,
    actor: number,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.actor(tx, actor);
        const rows =
          kind === 'users'
            ? await this.users.selectBulkIds(query as AdminUserQueryDto, tx)
            : await this.products.selectBulkIds(
                query as AdminProductQueryDto,
                tx,
              );
        if (rows.length > 100)
          throw new BadRequestException(
            'Hay más de 100 resultados. Acota los filtros; no se ha seleccionado un subconjunto.',
          );
        return { ids: rows.map((r) => r.id), limit: 100 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private normalize(dto: BulkPreviewDto) {
    if (!dto.changes || typeof dto.changes !== 'object')
      throw new BadRequestException('Indica los cambios.');
    const c = dto.changes;
    if (Object.values(c).some((v) => v === null))
      throw new BadRequestException('No se admiten valores nulos.');
    const allowed =
      dto.kind === 'users'
        ? ['role', 'circleLevel', 'accountState']
        : ['isActive', 'categoryMode', 'categoryIds'];
    if (
      Object.entries(c).some(
        ([k, v]) => v !== undefined && !allowed.includes(k),
      )
    )
      throw new BadRequestException('Campo no permitido para este listado.');
    if (c.categoryMode === 'clear' && c.categoryIds?.length)
      throw new BadRequestException(
        'Vaciar categorías no admite una selección.',
      );
    if (c.categoryMode && c.categoryMode !== 'clear' && !c.categoryIds?.length)
      throw new BadRequestException(
        'Selecciona al menos una categoría; para vaciar utiliza la acción explícita.',
      );
    if (c.categoryIds && !c.categoryMode)
      throw new BadRequestException('Indica la operación de categorías.');
    const changes = Object.fromEntries(
      Object.entries(c)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, k === 'categoryIds' ? sorted(v as number[]) : v]),
    );
    return { kind: dto.kind, ids: sorted(dto.ids), changes };
  }
  private async plan(
    tx: Prisma.TransactionClient,
    dto: BulkPreviewDto,
    actorId: number,
  ) {
    const actor = await this.actor(tx, actorId),
      normalized = this.normalize(dto),
      c = dto.changes;
    const categories = c.categoryIds?.length
      ? await tx.category.findMany({
          where: { id: { in: sorted(c.categoryIds) } },
          select: { id: true, name: true, isActive: true, updatedAt: true },
          orderBy: { id: 'asc' },
        })
      : [];
    if (categories.length !== sorted(c.categoryIds || []).length)
      throw new BadRequestException('Alguna categoría ya no existe.');
    const records =
      dto.kind === 'users'
        ? await tx.user.findMany({
            where: { id: { in: normalized.ids } },
            select: {
              id: true,
              name: true,
              role: true,
              circleLevel: true,
              accountState: true,
              password: true,
              preRegistration: { select: { userId: true } },
              sessionVersion: true,
              updatedAt: true,
            },
            orderBy: { id: 'asc' },
          })
        : await tx.product.findMany({
            where: { id: { in: normalized.ids } },
            select: {
              id: true,
              name: true,
              isActive: true,
              updatedAt: true,
              categories: {
                select: { categoryId: true },
                orderBy: { categoryId: 'asc' },
              },
            },
            orderBy: { id: 'asc' },
          });
    if (records.length !== normalized.ids.length)
      throw new ConflictException(
        'Hay registros eliminados o inexistentes. Actualiza el listado y revisa la selección.',
      );
    const rows = records.map((r: any) => {
      const before =
        dto.kind === 'users'
          ? {
              role: r.role,
              circleLevel: r.circleLevel,
              accountState: r.accountState,
            }
          : {
              isActive: r.isActive,
              categoryIds: r.categories.map((a: any) => a.categoryId),
            };
      const after = { ...before };
      let reason = '';
      if (dto.kind === 'users') {
        if (r.role === 'SUPERADMIN') reason = 'Cuenta SUPERADMIN protegida.';
        if ((c.role || c.accountState) && r.id === actorId)
          reason = 'No puedes cambiar tu propio rol ni estado.';
        if (c.role !== undefined) after.role = c.role;
        if (c.circleLevel !== undefined) after.circleLevel = c.circleLevel;
        if (c.accountState !== undefined) {
          after.accountState = c.accountState;
          if (!reason && c.accountState !== r.accountState) {
            if (c.accountState === UserAccountState.ACTIVE && !r.password)
              throw new BadRequestException(
                `Usuario #${r.id}: para activar la cuenta debe establecer primero una contraseña.`,
              );
            if (
              c.accountState === UserAccountState.PENDING_PASSWORD &&
              r.password
            )
              throw new BadRequestException(
                `Usuario #${r.id}: Pendiente de contraseña requiere una cuenta sin contraseña.`,
              );
            if (
              c.accountState === UserAccountState.PRE_REGISTERED &&
              (!r.preRegistration || r.password)
            )
              throw new BadRequestException(
                `Usuario #${r.id}: Prerregistrado requiere un prerregistro existente y una cuenta sin contraseña.`,
              );
          }
        }
      } else {
        if (c.isActive !== undefined) after.isActive = c.isActive;
        if (c.categoryMode === 'clear') after.categoryIds = [];
        if (c.categoryMode === 'replace')
          after.categoryIds = sorted(c.categoryIds!);
        if (c.categoryMode === 'add')
          after.categoryIds = sorted([
            ...before.categoryIds!,
            ...c.categoryIds!,
          ]);
        if (c.categoryMode === 'remove')
          after.categoryIds = before.categoryIds!.filter(
            (id: number) => !c.categoryIds!.includes(id),
          );
      }
      const state = reason
        ? 'excluded'
        : digest(before) === digest(after)
          ? 'unchanged'
          : 'changed';
      return {
        id: r.id,
        name: r.name || `Usuario #${r.id}`,
        state,
        reason,
        before,
        after,
      };
    });
    const counts = {
      changed: rows.filter((r) => r.state === 'changed').length,
      unchanged: rows.filter((r) => r.state === 'unchanged').length,
      excluded: rows.filter((r) => r.state === 'excluded').length,
    };
    return {
      normalized,
      rows,
      counts,
      categories,
      records,
      actor,
      version: digest({ normalized, records, categories, actor }),
    };
  }
  async preview(dto: BulkPreviewDto, actor: number) {
    return this.db.$transaction(
      async (tx) => {
        const p = await this.plan(tx, dto, actor);
        const reviewToken = this.jwt.sign(
          { version: p.version, actor, requestHash: digest(p.normalized) },
          {
            secret: getRequiredJwtSecret('JWT_ACCESS_SECRET'),
            audience: 'admin-bulk-review',
            expiresIn: '15m',
          },
        );
        return {
          rows: p.rows,
          counts: p.counts,
          categories: p.categories.map((c) => ({ id: c.id, name: c.name })),
          reviewToken,
          limit: 100,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async result(id: string, actor: number) {
    const op = await this.db.adminBulkOperation.findFirst({
      where: { id, actorId: actor },
    });
    if (!op)
      throw new NotFoundException(
        'Resultado aún no confirmado. Puedes consultar de nuevo o reintentar la misma operación.',
      );
    return op.result;
  }
  async execute(dto: BulkExecuteDto, actor: number) {
    const normalized = this.normalize(dto),
      requestHash = digest(normalized);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            // Serializes retries of this exact operation across all backend processes.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.operationId},0))`;
            await this.actor(tx, actor);
            const existing = await tx.adminBulkOperation.findUnique({
              where: { id: dto.operationId },
            });
            if (existing) {
              if (
                existing.actorId !== actor ||
                existing.requestHash !== requestHash
              )
                throw new ConflictException(
                  'Identificador de operación usado para otros cambios.',
                );
              return existing.result;
            }
            let token: any;
            try {
              token = this.jwt.verify(dto.reviewToken, {
                secret: getRequiredJwtSecret('JWT_ACCESS_SECRET'),
                algorithms: ['HS256'],
                audience: 'admin-bulk-review',
              });
            } catch {
              throw new ConflictException(
                'La revisión ha caducado. Revisa de nuevo antes de aplicar.',
              );
            }
            const p = await this.plan(tx, dto, actor);
            if (
              token.actor !== actor ||
              token.requestHash !== requestHash ||
              token.version !== p.version
            )
              throw new ConflictException(
                'Los datos o permisos han cambiado. Revisa el resumen actualizado antes de aplicar.',
              );
            if (!p.counts.changed)
              throw new BadRequestException('No hay cambios que aplicar.');
            for (const row of p.rows.filter((r) => r.state === 'changed')) {
              if (dto.kind === 'users') {
                const original = p.records.find((r) => r.id === row.id)!;
                await this.users.updateAdminUser(
                  row.id,
                  {
                    ...dto.changes,
                    expectedUpdatedAt: original.updatedAt.toISOString(),
                  },
                  actor,
                  {},
                  tx,
                );
              } else {
                if (dto.changes.categoryMode)
                  await this.products.replaceProductCategories(
                    row.id,
                    row.after.categoryIds!,
                    actor,
                    tx,
                  );
                await tx.product.update({
                  where: { id: row.id },
                  data: {
                    ...(dto.changes.isActive !== undefined
                      ? { isActive: dto.changes.isActive }
                      : {}),
                    updatedAt: new Date(),
                  },
                });
              }
            }
            const result = {
              operationId: dto.operationId,
              kind: dto.kind,
              counts: p.counts,
              rows: p.rows.map(({ id, state, reason }) => ({
                id,
                state,
                reason,
              })),
            };
            await tx.auditLog.create({
              data: {
                actorId: actor,
                action: 'admin.bulk.update',
                actionType: 'admin.bulk.update',
                targetType: dto.kind,
                targetId: dto.operationId,
                metadata: { changes: normalized.changes, records: result.rows },
              },
            });
            await tx.adminBulkOperation.create({
              data: {
                id: dto.operationId,
                actorId: actor,
                requestHash,
                result: result as Prisma.InputJsonValue,
              },
            });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 30000,
          },
        );
      } catch (e: any) {
        if ((e.code === 'P2034' || e.code === 'P2002') && attempt < 2) continue;
        if (e.code === 'P2034')
          throw new ConflictException(
            'Los datos han cambiado simultáneamente. Revisa de nuevo.',
          );
        throw e;
      }
    }
  }
}
