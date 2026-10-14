import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import multer, { memoryStorage } from 'mailbox-multer';
import { SHIPPING_LABEL_MAX_BYTES } from './labels.service';

@Injectable()
export class ShippingLabelUploadInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const upload = multer({
      storage: memoryStorage(),
      limits: { fileSize: SHIPPING_LABEL_MAX_BYTES, files: 1, fields: 1, fieldSize: 20, parts: 2 },
      fileFilter: (_req, file, done) => {
        if (file.mimetype !== 'application/pdf') return done(new Error('PDF_REQUIRED'));
        done(null, true);
      },
    }).single('file');
    await new Promise<void>((resolve, reject) => {
      upload(http.getRequest(), http.getResponse(), (error) => {
        if (error) reject(new BadRequestException('Selecciona una etiqueta PDF de hasta 10 MiB'));
        else resolve();
      });
    });
    return next.handle();
  }
}
