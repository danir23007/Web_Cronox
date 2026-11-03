import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/roles.decorator';
import { AdminLotsController } from './admin-lots.controller';
import { CreateLotDto, ReconcileHistoricalLotDto } from './lot.dto';

describe('Lot administration boundary', () => {
  it('keeps private costs and reconciliation behind superadmin authentication', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminLotsController)).toEqual(expect.arrayContaining([JwtAuthGuard, AdminGuard, RolesGuard]));
    expect(Reflect.getMetadata(ROLES_KEY, AdminLotsController)).toEqual([Role.SUPERADMIN]);
  });
  it('rejects fractional cents, fractional stock and unbounded receipt arrays', () => {
    const valid = { name: 'Receipt', receivedAt: '2026-11-03', costQuality: 'CONFIRMED', freightTotalCents: 1, otherTotalCents: 0, lines: [{ variantId: 1, quantity: 1, productionCents: 100 }] };
    expect(validateSync(plainToInstance(CreateLotDto, valid))).toHaveLength(0);
    expect(validateSync(plainToInstance(CreateLotDto, { ...valid, freightTotalCents: .5 })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(CreateLotDto, { ...valid, lines: [{ variantId: 1, quantity: 1.5, productionCents: 100 }] })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(CreateLotDto, { ...valid, lines: Array(101).fill(valid.lines[0]) })).length).toBeGreaterThan(0);
  });
  it('requires an explicit version, reason and cost evidence for historical corrections', () => {
    expect(validateSync(plainToInstance(ReconcileHistoricalLotDto, { orderId: 1, itemId: 1, parts: [] })).length).toBeGreaterThan(0);
  });
});
