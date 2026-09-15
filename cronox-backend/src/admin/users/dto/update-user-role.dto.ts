import { Role } from '@prisma/client';
import { IsEnum, IsISO8601 } from 'class-validator';

export class UpdateUserRoleDto {
  @IsEnum(Role)
  role!: Role;

  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
