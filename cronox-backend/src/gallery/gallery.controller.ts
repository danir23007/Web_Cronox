import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GalleryService } from './gallery.service';

@ApiTags('Gallery')
@Controller('gallery')
export class GalleryController {
  constructor(private readonly galleryService: GalleryService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener la galeria publica publicada' })
  @ApiOkResponse({ description: 'Las 13 posiciones publicas de la galeria' })
  getPublicGallery() {
    return this.galleryService.getPublicGallery();
  }
}
