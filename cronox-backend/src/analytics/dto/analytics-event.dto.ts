import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CustomerActivityEventType } from '@prisma/client';

const CLIENT_EVENT_TYPES = [
  CustomerActivityEventType.PRODUCT_VIEWED,
  CustomerActivityEventType.SEARCH_PERFORMED,
  CustomerActivityEventType.CATEGORY_VIEWED,
  CustomerActivityEventType.ACTIVE_TIME,
] as const;

export class AnalyticsEventDto {
  @IsUUID()
  clientEventId!: string;

  @IsEnum(CLIENT_EVENT_TYPES)
  eventType!: (typeof CLIENT_EVENT_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  categorySlug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  searchQuery?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  resultCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  activeSeconds?: number;
}

export class IngestAnalyticsEventsDto {
  @IsUUID()
  sessionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnalyticsEventDto)
  events!: AnalyticsEventDto[];
}
