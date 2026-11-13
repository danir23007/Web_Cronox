import Handlebars from 'handlebars';
import { parseDocument } from 'htmlparser2';
import { logisticsMail } from '../../shipping-tracking/logistics-mail';

// Copy from the transactional data producers. Only these fields are fixed for
// a purpose; customer/event content in other purposes stays a real variable.
export const PASSWORD_SETUP_COPY = {
  PASSWORD_SETUP_NEW_ACCOUNT: {
    title: 'Tu cuenta está lista: configura tu contraseña',
    message: 'Hemos creado una cuenta asociada al email utilizado en tu compra para que puedas consultar tus pedidos. Configura una contraseña para acceder.',
    actionLabel: 'Configurar contraseña',
  },
  PASSWORD_SETUP_EXISTING_ACCOUNT: {
    title: 'Configura tu contraseña y consulta tu pedido',
    message: 'Tu pedido está asociado a tu cuenta CRONOX. Puedes configurar una contraseña para acceder y consultar tu pedido.',
    actionLabel: 'Configurar contraseña',
  },
};
export const NEWSLETTER_ACCESS_COPY = {
  title: 'Tu acceso a CRONOX', actionLabel: 'Entrar en CRONOX',
  eligible: 'Solicitaste un enlace de acceso. Pulsa el botón para entrar; caduca en 20 minutos y solo funciona una vez. Si no lo solicitaste, ignora este correo.',
  registration: 'Para acceder a CRONOX, continúa con el registro o inicia sesión con tu contraseña. Esta solicitud no ha creado ninguna cuenta.',
};
export function editorCopy(purpose?: string | null): Record<string, string> {
  if (purpose && purpose in PASSWORD_SETUP_COPY) return PASSWORD_SETUP_COPY[purpose as keyof typeof PASSWORD_SETUP_COPY];
  const milestone = Object.values(logisticsMail).find(value => value.type === purpose);
  if (milestone) return { title: milestone.label, message: milestone.message };
  switch (purpose) {
    case 'PASSWORD_RESET': return { title: 'Restablecimiento de contraseña', message: 'Use the secure link below to reset your password. It expires in one hour.', actionLabel: 'Reset password' };
    case 'NEWSLETTER_WELCOME': return { title: 'Bienvenido a CRONOX', message: 'Aquí empieza tu recorrido dentro de los círculos de CRONOX.' };
    case 'ORDER_CONFIRMATION': return { message: 'Tu pedido se ha confirmado correctamente. Te avisaremos cuando esté en camino.' };
    case 'NEWSLETTER_ACCESS': return { title: NEWSLETTER_ACCESS_COPY.title, actionLabel: NEWSLETTER_ACCESS_COPY.actionLabel,
      message: `{{#if accountEligible}}${NEWSLETTER_ACCESS_COPY.eligible}{{else}}${NEWSLETTER_ACCESS_COPY.registration}{{/if}}`,
      passwordMessage: '{{#if initialPassword}}Tu contraseña es: "{{initialPassword}}". Introdúcela sin las comillas.{{/if}}' };
    default: return {};
  }
}

// A read-time projection. Never updates drafts or published snapshots. Replace
// exact variables only, without touching literal custom copy or design fields.
export function editableDraft<T extends { purpose?: string | null; document: unknown; subject?: string; preheader?: string; textOverride?: string | null }>(draft: T): T {
  const copy = JSON.parse(JSON.stringify(draft)) as T;
  const vocabulary = editorCopy(copy.purpose);
  const expand = (value: string, html = false) => value.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key) =>
    vocabulary[key] === undefined ? token : html ? Handlebars.escapeExpression(vocabulary[key]) : vocabulary[key]);
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    for (const key of ['text', 'html', 'alt']) if (typeof value[key] === 'string') value[key] = expand(value[key], key === 'html');
    if (Array.isArray(value.blocks)) value.blocks.forEach(walk);
    if (Array.isArray(value.columns)) value.columns.forEach((column: any[]) => column.forEach(walk));
  };
  walk(copy.document);
  if (copy.subject) copy.subject = expand(copy.subject);
  if (copy.preheader) copy.preheader = expand(copy.preheader);
  if (copy.textOverride) copy.textOverride = expand(copy.textOverride);
  return copy;
}

export type EditBinding = { id: number; path: number[]; field: 'text' | 'html'; start?: number; end?: number; value: string };
// Mark a disposable copy before the normal renderer. Markers survive sanitizing
// as text; the parent turns them into editable spans inside a script-free iframe.
// HTML edits target source offsets, preserving surrounding markup/conditionals.
export function markEditableDocument(document: any) {
  const result = JSON.parse(JSON.stringify(document));
  const bindings: EditBinding[] = [];
  const wrap = (binding: Omit<EditBinding, 'id'>) => {
    const id = bindings.length; bindings.push({ ...binding, id });
    return `CRONOXEDITSTART${id}X${binding.value}CRONOXEDITEND${id}X`;
  };
  const walk = (blocks: any[], prefix: number[] = []) => blocks.forEach((block, index) => {
    const path = [...prefix, index];
    if (typeof block.text === 'string') {
      let start = 0;
      block.text = block.text.split(/(\n|\{\{\s*(?:#(?:if|each)\s+[\w.]+|\/(?:if|each)|else)\s*\}\})/g).map((part: string) => {
        const offset = start; start += part.length;
        return part && part !== '\n' && !/^\{\{\s*(?:#|\/|else)/.test(part)
          ? wrap({ path, field: 'text', start: offset, end: offset + part.length, value: part }) : part;
      }).join('');
    }
    if (typeof block.html === 'string') {
      const source = block.html;
      const nodes: any[] = [];
      const visit = (node: any) => {
        if (node.type === 'text' && node.data.trim()) nodes.push(node);
        if (node.children && !['script', 'style', 'head'].includes(node.name)) node.children.forEach(visit);
      };
      visit(parseDocument(source, { withStartIndices: true, withEndIndices: true }));
      let marked = source;
      for (const node of nodes.reverse()) {
        const start = node.startIndex, end = node.endIndex + 1;
        let offset = start;
        const segments = source.slice(start, end).split(/(\{\{\s*(?:#(?:if|each)\s+[\w.]+|\/(?:if|each)|else)\s*\}\})/g).map((part: string) => {
          const at = offset; offset += part.length;
          return part.trim() && !/^\{\{\s*(?:#|\/|else)/.test(part)
            ? wrap({ path, field: 'html', start: at, end: offset, value: part }) : part;
        }).join('');
        marked = marked.slice(0, start) + segments + marked.slice(end);
      }
      block.html = marked;
    }
    block.columns?.forEach((column: any[], columnIndex: number) => walk(column, [...path, columnIndex]));
  });
  walk(result.blocks);
  return { document: result, bindings };
}
