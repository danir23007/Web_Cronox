import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const INLINE_SCRIPT_PATTERN =
  /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * CSP hashes are calculated from the script text after HTML tokenization.
 * The HTML parser normalizes CRLF/CR into LF before the text becomes a script
 * node, so normalizing here keeps hashes valid for Windows-authored pages.
 */
export const normalizeInlineScriptForCsp = (source: string): string =>
  source.replace(/\r\n?/g, '\n');

export const getInlineScriptHashes = (frontendRoot: string): string[] => {
  const sources = new Set<string>();

  for (const entry of readdirSync(frontendRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;

    const html = readFileSync(join(frontendRoot, entry.name), 'utf8');
    for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
      const inlineSource = match[1];
      if (!inlineSource.trim()) continue;

      const digest = createHash('sha256')
        .update(normalizeInlineScriptForCsp(inlineSource))
        .digest('base64');
      sources.add(`'sha256-${digest}'`);
    }
  }

  return [...sources];
};

export const createContentSecurityPolicy = (frontendRoot: string): string => {
  const inlineScriptHashes = getInlineScriptHashes(frontendRoot);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "media-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https:",
    "font-src 'self' data: https:",
    [
      "script-src 'self'",
      ...inlineScriptHashes,
      'https://js.stripe.com',
      'https://*.stripe.com',
    ].join(' '),
    "connect-src 'self' https:",
    'frame-src https://js.stripe.com https://*.stripe.com',
  ].join('; ');
};
