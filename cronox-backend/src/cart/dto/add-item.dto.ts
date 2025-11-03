import { IsInt, Min } from 'class-validator';

export class AddItemDto {
  @IsInt()
  variantId!: number;

  @IsInt()
  @Min(1)
  qty!: number;
}
