import {
  Body,
  Controller,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { EmailService } from './email.service';
import { EmailType, OrderConfirmationEmailTemplateData } from './email.types';

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
    const templateData =
      type === EmailType.ORDER_CONFIRMATION
        ? this.buildOrderConfirmationMock(body.to)
        : {
            title: 'Email de prueba CRONOX',
            message: 'Este email confirma que la configuración SMTP está operativa.',
            customerEmail: body.to,
            orderId: 'ORDER-TEST-001',
            supportCaseId: 'SUP-TEST-001',
          };

    const result = await this.emailService.send({
      type,
      to: body.to,
      subject: `[CRONOX] Test email (${type})`,
      templateData,
    });

    return { ok: true, messageId: result.messageId };
  }

  private buildOrderConfirmationMock(
    customerEmail: string,
  ): OrderConfirmationEmailTemplateData {
    const storeUrl =
      process.env.FRONTEND_URL ??
      process.env.FRONT_URL ??
      process.env.STORE_URL ??
      'https://cronoxwear.com';

    return {
      orderId: 'ORDER-TEST-001',
      customerEmail,
      customerFullName: 'Cliente CRONOX',
      customerPhone: '+34 600 123 123',
      message:
        'Gracias por confiar en CRONOX. Estamos preparando tu pedido y te avisaremos en cuanto salga de nuestro almacén.',
      orderUrl: `${storeUrl.replace(/\/$/, '')}/profile.html?tab=orders&orderId=ORDER-TEST-001`,
      storeUrl,
      subtotalFormatted: '89,90 €',
      discountFormatted: '10,00 €',
      shippingFormatted: '4,99 €',
      taxesFormatted: '15,60 €',
      totalFormatted: '84,89 €',
      savingsFormatted: '10,00 €',
      shippingMethod: 'Envío Estándar 24/72h',
      shippingAddress: {
        fullName: 'Cliente CRONOX',
        line1: 'Calle Gran Vía 10',
        line2: '3º B',
        city: 'Madrid',
        state: 'Madrid',
        postalCode: '28013',
        country: 'España',
      },
      items: [
        {
          name: 'Camiseta Washed Negra',
          variantName: 'Talla M',
          quantity: 1,
          imageUrl:
            'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=200&q=80',
          unitPriceFormatted: '49,95 €',
          lineTotalFormatted: '49,95 €',
        },
        {
          name: 'Camiseta Washed Gris',
          variantName: 'Talla L',
          quantity: 1,
          imageUrl:
            'https://images.unsplash.com/photo-1503341455253-b2e723bb3dbb?auto=format&fit=crop&w=200&q=80',
          unitPriceFormatted: '39,95 €',
          lineTotalFormatted: '39,95 €',
        },
      ],
    };
  }
}
