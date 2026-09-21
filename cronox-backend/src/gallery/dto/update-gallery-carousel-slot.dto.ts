import { UpdateGallerySlotDto } from './update-gallery-slot.dto';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateGalleryCarouselSlotDto extends UpdateGallerySlotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
