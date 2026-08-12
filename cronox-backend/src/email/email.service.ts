import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import Handlebars from 'handlebars';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { SentMessageInfo } from 'nodemailer';
import { loadEmailConfig } from './email.config';
import { MailTransportFactory } from './mail-transport.factory';
import {
  EMAIL_TEMPLATE_FILE,
  EMAIL_TYPE_TO_SENDER,
  EMAIL_TYPE_TO_TEMPLATE,
  EmailSendOptions,
  EmailSendResult,
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

  constructor(private readonly transportFactory: MailTransportFactory) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    if (!this.config.enabled) {
      throw new InternalServerErrorException(
        'El envio de email no esta habilitado.',
      );
    }

    const senderKey = EMAIL_TYPE_TO_SENDER[options.type];
    const template = EMAIL_TYPE_TO_TEMPLATE[options.type];

    try {
      const html = await this.renderTemplate(template, {
        subject: options.subject,
        title: options.subject,
        ...options.templateData,
      });

      const info = (await this.transportFactory
        .getTransport(senderKey)
        .sendMail({
          to: options.to,
          from: this.transportFactory.getFrom(senderKey),
          subject: options.subject,
          html,
        })) as SentMessageInfo;

      return { messageId: info.messageId };
    } catch (error) {
      this.logger.error(
        `Fallo enviando email. type=${options.type} sender=${senderKey}`,
      );
      throw new InternalServerErrorException(
        'No se pudo enviar el email. Revisa la configuración SMTP.',
      );
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
      subject: 'CRONOX newsletter confirmation',
      templateData: {
        title: 'Confirm your subscription',
        message:
          'Confirm your email address to activate the newsletter and welcome discount.',
        actionUrl: link,
        actionLabel: 'Confirm subscription',
      },
    });
  }

  async sendFirstOrderDiscount(email: string, code: string) {
    const subject = 'CRONOX · Tu descuento de bienvenida';
    return this.send({
      type: EmailType.GENERIC,
      to: email,
      subject,
      templateData: {
        title: 'Descuento de primera compra',
        message: `Tu código de descuento es: ${code}`,
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
