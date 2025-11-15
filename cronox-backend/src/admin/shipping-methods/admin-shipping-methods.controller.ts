import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { ShippingMethodsService } from '../../shipping-methods/shipping-methods.service';
import { CreateShippingMethodDto } from '../../shipping-methods/dto/create-shipping-method.dto';
import { UpdateShippingMethodDto } from '../../shipping-methods/dto/update-shipping-method.dto';

@ApiTags('Admin / Shipping Methods')
@Controller('admin/shipping-methods')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminShippingMethodsController {
  constructor(private readonly shippingMethods: ShippingMethodsService) {}

  @Get()
  listAll() {
    return this.shippingMethods.listAll();
  }

  @Post()
  create(@Body() dto: CreateShippingMethodDto) {
    return this.shippingMethods.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShippingMethodDto) {
    return this.shippingMethods.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.shippingMethods.remove(id);
  }
}
