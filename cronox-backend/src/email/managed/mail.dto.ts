import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

export class MailListDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @MaxLength(100) folderId?: string;
  @IsOptional() @IsIn(['name', 'createdAt', 'updatedAt']) sort:
    | 'name'
    | 'createdAt'
    | 'updatedAt' = 'updatedAt';
  @IsOptional() @IsIn(['true', 'false']) archived?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}
export class MailSaveDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['FOR_ALL', 'UNIQUE', 'DIFFERENT'])
  visualClassification?: string;
  @IsOptional() @IsString() @MaxLength(1000000) textOverride?: string;
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(100) folderId!: string;
  @IsString() @MaxLength(200) subject!: string;
  @IsOptional() @IsString() @MaxLength(300) preheader = '';
  @IsOptional() @IsString() @MaxLength(80) purpose?: string;
  @IsObject() document!: Record<string, unknown>;
  @IsIn(['none', 'default', 'selected']) signatureMode:
    | 'none'
    | 'default'
    | 'selected' = 'none';
  @IsOptional() @IsString() @MaxLength(100) signatureId?: string;
  @IsOptional() @IsInt() @Min(1) revision?: number;
}
export class MailPreviewDto extends MailSaveDto {
  @IsOptional() @IsIn(['available']) previewDiscountCode?: 'available';
}
export class CampaignFamilyDto {
  @IsString() @MaxLength(120) name!: string;
  @IsIn(['LAUNCH', 'RESTOCK', 'GENERAL']) eventKind!: string;
  @IsOptional() @IsInt() @Min(1) revision?: number;
}
export class CampaignFamilyVersionDto {
  @IsString() @MaxLength(100) templateId!: string;
  @IsInt() @Min(1) revision!: number;
}
export class MailDraftTargetDto {
  @IsString() @MaxLength(100) id!: string;
  @IsInt() @Min(1) revision!: number;
}
export class MailMultiSaveDto extends MailSaveDto {
  @IsOptional() @IsIn(['classification', 'content']) saveMode?: 'classification' | 'content';
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean() explicitSelection?: boolean;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique((target: MailDraftTargetDto) => target.id)
  @ValidateNested({ each: true })
  @Type(() => MailDraftTargetDto)
  targets!: MailDraftTargetDto[];
}
export class MailActionDto {
  @IsIn([
    'duplicate',
    'move',
    'rename',
    'archive',
    'restore',
    'publish',
    'unpublish',
    'restoreVersion',
  ])
  action!: string;
  @IsInt() @Min(1) revision!: number;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(100) folderId?: string;
  @IsOptional() @IsString() @MaxLength(100) versionId?: string;
  @IsOptional() @IsBoolean() confirmed?: boolean;
}
export class FolderDto {
  @IsString() @MaxLength(120) name!: string;
}
export class FolderOrderDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];
}
export class FolderDeleteDto {
  @IsIn(['empty', 'move', 'archive']) mode!: string;
  @IsOptional() @IsString() @MaxLength(100) destinationId?: string;
}
export class SignatureDto {
  @IsString() @MaxLength(120) name!: string;
  @IsObject() document!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(1) revision?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class TestMailDto {
  @IsEmail() @MaxLength(254) to!: string;
  @IsBoolean() confirmed!: boolean;
}
export class AssetDto {
  @IsString() @MaxLength(300) alt!: string;
}
