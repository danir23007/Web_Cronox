import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsEmail,
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
    description:
      'Campo heredado aceptado por compatibilidad; el servidor lo ignora y nunca vincula un PaymentIntent indicado por el cliente.',
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

  @ApiPropertyOptional({
    description:
      'Email de contacto requerido únicamente para un checkout invitado',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  guestEmail?: string;
}
