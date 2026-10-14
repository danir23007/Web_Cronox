import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  SHIPPING_LABEL_MAX_BYTES,
  ShippingLabelsService,
  shippingLabelPrivateRoot,
  validateShippingLabel,
} from './labels.service';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type/Catalog>> endobj\n%%EOF\n');
const file = (overrides = {}) => ({
  originalname: 'etiqueta.pdf', mimetype: 'application/pdf', buffer: pdf, size: pdf.length, ...overrides,
}) as Express.Multer.File;

describe('Private order PDF labels', () => {
  let directory: string;
  const previous = process.env.CORREOS_LABEL_PRIVATE_DIR;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cronox-private-label-test-'));
    process.env.CORREOS_LABEL_PRIVATE_DIR = directory;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.CORREOS_LABEL_PRIVATE_DIR;
    else process.env.CORREOS_LABEL_PRIVATE_DIR = previous;
    // This suite only removes the specific newly-created OS temp directory.
    if (resolve(directory).startsWith(resolve(tmpdir())) && basename(directory).startsWith('cronox-private-label-test-')) {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects relative and publicly served storage locations', () => {
    process.env.CORREOS_LABEL_PRIVATE_DIR = 'uploads/labels';
    expect(shippingLabelPrivateRoot).toThrow('SHIPPING_LABEL_STORAGE_NOT_CONFIGURED');
    process.env.CORREOS_LABEL_PRIVATE_DIR = resolve(__dirname, '../../../cronox-front/labels');
    expect(shippingLabelPrivateRoot).toThrow('SHIPPING_LABEL_STORAGE_NOT_PRIVATE');
  });

  it('validates bytes and size rather than trusting a client filename or MIME type', () => {
    expect(() => validateShippingLabel(file({ buffer: Buffer.from('<html>wrong</html>') }))).toThrow('PDF');
    expect(() => validateShippingLabel(file({ mimetype: 'text/html' }))).toThrow('PDF');
    expect(() => validateShippingLabel(file({ buffer: Buffer.alloc(SHIPPING_LABEL_MAX_BYTES + 1) }))).toThrow('10 MiB');
    expect(validateShippingLabel(file({ originalname: '../../private\\label.pdf' })).originalName).toBe('label.pdf');
  });

  it('stores only opaque private keys, verifies integrity and returns safe download metadata', async () => {
    let stored: any;
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 9 }]),
      order: { findUnique: jest.fn().mockResolvedValue({ trackingRevision: 2 }) },
      orderShippingLabel: {
        findUnique: jest.fn().mockImplementation(() => stored ?? null),
        upsert: jest.fn().mockImplementation(({ create }) => stored = { ...create, createdAt: new Date() }),
      },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    const labels = new ShippingLabelsService(db as any);
    const result = await labels.upload(9, 2, 7, file());
    expect(result).toEqual(expect.objectContaining({ downloadUrl: '/api/admin/orders/9/label', fileName: 'etiqueta.pdf', trackingRevision: 2 }));
    expect(result).not.toHaveProperty('storageKey');
    expect(stored.storageKey).toMatch(/^[a-f0-9-]{36}\.pdf$/);
    expect(stored.uploadedBy).toBe(7);
    expect(await readFile(join(directory, stored.storageKey))).toEqual(pdf);
    expect((await labels.download(9)).buffer).toEqual(pdf);
    await writeFile(join(directory, stored.storageKey), Buffer.alloc(pdf.length));
    await expect(labels.download(9)).rejects.toThrow('SHIPPING_LABEL_UNAVAILABLE');
  });

  it('discards an upload if its tracking revision changed while it was in flight', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 9 }]),
      order: { findUnique: jest.fn().mockResolvedValue({ trackingRevision: 3 }) },
      orderShippingLabel: { upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    await expect(new ShippingLabelsService(db as any).upload(9, 2, 7, file())).rejects.toThrow('El seguimiento ha cambiado');
    expect(db.orderShippingLabel.upsert).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects a stored traversal key before opening a file', async () => {
    const label = {
      orderId: 9, storageKey: '../secret.pdf', originalName: 'label.pdf',
      mimeType: 'application/pdf', size: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'), createdAt: new Date(),
    };
    const db = { orderShippingLabel: { findUnique: jest.fn().mockResolvedValue(label) } };
    await expect(new ShippingLabelsService(db as any).download(9)).rejects.toThrow('SHIPPING_LABEL_UNAVAILABLE');
  });
});
