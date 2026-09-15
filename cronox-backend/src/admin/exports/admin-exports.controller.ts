import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminExportsService, ExportModule } from './admin-exports.service';
import { AdminExportQueryDto } from './dto/admin-export-query.dto';
import { EXCEL_MIME } from './excel-workbook.service';

@Controller('admin/exports')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, SuperAdminGuard)
@Roles(Role.SUPERADMIN)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class AdminExportsController {
  constructor(private readonly exportsService: AdminExportsService) {}

  @Get('users')
  users(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('usuarios', query, actorId, request, response);
  }

  @Get('orders')
  orders(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('pedidos', query, actorId, request, response);
  }

  @Get('products')
  products(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('productos', query, actorId, request, response);
  }

  @Get('inventory')
  inventory(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('inventario', query, actorId, request, response);
  }

  @Get('circles')
  circles(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('circulos', query, actorId, request, response);
  }

  @Get('promo-codes')
  promoCodes(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('codigos', query, actorId, request, response);
  }

  @Get('audit')
  audit(
    @Query() query: AdminExportQueryDto,
    @CurrentUser('id') actorId: number,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.send('actividad', query, actorId, request, response);
  }

  // Keep valid modules explicit and provide a controlled response for typos
  // instead of leaking Express' raw "Cannot GET" route message.
  @Get(':module')
  invalidModule(@Param('module') module: string): never {
    throw new BadRequestException(`Módulo de exportación no válido: ${module}`);
  }

  private async send(
    module: ExportModule,
    query: AdminExportQueryDto,
    actorId: number,
    request: Request,
    response: Response,
  ) {
    const requestId = request.headers['x-request-id'];
    const result = await this.exportsService.export(module, query, actorId, {
      ip: request.ip,
      userAgent: request.get('user-agent'),
      requestId: Array.isArray(requestId) ? requestId[0] : requestId,
    });
    response.set({
      'Content-Type': EXCEL_MIME,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.send(result.buffer);
  }
}
