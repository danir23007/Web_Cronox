import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isIP } from 'node:net';
import { CART_COOKIE_NAME, getCartCookieOptions } from '../common/cookies/cart-cookie';
import { CartService } from '../cart/cart.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  resolveCheckoutOwner,
  resolveCheckoutOwnerIdentity,
} from '../orders/checkout-owner';
import { BankTransferService } from './bank-transfer.service';
import { StripeService } from './stripe.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

@Controller('payments/bank-transfer')
@UseGuards(OptionalJwtAuthGuard)
export class BankTransferController {
  constructor(
    private readonly banks: BankTransferService,
    private readonly stripe: StripeService,
    private readonly carts: CartService,
  ) {}
  @Get('availability')
  async availability() {
    // Fail closed if the key cannot inspect Dashboard configuration.
    return {
      available: await this.stripe.isBankTransferAvailable().catch(() => false),
    };
  }
  @Post()
  async begin(@Req() req: Request, @Body() dto: CreatePaymentIntentDto, @Res({ passthrough: true }) res: Response) {
    const cart = await this.carts.getCheckoutCartForRequest(req);
    const result = await this.banks.begin(
      resolveCheckoutOwner(req, cart, dto.guestEmail),
      dto,
      cart,
      this.reservationNetwork(req),
    );
    this.persistGuestContext(req, res, result);
    return result;
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  async get(@Req() req: Request, @Query('ref') ref: string, @Res({ passthrough: true }) res: Response) {
    const cart = await this.carts.getCheckoutCartForRequest(req);
    const result = await this.banks.get(resolveCheckoutOwnerIdentity(req, cart), ref || '');
    this.persistGuestContext(req, res, result);
    return result;
  }
  @Post('cancel')
  async cancel(@Req() req: Request, @Query('ref') ref: string) {
    const cart = await this.carts.getCheckoutCartForRequest(req);
    return this.banks.cancel(
      resolveCheckoutOwnerIdentity(req, cart),
      ref || '',
    );
  }
  @Post('resume')
  async resume(@Req() req: Request, @Query('ref') ref: string) {
    const cart = await this.carts.getCheckoutCartForRequest(req);
    return this.banks.resume(
      resolveCheckoutOwnerIdentity(req, cart),
      ref || '',
    );
  }

  private persistGuestContext(req: Request, res: Response, result: { orderStatus?: string; expiresAt: Date }) {
    if (typeof req.user?.id === 'number') return;
    const anonymousId = req.cookies?.[CART_COOKIE_NAME];
    if (typeof anonymousId !== 'string') return;
    const options = getCartCookieOptions();
    // Keep the existing opaque owner handle until the ORIGINAL bank deadline.
    // Authorized repeated reads shorten this interval, never renew stock/plazo.
    const remaining = new Date(result.expiresAt).getTime() - Date.now();
    if (result.orderStatus === 'PENDING' && Number.isFinite(remaining) && remaining > 0) {
      options.maxAge = remaining;
    }
    res.cookie(CART_COOKIE_NAME, anonymousId, options);
  }

  private reservationNetwork(req: Request): string {
    const peer = req.socket?.remoteAddress?.replace(/^::ffff:/, '');
    // Production Nginx overwrites X-Real-IP and connects over loopback. The
    // origin is also directly reachable: never trust headers from other peers.
    const forwarded = req.headers?.['x-real-ip'];
    if ((peer === '127.0.0.1' || peer === '::1') &&
        typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
    if (peer && peer !== '127.0.0.1' && peer !== '::1') return peer;
    return req.ip || peer || 'unknown';
  }
}
