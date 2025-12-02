import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendPasswordReset(email: string, link: string) {
    this.logger.log(`Password reset link for ${email}: ${link}`);
  }

  async sendFirstOrderDiscount(email: string, code: string) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      this.logger.log(`Enviando código de bienvenida a ${email}`);
      return;
    }

    this.logger.log(`First order discount for ${email}: ${code}`);
  }
}
