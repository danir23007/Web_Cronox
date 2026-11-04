import { Equals, IsISO8601 } from 'class-validator';

export class DeleteAdminUserDto {
  @Equals(true)
  confirmed!: true;

  @IsISO8601()
  expectedUpdatedAt!: string;
}
