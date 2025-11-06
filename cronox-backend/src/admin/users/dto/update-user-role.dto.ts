import { Role } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateUserRoleDto {
  @IsEnum(Role)
  role!: Role;
}
