import { ValidationPipe } from '@nestjs/common';
import { BulkPreviewDto } from './admin-bulk.dto';
import { AdminBulkController } from './admin-bulk.controller';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
describe('bulk contract security', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  it('protects all operations including result retrieval', () =>
    expect(Reflect.getMetadata('__guards__', AdminBulkController)).toEqual([
      JwtAuthGuard,
      SuperAdminGuard,
    ]));
  it.each([
    { kind: 'users', ids: [1], changes: { role: 'SUPERADMIN' } },
    { kind: 'users', ids: [1], changes: { password: 'forbidden' } },
    { kind: 'users', ids: [1], changes: { circleLevel: 0 } },
    { kind: 'users', ids: [1], changes: { accountState: 'UNKNOWN' } },
    { kind: 'products', ids: [1], changes: { price: 10 } },
    { kind: 'products', ids: [2147483648], changes: { isActive: true } },
    { kind: 'products', ids: [], changes: { isActive: true } },
    { kind: 'products', ids: Array(101).fill(1), changes: { isActive: true } },
    {
      kind: 'products',
      ids: [1],
      changes: { categoryMode: 'replace', categoryIds: [-1] },
    },
  ])('rejects unsupported IDs/fields %j', async (payload) => {
    await expect(
      pipe.transform(payload, { type: 'body', metatype: BulkPreviewDto }),
    ).rejects.toThrow();
  });
  it.each(['ACTIVE', 'PENDING_PASSWORD', 'PRE_REGISTERED'])(
    'accepts the real account state %s',
    async (accountState) => {
      await expect(
        pipe.transform(
          { kind: 'users', ids: [1], changes: { accountState } },
          { type: 'body', metatype: BulkPreviewDto },
        ),
      ).resolves.toMatchObject({ changes: { accountState } });
    },
  );
});
