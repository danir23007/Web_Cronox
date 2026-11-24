/** Render the actual shared component at first paint; do not duplicate its
 * fields, validation attributes, password controls or account-access flow. */
export function renderEventRegistration(page: string, sharedAuth: string) {
  const auth = sharedAuth
    .replace('role="dialog" aria-modal="true"', 'role="region"')
    .replace('class="cronox-auth auth-hidden" aria-hidden="true"', 'class="cronox-auth is-open" aria-hidden="false"')
    .replace('id="authTitle">Iniciar sesión', 'id="authTitle">Crear cuenta')
    .replace('id="authLoginForm" class="cronox-auth__view is-active"', 'id="authLoginForm" class="cronox-auth__view"')
    .replace('id="authRegisterForm" class="cronox-auth__view"', 'id="authRegisterForm" class="cronox-auth__view is-active"');
  if (!auth.includes('id="authRegisterForm"') || !page.includes('<!--CRONOX_EVENT_AUTH-->')) throw Error('EVENT_REGISTRATION_COMPONENT_UNAVAILABLE');
  return page.replace('<!--CRONOX_EVENT_AUTH-->', auth);
}
