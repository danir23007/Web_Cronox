import type { NextFunction, Request, Response } from 'express';

type MutableRequest = Request & {
  cookies?: Record<string, string>;
  signedCookies?: Record<string, string>;
};

type CookieParserMiddleware = (req: Request, res: Response, next: NextFunction) => void;

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [rawName, ...rest] = part.split('=');
    const name = rawName?.trim();

    if (!name) {
      return acc;
    }

    const rawValue = rest.join('=').trim();
    acc[name] = decodeCookieValue(rawValue);
    return acc;
  }, {});
}

function cookieParser(): CookieParserMiddleware {
  return (req: MutableRequest, _res: Response, next: NextFunction) => {
    if (!req.cookies) {
      req.cookies = parseCookieHeader(req.headers?.cookie);
    }

    if (!req.signedCookies) {
      req.signedCookies = {};
    }

    next();
  };
}

export = cookieParser;
