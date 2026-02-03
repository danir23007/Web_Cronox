import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminNoteQueryDto } from './dto/admin-note-query.dto';
import { CreateAdminNoteDto } from './dto/create-admin-note.dto';
import { UpdateAdminNoteDto } from './dto/update-admin-note.dto';
import { isSuperAdminRole } from '../../common/roles.utils';

@Injectable()
export class AdminNotesService {
  constructor(private readonly prisma: PrismaService) {}

  private mapNote(note: {
    id: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    targetType: string;
    targetId: string;
    authorAdminId: number;
    author: {
      id: number;
      email: string | null;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      role: Role;
    };
  }) {
    return {
      id: note.id,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      targetType: note.targetType,
      targetId: note.targetId,
      authorAdminId: note.authorAdminId,
      author: note.author,
    };
  }

  async list(query: AdminNoteQueryDto) {
    const items = await this.prisma.adminNote.findMany({
      where: {
        targetType: query.targetType,
        targetId: query.targetId,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    return items.map((item) => this.mapNote(item));
  }

  async create(adminId: number, dto: CreateAdminNoteDto) {
    const content = dto.content.trim();
    const created = await this.prisma.adminNote.create({
      data: {
        authorAdminId: adminId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        content,
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    return this.mapNote(created);
  }

  async update(
    noteId: string,
    adminId: number,
    role: Role | null,
    dto: UpdateAdminNoteDto,
  ) {
    const note = await this.prisma.adminNote.findUnique({
      where: { id: noteId },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    if (!note || note.isDeleted) {
      throw new NotFoundException('Nota no encontrada');
    }

    if (note.authorAdminId !== adminId && !isSuperAdminRole(role)) {
      throw new ForbiddenException('No puedes editar esta nota');
    }

    const updated = await this.prisma.adminNote.update({
      where: { id: noteId },
      data: { content: dto.content.trim() },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    return this.mapNote(updated);
  }

  async remove(noteId: string, adminId: number, role: Role | null) {
    const note = await this.prisma.adminNote.findUnique({
      where: { id: noteId },
    });

    if (!note || note.isDeleted) {
      throw new NotFoundException('Nota no encontrada');
    }

    if (note.authorAdminId !== adminId && !isSuperAdminRole(role)) {
      throw new ForbiddenException('No puedes eliminar esta nota');
    }

    await this.prisma.adminNote.update({
      where: { id: noteId },
      data: { isDeleted: true },
    });

    return { id: noteId, deleted: true };
  }
}
