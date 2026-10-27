import { Equals, IsISO8601, IsOptional, Matches } from 'class-validator';

export class DeleteAdminUserDto {
  @Equals(true)
  confirmed!: true;

  @IsISO8601()
  expectedUpdatedAt!: string;

  @IsOptional()
  @Equals(true)
  deleteQrParticipations?: true;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  qrParticipationToken?: string;
}
