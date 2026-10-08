import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserIdentityGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const path = req.path ?? '';
    const id = path.includes('/admin/users/') ? req.params?.id :
      req.query?.userId ?? (req.query?.targetType === 'user' ? req.query.targetId : null) ??
      (req.body?.targetType === 'user' ? req.body.targetId : null);
    if (!id || !/^\d+$/.test(String(id))) return true;
    const identityUid = req.headers['x-cronox-user-identity'];
    if (typeof identityUid !== 'string' || !/^[0-9a-f-]{36}$/i.test(identityUid)) this.stale();
    const user = await this.db.user.findUnique({ where:{ id:Number(id) },select:{ identityUid:true } });
    if (!user || user.identityUid !== identityUid) this.stale();
    return true;
  }
  private stale(): never {
    throw new ConflictException({ code:'USER_IDENTITY_CHANGED',message:'Este enlace de usuario ya no es válido. Selecciona la cuenta desde el listado actualizado.' });
  }
}
