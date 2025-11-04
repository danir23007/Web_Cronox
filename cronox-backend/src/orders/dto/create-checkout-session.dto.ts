// [ORDERS] Datos necesarios para preparar un checkout sin confirmar pago
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateCheckoutSessionDto {
  @ApiPropertyOptional({ description: 'Identificador del método de envío elegido' })
  @IsOptional()
  @IsString()
  shippingMethod?: string;

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
