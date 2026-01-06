import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
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
}
