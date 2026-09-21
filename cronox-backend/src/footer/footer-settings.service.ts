import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateFooterPageContentDto } from './dto/update-footer-page-content.dto';
import { UpdateFooterSettingsDto } from './dto/update-footer-settings.dto';

const SETTINGS_ID = 'global';
export const FOOTER_PAGE_SLUGS = Object.freeze([
  'faqs',
  'shipping-policy',
  'returns-exchanges',
  'develop',
  'events',
  'privacy-policy',
  'cookie-policy',
  'terms-of-service',
  'legal-notice',
] as const);
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
      instagramUrl: record?.instagramUrl || FOOTER_DEFAULTS.instagramUrl,
      tiktokUrl: record?.tiktokUrl || FOOTER_DEFAULTS.tiktokUrl,
      youtubeUrl: record?.youtubeUrl || FOOTER_DEFAULTS.youtubeUrl,
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

  private assertPageSlug(slug: string) {
    if (!(FOOTER_PAGE_SLUGS as readonly string[]).includes(slug)) {
      throw new BadRequestException('Página de Footer no válida');
    }
    return slug;
  }

  private sanitizePageHtml(value: string) {
    const html = sanitizeHtml(value, {
      allowedTags: [
        'h1',
        'h2',
        'h3',
        'h4',
        'p',
        'ul',
        'ol',
        'li',
        'a',
        'strong',
        'em',
        'br',
        'div',
        'section',
        'article',
        'button',
        'span',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'code',
      ],
      allowedAttributes: {
        '*': ['id', 'class', 'hidden', 'aria-*', 'data-*'],
        a: ['href', 'target', 'rel'],
        button: ['type'],
      },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowedSchemesAppliedToAttributes: ['href'],
      allowProtocolRelative: false,
      enforceHtmlBoundary: true,
      transformTags: {
        a: (_tagName, attribs) => ({
          tagName: 'a',
          attribs: {
            ...attribs,
            ...(attribs.target === '_blank'
              ? { rel: 'noopener noreferrer' }
              : {}),
          },
        }),
      },
    }).trim();
    if (!html || !/<h1(?:\s|>)/i.test(html)) {
      throw new BadRequestException(
        'El contenido debe conservar un título principal válido',
      );
    }
    return html;
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
      const settings = this.serialize(await this.record());
      return {
        version: 1,
        ...FOOTER_DEFAULTS,
        instagramUrl: settings.instagramUrl,
        tiktokUrl: settings.tiktokUrl,
        youtubeUrl: settings.youtubeUrl,
      };
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
    const { expectedRevision } = dto;
    const data = {
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

  async getPageContent(slug: string, includeRevision = false) {
    const safeSlug = this.assertPageSlug(slug);
    try {
      const record = await this.prisma.footerPageContent.findUnique({
        where: { slug: safeSlug },
      });
      return {
        version: 1,
        slug: safeSlug,
        html: record?.html ?? null,
        ...(includeRevision
          ? {
              revision: record?.revision ?? 0,
              updatedAt: record?.updatedAt ?? null,
            }
          : {}),
      };
    } catch (error) {
      if (this.isMissingTable(error)) {
        return {
          version: 1,
          slug: safeSlug,
          html: null,
          ...(includeRevision ? { revision: 0, updatedAt: null } : {}),
        };
      }
      throw error;
    }
  }

  async updatePageContent(
    slug: string,
    dto: UpdateFooterPageContentDto,
    adminId?: number,
  ) {
    const safeSlug = this.assertPageSlug(slug);
    const html = this.sanitizePageHtml(dto.html);
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.footerPageContent.findUnique({
          where: { slug: safeSlug },
        });
        if ((current?.revision ?? 0) !== dto.expectedRevision) {
          throw new ConflictException();
        }
        if (current) {
          const updated = await tx.footerPageContent.updateMany({
            where: { slug: safeSlug, revision: dto.expectedRevision },
            data: {
              html,
              updatedBy: adminId ?? null,
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new ConflictException();
        } else {
          await tx.footerPageContent.create({
            data: {
              slug: safeSlug,
              html,
              updatedBy: adminId ?? null,
              revision: 1,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            actorId: adminId ?? null,
            action: 'footer.page-content.update',
            actionType: 'UPDATE',
            targetType: 'footer-page-content',
            targetId: safeSlug,
            metadata: {
              beforeRevision: current?.revision ?? null,
              afterRevision: dto.expectedRevision + 1,
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
          'Otro administrador actualizó esta página. Recarga antes de guardar.',
        );
      }
      throw error;
    }
    return this.getPageContent(safeSlug, true);
  }
}
