import { PasswordPolicy } from '../../common/password-policy';
import { IsString } from 'class-validator';


export class ResetDto {
  @IsString()
  token!: string;

  @IsString()
  @PasswordPolicy()
  newPassword!: string;
}
