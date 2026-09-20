import { GalleryPresentationMode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateGalleryModeDto {
  @IsEnum(GalleryPresentationMode)
  activeMode!: GalleryPresentationMode;
}
