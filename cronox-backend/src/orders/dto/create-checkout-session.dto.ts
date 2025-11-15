// [ORDERS] Datos necesarios para preparar un checkout sin confirmar pago
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'Identificador del método de envío elegido' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shippingMethodId!: number;

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
