import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ShippingMethodCode } from '../../common/enums/shipping-method-code.enum';

export class CreatePaymentIntentDto {
  @ApiProperty({
    description: 'Método de envío elegido',
    enum: ShippingMethodCode,
    enumName: 'ShippingMethodCode',
  })
  @IsEnum(ShippingMethodCode)
  shippingMethod!: ShippingMethodCode;

  @ApiPropertyOptional({
    description: 'Identificador de la dirección seleccionada en el checkout',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  addressId?: number; // [STRIPE]

  @ApiPropertyOptional({
    description: 'Código promocional aplicado en el checkout',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  promoCode?: string;

  @ApiPropertyOptional({
    description: 'PaymentIntent existente a refrescar cuando cambian totales/metadata',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentIntentId?: string;

  @ApiPropertyOptional({
    description: 'Dirección de envío capturada en el checkout',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, unknown>;
}
