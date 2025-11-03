import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { CartService, CartContext, CartWithItems } from './cart.service';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

interface ResolveContextOptions {
  ensureAnonymousId?: boolean;
}

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, res, { ensureAnonymousId: true });
    return this.cartService.getOrCreateCart(context);
  }

  @Post('items')
  async addItem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: AddItemDto,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, res, { ensureAnonymousId: true });
    return this.cartService.addItem(context, dto);
  }

  @Patch('items/:id')
  async updateItem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemDto,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, res, { ensureAnonymousId: true });
    return this.cartService.updateItem(context, id, dto);
  }

  @Delete('items/:id')
  async removeItem(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, res, { ensureAnonymousId: true });
    return this.cartService.removeItem(context, id);
  }

  @Delete()
  async clearCart(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartWithItems> {
    const context = this.resolveContext(req, res, { ensureAnonymousId: true });
    return this.cartService.clearCart(context);
  }

  private resolveContext(
    req: Request,
    res: Response,
    options?: ResolveContextOptions,
  ): CartContext {
    const user = req.user as { id?: number } | undefined;
    const userId = typeof user?.id === 'number' ? user.id : undefined;

    const cookies = (req as Request & { cookies?: Record<string, string | undefined> })
      .cookies;
    const currentAnonymousId = cookies?.cartId;

    let anonymousId = currentAnonymousId;

    if (!userId && options?.ensureAnonymousId) {
      if (!anonymousId) {
        anonymousId = randomUUID();
      }

      if (anonymousId) {
        this.setAnonymousCookie(res, anonymousId);
      }
    } else if (!userId && anonymousId) {
      this.setAnonymousCookie(res, anonymousId);
    }

    const context: CartContext = {};

    if (userId) {
      context.userId = userId;
    } else if (anonymousId) {
      context.anonymousId = anonymousId;
    }

    return context;
  }

  private setAnonymousCookie(res: Response, anonymousId: string) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('cartId', anonymousId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
  }
}
