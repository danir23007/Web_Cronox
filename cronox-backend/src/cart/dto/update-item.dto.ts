import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateItemDto {
  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedQty?: number;
}
