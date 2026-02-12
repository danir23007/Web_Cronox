import {
  Body,
  Controller,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { EmailService } from './email.service';
import { EmailType } from './email.types';

class DevEmailTestDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsEnum(EmailType)
  type?: EmailType;
}

@Controller('dev/email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('test')
  async testEmail(@Body() body: DevEmailTestDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }

    const type = body.type ?? EmailType.TEST;
    const result = await this.emailService.send({
      type,
      to: body.to,
      subject: `[CRONOX] Test email (${type})`,
      templateData: {
        title: 'Email de prueba CRONOX',
        message: 'Este email confirma que la configuración SMTP está operativa.',
        customerEmail: body.to,
        orderId: 'ORDER-TEST-001',
        supportCaseId: 'SUP-TEST-001',
      },
    });

    return { ok: true, messageId: result.messageId };
  }
}
