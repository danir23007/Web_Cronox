import { readFileSync } from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('admin UI improvement contracts', () => {
  it('uses a white, contained product-editor thumbnail with missing and failed-image fallbacks', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).toContain(
      '.product-editor-thumbnail { width: 44px; height: 44px;',
    );
    expect(html).toContain('border-radius: 8px; background: #ffffff;');
    expect(html).toContain('.product-editor-thumbnail__image {');
    expect(html).toContain('object-fit: contain; object-position: center;');
    expect(admin).toContain(
      '\'<span class="product-editor-thumbnail__fallback">Sin imagen</span>\'',
    );
    expect(admin).toContain(
      "productsBody.addEventListener('error', onProductThumbnailError, true)",
    );
  });

  it('opens the Activity filters natively on every fresh page load', () => {
    const html = readFrontend('admin.html');
    const activitySection = html.slice(
      html.indexOf('<section id="section-activity"'),
      html.indexOf('<section id="section-users"'),
    );

    expect(activitySection).toContain(
      '<details class="filters-panel" style="margin-top:10px;" open>',
    );
  });

  it('toggles promo codes in both directions with immediate state and failure rollback', () => {
    const admin = readFrontend('assets/admin.js');
    const renderCodes = admin.slice(
      admin.indexOf('const renderCodes ='),
      admin.indexOf('const openCodeModal ='),
    );
    const toggleCodeStatus = admin.slice(
      admin.indexOf('const toggleCodeStatus ='),
      admin.indexOf('const onCodesTableClick ='),
    );

    expect(renderCodes).toContain("code.isActive ? 'Desactivar' : 'Activar'");
    expect(renderCodes).not.toContain('Inactivar');
    expect(renderCodes).toContain('data-code-status=');
    expect(renderCodes).toContain('data-toggle-code=');
    expect(admin).toContain("buildChip(isActive ? 'ACTIVO' : 'INACTIVO'");
    expect(toggleCodeStatus).toContain('if (button) button.disabled = true');
    expect(
      toggleCodeStatus.indexOf('applyVisualState(nextIsActive)'),
    ).toBeLessThan(
      toggleCodeStatus.indexOf(
        'await window.CRONOX_API?.admin?.updatePromoCode',
      ),
    );
    expect(toggleCodeStatus).toContain(
      'updatePromoCode(id, { isActive: nextIsActive })',
    );
    expect(toggleCodeStatus).toContain('applyVisualState(previousIsActive)');
    expect(toggleCodeStatus).toContain(
      "setScopedMessage(codesMessage, errorMessage, 'error')",
    );
  });

  it('keeps an empty promo-code message hidden without suppressing real errors', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');
    const toggleCodeStatus = admin.slice(
      admin.indexOf('const toggleCodeStatus ='),
      admin.indexOf('const onCodesTableClick ='),
    );

    expect(html).toContain(
      '#codesMessage:empty { display: none !important; height: 0; margin: 0; padding: 0; border: 0; }',
    );
    expect(toggleCodeStatus).not.toContain("'Código desactivado.', 'success'");
    expect(toggleCodeStatus).toContain(
      "showToast(`Código ${nextIsActive ? 'activado' : 'desactivado'}.`",
    );
    expect(toggleCodeStatus).toContain(
      "setScopedMessage(codesMessage, errorMessage, 'error')",
    );
  });
});
