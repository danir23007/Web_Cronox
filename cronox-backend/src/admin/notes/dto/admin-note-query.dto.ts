import { IsIn, IsString } from 'class-validator';

const TARGET_TYPES = ['user', 'circleRequest'] as const;

export class AdminNoteQueryDto {
  @IsIn(TARGET_TYPES)
  targetType: (typeof TARGET_TYPES)[number];

  @IsString()
  targetId: string;
}
