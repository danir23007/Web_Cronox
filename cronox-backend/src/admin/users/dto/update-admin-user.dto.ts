import { Role, UserAccountState } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const optionalTrim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() || null : value;
const NAME_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/;
const PHONE_REGEX = /^\+?[\d\s()-]+$/;

export class UpdateAdminUserDto {
  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @Length(1, 160)
  @Matches(NAME_REGEX, {
    message: 'El nombre solo puede contener letras y espacios',
  })
  name?: string | null;

  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @Length(6, 32)
  @Matches(PHONE_REGEX, {
    message:
      'El teléfono debe usar un formato internacional válido con números y un único + inicial opcional',
  })
  phone?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(Role)
  role?: Role;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(UserAccountState)
  accountState?: UserAccountState;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(5)
  circleLevel?: number;

  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
