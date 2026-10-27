import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { Roles } from '../../common/roles.decorator';
import { Role } from '@prisma/client';
import { PROVINCES } from '../map/spain-geography';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminPointsService } from './admin-points.service';
import { DeletePointDto, ExpenseDto, PointDto, ReturnDto, SaleDto, SaleDateDto } from './point.dto';

@Controller('admin/sale-points')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
export class AdminPointsController {
  constructor(private readonly service: AdminPointsService) {}
  @Get('options') options() {
    return this.service.options();
  }
  @Get('territories') territories(){return PROVINCES.map(p=>({id:p.id,name:p.name,regionId:p.regionId}));}
  @Get() @Header('Cache-Control','private, no-store') async list(@Query('search') search = '', @CurrentUser('role') role:Role) {
    return (await this.service.list(search.slice(0,160))).map(p=>({...p,canDelete:role===Role.SUPERADMIN}));
  }
  @Get(':id/deletion-preview') @Header('Cache-Control','private, no-store') @Roles(Role.SUPERADMIN) @UseGuards(SuperAdminGuard)
  previewDeletion(@Param('id',ParseUUIDPipe) id:string){return this.service.previewDeletion(id);}
  @Delete(':id') @Roles(Role.SUPERADMIN) @UseGuards(SuperAdminGuard)
  delete(@Param('id',ParseUUIDPipe) id:string,@Body() dto:DeletePointDto,@CurrentUser('id') actor:number){return this.service.delete(id,dto,actor);}
  @Get(':id') @Header('Cache-Control','private, no-store') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('search') search = '',
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.service.detail(id, from, to, search.slice(0, 160), productId);
  }
  @Post() create(
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: PointDto,
  ) {
    return this.service.savePoint(actor, key, dto);
  }
  @Post(':id') edit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: PointDto,
  ) {
    return this.service.savePoint(actor, key, dto, id);
  }
  @Post(':id/sales') sale(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: SaleDto,
  ) {
    return this.service.sale(id, actor, key, dto);
  }
  @Post(':id/sales/:saleId/correct') correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: SaleDto,
  ) {
    return this.service.sale(id, actor, key, dto, saleId);
  }
  @Post(':id/sales/:saleId/returns') refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: ReturnDto,
  ) {
    return this.service.refund(id, saleId, actor, key, dto);
  }
  @Post(':id/sales/:saleId/date') saleDate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: SaleDateDto,
  ) {
    return this.service.changeSaleDate(id, saleId, actor, key, dto);
  }
  @Post(':id/expenses') expense(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: ExpenseDto,
  ) {
    return this.service.expense(id, actor, key, dto);
  }
}
