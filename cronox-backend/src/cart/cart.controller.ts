import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Optional,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { CartService, CartContext, CartWithItems } from './cart.service';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CART_COOKIE_NAME,
  getCartCookieOptions,
} from '../common/cookies/cart-cookie';
import { AnalyticsService } from '../analytics/analytics.service';
import { CustomerActivityEventType } from '@prisma/client';

interface ResolveContextOptions {
  ensureAnonymousId?: boolean;
}

interface PersistAnonymousCookieOptions {
  refreshExisting?: boolean;
}

@Controller('cart')
@UseGuards(OptionalJwtAuthGuard)
export class CartController {
  constructor(
    private readonly cartService: CartService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  @Get()
  async getCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, { ensureAnonymousId: true });

    const cart = await this.cartService.getActiveCartForRequest(req, context);

    if (cart) {
      this.persistAnonymousCookie(req, res, context);
      return cart;
    }

    const created = await this.cartService.getOrCreateCart(context);
    this.persistAnonymousCookie(req, res, context);
    return created;
  }

  @Post('items')
  async addItem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AddItemDto,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, { ensureAnonymousId: true });
    const cart = await this.cartService.addItem(context, dto);
    this.persistAnonymousCookie(req, res, context, { refreshExisting: true });
    if (context.userId) {
      const item = cart.items.find((entry) => entry.variantId === dto.variantId);
      void this.analytics?.recordServerEvent(req, context.userId, CustomerActivityEventType.PRODUCT_ADDED_TO_CART, {
        productId: item?.variant.productId,
        variantId: dto.variantId,
        quantity: dto.qty,
      }).catch(() => undefined);
    }
    return cart;
  }

  @Patch('items/:id')
  async updateItem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemDto,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, { ensureAnonymousId: true });
    const before = context.userId
      ? (await this.cartService.getActiveCartForRequest(req, context))?.items.find((entry) => entry.id === id)
      : undefined;
    const cart = await this.cartService.updateItem(context, id, dto);
    this.persistAnonymousCookie(req, res, context, { refreshExisting: true });
    if (context.userId && before && before.qty !== dto.qty) {
      void this.analytics?.recordServerEvent(req, context.userId, CustomerActivityEventType.CART_QUANTITY_CHANGED, {
        productId: before.variant.productId,
        variantId: before.variantId,
        previousQuantity: before.qty,
        quantity: dto.qty,
      }).catch(() => undefined);
    }
    return cart;
  }

  @Delete('items/:id')
  async removeItem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, { ensureAnonymousId: true });
    const before = context.userId
      ? (await this.cartService.getActiveCartForRequest(req, context))?.items.find((entry) => entry.id === id)
      : undefined;
    const cart = await this.cartService.removeItem(context, id);
    this.persistAnonymousCookie(req, res, context, { refreshExisting: true });
    if (context.userId && before) {
      void this.analytics?.recordServerEvent(req, context.userId, CustomerActivityEventType.PRODUCT_REMOVED_FROM_CART, {
        productId: before.variant.productId,
        variantId: before.variantId,
        quantity: before.qty,
      }).catch(() => undefined);
    }
    return cart;
  }

  @Delete()
  async clearCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, { ensureAnonymousId: true });
    const before = context.userId
      ? (await this.cartService.getActiveCartForRequest(req, context))?.items ?? []
      : [];
    const cart = await this.cartService.clearCart(context);
    this.persistAnonymousCookie(req, res, context, { refreshExisting: true });
    if (context.userId) {
      for (const item of before) {
        void this.analytics?.recordServerEvent(req, context.userId, CustomerActivityEventType.PRODUCT_REMOVED_FROM_CART, {
          productId: item.variant.productId,
          variantId: item.variantId,
          quantity: item.qty,
        }).catch(() => undefined);
      }
    }
    return cart;
  }

  private resolveContext(
    req: Request,
    options?: ResolveContextOptions,
  ): CartContext {
    const user = req.user as { id?: number } | undefined;
    const userId = typeof user?.id === 'number' ? user.id : undefined;

    const cookies = (
      req as Request & { cookies?: Record<string, string | undefined> }
    ).cookies;
    const currentAnonymousId = cookies?.[CART_COOKIE_NAME];

    let anonymousId = currentAnonymousId;

    if (!userId && options?.ensureAnonymousId) {
      if (!anonymousId) {
        anonymousId = randomUUID();
      }
    }

    const context: CartContext = {};

    if (userId) {
      context.userId = userId;
    } else if (anonymousId) {
      context.anonymousId = anonymousId;
    }

    return context;
  }

  private persistAnonymousCookie(
    req: Request,
    res: Response,
    context: CartContext,
    options?: PersistAnonymousCookieOptions,
  ) {
    if (!context.anonymousId) return;

    const cookies = (
      req as Request & { cookies?: Record<string, string | undefined> }
    ).cookies;
    const hasExistingCookie = Boolean(cookies?.[CART_COOKIE_NAME]);

    // A first successful read creates the opaque browser handle. Thereafter,
    // only successful cart mutations roll the one-hour guest lifetime.
    if (!hasExistingCookie || options?.refreshExisting) {
      this.setAnonymousCookie(res, context.anonymousId);
    }
  }

  private setAnonymousCookie(res: Response, anonymousId: string) {
    res.cookie(CART_COOKIE_NAME, anonymousId, getCartCookieOptions());
  }
}
