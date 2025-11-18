import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddFavoriteDto {
  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? Number(value) : value))
  @IsInt()
  @Min(1)
  productId?: number;

  @IsOptional()
  @IsString()
  slug?: string;
}
