// src/common/guards/app-throttler.guard.ts
import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import type { ThrottlerRequest, ThrottlerLimitDetail } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { getRequiredJwtSecret } from '../config/environment';

export function requestNetwork(req: any): string {
  const peer = req.socket?.remoteAddress?.replace(/^::ffff:/, '');
  if (req.ips?.length) return req.ip; // Explicit Express trust-proxy policy.
  const forwarded = req.headers?.['x-real-ip'];
  // Same documented local-proxy contract already used by bank reservations.
  if (
    ['127.0.0.1', '::1'].includes(peer) &&
    typeof forwarded === 'string' &&
    isIP(forwarded)
  )
    return forwarded;
  return peer || req.ip || 'unknown';
}

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService();
  constructor(
    @InjectThrottlerOptions()
    protected readonly options: ThrottlerModuleOptions,
    @InjectThrottlerStorage()
    protected readonly storageService: ThrottlerStorage,
    protected readonly reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = req.body?.email;
    if (
      /^\/api\/(auth|newsletter|waitlist|key-screen)\//.test(
        req.path || req.url || '',
      ) &&
      typeof email === 'string' &&
      email.length <= 254 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return 'email:' + email.trim().toLowerCase();
    }
    const bearer = req.headers?.authorization?.match(/^Bearer (.+)$/i)?.[1];
    for (const [token, secret, type] of [
      [req.cookies?.jwt || bearer, 'JWT_ACCESS_SECRET', 'access'],
      [req.cookies?.refresh_token, 'JWT_REFRESH_SECRET', 'refresh'],
    ] as const) {
      if (typeof token !== 'string') continue;
      try {
        const claims = this.jwt.verify(token, {
          secret: getRequiredJwtSecret(secret),
          algorithms: ['HS256'],
        });
        if (
          Number.isSafeInteger(Number(claims.sub)) &&
          Number(claims.sub) > 0 &&
          (!claims.type || claims.type === type)
        )
          return 'user:' + claims.sub;
      } catch {
        /* Invalid credentials cannot choose another account's bucket. */
      }
    }
    if (
      typeof req.cookies?.cartId === 'string' &&
      /^[a-f0-9-]{36}$/i.test(req.cookies.cartId)
    )
      return 'cart:' + req.cookies.cartId;
    return 'network:' + requestNetwork(req);
  }

  protected generateKey(
    context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return createHmac('sha256', getRequiredJwtSecret('JWT_ACCESS_SECRET'))
      .update(
        `${context.getClass().name}:${context.getHandler().name}:${name}:${tracker}`,
      )
      .digest('hex');
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const { req, res } = this.getRequestResponse(props.context);
    const tracker = await this.getTracker(req);
    const networkLimit = Math.max(200, props.limit * 20);
    if (!tracker.startsWith('network:')) {
      // A bounded network ceiling also covers attackers rotating cookies/emails.
      const key = this.generateKey(
        props.context,
        'network:' + requestNetwork(req),
        'network',
      );
      const hit = await this.storageService.increment(
        key,
        props.ttl,
        networkLimit,
        props.blockDuration,
        'network',
      );
      if (hit.isBlocked) {
        res.header('Retry-After', hit.timeToBlockExpire);
        await this.throwThrottlingException(props.context, {
          ...hit,
          key,
          tracker: '',
          limit: networkLimit,
          ttl: props.ttl,
        });
      }
    }
    // Anonymous browsing is shared by a NAT. Account/email quotas remain the
    // route's existing explicit limits; reads cannot exhaust another handler.
    return super.handleRequest({
      ...props,
      getTracker: async () => tracker,
      limit: tracker.startsWith('network:') && ['GET', 'HEAD'].includes(req.method)
        ? networkLimit : props.limit,
    });
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      {
        statusCode: 429,
        code: 'RATE_LIMITED',
        retryAfter: detail.timeToBlockExpire,
        message: `Has realizado demasiadas solicitudes. Espera ${detail.timeToBlockExpire} segundos antes de volver a intentarlo.`,
      },
      429,
    );
  }
}
