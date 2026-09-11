import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UseFilters,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseStorageService } from '../../common/storage/supabase-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderKey } from '../email.types';
import { ManagedMailService } from './managed-mail.service';
import { MailExceptionFilter } from './mail-exception.filter';
import { renderMail } from './mail-renderer';
import { SAMPLE_DATA } from './mail-catalog';
import {
  AssetDto,
  FolderDeleteDto,
  FolderDto,
  FolderOrderDto,
  MailActionDto,
  MailListDto,
  MailMultiSaveDto,
  MailSaveDto,
  SignatureDto,
  TestMailDto,
} from './mail.dto';

@Controller('admin/mail-templates')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@UseFilters(MailExceptionFilter)
export class ManagedMailController {
  @Post(':key/signatures/preview')
  previewSignature(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Body() dto: SignatureDto,
  ) {
    return {
      ...renderMail(dto.document, dto.name, '', null, SAMPLE_DATA),
      senderKey: key,
    };
  }
  constructor(
    private readonly service: ManagedMailService,
    private readonly db: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}
  @Get() accounts() {
    return this.service.accounts();
  }
  @Get('catalog') catalog() {
    return this.service.catalog();
  }
  @Post(':key/initialize') initialize(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.initialize(key, actor);
  }
  @Get(':key/folders') folders(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
  ) {
    return this.service.folders(key);
  }
  @Post(':key/folders') createFolder(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Body() dto: FolderDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.saveFolder(key, dto.name, undefined, actor);
  }
  @Patch(':key/folders/order') order(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Body() dto: FolderOrderDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.reorder(key, dto.ids, actor);
  }
  @Patch(':key/folders/:id') renameFolder(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: FolderDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.saveFolder(key, dto.name, id, actor);
  }
  @Delete(':key/folders/:id') deleteFolder(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: FolderDeleteDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.deleteFolder(key, id, dto, actor);
  }
  @Get(':key/templates') list(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Query() dto: MailListDto,
  ) {
    return this.service.list(key, dto);
  }
  @Get(':key/templates/:id') template(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
  ) {
    return this.service.template(key, id);
  }
  @Get(':key/templates/:id/draft-targets') draftTargets(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
  ) {
    return this.service.draftTargets(key, id);
  }
  @Post(':key/templates') create(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Body() dto: MailSaveDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.save(key, dto, actor);
  }
  @Patch(':key/templates/:id') save(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: MailSaveDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.save(key, dto, actor, id);
  }
  @Patch(':key/templates/:id/drafts') saveDrafts(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: MailMultiSaveDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.saveDrafts(key, id, dto, actor);
  }
  @Post(':key/templates/:id/actions') action(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: MailActionDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.action(key, id, dto, actor);
  }
  @Get(':key/templates/:id/versions') versions(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
  ) {
    return this.service.versions(key, id);
  }
  @Post(':key/preview') preview(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Body() dto: MailSaveDto,
  ) {
    return this.service.preview(key, dto);
  }
  @Post(':key/templates/:id/test')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  test(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: TestMailDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.test(key, id, dto.to, dto.confirmed, actor);
  }
  @Get(':key/signatures') signatures(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
  ) {
    return this.service.signatures(key);
  }
  @Post(':key/signatures') createSignature(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Body() dto: SignatureDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.saveSignature(key, dto, actor);
  }
  @Patch(':key/signatures/:id') saveSignature(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
    @Body() dto: SignatureDto,
    @CurrentUser('id') actor?: number,
  ) {
    return this.service.saveSignature(key, dto, actor, id);
  }
  @Get(':key/assets') async assets(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Query() dto: MailListDto,
  ) {
    const [items, total] = await this.db.$transaction([
      this.db.emailAsset.findMany({
        where: { senderKey: key },
        orderBy: { createdAt: 'desc' },
        take: dto.limit,
        skip: (dto.page - 1) * dto.limit,
      }),
      this.db.emailAsset.count({ where: { senderKey: key } }),
    ]);
    return { items, total, page: dto.page };
  }
  @Post(':key/assets')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AssetDto,
    @CurrentUser('id') actor?: number,
  ) {
    await this.db.emailSenderProfile.findUniqueOrThrow({ where: { key } });
    const uploaded = await this.storage.uploadEmailImage(file, key);
    return this.db.$transaction(async (tx) => {
      const asset = await tx.emailAsset.create({
        data: {
          ...uploaded,
          senderKey: key,
          name: file.originalname.slice(0, 120),
          alt: dto.alt,
          createdBy: actor,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor,
          action: 'EMAIL_ASSET_UPLOAD',
          actionType: 'EMAIL_ASSET_UPLOAD',
          targetType: 'EMAIL_ASSET',
          targetId: asset.id,
        },
      });
      return asset;
    });
  }

  @Get(':key/assets/:id/usage')
  async usage(
    @Param('key', new ParseEnumPipe(EmailSenderKey)) key: EmailSenderKey,
    @Param('id') id: string,
  ) {
    const asset = await this.db.emailAsset.findFirst({
      where: { id, senderKey: key },
    });
    if (!asset)
      throw new NotFoundException('Imagen no encontrada en esta cuenta.');
    const items = await this.db.$queryRaw<
      Array<{ id: string; name: string; source: string }>
    >`
      SELECT id, name, 'Borrador' AS source FROM "ManagedEmailTemplate" WHERE "senderKey"=${key} AND POSITION(${asset.url} IN document::text)>0
      UNION SELECT t.id, t.name, 'Versión publicada' AS source FROM "EmailTemplateVersion" v JOIN "ManagedEmailTemplate" t ON t.id=v."templateId" WHERE t."senderKey"=${key} AND POSITION(${asset.url} IN v.snapshot::text)>0
      UNION SELECT id, name, 'Firma' AS source FROM "EmailSignature" WHERE "senderKey"=${key} AND POSITION(${asset.url} IN document::text)>0
    `;
    return {
      items,
      message:
        'Las imágenes se conservan; no hay eliminación permanente desde el editor.',
    };
  }
}
