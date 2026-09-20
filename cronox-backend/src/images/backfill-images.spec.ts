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
    expect(source).toContain("mediaType: 'image'");
  });

  it('supports an isolated website-media target and never scans unrelated models in that mode', () => {
    expect(source).toContain("optionalIdArg('website-media-id')");
    expect(source).toContain('while (!websiteMediaId)');
    expect(source).toContain(
      '...(websiteMediaId ? { id: websiteMediaId } : {})',
    );
    expect(source).toContain('if (websiteMediaId) break');
  });

  it('uses expanded recovery only for website media and persists after storage succeeds', () => {
    expect(source).toContain('allowLargeManagedOriginal = false');
    expect(source).toContain('declaredMimeType: record.mimeType');
    const backfill = source.indexOf('storage.backfillManagedImage({');
    const update = source.indexOf(
      'if (execute) await update(record.id, result)',
    );
    const generated = source.indexOf('summary.generated += 1');
    expect(backfill).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(backfill);
    expect(generated).toBeGreaterThan(update);
  });

  it('uses bounded batches and conservative concurrency with byte totals', () => {
    expect(source).toContain("integerArg('batch-size', 20)");
    expect(source).toContain("integerArg('concurrency', 2)");
    expect(source).toContain("Math.min(integerArg('concurrency', 2), 4)");
    expect(source).toContain('originalTotalBytes');
    expect(source).toContain('generatedDerivativeBytes');
  });
});
