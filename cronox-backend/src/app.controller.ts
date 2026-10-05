import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ReadinessService } from './readiness.service';

@Controller()
export class AppController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('health')
  @SkipThrottle()
  health() {
    return { ok: true };
  }

  @Get('ready')
  @SkipThrottle()
  async ready(@Res({ passthrough: true }) res: Response) {
    const ok = await this.readiness.check();
    res.setHeader('Cache-Control', 'no-store');
    if (!ok) {
      res.status(503);
      res.setHeader('Retry-After', '5');
    }
    return { ok };
  }
}
