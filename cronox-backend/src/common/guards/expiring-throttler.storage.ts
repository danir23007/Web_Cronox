import type { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

type Bucket = { hits: number[]; blockedUntil: number; expiresAt: number };

/** Same per-operation/IP sliding windows; no database work or lifetime IP list. */
export class ExpiringThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly buckets = new Map<string, Bucket>();
  private timer?: ReturnType<typeof setInterval>;

  get size() {
    return this.buckets.size;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    name: string,
  ) {
    if (!this.timer) {
      this.timer = setInterval(() => this.sweep(), 10_000);
      this.timer.unref?.();
    }
    const now = Date.now(),
      id = `${name}:${key}`;
    let bucket = this.buckets.get(id);
    if (!bucket || bucket.expiresAt <= now) {
      bucket = { hits: [], blockedUntil: 0, expiresAt: now + ttl };
      this.buckets.set(id, bucket);
    }
    if (bucket.blockedUntil && bucket.blockedUntil <= now) {
      bucket.hits = [];
      bucket.blockedUntil = 0;
    }
    if (!bucket.blockedUntil) {
      bucket.hits = bucket.hits.filter((time) => time > now - ttl);
      bucket.hits.push(now);
      if (bucket.hits.length > limit) bucket.blockedUntil = now + blockDuration;
      bucket.expiresAt = Math.max(now + ttl, bucket.blockedUntil);
    }
    return {
      totalHits: bucket.hits.length,
      timeToExpire: Math.max(
        0,
        Math.ceil(((bucket.hits[0] ?? now) + ttl - now) / 1000),
      ),
      isBlocked: bucket.blockedUntil > now,
      timeToBlockExpire: Math.max(
        0,
        Math.ceil((bucket.blockedUntil - now) / 1000),
      ),
    };
  }

  private sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
    if (!this.buckets.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.buckets.clear();
  }
}
