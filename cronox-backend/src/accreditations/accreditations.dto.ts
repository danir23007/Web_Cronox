import { IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import { Prisma } from '@prisma/client';

export class ActivateAccreditationDto {
  @IsInt() @Min(0) expectedRevision!: number;
}
export class UpdateAccreditationDto extends ActivateAccreditationDto {
  @IsString() @Length(1, 100) name!: string;
  @IsObject() config!: Prisma.InputJsonObject;
}
