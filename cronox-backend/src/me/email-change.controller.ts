import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EmailChangeService } from './email-change.service';

export class StartEmailChangeDto {
  @IsEmail() @MaxLength(254) newEmail!: string;
}
export class EmailChangeActionDto {
  @IsString() @Length(43, 43) token!: string;
  @IsIn(['authorize', 'verify', 'cancel']) action!: 'authorize' | 'verify' | 'cancel';
}

@Controller('me/email-change')
@UseGuards(JwtAuthGuard)
export class MyEmailChangeController {
  constructor(private readonly changes: EmailChangeService) {}
  @Get() @Header('Cache-Control', 'no-store') status(@CurrentUser('id') id: number) { return this.changes.status(id); }
  @Post() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  start(@CurrentUser('id') id: number, @Body() dto: StartEmailChangeDto) { return this.changes.start(id, dto.newEmail); }
  @Post('resend') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resend(@CurrentUser('id') id: number) { return this.changes.resend(id); }
  @Post('cancel') cancel(@CurrentUser('id') id: number) { return this.changes.cancel(id); }
}

@Controller('email-change')
export class EmailChangeController {
  constructor(private readonly changes: EmailChangeService) {}
  @Post('inspect') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 30, ttl: 60_000 } })
  inspect(@Body() dto: EmailChangeActionDto) { return this.changes.inspect(dto.token, dto.action); }
  @Post('confirm') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirm(@Body() dto: EmailChangeActionDto) { return this.changes.confirm(dto.token, dto.action); }
}
