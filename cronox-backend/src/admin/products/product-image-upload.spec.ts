import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PRODUCT_IMAGE_UPLOAD_MULTER_LIMITS } from './admin-products.controller';
import {
  PRODUCT_IMAGE_TOO_LARGE_MESSAGE,
  ProductImageUploadSizeExceptionFilter,
} from './product-image-upload-size-exception.filter';

const frontendRoot = path.resolve(__dirname, '../../../../cronox-front');

describe('Product image upload limit', () => {
  it('configures Multer with 25 MB per file and up to eight files', () => {
    expect(PRODUCT_IMAGE_UPLOAD_MULTER_LIMITS).toEqual({
      files: 8,
      fileSize: 25 * 1024 * 1024,
    });
  });

  it('returns the required message when Multer rejects an oversized file', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;

    new ProductImageUploadSizeExceptionFilter().catch(
      new PayloadTooLargeException('File too large'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 413,
      message: PRODUCT_IMAGE_TOO_LARGE_MESSAGE,
      error: 'Payload Too Large',
    });
    expect(PRODUCT_IMAGE_TOO_LARGE_MESSAGE).toBe(
      'Cada imagen puede pesar como máximo 25 MB.',
    );
  });

  it('keeps frontend format, copy and per-file validation aligned', () => {
    const html = readFileSync(path.join(frontendRoot, 'admin.html'), 'utf8');
    const script = readFileSync(
      path.join(frontendRoot, 'assets/admin.js'),
      'utf8',
    );

    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain(
      'JPEG, PNG o WEBP. Máximo 25 MB por imagen. La primera imagen será la principal.',
    );
    expect(script).toContain(
      'const MAX_PRODUCT_IMAGE_BYTES = 25 * 1024 * 1024;',
    );
    expect(script).toContain('file.size > MAX_PRODUCT_IMAGE_BYTES');
    expect(script).toContain(PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
  });

  it('uploads selected product images in separate multipart requests', () => {
    const source = readFileSync(
      path.join(frontendRoot, 'src/admin/api.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /for \(const file of files\) \{[\s\S]*new FormData\(\)[\s\S]*formData\.append\('files', file\)/,
    );
  });
});
