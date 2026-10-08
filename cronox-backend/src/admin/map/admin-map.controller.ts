import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminMapService } from './admin-map.service';
import { REGIONS } from './spain-geography';

export class MapQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @IsOptional()
  @IsIn([...REGIONS.map((r) => r.id), 'unknownSpain', 'foreign', 'unresolved'])
  region?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}

// Same guards and roles as /admin/finance. No public geography-sales endpoint.
@Controller('admin/map')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminMapController {
  constructor(private readonly map: AdminMapService) {}
  @Get() get(@Query() query: MapQuery) {
    return this.map.getReport(query);
  }
}
