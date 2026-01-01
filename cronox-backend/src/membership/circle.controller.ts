import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CircleService } from './circle.service';

@Controller('account/circle')
@UseGuards(JwtAuthGuard)
export class CircleController {
  constructor(private readonly circleService: CircleService) {}

  @Post('request')
  async requestPromotion(@CurrentUser('id') userId: number) {
    const request = await this.circleService.requestPromotion(userId);

    return {
      status: request.status,
      promoteAt: request.promoteAt,
      requestedAt: request.requestedAt,
    };
  }
}
