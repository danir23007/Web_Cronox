import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, realpathSync } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

export const SHIPPING_LABEL_MAX_BYTES = 10 * 1024 * 1024;

const isInside = (directory: string, candidate: string) => {
  const path = relative(directory, candidate);
  return !path || (!path.startsWith('..') && !isAbsolute(path));
};

// Resolve existing ancestors too: a symlink into a static tree is not private.
export function shippingLabelPrivateRoot() {
  const configured = process.env.CORREOS_LABEL_PRIVATE_DIR;
  if (!configured || !isAbsolute(configured)) {
    throw new ServiceUnavailableException('SHIPPING_LABEL_STORAGE_NOT_CONFIGURED');
  }
  const canonical = (path: string): string => {
    if (existsSync(path)) return realpathSync(path);
    return join(canonical(dirname(path)), basename(path));
  };
  const root = canonical(resolve(configured));
  // Both src and dist live directly inside cronox-backend. Keep private labels
  // outside the entire application tree, including every static asset location.
  const repository = canonical(resolve(__dirname, '../../..'));
  if (isInside(repository, root) || isInside(root, repository)) {
    throw new ServiceUnavailableException('SHIPPING_LABEL_STORAGE_NOT_PRIVATE');
  }
  return root;
}

export function validateShippingLabel(file?: Express.Multer.File) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new BadRequestException('Selecciona una etiqueta PDF');
  }
  if (file.buffer.length > SHIPPING_LABEL_MAX_BYTES) {
    throw new BadRequestException('La etiqueta supera los 10 MiB');
  }
  if (
    file.mimetype !== 'application/pdf' ||
    !/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(file.buffer.subarray(0, 8).toString('ascii')) ||
    !/%%EOF\s*$/.test(file.buffer.subarray(-1024).toString('ascii'))
  ) {
    throw new BadRequestException('La etiqueta debe ser un archivo PDF valido');
  }
  return {
    originalName:
      basename(file.originalname.replace(/\\/g, '/'))
        .replace(/[\x00-\x1f\x7f"<>]/g, '')
        .slice(0, 150) || 'etiqueta.pdf',
    mimeType: 'application/pdf',
    size: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  };
}

@Injectable()
export class ShippingLabelsService {
  constructor(private readonly db: PrismaService) {}

  private keyPath(root: string, key: string) {
    if (!/^[a-f0-9-]{36}\.pdf$/.test(key)) {
      throw new ServiceUnavailableException('SHIPPING_LABEL_UNAVAILABLE');
    }
    return join(root, key);
  }

  async upload(orderId: number, revision: number, actorId: number, file: Express.Multer.File) {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new BadRequestException('La revision del seguimiento es obligatoria');
    }
    const metadata = validateShippingLabel(file);
    const root = shippingLabelPrivateRoot();
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (realpathSync(root) !== root) {
      throw new ServiceUnavailableException('SHIPPING_LABEL_STORAGE_NOT_PRIVATE');
    }
    const storageKey = `${randomUUID()}.pdf`;
    const path = this.keyPath(root, storageKey);
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(file.buffer);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(path).catch(() => undefined);
      throw error;
    } finally {
      await handle.close().catch(() => undefined);
    }
    let oldKey: string | undefined;
    try {
      const label = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id: orderId }, select: { trackingRevision: true } });
        if (!order) throw new NotFoundException('Pedido no encontrado');
        if (order.trackingRevision !== revision) {
          throw new ConflictException('El seguimiento ha cambiado. Recarga el pedido antes de guardar la etiqueta');
        }
        const previous = await tx.orderShippingLabel.findUnique({ where: { orderId } });
        oldKey = previous?.storageKey;
        return tx.orderShippingLabel.upsert({
          where: { orderId },
          create: { orderId, trackingRevision: revision, storageKey, uploadedBy: actorId, ...metadata },
          update: { trackingRevision: revision, storageKey, uploadedBy: actorId, ...metadata, createdAt: new Date() },
        });
      });
      if (oldKey) await unlink(this.keyPath(root, oldKey)).catch(() => undefined);
      return this.serialize(label);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  serialize(label: { orderId: number; trackingRevision: number; originalName: string; mimeType: string; size: number; createdAt: Date }) {
    return {
      fileName: label.originalName,
      mimeType: label.mimeType,
      size: label.size,
      trackingRevision: label.trackingRevision,
      updatedAt: label.createdAt.toISOString(),
      downloadUrl: `/api/admin/orders/${label.orderId}/label`,
    };
  }

  async download(orderId: number) {
    const label = await this.db.orderShippingLabel.findUnique({ where: { orderId } });
    if (!label) throw new NotFoundException('El pedido no tiene etiqueta');
    const path = this.keyPath(shippingLabelPrivateRoot(), label.storageKey);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('INVALID_STORED_LABEL');
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== label.size || stat.size > SHIPPING_LABEL_MAX_BYTES) {
        throw new Error('INVALID_STORED_LABEL');
      }
      const buffer = await handle.readFile();
      if (createHash('sha256').update(buffer).digest('hex') !== label.sha256) {
        throw new Error('INVALID_STORED_LABEL');
      }
      return { buffer, ...this.serialize(label) };
    } catch {
      throw new ServiceUnavailableException('SHIPPING_LABEL_UNAVAILABLE');
    } finally {
      await handle?.close();
    }
  }
}
