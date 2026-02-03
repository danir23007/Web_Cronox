import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

const trim = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  lastName?: string;
}

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users/admin/ping')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.MODERATOR, Role.LOGISTICS, Role.MARKETING)
  adminPing() {
    return { message: 'pong' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser('id') userId: number) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.usersService.toSafeUser(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @CurrentUser('id') userId: number,
    @Body() dto: UpdateMeDto,
  ) {
    if (dto.name === undefined && dto.firstName === undefined && dto.lastName === undefined) {
      const user = await this.usersService.findById(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return this.usersService.toSafeUser(user);
    }

    return this.usersService.updateProfile(userId, {
      name: dto.name,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
  }
}
