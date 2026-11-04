import { Body, Controller, Get, Headers, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminLotsService } from './admin-lots.service';
import { ProductEditionsService } from './product-editions.service';
import { SaveEditionDto, DuplicateEditionDto } from './edition.dto';
import { ActivateLotsDto, CreateLotDto, EditLotDto, CorrectLotCostsDto, ReconcileHistoricalLotDto, ReconcilePointLotDto } from './lot.dto';
@Controller('admin/products/:productId/lots')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminLotsController {
  constructor(private readonly lots: AdminLotsService, private readonly editions: ProductEditionsService) {}
  @Get('editions') editionsList(@Param('productId', ParseIntPipe) id: number) { return this.editions.list(id); }
  @Post('editions/:lotId/duplicate') duplicateEdition(@Param('productId', ParseIntPipe) id: number, @Param('lotId') lot: string, @Body() dto: DuplicateEditionDto, @Headers('idempotency-key') key: string, @CurrentUser('id') actor: number) { return this.editions.duplicate(id,lot,dto.revision,key,actor); }
  @Post('editions/:lotId/activate') activateEdition(@Param('productId', ParseIntPipe) id: number, @Param('lotId') lot: string, @Body() dto: DuplicateEditionDto, @CurrentUser('id') actor: number) { return this.editions.activate(id,lot,dto.revision,actor); }
  @Post('editions/:lotId') saveEdition(@Param('productId', ParseIntPipe) id: number, @Param('lotId') lot: string, @Body() dto: SaveEditionDto, @CurrentUser('id') actor: number, @Headers('idempotency-key') key?: string) { return this.editions.save(id,lot,dto,actor,key); }
  @Get() list(@Param('productId', ParseIntPipe) id: number) { return this.lots.list(id); }
  @Get('preview') preview(@Param('productId', ParseIntPipe) id: number) { return this.lots.preview(id); }
  @Get('report') report(@Param('productId', ParseIntPipe) id: number, @Query('from') from = '2000-01-01', @Query('to') to = '2100-12-31') { return this.lots.report(id, from, to); }
  @Get('historical') historical(@Param('productId', ParseIntPipe) id: number, @Query('page') page = '1') { return this.lots.historical(id, Number(page)); }
  @Post('historical') reconcile(@Param('productId', ParseIntPipe) id: number, @Body() dto: ReconcileHistoricalLotDto, @CurrentUser('id') actor: number) { return this.lots.reconcileHistorical(id, dto, actor); }
  @Get('point-history') pointHistory(@Param('productId', ParseIntPipe) id: number, @Query('page') page = '1') { return this.lots.pointHistory(id, Number(page)); }
  @Post('point-history') reconcilePoint(@Param('productId', ParseIntPipe) id: number, @Body() dto: ReconcilePointLotDto, @CurrentUser('id') actor: number) { return this.lots.reconcilePoint(id, dto, actor); }
  @Post('activate') activate(@Param('productId', ParseIntPipe) id: number, @Body() dto: ActivateLotsDto, @CurrentUser('id') actor: number) { return this.lots.activate(id, dto, actor); }
  @Post() create(@Param('productId', ParseIntPipe) id: number, @Headers('idempotency-key') key: string, @Body() dto: CreateLotDto, @CurrentUser('id') actor: number) { return this.lots.create(id, key, dto, actor); }
  @Patch(':lotId') edit(@Param('productId', ParseIntPipe) id: number, @Param('lotId') lot: string, @Body() dto: EditLotDto, @CurrentUser('id') actor: number) { return this.lots.edit(id, lot, dto, actor); }
  @Post(':lotId/costs') costs(@Param('productId', ParseIntPipe) id: number, @Param('lotId') lot: string, @Body() dto: CorrectLotCostsDto, @CurrentUser('id') actor: number) { return this.lots.correctCosts(id, lot, dto, actor); }
}
