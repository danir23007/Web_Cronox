import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateAdminNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}
