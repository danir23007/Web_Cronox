import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const TARGET_TYPES = ['user', 'circleRequest'] as const;

export class CreateAdminNoteDto {
  @IsIn(TARGET_TYPES)
  targetType: (typeof TARGET_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  targetId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}
