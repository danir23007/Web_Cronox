import { IsBoolean, IsEmail, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class NewsletterSubscribeDto {
  @IsOptional()
  @IsBoolean()
  newsletterSubscribed?: boolean;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsEmail()
  email!: string;
}
