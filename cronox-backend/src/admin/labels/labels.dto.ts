import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LabelsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) lotId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['true', 'false', '']) active?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class LabelLineDto {
  @IsOptional() @IsString() @MaxLength(100) lotId?: string;
  @IsInt() @Min(1) @Max(2147483647) variantId: number;
  @IsInt() @Min(1) @Max(500) quantity: number;
}
export class LabelSelectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LabelLineDto)
  lines: LabelLineDto[];
}
export class LabelLayoutDto {
  @IsIn(['brother-ql700-continuous62', 'brother-ql700-dk22223', 'custom'])
  profile = 'brother-ql700-continuous62';
  @IsIn(['portrait', 'rotated']) orientation = 'portrait';
  @IsNumber() @Min(30) @Max(150) width = 62;
  @IsNumber() @Min(30) @Max(100) height = 35;
  @IsNumber() @Min(0) @Max(25) margin = 3;
  @IsNumber() @Min(0) @Max(20) gap = 0;
  @IsNumber() @Min(0) @Max(8) padding = 1.55;
  @IsNumber() @Min(30) @Max(420) pageWidth = 62;
  @IsNumber() @Min(30) @Max(600) pageHeight = 35;
}
export class LabelElementDto {
  @IsString() @MaxLength(60) id: string;
  @IsIn(['brand', 'name', 'size', 'color', 'barcode', 'identifier', 'custom'])
  kind: string;
  @IsBoolean() visible: boolean;
  @IsString() @MaxLength(160) text: string;
  @IsNumber() @Min(6) @Max(18) fontSizePt: number;
  @IsIn(['left', 'center', 'right']) align: string;
  @IsNumber() @Min(0) @Max(5) gapAfter: number;
  @IsInt() @Min(1) @Max(3) maxLines: number;
}
export class LabelTemplateDefinitionDto {
  @IsIn([2]) schemaVersion: number;
  @IsDefined()
  @ValidateNested()
  @Type(() => LabelLayoutDto)
  layout: LabelLayoutDto;
  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => LabelElementDto)
  elements: LabelElementDto[];
}
export class LabelTemplateRevisionDto {
  @IsInt() @Min(0) @Max(2147483646) revision: number;
}
export class SaveLabelTemplateDto extends LabelTemplateRevisionDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => LabelTemplateDefinitionDto)
  template: LabelTemplateDefinitionDto;
}
export class LabelPreviewDto extends LabelSelectionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LabelLayoutDto)
  layout?: LabelLayoutDto;
  @IsOptional()
  @ValidateNested()
  @Type(() => LabelTemplateDefinitionDto)
  template?: LabelTemplateDefinitionDto;
}
