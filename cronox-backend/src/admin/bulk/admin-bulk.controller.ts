import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminUserQueryDto } from '../users/dto/admin-user-query.dto';
import { AdminProductQueryDto } from '../products/dto/admin-product-query.dto';
import { BulkExecuteDto, BulkPreviewDto } from './admin-bulk.dto';
import { AdminBulkService } from './admin-bulk.service';
@Controller('admin/bulk')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminBulkController {
  constructor(private readonly bulk: AdminBulkService) {}
  @Get('users/selection') users(
    @Query() query: AdminUserQueryDto,
    @CurrentUser('id') actor: number,
  ) {
    return this.bulk.select('users', query, actor);
  }
  @Get('products/selection') products(
    @Query() query: AdminProductQueryDto,
    @CurrentUser('id') actor: number,
  ) {
    return this.bulk.select('products', query, actor);
  }
  @Post('preview') preview(
    @Body() dto: BulkPreviewDto,
    @CurrentUser('id') actor: number,
  ) {
    return this.bulk.preview(dto, actor);
  }
  @Post('execute') execute(
    @Body() dto: BulkExecuteDto,
    @CurrentUser('id') actor: number,
  ) {
    return this.bulk.execute(dto, actor);
  }
  @Get('operations/:id') result(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') actor: number,
  ) {
    return this.bulk.result(id, actor);
  }
}
