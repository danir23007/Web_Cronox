import { IsInt, Min } from 'class-validator';

export class UpdateItemDto {
  @IsInt()
  @Min(1)
  qty!: number;
}
