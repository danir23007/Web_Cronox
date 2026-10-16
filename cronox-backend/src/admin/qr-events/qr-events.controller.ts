import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
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
