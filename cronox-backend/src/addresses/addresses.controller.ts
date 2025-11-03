import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SafeUser } from '../users/users.service';
import { AddressesService, SafeAddress } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Controller('me/addresses')
@UseGuards(JwtAuthGuard)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  async list(@Req() req: Request): Promise<SafeAddress[]> {
    const userId = (req.user as SafeUser).id;

    return this.addressesService.list(userId);
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateAddressDto,
  ): Promise<SafeAddress> {
    const userId = (req.user as SafeUser).id;

    return this.addressesService.create(userId, dto);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAddressDto,
  ): Promise<SafeAddress> {
    const userId = (req.user as SafeUser).id;

    return this.addressesService.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    const userId = (req.user as SafeUser).id;

    await this.addressesService.remove(userId, id);
  }

  @Patch(':id/default')
  async setDefault(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SafeAddress> {
    const userId = (req.user as SafeUser).id;

    return this.addressesService.setDefault(userId, id);
  }
}
