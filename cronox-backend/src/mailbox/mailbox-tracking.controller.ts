import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { MailboxTrackingService } from './mailbox-tracking.service';
class ArrivalDto {
  @IsString() @MaxLength(12000) token: string;
  @IsString() @MaxLength(250) path: string;
}
@Controller('mailbox-access')
export class MailboxTrackingController {
  constructor(readonly tracking: MailboxTrackingService) {}
  @Get(':token') redirect(@Param('token') token: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, this.tracking.redirect(token));
  }
  @Post('arrival')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async arrival(@Req() req: Request, @Body() body: ArrivalDto) {
    // Metric failure never blocks storefront navigation.
    try {
      return await this.tracking.arrive(req, body.token, body.path);
    } catch {
      return { attributed: false };
    }
  }
}
