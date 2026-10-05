import { RequestTimeoutException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const EXPORT_SQL_TIMEOUT_MS = 30_000;

/** A transaction-local PostgreSQL deadline; never cancels another connection. */
export async function withExportSqlDeadline<T>(
  prisma: PrismaService,
  operation: (client: Prisma.TransactionClient) => Promise<T>,
  timeoutMs = EXPORT_SQL_TIMEOUT_MS,
): Promise<T> {
  const expired = () => new RequestTimeoutException(
    'La exportación superó el tiempo máximo. Aplica filtros y vuelve a intentarlo.',
  );
  try {
    return await prisma.$transaction(async tx => {
      const deadline = Date.now() + timeoutMs;
      let queue: Promise<unknown> = Promise.resolve();
      const run = (callback: () => unknown) => {
        const result = queue.then(async () => {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw expired();
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(remaining)}, true)`;
          return callback();
        });
        // Preserve rejection so later queued reads never run in a failed transaction.
        queue = result;
        return result;
      };
      const delegates = new Map<PropertyKey, unknown>();
      const scoped = new Proxy(tx, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value === 'function') return (...args: unknown[]) => run(() => value.apply(target, args));
          if (value && typeof value === 'object') {
            if (!delegates.has(key)) delegates.set(key, new Proxy(value, {
              get(delegate, method) {
                const action = Reflect.get(delegate, method);
                return typeof action === 'function'
                  ? (...args: unknown[]) => run(() => action.apply(delegate, args))
                  : action;
              },
            }));
            return delegates.get(key);
          }
          return value;
        },
      });
      return operation(scoped);
    }, { timeout: timeoutMs + 1000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string }; message?: string };
    if (failure.meta?.code === '57014' ||
        /canceling statement due to statement timeout/.test(failure.message || '') ||
        (failure.code === 'P2028' && /expired|timeout|timed out/i.test(failure.message || ''))) {
      throw expired();
    }
    throw error;
  }
}
