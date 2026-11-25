import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class SaveBlackFridayDto {
  @IsBoolean() enabled!: boolean;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) title!: string;
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  bannerText!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) eventText!: string;
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  endsAt!: string;
  @Matches(/^#[\da-fA-F]{6}$/) textColor!: string;
  @Matches(/^#[\da-fA-F]{6}$/) backgroundColor!: string;
  @IsInt() @Min(1) revision!: number;
}

@Injectable()
export class BlackFridayService {
  constructor(private readonly prisma: PrismaService) {}
  async adminState() {
    const settings = await this.prisma.blackFridaySettings.upsert({
      where: { id: 'global' },
      create: {},
      update: {},
    });
    return { ...settings, serverTime: new Date().toISOString() };
  }
  async publicState() {
    try {
      const settings = await this.prisma.blackFridaySettings.findUnique({
        where: { id: 'global' },
      });
      const serverTime = new Date().toISOString();
      if (!settings?.enabled || settings.endsAt.getTime() <= Date.now())
        return { enabled: false, serverTime };
      const {
        id: _id,
        updatedBy: _by,
        updatedAt: _at,
        revision: _revision,
        ...publicSettings
      } = settings;
      return { ...publicSettings, serverTime };
    } catch {
      // An absent migration or unavailable configuration must never block the shop.
      return { enabled: false, serverTime: new Date().toISOString() };
    }
  }
  async save(dto: SaveBlackFridayDto, updatedBy?: number) {
    const startsAt = new Date(dto.startsAt),
      endsAt = new Date(dto.endsAt);
    if (
      !Number.isFinite(+startsAt) ||
      !Number.isFinite(+endsAt) ||
      +endsAt <= +startsAt
    ) {
      throw new BadRequestException(
        'La fecha de finalización debe ser posterior a la de inicio.',
      );
    }
    const { revision } = dto;
    const result = await this.prisma.blackFridaySettings.updateMany({
      where: { id: 'global', revision },
      data: {
        enabled: dto.enabled,
        title: dto.title,
        bannerText: dto.bannerText,
        eventText: dto.eventText,
        textColor: dto.textColor,
        backgroundColor: dto.backgroundColor,
        startsAt,
        endsAt,
        updatedBy,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new ConflictException(
        'La campaña ha cambiado. Recarga sus ajustes antes de guardar.',
      );
    return this.adminState();
  }
}

@Controller('black-friday')
export class PublicBlackFridayController {
  constructor(private readonly campaign: BlackFridayService) {}
  @Get() @Header('Cache-Control', 'no-store, max-age=0') state() {
    return this.campaign.publicState();
  }
}

@Controller('admin/black-friday')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class AdminBlackFridayController {
  constructor(private readonly campaign: BlackFridayService) {}
  @Get() @Header('Cache-Control', 'no-store, max-age=0') state() {
    return this.campaign.adminState();
  }
  @Patch() save(
    @Body() dto: SaveBlackFridayDto,
    @CurrentUser('id') id?: number,
  ) {
    return this.campaign.save(dto, id);
  }
}
