import { Controller, Get, Param } from '@nestjs/common';
import { FooterSettingsService } from './footer-settings.service';

@Controller('footer')
export class FooterController {
  constructor(private readonly settings: FooterSettingsService) {}

  @Get()
  getSettings() {
    return this.settings.getPublicSettings();
  }

  @Get('pages/:slug')
  getPage(@Param('slug') slug: string) {
    return this.settings.getPageContent(slug);
  }
}
