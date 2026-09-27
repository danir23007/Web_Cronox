import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminFinanceService } from './admin-finance.service';

export class FinanceQuery {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @IsOptional() @IsIn(['days', 'months']) aggregation: 'days' | 'months' = 'days';
  @IsOptional() @IsIn(['revenue', 'profit', 'units']) sort: 'revenue' | 'profit' | 'units' = 'revenue';
  @IsOptional() @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'desc';
  @IsOptional() @IsString() @MaxLength(120) search = '';
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency = 'EUR';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
}

@Controller('admin/finance')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}
  @Get() get(@Query() query: FinanceQuery) { return this.finance.getReport(query); }
}
