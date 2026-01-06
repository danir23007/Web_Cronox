import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ShippingMethodCode } from '../../common/enums/shipping-method-code.enum';

const sanitizeCode = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\s+/g, '').toUpperCase();
};

export class ApplyPromoDto {
  @ApiProperty({ description: 'Código promocional a aplicar' })
  @Transform(sanitizeCode)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  code!: string;

  @ApiPropertyOptional({
    description: 'Método de envío elegido',
    enum: ShippingMethodCode,
    enumName: 'ShippingMethodCode',
  })
  @IsOptional()
  @IsEnum(ShippingMethodCode)
  shippingMethod?: ShippingMethodCode;
}
