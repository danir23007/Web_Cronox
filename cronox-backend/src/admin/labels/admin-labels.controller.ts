import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminLabelsService } from './admin-labels.service';
import {
  LabelPreviewDto,
  LabelSelectionDto,
  LabelsQueryDto,
  SaveLabelTemplateDto,
  LabelTemplateRevisionDto,
} from './labels.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('admin/physical-labels')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminLabelsController {
  constructor(private readonly labels: AdminLabelsService) {}
  @Get('template') @Header('Cache-Control', 'no-store') template() {
    return this.labels.template();
  }
  @Post('template') @Header('Cache-Control', 'no-store') saveTemplate(
    @Body() dto: SaveLabelTemplateDto,
    @CurrentUser('id') actorId?: number,
  ) {
    return this.labels.saveTemplate(dto, actorId);
  }
  @Post('template/reset') @Header('Cache-Control', 'no-store') resetTemplate(
    @Body() dto: LabelTemplateRevisionDto,
    @CurrentUser('id') actorId?: number,
  ) {
    return this.labels.resetTemplate(dto.revision, actorId);
  }
  @Get() @Header('Cache-Control', 'no-store') list(
    @Query() query: LabelsQueryDto,
  ) {
    return this.labels.list(query);
  }
  @Post('generate') @Header('Cache-Control', 'no-store') generate(
    @Body() dto: LabelSelectionDto,
  ) {
    return this.labels.generate(dto);
  }
  @Post('preview') @Header('Cache-Control', 'no-store') preview(
    @Body() dto: LabelPreviewDto,
  ) {
    return this.labels.preview(dto);
  }
  @Post('pdf')
  @Header('Cache-Control', 'no-store')
  async pdf(@Body() dto: LabelPreviewDto) {
    return new StreamableFile(await this.labels.pdf(dto), {
      type: 'application/pdf',
      disposition: 'attachment; filename="cronox-etiquetas.pdf"',
    });
  }
  @Get('resolve/:code') @Header('Cache-Control', 'no-store') resolve(
    @Param('code') code: string,
  ) {
    return this.labels.resolve(code);
  }
}
