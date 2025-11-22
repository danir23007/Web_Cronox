// [ORDERS] Datos necesarios para preparar un checkout sin confirmar pago
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ShippingMethod } from '@prisma/client';

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'Método de envío elegido', enum: ShippingMethod })
  @Type(() => String)
  @IsEnum(ShippingMethod)
  shippingMethod!: ShippingMethod;

  @ApiPropertyOptional({ description: 'Dirección de envío a usar durante el checkout', type: Object })
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Dirección de facturación a usar durante el checkout', type: Object })
  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Código de cupón promocional aplicado' })
  @IsOptional()
  @IsString()
  couponCode?: string;
}
