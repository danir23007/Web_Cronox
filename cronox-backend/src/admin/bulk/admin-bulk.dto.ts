import { Type } from 'class-transformer';
import { UserAccountState } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
export class BulkChangesDto {
  @IsOptional() @IsIn(['USER', 'FRIEND', 'ADMIN']) role?:
    | 'USER'
    | 'FRIEND'
    | 'ADMIN';
  @IsOptional() @IsInt() @Min(1) @Max(5) circleLevel?: number;
  @IsOptional()
  @IsIn(Object.values(UserAccountState))
  accountState?: UserAccountState;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsIn(['add', 'remove', 'replace', 'clear']) categoryMode?:
    | 'add'
    | 'remove'
    | 'replace'
    | 'clear';
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  categoryIds?: number[];
}
export class BulkPreviewDto {
  @IsIn(['users', 'products']) kind: 'users' | 'products';
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  ids: number[];
  @IsOptional() @IsObject() userIdentities?: Record<string, string>;
  @ValidateNested() @Type(() => BulkChangesDto) changes: BulkChangesDto;
}
export class BulkExecuteDto extends BulkPreviewDto {
  @IsUUID() operationId: string;
  @IsString() @MaxLength(2048) reviewToken: string;
}
