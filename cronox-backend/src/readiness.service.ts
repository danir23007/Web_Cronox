import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class ReadinessService {
  private cached = { ok: false, until: 0 };
  private response?: Promise<boolean>;
  private querying = false;

  constructor(private readonly prisma: PrismaService) {}

  check(): Promise<boolean> {
    if (this.cached.until > Date.now()) return Promise.resolve(this.cached.ok);
    if (this.response) return this.response;
    // A response timeout must not enqueue another query behind the first one.
    if (this.querying) return Promise.resolve(false);
    this.querying = true;
    let timer: ReturnType<typeof setTimeout>;
    const query = Promise.resolve()
      .then(() => this.prisma.$queryRaw`SELECT 1`)
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        this.querying = false;
      });
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 1000);
      timer.unref?.();
    });
    this.response = Promise.race([query, deadline])
      .then((ok) => {
        this.cached = { ok, until: Date.now() + 1000 };
        return ok;
      })
      .finally(() => {
        clearTimeout(timer);
        this.response = undefined;
      });
    return this.response;
  }
}
