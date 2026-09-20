import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ReorderGalleryCarouselDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  sourcePosition!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  targetPosition!: number;
}
