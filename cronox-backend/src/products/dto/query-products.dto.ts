import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class QueryProductsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'price', 'name', 'id'])
  sortBy?: 'createdAt' | 'price' | 'name' | 'id' = 'id';

  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';
}
