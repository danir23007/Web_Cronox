import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  CanActivate,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import multer, { diskStorage } from 'mailbox-multer';
import { createReadStream, mkdirSync, realpathSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { mailboxPrivateRoot } from './mailbox-files.service';
import type { Request, Response } from 'express';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AuthSessionsService } from '../auth/auth-sessions.service';
import { MailboxService } from './mailbox.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { MailboxPushService } from './mailbox-push.service';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxCampaignService } from './mailbox-campaign.service';
import { madridInstant } from './mailbox-campaign-policy';
import { maxAttachmentBytes, safeFilename } from './mailbox-security';

class DeleteDraftDto {
  @IsInt() @Min(1) revision: number;
}
class GrantDto {
  @IsInt() @Min(1) userId: number;
  @IsIn(['read', 'send']) access: string;
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsOptional() @IsBoolean() details?: boolean;
}
class ConfigureDto {
  @IsString() @MaxLength(100) name: string;
  @IsString() @MaxLength(254) address: string;
  @IsString() @MaxLength(100) fromName: string;
  @IsIn(['hostinger', 'titan']) provider: string;
  @IsString() @MaxLength(100) imapHost: string;
  @IsInt() imapPort: number;
  @IsString() @MaxLength(100) smtpHost: string;
  @IsInt() smtpPort: number;
  @IsString() @MaxLength(254) username: string;
  @IsBoolean() active: boolean;
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsIn(['append', 'provider']) sentCopy: string;
  @IsOptional() @IsString() @MaxLength(100) imapSecretRef?: string;
  @IsOptional() @IsString() @MaxLength(100) smtpSecretRef?: string;
  @IsOptional() @IsString() @MaxLength(500) imapPassword?: string;
  @IsOptional() @IsString() @MaxLength(500) smtpPassword?: string;
  @IsOptional() @IsInt() revision?: number;
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GrantDto)
  permissions: GrantDto[];
}
class DraftDto {
  @IsUUID() mailboxId: string;
  @IsOptional() @IsUUID() messageId?: string;
  @IsOptional()
  @IsIn(['reply', 'forward', 'campaign'])
  mode?: string;
  @IsOptional() @IsString() @MaxLength(254) replyRecipient?: string;
}
class SaveDraftDto {
  @IsOptional() @IsString() @MaxLength(160) campaignName?: string;
  @IsOptional() @IsString() @MaxLength(100) familyId?: string;
  @IsOptional() @IsInt() @Min(1) variantId?: number;
  @IsOptional() @IsUUID() mailboxId?: string;
  @IsOptional() @IsString() @MaxLength(100) templateId?: string;
  @IsOptional() @IsString() @MaxLength(200000) html?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  circles?: number[];
  @IsOptional() @IsString() @MaxLength(15000) to?: string;
  @IsOptional() @IsString() @MaxLength(15000) cc?: string;
  @IsOptional() @IsString() @MaxLength(15000) bcc?: string;
  @IsOptional() @IsString() @MaxLength(500) subject?: string;
  @IsOptional() @IsString() @MaxLength(1000000) text?: string;
  @IsInt() @Min(1) revision: number;
}
class SendDto {
  @IsUUID() requestKey: string;
  @IsInt() @Min(1) revision: number;
}
class CampaignDto extends SendDto {
  @IsString() @MaxLength(64) previewHash: string;
  @IsOptional() @IsString() @MaxLength(16) localDate?: string;
  @IsOptional() @IsIn(['+01:00', '+02:00']) offset?: string;
}
class SaveCampaignSelectionDto extends SaveDraftDto {
  @IsOptional() @IsUUID() draftId?: string;
}
class SendCampaignSelectionDto extends CampaignDto {
  @IsOptional() @IsUUID() draftId?: string;
  @IsOptional() @IsString() @MaxLength(160) campaignName?: string;
  @IsOptional() @IsString() @MaxLength(100) familyId?: string;
  @IsOptional() @IsInt() @Min(1) variantId?: number;
  @IsArray() @ArrayMaxSize(5) @IsInt({ each: true }) circles: number[];
}
class TemplateDto {
  @IsString() @MaxLength(100) templateId: string;
  @IsOptional() variables?: Record<string, unknown>;
}
class SuppressionDto {
  @IsString() @MaxLength(254) email: string;
  @IsIn(['UNSUBSCRIBED', 'CONFIRMED_HARD_BOUNCE']) reason: string;
}
class ActionDto {
  @IsIn(['read', 'unread', 'trash', 'restore']) operation: string;
  @IsOptional() @IsUUID() destination?: string;
}
class CloneDto {
  @IsBoolean() acknowledge: boolean;
}
@Injectable()
export class MailboxPrivateResponse implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return next.handle();
  }
}
@Injectable()
export class MailboxDraftUploadGuard implements CanActivate {
  constructor(readonly access: MailboxAccessService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    await this.access.draft(request.user!, String(request.params.id));
    return true;
  }
}
@Injectable()
export class MailboxUploadInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const middleware = multer({
      storage: diskStorage({
        destination: (_req, _file, done) => {
          try {
            const root = mailboxPrivateRoot();
            const dir = resolve(root, 'uploads');
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            const real = realpathSync(dir),
              rel = relative(root, real);
            if (rel.startsWith('..') || isAbsolute(rel)) throw Error();
            done(null, real);
          } catch {
            done(new Error('MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED'), '');
          }
        },
        filename: (_req, _file, done) => done(null, randomUUID() + '.upload'),
      }),
      limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 0 },
    }).single('file');
    await new Promise<void>((resolveUpload, reject) =>
      middleware(http.getRequest(), http.getResponse(), (error) =>
        error
          ? reject(
              new BadRequestException('MAILBOX_UPLOAD_INVALID_OR_TOO_LARGE'),
            )
          : resolveUpload(),
      ),
    );
    return next.handle();
  }
}
@Catch()
export class MailboxErrorFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : error?.code === 'P2025'
          ? 404
          : error?.code === 'P2002'
            ? 409
            : 503;
    const raw = error instanceof HttpException ? error.getResponse() : null;
    const code = raw && typeof raw === 'object' ? (raw as any).message : raw;
    res.status(status).json({
      statusCode: status,
      ...(code === 'MAILBOX_CAMPAIGN_BLOCKED' &&
      Array.isArray((raw as any)?.details)
        ? { details: (raw as any).details }
        : {}),
      message:
        typeof code === 'string' &&
        /^(MAILBOX_|INVALID_|CREDENTIAL_|RECIPIENT_)[A-Z0-9_]+$/.test(code)
          ? code
          : error?.code === 'P2021'
            ? 'MAILBOX_MIGRATION_REQUIRED'
            : status === 400
              ? 'MAILBOX_INVALID_INPUT'
              : status === 403
                ? 'MAILBOX_ACCESS_DENIED'
                : status === 401
                  ? 'MAILBOX_SESSION_REQUIRED'
                  : 'MAILBOX_OPERATION_FAILED',
    });
  }
}
@Controller('admin/mailbox')
@UseGuards(JwtAuthGuard, AdminGuard)
@UseFilters(MailboxErrorFilter)
@UseInterceptors(MailboxPrivateResponse)
export class MailboxController {
  constructor(
    readonly service: MailboxService,
    readonly reader: MailboxReaderService,
    readonly push: MailboxPushService,
    readonly access: MailboxAccessService,
    readonly sessions: AuthSessionsService,
    readonly campaigns: MailboxCampaignService,
  ) {}
  @Get('overview') overview(@Req() r: Request) {
    return this.service.overview(r.user!);
  }
  @Get('schedule-preview') schedulePreview(
    @Query('localDate') localDate: string,
    @Query('offset') offset?: string,
  ) {
    return { scheduledAt: madridInstant(localDate, offset) };
  }
  @Get('administrators') administrators(@Req() r: Request) {
    this.access.superadmin(r.user!);
    return this.access.db.user.findMany({
      where: { role: 'ADMIN', accountState: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
  }
  @Post('suppressions') suppress(
    @Req() r: Request,
    @Body() body: SuppressionDto,
  ) {
    return this.campaigns.suppress(r.user!, body.email, body.reason);
  }
  @Get('messages') messages(@Req() r: Request, @Query() q: any) {
    return this.service.messages(r.user!, q);
  }
  @Get('messages/:id') body(@Req() r: Request, @Param('id') id: string) {
    return this.reader.body(r.user!, id);
  }
  @Get('messages/:id/status')
  async messageStatus(@Req() r: Request, @Param('id') id: string) {
    const message = await this.access.message(r.user!, id);
    return { id: message.id, mailboxId: message.mailboxId, seen: message.seen };
  }
  @Post('messages/:id/action') action(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: ActionDto,
  ) {
    return this.reader.action(r.user!, id, body.operation, body.destination);
  }
  @Post('boxes') @Throttle({ default: { limit: 6, ttl: 60000 } }) configure(
    @Req() r: Request,
    @Body() body: ConfigureDto,
  ) {
    return this.service.configure(r.user!, undefined, body);
  }
  @Patch('boxes/:id') configureExisting(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: ConfigureDto,
  ) {
    return this.service.configure(r.user!, id, body);
  }
  @Post('boxes/:id/test') @Throttle({ default: { limit: 3, ttl: 60000 } }) test(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return this.service.diagnose(r.user!, id);
  }
  @Post('boxes/:id/refresh')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  refresh(@Req() r: Request, @Param('id') id: string) {
    return this.service.refresh(r.user!, id);
  }
  @Get('drafts') drafts(@Req() r: Request, @Query('view') view?: string) {
    return this.service.drafts(r.user!, view);
  }
  @Delete('drafts/:id') deleteDraft(@Req() r: Request, @Param('id') id: string, @Body() body: DeleteDraftDto) {
    return this.service.deleteDraft(r.user!, id, body.revision);
  }
  private campaignSelection(q: any) {
    if (q.circles !== undefined && typeof q.circles !== 'string')
      throw new BadRequestException('MAILBOX_INVALID_CIRCLES');
    return { familyId: q.familyId, circles: q.circles ? q.circles.split(',').map(Number) : [],
      variantId: q.variantId ? Number(q.variantId) : undefined, revision: q.revision ? Number(q.revision) : 1 };
  }
  @Get('boxes/:id/campaign-audience') campaignAudience(@Req() r: Request, @Param('id') id: string, @Query() q: any) {
    return this.campaigns.audience(r.user!, id, this.campaignSelection(q));
  }
  @Get('boxes/:id/campaign-recipients.xlsx') async exportCampaignAudience(@Req() r: Request, @Param('id') id: string, @Query() q: any, @Res() res: Response) {
    const buffer = await this.campaigns.exportAudience(r.user!, id, this.campaignSelection(q));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="CRONOX-destinatarios.xlsx"');
    res.send(Buffer.from(buffer));
  }
  @Post('boxes/:id/campaign-draft') async saveCampaignSelection(@Req() r: Request, @Param('id') id: string, @Body() body: SaveCampaignSelectionDto) {
    const saved = await this.campaigns.saveSelection(r.user!, id, body);
    return this.service.draftView(await this.access.draft(r.user!, saved.id));
  }
  @Post('boxes/:id/campaign')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async sendCampaignSelection(@Req() r: Request, @Param('id') id: string, @Body() body: SendCampaignSelectionDto) {
    if (body.draftId && (await this.access.draft(r.user!, body.draftId)).mailboxId !== id)
      throw new BadRequestException('MAILBOX_INVALID_CAMPAIGN');
    return this.campaigns.enqueue(r.user!, body.draftId || null, { ...body, selection: true }, id);
  }
  @Get('boxes/:id/campaign-options')
  campaignOptions(@Req() req: Request, @Param('id') id: string) {
    return this.campaigns.options(req.user!, id);
  }
  @Get('boxes/:id/templates') templates(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return this.campaigns.templateList(r.user!, id);
  }
  @Post('boxes/:id/template') template(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: TemplateDto,
  ) {
    return this.campaigns.template(
      r.user!,
      id,
      body.templateId,
      body.variables,
    );
  }
  @Get('drafts/:id/recipients') recipients(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return this.campaigns.summary(r.user!, id);
  }
  @Post('drafts/:id/campaign')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  campaign(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: CampaignDto,
  ) {
    return this.campaigns.enqueue(r.user!, id, body);
  }
  @Get('campaigns/:id') campaignView(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return this.campaigns.view(r.user!, id);
  }
  @Post('campaigns/:id/cancel') cancel(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return this.campaigns.cancel(r.user!, id);
  }
  @Post('campaigns/:id/edit') edit(@Req() r: Request, @Param('id') id: string) {
    return this.campaigns.cancel(r.user!, id, true);
  }
  @Post('drafts') newDraft(@Req() r: Request, @Body() body: DraftDto) {
    return this.service.createDraft(r.user!, body);
  }
  @Get('drafts/:id') async draft(@Req() r: Request, @Param('id') id: string) {
    return this.service.draftView(await this.access.draft(r.user!, id));
  }
  @Patch('drafts/:id') save(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: SaveDraftDto,
  ) {
    return this.service.saveDraft(r.user!, id, body);
  }
  @Post('drafts/:id/send')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  send(@Req() r: Request, @Param('id') id: string, @Body() body: SendDto) {
    return this.service.enqueue(r.user!, id, body, (r as any).authSession);
  }
  @Post('drafts/:id/clone') clone(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: CloneDto,
  ) {
    return this.service.clone(r.user!, id, body.acknowledge);
  }
  @Delete('files/:id') remove(@Req() r: Request, @Param('id') id: string) {
    return this.service.removeFile(r.user!, id);
  }
  @Post('drafts/:id/files')
  @UseGuards(MailboxDraftUploadGuard)
  @UseInterceptors(MailboxUploadInterceptor)
  async upload(
    @Req() r: Request,
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    if (!file) throw new BadRequestException('MAILBOX_FILE_REQUIRED');
    try {
      if (file.size > maxAttachmentBytes())
        throw new BadRequestException('MAILBOX_ATTACHMENT_TOO_LARGE');
      const saved = await this.service.upload(
        r.user!,
        id,
        createReadStream(file.path),
        safeFilename(file.originalname),
        String(file.mimetype).slice(0, 100),
      );
      return { id: saved.id, name: saved.name, size: saved.size };
    } finally {
      await unlink(file.path).catch(() => {});
    }
  }
  @Get('files/:id') async download(
    @Req() r: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.reader.file(r.user!, id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(safeFilename(file.name)).replace(/'/g, '%27')}`,
    );
    const timer = setInterval(() => {
      void (async () => {
        await this.access.box(r.user!, file.mailboxId);
        const claim = (r as any).authSession;
        await this.sessions.validate({
          sub: r.user!.id,
          sid: claim.sid,
          sv: claim.sv,
          type: 'access',
        });
      })().catch(() => {
        file.stream.destroy();
        res.destroy();
      });
    }, 3000);
    timer.unref();
    res.on('close', () => {
      clearInterval(timer);
      file.stream.destroy();
    });
    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
  }
  @Get('push/config') async pushConfig(@Req() r: Request) {
    await this.access.allowedIds(r.user!);
    return this.push.config();
  }
  @Get('push/devices') devices(@Req() r: Request) {
    return this.push.devices(r.user!);
  }
  @Post('push/devices') subscribe(@Req() r: Request, @Body() body: any) {
    return this.push.subscribe(r.user!, (r as any).authSession, body);
  }
  @Delete('push/devices/:id') disable(
    @Req() r: Request,
    @Param('id') id: string,
  ) {
    return this.push.disable(r.user!, id);
  }
  @Patch('push/devices/:id') preferences(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.push.preferences(r.user!, id, body);
  }
  @Post('push/logout') disableSession(@Req() r: Request) {
    return this.push.disable(r.user!, undefined, (r as any).authSession.sid);
  }
  @Get('notices') notices(@Req() r: Request, @Query('after') after: string) {
    return this.push.notices(r.user!, after);
  }
  @Get('audit') async audit(
    @Req() r: Request,
    @Query('mailboxId') mailboxId: string,
  ) {
    this.access.superadmin(r.user!);
    return this.access.db.mailboxAudit.findMany({
      where: mailboxId ? { mailboxId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
