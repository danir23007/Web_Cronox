import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccreditationDesign, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DESIGN_REGISTRY } from './design-registry';
import { UpdateAccreditationDto } from './accreditations.dto';
import { isDeepStrictEqual } from 'node:util';

@Injectable()
export class AccreditationsService {
  constructor(private readonly prisma: PrismaService) {}

  private describe(design: AccreditationDesign) {
    const definition = DESIGN_REGISTRY[design.id];
    if (!definition || definition.renderer !== design.renderer) {
      throw new BadRequestException('Diseño no implementado o incompleto');
    }
    return { ...design, config: definition.validate(design.config) };
  }

  async list() {
    return this.prisma.$transaction(async tx => {
      const state = await tx.accreditationSelection.findUniqueOrThrow({ where: { id: 'global' } });
      const designs = await tx.accreditationDesign.findMany({ orderBy: { createdAt: 'asc' } });
      return { revision: state.revision, designs: designs.map(design => {
        let ready = true;
        try { this.describe(design); } catch { ready = false; }
        return { ...design, ready, active: state.activeDesignId === design.id };
      }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async active() {
    const selection = await this.prisma.accreditationSelection.findUniqueOrThrow({
      where: { id: 'global' }, include: { activeDesign: true },
    });
    const { id, renderer, config } = this.describe(selection.activeDesign);
    return { id, renderer, config };
  }

  async preview(id: string) {
    const design = await this.prisma.accreditationDesign.findUnique({ where: { id } });
    if (!design) throw new NotFoundException('Acreditación inexistente');
    return this.describe(design);
  }

  async activate(id: string, expectedRevision: number, actorId?: number) {
    await this.prisma.$transaction(async tx => {
      // Serialize activation and configuration edits on the same singleton row.
      await tx.$queryRaw`SELECT "id" FROM "AccreditationSelection" WHERE "id" = 'global' FOR UPDATE`;
      const design = await tx.accreditationDesign.findUnique({ where: { id } });
      if (!design) throw new NotFoundException('Acreditación inexistente');
      const validated = this.describe(design);
      await DESIGN_REGISTRY[id].checkResources(validated.config);
      const before = await tx.accreditationSelection.findUniqueOrThrow({ where: { id: 'global' } });
      const result = await tx.accreditationSelection.updateMany({
        where: { id: 'global', revision: expectedRevision },
        data: { activeDesignId: id, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException('La selección cambió. Recarga antes de activar.');
      await tx.auditLog.create({ data: { actorId, action: 'accreditation.activate', actionType: 'UPDATE',
        targetType: 'accreditation', targetId: id,
        metadata: { before: before.activeDesignId, after: id } } });
    });
    return this.list();
  }

  async update(id: string, dto: UpdateAccreditationDto, actorId?: number) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    if (id === 'metacrilatos' && name !== 'METACRILATOS') throw new BadRequestException('El nombre de esta familia es METACRILATOS');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "AccreditationSelection" WHERE "id" = 'global' FOR UPDATE`;
      const current = await tx.accreditationDesign.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Acreditación inexistente');
      const validated = this.describe({ ...current, config: dto.config as Prisma.JsonObject });
      if (current.revision !== dto.expectedRevision) throw new ConflictException('La configuración cambió. Recarga antes de guardar.');
      // An unchanged submission must not touch timestamps, revisions or audit.
      if (current.name === name && isDeepStrictEqual(current.config, validated.config)) return;
      await DESIGN_REGISTRY[id].checkResources(validated.config);
      const result = await tx.accreditationDesign.updateMany({
        where: { id, revision: dto.expectedRevision },
        data: { name, config: validated.config, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new ConflictException('La configuración cambió. Recarga antes de guardar.');
      // Invalidates activation forms opened before this edit.
      await tx.accreditationSelection.update({ where: { id: 'global' }, data: { revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId, action: 'accreditation.configure', actionType: 'UPDATE',
        targetType: 'accreditation', targetId: id,
        metadata: { before: current.config, after: validated.config, name } } });
    });
    return this.list();
  }
}
