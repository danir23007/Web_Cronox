// [ORDERS] Payload recibido desde el proveedor de pago
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class WebhookMetadataDto {
  @ApiProperty({ description: 'Identificador del usuario asociado al pago' })
  @Type(() => Number)
  @IsInt()
  userId!: number;

  @ApiPropertyOptional({ description: 'Identificador del carrito usado en el checkout' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cartId?: number;

  @ApiPropertyOptional({ description: 'Dirección de envío usada en el checkout', type: Object })
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Dirección de facturación usada en el checkout', type: Object })
  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Indica si el pago fue capturado automáticamente' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoCaptured?: boolean;
}

export class CreateOrderWebhookDto {
  @ApiProperty({ description: 'Proveedor de pagos que confirmó el pedido' })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({ description: 'Referencia única del proveedor para garantizar idempotencia' })
  @IsString()
  @IsNotEmpty()
  providerRef!: string;

  @ApiProperty({ description: 'Cantidad total cobrada por el proveedor expresada en la divisa del pedido' })
  @IsNumberString()
  amount!: string;

  @ApiProperty({ description: 'Divisa del pedido (ISO 4217)' })
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @ApiProperty({ description: 'Metadatos asociados al pago para reconstruir el pedido', type: WebhookMetadataDto })
  @ValidateNested()
  @Type(() => WebhookMetadataDto)
  metadata!: WebhookMetadataDto;

  @ApiPropertyOptional({ description: 'Dirección de envío confirmada por el proveedor', type: Object })
  @IsOptional()
  @IsObject()
  shippingAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Dirección de facturación confirmada por el proveedor', type: Object })
  @IsOptional()
  @IsObject()
  billingAddress?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Información adicional devuelta por el proveedor', type: Object })
  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}
