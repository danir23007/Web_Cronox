import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReorderGallerySlotsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  sourceKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  targetKey!: string;
}
