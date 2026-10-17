import { Body, Controller, Get, Header, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { renderAccreditationQr } from '../membership/accreditation-identity';
import * as QRCode from 'qrcode';
import { Role } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccreditationsService } from './accreditations.service';
import { ActivateAccreditationDto, UpdateAccreditationDto } from './accreditations.dto';

@Controller('accreditations')
export class AccreditationsController {
  constructor(private readonly service: AccreditationsService) {}
  @Get('active') @Header('Cache-Control', 'no-store')
  active() { return this.service.active(); }
}

@Controller('admin/accreditations')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminAccreditationsController {
  constructor(private readonly service: AccreditationsService) {}
  @Get() @Header('Cache-Control', 'private, no-store')
  list() { return this.service.list(); }
  @Get(':id/preview-data') @Header('Cache-Control', 'private, no-store')
  async previewData(@Param('id') id: string) {
    return { ...await this.service.preview(id), sampleQr: id === 'metacrilatos'
      ? await renderAccreditationQr('CRX:PREVIEW:INVALID')
      : await QRCode.toDataURL('CRONOX: VISTA PREVIA SIN VALIDEZ') };
  }
  @Get(':id/preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  async preview(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const design = await this.service.preview(id);
    // Allow embedding only this authenticated preview, only on our own origin.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const csp = res.getHeader('Content-Security-Policy');
    if (typeof csp === 'string') res.setHeader('Content-Security-Policy', csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
    if (design.renderer === 'metacrilatos-v1') {
      // A minimal sample document shares the presentation module with the
      // profile. It contains no account page, customer scripts or personal QR.
      return readFile(join(__dirname, '../../../cronox-front/metacrilatos-preview.html'), 'utf8');
    }
    // Reuse the real template/styles. No customer scripts, QR issuance, analytics,
    // promotions or other business actions run in this isolated document.
    const html = await readFile(join(__dirname, '../../../cronox-front/profile.html'), 'utf8');
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace('<head>', '<head><base href="/"><style>body{visibility:hidden}</style>')
      .replace('</body>', '<script src="/assets/user-identity.js?v=1"></script><script src="/assets/metacrilatos.js?v=5"></script><script src="/assets/accreditation-designs.js?v=2"></script><script src="/assets/accreditation-preview.js?v=6"></script></body>');
  }
  @Post(':id/activate')
  activate(@Param('id') id: string, @Body() dto: ActivateAccreditationDto, @CurrentUser('id') actorId: number) {
    return this.service.activate(id, dto.expectedRevision, actorId);
  }
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccreditationDto, @CurrentUser('id') actorId: number) {
    return this.service.update(id, dto, actorId);
  }
}
