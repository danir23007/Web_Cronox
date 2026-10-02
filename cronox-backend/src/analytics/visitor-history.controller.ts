import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { isPublicVisitPath, VisitorHistoryService } from './visitor-history.service';

export class RecordVisitDto {
  @IsString() @MaxLength(250) path: string;
  @IsOptional() @IsUUID('4') browserId?: string;
  @IsIn(['authenticated', 'anonymous']) expectedCategory: string;
}
export class VisitorRangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}
export class VisitorDetailDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) day: string;
  @IsOptional() @IsIn(['all', 'authenticated', 'anonymous']) category = 'all';
  @IsOptional() @IsString() @MaxLength(120) search = '';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}

@Controller('analytics/visits')
export class PublicVisitorController {
  constructor(private readonly history: VisitorHistoryService) {}
  @Get('session') @UseGuards(OptionalJwtAuthGuard)
  session(@Req() req: Request) {
    if (!req.user && req.cookies?.refresh_token) throw new UnauthorizedException('SESSION_RESOLUTION_REQUIRED');
    return { category: req.user ? 'authenticated' : 'anonymous', userId: req.user?.id ?? null };
  }
  @Post() @HttpCode(202)
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  record(@Req() req: Request, @Body() dto: RecordVisitDto) {
    // Global validation strips unknown keys; explicitly reject identity injection before it can be hidden.
    if (req.body && Object.keys(req.body).some(key => !['path', 'browserId', 'expectedCategory'].includes(key))) {
      throw new BadRequestException('UNEXPECTED_VISIT_FIELDS');
    }
    // An unresolved refresh-only session must never be classified as anonymous.
    if (!req.user && req.cookies?.refresh_token) throw new UnauthorizedException('SESSION_RESOLUTION_REQUIRED');
    if (dto.expectedCategory !== (req.user ? 'authenticated' : 'anonymous')) throw new BadRequestException('SESSION_CHANGED_RETRY');
    if (!req.user && !dto.browserId) throw new BadRequestException('BROWSER_ID_REQUIRED');
    // Reject a public-path payload originating from exclusive panel/API navigation.
    const referer = req.get('referer');
    if (referer) {
      let source: string;
      try { source = new URL(referer).pathname; } catch { throw new BadRequestException('PUBLIC_PAGE_REQUIRED'); }
      if (!isPublicVisitPath(source)) throw new BadRequestException('PUBLIC_PAGE_REQUIRED');
    }
    return this.history.record(req, dto.path, dto.browserId);
  }
}

@Controller('admin/visitors')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminVisitorController {
  constructor(private readonly history: VisitorHistoryService) {}
  @Get() report(@Query() query: VisitorRangeDto) { return this.history.report(query.from, query.to); }
  @Get('day') detail(@Query() query: VisitorDetailDto) {
    return this.history.detail(query.day, query.category, query.search, query.page);
  }
}
