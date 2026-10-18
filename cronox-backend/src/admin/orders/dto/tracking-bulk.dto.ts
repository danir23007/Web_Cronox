import { IsArray, ArrayMaxSize, ArrayMinSize, IsBoolean } from 'class-validator';

// Rows are validated individually to return useful errors beside every row.
export class TrackingBulkAssignDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  rows!: unknown[];

  @IsBoolean()
  preview!: boolean;
}

export class TrackingBulkSyncDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  orderIds!: unknown[];
}

export class FulfillmentBulkShipDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  rows!: unknown[];

  @IsBoolean()
  preview!: boolean;
}
