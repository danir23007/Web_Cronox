import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersService, SafeUser } from './users.service';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  name?: string;
}

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users/admin/ping')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.admin)
  adminPing() {
    return { message: 'pong' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: Request) {
    const userId = (req.user as SafeUser).id;
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.usersService.toSafeUser(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@Req() req: Request, @Body() dto: UpdateMeDto) {
    const userId = (req.user as SafeUser).id;

    if (dto.name === undefined) {
      const user = await this.usersService.findById(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return this.usersService.toSafeUser(user);
    }

    return this.usersService.updateProfile(userId, { name: dto.name });
  }
}
