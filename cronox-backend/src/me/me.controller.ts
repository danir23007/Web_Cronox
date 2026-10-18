import { Body, Controller, Get, Put, UseGuards, Param, ParseIntPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpsertAddressDto } from './dto/upsert-address.dto';
import { MeService } from './me.service';

// Opción A: controlador dedicado para los endpoints del usuario autenticado (/api/me)
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  // GET /me is registered once by UsersController and returns SafeUser.
  // Keep the profile mutations and address/order routes here.
  @Put()
  updateMe(@CurrentUser('id') userId: number, @Body() dto: UpdateMeDto) {
    return this.meService.updateProfile(userId, dto);
  }

  @Get('address')
  getDefaultAddress(@CurrentUser('id') userId: number) {
    return this.meService.getDefaultAddress(userId);
  }

  @Put('address')
  upsertAddress(@CurrentUser('id') userId: number, @Body() dto: UpsertAddressDto) {
    return this.meService.upsertDefaultAddress(userId, dto);
  }

  @Get('orders')
  getOrders(@CurrentUser('id') userId: number) {
    return this.meService.getOrders(userId);
  }
  @Get('orders/:id/tracking')
  getOrderTracking(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.meService.getOrderTracking(userId, id);
  }
}
