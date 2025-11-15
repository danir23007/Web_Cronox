import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ description: 'Identificador del método de envío elegido' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shippingMethodId!: number;

  @ApiPropertyOptional({ description: 'Identificador de la dirección seleccionada en el checkout' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  addressId?: number; // [STRIPE]
}
