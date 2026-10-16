import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export const ORIGINAL_ARTWORK = 'https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/Acreditation/Libro-antiguo.png';
export interface DesignDefinition {
  renderer: string;
  validate(config: Prisma.JsonValue): Prisma.InputJsonObject;
  checkResources(config: Prisma.InputJsonObject): Promise<void>;
}
// Only implemented, reviewed renderers belong here. Database rows alone cannot
// enable arbitrary templates, scripts or unfinished designs.
export const DESIGN_REGISTRY: Readonly<Record<string, DesignDefinition>> = Object.freeze({
  original: {
    renderer: 'original-v1',
    async checkResources(config) {
      const url = String(config.artworkUrl);
      try {
        if (url.startsWith('/assets/')) {
          if (!(await stat(join(__dirname, '../../../cronox-front', url))).isFile()) throw new Error();
        } else {
          const response = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000) });
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error();
        }
      } catch {
        throw new BadRequestException('No se pudo verificar la imagen del diseño. La acreditación anterior se conserva.');
      }
    },
    validate(config) {
      if (!config || typeof config !== 'object' || Array.isArray(config) ||
          Object.keys(config).some(key => !['version', 'artworkUrl'].includes(key)) ||
          config.version !== 1 || typeof config.artworkUrl !== 'string') {
        throw new BadRequestException('Configuración de acreditación incompleta');
      }
      const url = config.artworkUrl;
      if (!/^\/assets\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)$/.test(url) &&
          !/^https:\/\/frqlgocxnyppzdgxxjuq\.supabase\.co\/storage\/v1\/object\/public\/Acreditation\/[a-zA-Z0-9_./%-]+\.(png|jpg|jpeg|webp)$/.test(url)) {
        throw new BadRequestException('Usa una imagen de assets o del almacén de acreditaciones existente');
      }
      if (url.includes('..')) throw new BadRequestException('Ruta de imagen inválida');
      return { version: 1, artworkUrl: url };
    },
  },
});
