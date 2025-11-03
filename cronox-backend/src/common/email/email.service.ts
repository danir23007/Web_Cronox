import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendPasswordReset(email: string, link: string) {
    this.logger.log(`Password reset link for ${email}: ${link}`);
  }
}
