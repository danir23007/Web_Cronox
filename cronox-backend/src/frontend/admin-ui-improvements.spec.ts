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

  it('edits and submits the optional one-use-per-user promo setting', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).toContain('id="codeSingleUsePerUser"');
    expect(html).toContain('Un solo uso por usuario');
    expect(html).toContain(
      'Cada usuario podrá utilizar este código una sola vez.',
    );
    expect(admin).toContain(
      'singleUsePerUserInput.checked = Boolean(code.singleUsePerUser)',
    );
    expect(admin).toContain(
      "codeForm.querySelector('#codeSingleUsePerUser')?.checked ?? false",
    );
  });

  it('shows customer analytics UI only to canonical SUPERADMIN', () => {
    const adminUser = readFrontend('src/admin/admin-user.ts');

    expect(adminUser).toContain(
      "analyticsAccessAllowed = currentUser?.role === 'SUPERADMIN'",
    );
    expect(adminUser).not.toContain("currentUser?.role === 'SUPER_ADMIN'");
    expect(adminUser).toContain('analyticsTab?.remove()');
    expect(adminUser).toContain('analyticsPanel?.remove()');
    expect(adminUser).toContain(
      'if (!analyticsAccessAllowed || !userId || !analyticsOverview) return;',
    );
  });

  it('offers protected user editing only to exact Super Admin roles and refreshes persisted detail data', () => {
    const html = readFrontend('admin-user.html');
    const adminUser = readFrontend('src/admin/admin-user.ts');
    const adminList = readFrontend('assets/admin.js');
    const api = readFrontend('src/admin/api.ts');

    expect(html).toContain('id="editUser"');
    expect(html).toContain('id="userEditForm"');
    expect(html).toContain('id="editUserName"');
    expect(html).toContain('id="editUserPhone"');
    expect(html).toContain('pattern="\\+?[0-9() -]{6,32}"');
    expect(html).toContain('id="editUserRole"');
    expect(html).toContain('id="editUserStatus"');
    expect(html).toContain('id="editUserCircle"');
    expect(adminUser).toContain(
      "canEditProtectedUserFields = currentUser.role === 'SUPERADMIN'",
    );
    expect(adminUser).not.toMatch(
      /canEditProtectedUserFields = \[[^\]]*'ADMIN'/,
    );
    expect(adminUser).toContain(
      'currentUserDetail = { ...currentUserDetail, ...updated }',
    );
    expect(adminUser).toContain(
      "editUserPhone.value = String(currentUserDetail.phone || '')",
    );
    expect(adminUser).toContain('phone: editUserPhone?.value.trim() || null');
    expect(adminUser).toContain('renderSummary(currentUserDetail)');
    expect(adminUser).toContain('renderProfile(currentUserDetail)');
    expect(adminList).toContain(
      'const phone = source.phone ?? source.phoneNumber ?? source.mobile ?? source.telefono ??',
    );
    expect(adminList).toContain('<td>${phoneCell}</td>');
    expect(adminUser).toContain(
      "cancelUserEditBtn?.addEventListener('click', closeUserEdit)",
    );
    expect(adminUser).toContain("if (role === 'FRIEND') return 'Friend'");
    expect(api).toContain(
      'request(`/api/admin/users/${encodeURIComponent(id)}`',
    );
    expect(api).toContain("method: 'PATCH'");
  });

  it('exposes exactly the four canonical roles in filters and selectors', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');
    const adminUser = readFrontend('src/admin/admin-user.ts');
    const routing = readFrontend('assets/admin-auth-routing.js');
    const values = [...html.matchAll(/<option value="([A-Z_]+)"/g)]
      .map((match) => match[1])
      .filter((value) =>
        ['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN'].includes(value),
      );

    expect(new Set(values)).toEqual(
      new Set(['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN']),
    );
    expect(admin).not.toContain('SUPER_ADMIN');
    expect(adminUser).not.toContain('SUPER_ADMIN');
    expect(routing).not.toContain('SUPER_ADMIN');
  });
});
