import { Controller, Get } from '@nestjs/common';
import { FooterSettingsService } from './footer-settings.service';

@Controller('footer')
export class FooterController {
  constructor(private readonly settings: FooterSettingsService) {}

  @Get()
  getSettings() {
    return this.settings.getPublicSettings();
  }
}
