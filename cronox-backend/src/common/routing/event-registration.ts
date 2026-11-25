import { parseDocument } from 'htmlparser2';
/** Compose the live homepage and shared authentication component, never a copy. */
export function renderEventRegistration(page: string, sharedAuth: string, homepage = page) {
  let original: any;
  const visit = (node: any) => { if (node.attribs?.id === 'authOverlay') original = node; else node.children?.forEach(visit); };
  visit(parseDocument(homepage, { withStartIndices: true, withEndIndices: true }));
  if (original) homepage = homepage.slice(0, original.startIndex) + homepage.slice(original.endIndex + 1);
  const auth = sharedAuth
    .replace('class="cronox-auth auth-hidden" aria-hidden="true"', 'class="cronox-auth is-open" aria-hidden="false"')
    .replace('id="authTitle">Iniciar sesi\u00f3n', 'id="authTitle">Crear cuenta')
    .replace('id="authLoginForm" class="cronox-auth__view is-active"', 'id="authLoginForm" class="cronox-auth__view"')
    .replace('id="authRegisterForm" class="cronox-auth__view"', 'id="authRegisterForm" class="cronox-auth__view is-active"');
  if (!auth.includes('id="authRegisterForm"')) throw Error('EVENT_REGISTRATION_COMPONENT_UNAVAILABLE');
  const head = '<meta name="cronox-event-registration" content="v1"><link rel="stylesheet" href="/assets/event-registration.css?v=2">';
  return homepage.replace('</head>', head + '</head>')
    .replace(/<body([^>]*)>/, '<body$1 data-registration-source="event" data-event-auth="pending"><div id="eventRegistrationBackground" inert aria-hidden="true">')
    .replace(/<div class="newsletter-modal-overlay"[\s\S]*?<\/div>\s*<\/div>/, '')
    .replace(/<script src="assets\/app(?:\.min)?\.js[^" ]*" defer><\/script>/, '<script src="/assets/event-registration.js?v=2" defer></script><script src="/assets/app.js?v=event-register-2" defer></script>')
    .replace('</body>', '</div>' + auth + '</body>');
}
