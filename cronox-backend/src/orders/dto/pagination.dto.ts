// [ORDERS] DTO reutilizable para la paginación de pedidos
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const SORTABLE_FIELDS = ['createdAt', 'total', 'status'] as const;
const ORDER_DIRECTIONS = ['asc', 'desc'] as const;

type SortField = (typeof SORTABLE_FIELDS)[number];
type SortDirection = (typeof ORDER_DIRECTIONS)[number];

export class PaginationDto {
  @ApiPropertyOptional({ description: 'Página a recuperar (>=1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Número de elementos por página', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: 'Campo para ordenar', enum: SORTABLE_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsString()
  @IsIn(SORTABLE_FIELDS as unknown as string[])
  sort?: SortField = 'createdAt';

  @ApiPropertyOptional({ description: 'Dirección de ordenación', enum: ORDER_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsString()
  @IsIn(ORDER_DIRECTIONS as unknown as string[])
  order?: SortDirection = 'desc';
}
