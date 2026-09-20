import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('image backfill safety', () => {
  const source = readFileSync(
    path.join(__dirname, 'backfill-images.ts'),
    'utf8',
  );

  it('requires an explicit, mutually exclusive mode and defaults to no execution', () => {
    expect(source).toContain("process.argv.includes('--execute')");
    expect(source).toContain("process.argv.includes('--dry-run')");
    expect(source).toContain('if (execute) await update(record.id, result)');
  });

  it('skips complete metadata, isolates failures and excludes videos', () => {
    expect(source).toContain('hasAllRoles(record.variants, presets)');
    expect(source).toContain('summary.skipped += 1');
    expect(source).toContain('summary.failed += 1');
    expect(source).toContain("where: { mediaType: 'image' }");
  });

  it('uses bounded batches and conservative concurrency with byte totals', () => {
    expect(source).toContain("integerArg('batch-size', 20)");
    expect(source).toContain("integerArg('concurrency', 2)");
    expect(source).toContain("Math.min(integerArg('concurrency', 2), 4)");
    expect(source).toContain('originalTotalBytes');
    expect(source).toContain('generatedDerivativeBytes');
  });
});
