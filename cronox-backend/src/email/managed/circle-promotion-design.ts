import type { MailBlock } from './mail-renderer';
import { noreplyLogoBlock } from './mail-logo-header';
import { parseDocument } from 'htmlparser2';

export const CIRCLE_PROMOTION_SUBJECT = 'CRONOX · Ya formas parte del Círculo {{circleRoman}}';
export const CIRCLE_PROMOTION_PREHEADER = 'Tu nueva acreditación y tus ventajas ya están disponibles.';
export const CIRCLE_PROMOTION_INTRO = 'Enhorabuena por subir al Círculo {{circleRoman}}. Has dado un paso más dentro de CRONOX.';
export const CIRCLE_PROMOTION_ACCREDITATION = 'Pásate por tu cuenta y echa un vistazo a tu nueva acreditación {{accreditationColor}}. Ya está disponible.';

const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
const accreditation = ['', 'negra', 'negra', 'gris', 'blanca', 'roja'];
const earlyAccess = 'Acceso anticipado a los drops.';
const exclusive = 'Acceso a piezas especiales y exclusivas.';
const gallery = 'Posibilidad de aparecer en la galería de CRONOX.';
const benefits: Record<number, string[]> = {
  1: [],
  2: ['Participación en el sorteo mensual de dos códigos de descuento acumulables.'],
  3: [earlyAccess, exclusive],
  4: [earlyAccess, exclusive, '10 % de descuento permanente.', 'Acceso a entradas para eventos privados.', gallery],
  5: [earlyAccess, exclusive, '25 % de descuento permanente.', 'Entradas gratis a eventos privados.',
    'Posibilidad de recibir piezas especiales o regalos.', gallery],
};
export const circleBenefitFields = ['circleBenefit1', 'circleBenefit2', 'circleBenefit3', 'circleBenefit4', 'circleBenefit5', 'circleBenefit6'];

export function normalizeCirclePromotionData(data: Record<string, unknown>) {
  return { ...data, ...Object.fromEntries(circleBenefitFields.map(field => [field,
    typeof data[field] === 'string' ? data[field].trim() : '',
  ])) };
}

/** Imported designs retain their logo, links and typography. Only the canvas,
 * approved copy and whole benefit-row visibility change. */
export function prepareCirclePromotionHtml(source: string) {
  const tree=parseDocument(source,{withStartIndices:true,withEndIndices:true});
  const edits:{start:number;end:number;text:string}[]=[];
  const plain=(n:any):string=>n.type==='text'?n.data:(n.children||[]).map(plain).join('');
  let accreditationFound=source.includes(CIRCLE_PROMOTION_ACCREDITATION);
  const visit=(node:any)=>{
    if(node.type==='tag'){
      const text=plain(node).trim();
      const field=circleBenefitFields.find(field=>text.replace(/\{\{\s*(?:#if\s+\w+|\/if)\s*\}\}/g,'').trim().match(new RegExp('^[•·]\\s*\\{\\{\\s*'+field+'\\s*\\}\\}$')));
      if(field&&['tr','p','li','div'].includes(node.name)&&!new RegExp('\\{\\{\\s*#if\\s+'+field+'\\s*\\}\\}\\s*$').test(source.slice(0,node.startIndex))){
        edits.push({start:node.startIndex,end:node.endIndex+1,text:`{{#if ${field}}}${source.slice(node.startIndex,node.endIndex+1)}{{/if}}`});return;
      }
      if(['p','td','div'].includes(node.name)&&/^Tu membresía CRONOX ya está actualizada\./.test(text)&&node.children?.every((n:any)=>n.type==='text'||['span','strong'].includes(n.name))){
        const end=source.indexOf('>',node.startIndex)+1;
        edits.push({start:end,end:source.lastIndexOf('</',node.endIndex),text:CIRCLE_PROMOTION_INTRO});return;
      }
      if(node.name==='a'&&node.attribs?.href==='{{actionUrl}}'&&!accreditationFound){
        let before=node;while(before.parent&&['p','td','div'].includes(before.parent.name)&&plain(before.parent).trim()===text)before=before.parent;
        const tableRow=before.name==='td'&&before.parent?.name==='tr';
        if(tableRow)before=before.parent;
        const introduction=tableRow?`<tr><td style="padding:20px 8px 16px;background:#000000;">${CIRCLE_PROMOTION_ACCREDITATION}</td></tr>`:`<p style="margin:0;padding:20px 0 16px;">${CIRCLE_PROMOTION_ACCREDITATION}</p>`;
        edits.push({start:before.startIndex,end:before.startIndex,text:introduction});accreditationFound=true;
      }
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  // Do not paint over the white action. Other surfaces use one black canvas.
  return source.replace(/<[^!\/][^>]*>/g,tag=>{
    if(/^<a\b/i.test(tag))return tag;
    return tag.replace(/\b(background(?:-color)?\s*:)\s*(?:#[\da-f]{3,8}|rgba?\([^)]*\)|black|white)\s*;?/gi,'$1#000000;')
      .replace(/\sbackground="[^"]*"/gi,'').replace(/background-image\s*:[^;"']*;?/gi,'')
      .replace(/bgcolor="[^"]*"/gi,'bgcolor="#000000"');
  });
}

/** Used by both editor projection and sending, including published snapshots. */
export function prepareCirclePromotionDocument<T>(document:T):T {
  if(!document||typeof document!=='object')return document;
  const result=structuredClone(document) as T & {blocks?:MailBlock[];page?:{background:string}};
  if(result.page)result.page.background='#000000';
  const walk=(blocks:MailBlock[])=>{
    const title=blocks.find(b=>b.type==='heading'&&b.text?.includes('{{circleRoman}}'));
    if(title){
      const intro=blocks.slice(blocks.indexOf(title)+1).find(b=>b.type==='text'&&!circleBenefitFields.some(f=>b.text?.includes('{{'+f+'}}')));
      if(intro&&!intro.text?.includes('CRONOXEDITSTART'))intro.text=CIRCLE_PROMOTION_INTRO;
      const button=blocks.find(b=>b.type==='button'&&b.url==='{{actionUrl}}');
      if(button&&!blocks.some(b=>b.type==='text'&&b.text?.includes('Pásate por tu cuenta y echa un vistazo a tu nueva acreditación')))
        blocks.splice(blocks.indexOf(button),0,{type:'text',text:CIRCLE_PROMOTION_ACCREDITATION,padding:8,paddingTop:20,paddingBottom:16});
    }
    for(const b of blocks){
      b.background='#000000';delete b.backgroundImage;b.align='left';
      if(typeof b.html==='string')b.html=prepareCirclePromotionHtml(b.html);
      const field=circleBenefitFields.find(field=>b.text?.trim()==='• {{'+field+'}}');
      if(field)b.condition=field;
      if(b.type==='button'&&b.url==='{{actionUrl}}'){b.buttonBackground='#ffffff';b.buttonColor='#111111';if(!b.text?.includes('CRONOXEDITSTART'))b.text='Ver mi acreditación';}
      b.columns?.forEach(walk);
    }
  };
  walk(result.blocks||[]);
  return result;
}

export function circlePromotionData(previous: number, destination: number, frontendUrl: string) {
  const unlocked = benefits[destination].filter(benefit => !benefits[previous]?.includes(benefit));
  return {
    circleLevel: destination,
    circleRoman: roman[destination],
    accreditationColor: accreditation[destination],
    actionLabel: 'Ver mi acreditación',
    actionUrl: new URL('/cuenta?login=1#accreditation', frontendUrl).href,
    ...Object.fromEntries(circleBenefitFields.map((field, index) => [field, unlocked[index] || ''])),
  };
}

export function circlePromotionDocument(circle: number) {
  const accent = ({ 2: '#eeeeee', 3: '#bcbcbc', 4: '#ffffff', 5: '#ff5959' } as Record<number, string>)[circle] || '#eeeeee';
  const copy: MailBlock[] = [
    noreplyLogoBlock('#000000'),
    { type: 'heading', text: 'Ya formas parte del Círculo {{circleRoman}}', size: 30, weight: 700, color: accent, padding: 8 },
    { type: 'text', text: CIRCLE_PROMOTION_INTRO, padding: 8 },
    { type: 'heading', text: 'Tus nuevas ventajas', size: 19, weight: 700, padding: 8 },
    ...circleBenefitFields.map((field): MailBlock => ({
      type: 'text', text: '• {{' + field + '}}', condition: field, padding: 5,
    })),
    { type: 'button', text: '{{actionLabel}}', url: '{{actionUrl}}', padding: 12,
      buttonBackground: '#ffffff', buttonColor: '#111111' },
  ];
  return prepareCirclePromotionDocument({ schemaVersion: 2 as const, sourceKind: 'cronox-first-party' as const, blocks: [{ type: 'section', padding: 24, background: '#000000', columns: [copy] }] });
}
