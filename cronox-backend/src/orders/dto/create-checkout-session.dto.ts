// [ORDERS] Datos necesarios para preparar un checkout sin confirmar pago
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ShippingMethodCode } from '../../common/enums/shipping-method-code.enum';

export class CreateCheckoutSessionDto {
  @ApiProperty({
    description: 'Método de envío elegido',
    enum: ShippingMethodCode,
    enumName: 'ShippingMethodCode',
  })
  @IsEnum(ShippingMethodCode)
  @IsNotEmpty()
  shippingMethod!: ShippingMethodCode;

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
