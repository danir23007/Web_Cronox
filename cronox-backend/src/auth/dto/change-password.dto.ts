import { PasswordPolicy } from '../../common/password-policy';
import { IsString, IsOptional } from 'class-validator';


export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @PasswordPolicy()
  newPassword!: string;
}
