import {
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import Handlebars from 'handlebars';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { loadEmailConfig } from './email.config';
import { MailTransportFactory } from './mail-transport.factory';
import { ManagedMailService } from './managed/managed-mail.service';
import { RestockDeliveryError, restockDeliveryOutcome } from './restock-delivery.error';
import {
  EMAIL_TEMPLATE_FILE,
  EMAIL_TYPE_TO_SENDER,
  EMAIL_TYPE_TO_TEMPLATE,
  EmailSendOptions,
  EmailSendResult,
  EmailSenderKey,
  EmailTemplate,
  EmailType,
} from './email.types';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly config = loadEmailConfig();
  private readonly templateCache = new Map<
    EmailTemplate,
    Handlebars.TemplateDelegate
  >();

  constructor(
    private readonly transportFactory: MailTransportFactory,
    @Optional() private readonly managed?: ManagedMailService,
  ) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isLaunchSenderConfigured(): boolean {
    const account = this.config.accounts[EmailSenderKey.INFO];
    return Boolean(this.config.enabled && account?.user && account.pass);
  }

  isRestockSenderConfigured(): boolean {
    return this.isLaunchSenderConfigured();
  }

  // Dedicated opt-in availability notice, independent from launch publications.
  async sendRestock(to: string, data: { product: string; size: string; actionUrl: string; imageUrl?: string }) {
    let html: string;
    try {
      html = await this.renderTemplate(EmailTemplate.RESTOCK, data);
      try {
        const custom = await this.managed?.published(EmailSenderKey.INFO, 'RESTOCK', data);
        const link = Handlebars.escapeExpression(data.actionUrl);
        if (custom && (custom.html.includes(`href="${link}"`) || custom.html.includes(`href='${link}'`))) html = custom.html;
      } catch { /* Preserve the working first-party template. */ }
    } catch { throw new RestockDeliveryError('RETRY'); }
    let info: { accepted?: unknown[] };
    try {
      info = await this.transportFactory.sendMail(EmailSenderKey.INFO, {
        to, subject: `Tu talla ha vuelto: ${data.product} · ${data.size}`,
        html,
        text: `Ya está disponible\nNos pediste que te avisáramos: ${data.product}, en la talla ${data.size}, vuelve a estar disponible en CRONOX.\nVER PRODUCTO: ${data.actionUrl}\nDisponibilidad sujeta a existencias. Este aviso no reserva la prenda.`,
      }, 'RESTOCK');
    } catch (error) { throw new RestockDeliveryError(restockDeliveryOutcome(error)); }
    if (!info.accepted?.length) throw new RestockDeliveryError('FAILED');
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const senderKey = EMAIL_TYPE_TO_SENDER[options.type];
    const template = EMAIL_TYPE_TO_TEMPLATE[options.type];

    try {
      const data: Record<string, unknown> = {
        subject: options.subject,
        title: options.subject,
        ...options.templateData,
      };
      let custom: { html: string; text: string; subject: string } | null = null;
      try {
        custom =
          (await this.managed?.published(
            senderKey,
            options.purpose || options.type,
            data,
          )) || null;
      } catch {
        this.logger.warn(
          `Plantilla gestionada no disponible; usando respaldo. type=${options.type}`,
        );
      }
      // A published design must never remove the verification action.
      if (options.purpose === 'NEWSLETTER_WELCOME' && custom && data.discountCode &&
          !custom.html.includes(Handlebars.escapeExpression(String(data.discountCode)))) custom = null;
      if (options.type === EmailType.NEWSLETTER_CONFIRMATION && custom) {
        const link = Handlebars.escapeExpression(String(data.actionUrl || ''));
        if (!link || !(custom.html.includes(`href="${link}"`) || custom.html.includes(`href='${link}'`))) {
          custom = null;
        }
      }
      const html = custom?.html || (await this.renderTemplate(template, data));

      const info = (await this.transportFactory
        .sendMail(senderKey, {
          to: options.to,
          subject: custom?.subject || options.subject,
          html,
          ...(custom ? { text: custom.text } : {}),
        }, options.purpose || options.type)) as { messageId: string; accepted?: unknown[] };

      if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
        throw new Error('SMTP_RECIPIENT_NOT_ACCEPTED');
      }

      return { messageId: info.messageId };
    } catch (error) {
      this.logger.error(
        `Fallo enviando email. type=${options.type} sender=${senderKey}`,
      );
      const failure = new InternalServerErrorException(
        'No se pudo enviar el email. Revisa la configuración SMTP.',
      );
      if ((error as { deliveryUnknown?: boolean }).deliveryUnknown) Object.assign(failure, { deliveryUnknown: true });
      throw failure;
    }
  }

  async sendPasswordReset(email: string, link: string) {
    const subject = 'CRONOX · Restablece tu contraseña';
    return this.send({
      type: EmailType.PASSWORD_RESET,
      to: email,
      subject,
      templateData: {
        title: 'Restablecimiento de contraseña',
        message:
          'Use the secure link below to reset your password. It expires in one hour.',
        actionUrl: link,
        actionLabel: 'Reset password',
      },
    });
  }

  async sendInitialPasswordSetup(email: string, link: string) {
    return this.send({
      purpose: 'INITIAL_PASSWORD_SETUP',
      type: EmailType.PASSWORD_RESET,
      to: email,
      subject: 'CRONOX · Tu cuenta ha sido creada',
      templateData: {
        title: 'Tu cuenta CRONOX ha sido creada',
        message:
          'Tu compra ya está asociada a tu nueva cuenta. Configura una contraseña para acceder a tus pedidos.',
        actionUrl: link,
        actionLabel: 'Configurar contraseña',
      },
    });
  }

  async sendNewsletterConfirmation(email: string, link: string) {
    return this.send({
      type: EmailType.NEWSLETTER_CONFIRMATION,
      to: email,
      subject: 'CRONOX · Confirma tu suscripción',
      templateData: {
        title: 'Confirma tu suscripción',
        message:
          'Confirma tu dirección para activar la newsletter y, si corresponde, tu descuento de bienvenida. El enlace caduca en 24 horas. Si has repetido la solicitud, utiliza el correo más reciente.',
        actionUrl: link,
        actionLabel: 'Confirmar suscripción',
      },
    });
  }

  async sendPreRegistrationConfirmation(email: string, registeredAt: Date) {
    return this.send({
      type: EmailType.PRE_REGISTRATION_CONFIRMATION,
      to: email,
      subject: 'CRONOX · Prerregistro confirmado',
      templateData: {
        title: 'Ya formas parte.',
        message:
          'Hemos recibido tu preregistro para el próximo lanzamiento de CRONOX.',
        email,
        preRegistrationDate: registeredAt.toISOString(),
      },
    });
  }

  async sendFirstOrderDiscount(email: string, code: string) {
    const subject = 'CRONOX · Tu descuento de bienvenida';
    return this.send({
      purpose: 'FIRST_ORDER_DISCOUNT',
      type: EmailType.GENERIC,
      to: email,
      subject,
      templateData: {
        title: 'Descuento de primera compra',
        message: `Tu código de descuento es: ${code}`,
      },
    });
  }

  async sendNewsletterWelcome(email: string, code?: string) {
    return this.send({
      purpose: 'NEWSLETTER_WELCOME', type: EmailType.GENERIC, to: email,
      subject: 'CRONOX · Te damos la bienvenida',
      templateData: {
        title: 'Bienvenido a CRONOX',
        message: code
          ? `Ya formas parte de nuestra newsletter. Tu código de bienvenida es ${code}: 10% de descuento en tu primera compra, de un solo uso y asociado a este correo. Utiliza esta misma dirección al comprar. ¡Gracias por unirte!`
          : 'Ya formas parte de nuestra newsletter. Recibirás nuestras novedades y próximos drops. ¡Gracias por unirte a CRONOX!',
        discountCode: code || '',
      },
    });
  }

  private async renderTemplate(
    template: EmailTemplate,
    data: Record<string, unknown>,
  ): Promise<string> {
    const compiledTemplate = await this.loadTemplate(template);
    return compiledTemplate(data);
  }

  private async loadTemplate(
    template: EmailTemplate,
  ): Promise<Handlebars.TemplateDelegate> {
    const cached = this.templateCache.get(template);
    if (cached) {
      return cached;
    }

    const fileName = EMAIL_TEMPLATE_FILE[template];
    const templatePaths = [
      join(process.cwd(), 'src', 'email', 'templates', fileName),
      join(__dirname, 'templates', fileName),
    ];

    for (const templatePath of templatePaths) {
      try {
        const content = await readFile(templatePath, 'utf8');
        const compiled = Handlebars.compile(content);
        this.templateCache.set(template, compiled);
        return compiled;
      } catch {
        // seguimos con el siguiente path
      }
    }

    throw new Error(`Plantilla de email no encontrada: ${fileName}`);
  }
}
