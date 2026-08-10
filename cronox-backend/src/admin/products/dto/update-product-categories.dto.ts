import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

export class UpdateProductCategoriesDto {
  @ApiProperty({
    description:
      'IDs únicos de las categorías que sustituirán la asignación actual',
    example: [1, 2, 5],
    type: [Number],
  })
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  categoryIds!: number[];
}
