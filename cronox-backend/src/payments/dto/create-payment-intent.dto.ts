import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ShippingMethod } from '@prisma/client';

export class CreatePaymentIntentDto {
  @ApiProperty({ description: 'Método de envío elegido', enum: ShippingMethod })
  @Type(() => String)
  @IsEnum(ShippingMethod)
  shippingMethod!: ShippingMethod;

  @ApiPropertyOptional({ description: 'Identificador de la dirección seleccionada en el checkout' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  addressId?: number; // [STRIPE]
}
