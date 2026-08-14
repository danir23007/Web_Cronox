import { BadRequestException } from '@nestjs/common';
import { normalizeInstagramPostUrl } from './gallery-url';

describe('normalizeInstagramPostUrl', () => {
  it.each([
    'https://instagram.com/p/CRONOX_01/',
    'https://www.instagram.com/reel/abc-123/',
    'https://m.instagram.com/tv/a_B-c/',
  ])('accepts a safe Instagram publication URL: %s', (url) => {
    expect(normalizeInstagramPostUrl(url)).toBe(url);
  });

  it.each([
    'http://www.instagram.com/p/abc/',
    'https://instagram.evil.test/p/abc/',
    'https://user:secret@instagram.com/p/abc/',
    'https://instagram.com:444/p/abc/',
    'https://instagram.com/explore/abc/',
    'javascript:alert(1)',
  ])('rejects an unsafe or non-post URL: %s', (url) => {
    expect(() => normalizeInstagramPostUrl(url)).toThrow(BadRequestException);
  });

  it('normalizes empty optional values to null', () => {
    expect(normalizeInstagramPostUrl('  ')).toBeNull();
    expect(normalizeInstagramPostUrl(null)).toBeNull();
  });
});
