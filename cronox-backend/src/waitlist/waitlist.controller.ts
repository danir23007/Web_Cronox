import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Throttle } from '@nestjs/throttler';
import { Role, VariantSize } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { WaitlistService } from './waitlist.service';

export class WaitlistQuery {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(Object.values(VariantSize)) size?: string;
  @IsOptional()
  @IsIn([
    'WAITING',
    'QUEUED',
    'PROCESSING',
    'ACCEPTED',
    'FAILED',
    'UNCERTAIN',
    'CANCELLED',
  ])
  status?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

@Controller('waitlist')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}
  @Get(':variantId') state(
    @CurrentUser('id') userId: number,
    @Param('variantId', ParseIntPipe) id: number,
  ) {
    return this.service.state(userId, id);
  }
  @Post(':variantId') join(
    @CurrentUser('id') userId: number,
    @Param('variantId', ParseIntPipe) id: number,
  ) {
    return this.service.join(userId, id);
  }
  @Delete(':variantId') cancel(
    @CurrentUser('id') userId: number,
    @Param('variantId', ParseIntPipe) id: number,
  ) {
    return this.service.cancel(userId, id);
  }
}

@Controller('admin/waitlist')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminWaitlistController {
  constructor(private readonly service: WaitlistService) {}
  @Get() report(@Query() query: WaitlistQuery) {
    return this.service.report(query);
  }
}
