import { IsEmail } from 'class-validator';

export class NewsletterSubscribeDto {
  @IsEmail()
  email!: string;
}
