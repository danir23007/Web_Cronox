import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MembershipService } from './membership.service';

@Controller('membership')
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @Get('me/qr')
  @UseGuards(JwtAuthGuard)
  async getMyQr(@CurrentUser('id') userId: number, @Res() res: Response) {
    const png = await this.membershipService.getQrForUser(userId);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(png);
  }

  @Get('me/stats')
  @UseGuards(JwtAuthGuard)
  getMyStats(@CurrentUser('id') userId: number) {
    return this.membershipService.getMyStats(userId);
  }
}

@Controller('m')
export class MembershipPublicController {
  constructor(private readonly membershipService: MembershipService) {}

  @Get(':publicMemberToken')
  async getMemberInfo(@Param('publicMemberToken') publicMemberToken: string) {
    return this.membershipService.getMemberInfo(publicMemberToken);
  }
}
