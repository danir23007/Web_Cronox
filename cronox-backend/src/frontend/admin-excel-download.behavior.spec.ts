/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const bundle = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/assets/api.js'),
  'utf8',
);
const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type DownloadExcel = (
  module: string,
  query?: Record<string, unknown>,
) => Promise<{ blob: Blob; filename: string }>;

const setup = (fetchMock: jest.Mock) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/admin.html',
    runScripts: 'outside-only',
  });
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock });
  dom.window.eval(bundle);
  return {
    dom,
    downloadExcel: (
      dom.window as unknown as {
        CRONOX_API: { admin: { downloadExcel: DownloadExcel } };
      }
    ).CRONOX_API.admin.downloadExcel,
  };
};

describe('compiled Admin Excel download client', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  it('never exposes a raw Cannot GET response to the UI', async () => {
    const { dom, downloadExcel } = setup(
      jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: jest
          .fn()
          .mockResolvedValue('Cannot GET /api/admin/exports/users?scope=all'),
      }),
    );
    await expect(downloadExcel('users', { scope: 'all' })).rejects.toThrow(
      'No se ha podido preparar el archivo Excel. Inténtalo de nuevo.',
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Admin Excel export failed',
      expect.objectContaining({ status: 404 }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Cannot GET');
    dom.window.close();
  });

  it('rejects a successful HTML/JSON response instead of downloading it as XLSX', async () => {
    const blob = jest.fn();
    const { dom, downloadExcel } = setup(
      jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        blob,
      }),
    );
    await expect(downloadExcel('users', { scope: 'all' })).rejects.toThrow(
      'No se ha podido preparar el archivo Excel. Inténtalo de nuevo.',
    );
    expect(blob).not.toHaveBeenCalled();
    dom.window.close();
  });

  it('returns a real XLSX blob and safe server filename', async () => {
    const expectedBlob = new Blob(['xlsx']);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': EXCEL_MIME,
        'content-disposition':
          'attachment; filename="cronox_usuarios_2026-09-16_1200.xlsx"',
      }),
      blob: jest.fn().mockResolvedValue(expectedBlob),
    });
    const { dom, downloadExcel } = setup(fetchMock);
    await expect(
      downloadExcel('users', { scope: 'filtered', q: 'á é' }),
    ).resolves.toEqual({
      blob: expectedBlob,
      filename: 'cronox_usuarios_2026-09-16_1200.xlsx',
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/api/admin/exports/users?scope=filtered&q=%C3%A1+%C3%A9',
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    dom.window.close();
  });
});
