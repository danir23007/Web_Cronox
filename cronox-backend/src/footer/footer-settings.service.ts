import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFooterSettingsDto } from './dto/update-footer-settings.dto';

const SETTINGS_ID = 'global';
export const FOOTER_DEFAULTS = Object.freeze({
  supportTitle: 'SOPORTE',
  supportFaqLabel: 'FAQS',
  supportShippingLabel: 'POLÍTICA DE ENVÍOS',
  supportReturnsLabel: 'DEVOLUCIONES Y CAMBIOS',
  collabTitle: 'COLABORA',
  collabDevelopLabel: 'DESARROLLA',
  collabEventsLabel: 'EVENTOS',
  legalTitle: 'LEGAL',
  legalPrivacyLabel: 'POLÍTICA DE PRIVACIDAD',
  legalCookiesLabel: 'POLÍTICA DE COOKIES',
  legalTermsLabel: 'TÉRMINOS DE SERVICIO',
  legalNoticeLabel: 'AVISO LEGAL',
  instagramUrl: 'https://www.instagram.com/cronox.es/',
  tiktokUrl: 'https://tiktok.com/@tu_cuenta',
  youtubeUrl: 'https://youtube.com/@tu_cuenta',
});

type FooterRecord = Prisma.FooterSettingsGetPayload<Record<string, never>>;

@Injectable()
export class FooterSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(record: FooterRecord | null) {
    return {
      ...FOOTER_DEFAULTS,
      ...(record
        ? Object.fromEntries(
            Object.keys(FOOTER_DEFAULTS).map((key) => [
              key,
              record[key as keyof typeof FOOTER_DEFAULTS] ||
                FOOTER_DEFAULTS[key as keyof typeof FOOTER_DEFAULTS],
            ]),
          )
        : {}),
      revision: record?.revision ?? 0,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  private isMissingTable(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2021'
    );
  }

  private validateSocialUrl(value: string) {
    try {
      const url = new URL(value.trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error();
      }
      return url.toString();
    } catch {
      throw new BadRequestException(
        'Las redes sociales deben usar una URL absoluta http o https',
      );
    }
  }

  private async record() {
    return this.prisma.footerSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
  }

  async getPublicSettings() {
    try {
      const {
        revision: _revision,
        updatedAt: _updatedAt,
        ...settings
      } = this.serialize(await this.record());
      return { version: 1, ...settings };
    } catch (error) {
      if (this.isMissingTable(error)) return { version: 1, ...FOOTER_DEFAULTS };
      throw error;
    }
  }

  async getAdminSettings() {
    try {
      return this.serialize(await this.record());
    } catch (error) {
      if (this.isMissingTable(error)) return this.serialize(null);
      throw error;
    }
  }

  async update(dto: UpdateFooterSettingsDto, adminId?: number) {
    const { expectedRevision, ...labelsAndUrls } = dto;
    const data = {
      ...labelsAndUrls,
      instagramUrl: this.validateSocialUrl(dto.instagramUrl),
      tiktokUrl: this.validateSocialUrl(dto.tiktokUrl),
      youtubeUrl: this.validateSocialUrl(dto.youtubeUrl),
      updatedBy: adminId ?? null,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.footerSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if ((current?.revision ?? 0) !== expectedRevision) {
          throw new ConflictException();
        }
        if (current) {
          const updated = await tx.footerSettings.updateMany({
            where: { id: SETTINGS_ID, revision: expectedRevision },
            data: { ...data, revision: { increment: 1 } },
          });
          if (updated.count !== 1) throw new ConflictException();
        } else {
          await tx.footerSettings.create({
            data: { id: SETTINGS_ID, ...data, revision: 1 },
          });
        }
        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: 'footer.settings.update',
            actionType: 'UPDATE',
            targetType: 'footer-settings',
            targetId: SETTINGS_ID,
            metadata: {
              before: current ? this.serialize(current) : null,
              after: data,
              revision: expectedRevision + 1,
            },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        throw new ConflictException(
          'Otro administrador actualizó el Footer. Recarga antes de guardar.',
        );
      }
      throw error;
    }
    return this.getAdminSettings();
  }
}
