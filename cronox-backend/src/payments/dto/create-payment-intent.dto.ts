import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiPropertyOptional({ description: 'Identificador de la dirección seleccionada en el checkout' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  addressId?: number; // [STRIPE]
}
