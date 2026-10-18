import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { EXCEL_MIME } from '../exports/excel-workbook.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateQrEventDto,
  QrEventQueryDto,
  ScanQrEventDto,
} from './qr-events.dto';
import { QrEventsService } from './qr-events.service';

@Controller('admin/qr-events')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class QrEventsController {
  constructor(private readonly service: QrEventsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: QrEventQueryDto) {
    return this.service.list(query);
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(@Body() body: CreateQrEventDto, @CurrentUser('id') actorId: number) {
    return this.service.create(body, actorId);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }
  @Get(':id/participants')
  @Header('Cache-Control', 'private, no-store')
  participants(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: QrEventQueryDto,
  ) {
    return this.service.participants(id, query);
  }
  @Get(':id/ids.xlsx')
  async exportIds(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ) {
    const result = await this.service.exportIds(id);
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
  @Post(':id/scan')
  @Header('Cache-Control', 'private, no-store')
  scan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ScanQrEventDto,
    @CurrentUser('id') actorId: number,
  ) {
    return this.service.scan(id, body.qrContent, actorId);
  }
}
