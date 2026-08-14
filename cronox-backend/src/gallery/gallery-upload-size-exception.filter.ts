import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

export const GALLERY_UPLOAD_TOO_LARGE_MESSAGE =
  'La imagen supera el tama\u00f1o m\u00e1ximo permitido de 25 MB.';

@Catch(PayloadTooLargeException)
export class GalleryUploadSizeExceptionFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(413).json({
      statusCode: 413,
      message: GALLERY_UPLOAD_TOO_LARGE_MESSAGE,
      error: 'Payload Too Large',
    });
  }
}
