import { MAIL_PURPOSES } from './mail-catalog';
import { MAIL_PURPOSE_HELP } from './mail-purpose-help';
import { ManagedMailService } from './managed-mail.service';
import { renderMail } from './mail-renderer';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { mailPreviewData } from './welcome-design';

describe('administrator-only purpose explanations', () => {
  it('covers every catalogue purpose with specific descriptions and exposes them through the common catalogue', () => {
    expect(Object.keys(MAIL_PURPOSE_HELP).sort()).toEqual(MAIL_PURPOSES.map(p=>p.key).sort());
    const catalogue=new ManagedMailService({} as any,{} as any).catalog();
    expect(new Set(catalogue.map(p=>p.usage.description)).size).toBe(catalogue.length);
    for(const purpose of catalogue){expect(purpose.usage).toEqual(MAIL_PURPOSE_HELP[purpose.key]);for(const value of Object.values(purpose.usage))expect(value.length).toBeGreaterThan(25)}
  });
  it('keeps the explanations outside generated customer HTML and text', () => {
    for(const key of ['ORDER_CONFIRMATION','NEWSLETTER_ACCESS','PASSWORD_SETUP_EXISTING_ACCOUNT','ORDER_INCIDENT']){
      const mail=renderMail(structuredDocumentForPurpose(key)!, 'Asunto', '', key,mailPreviewData(key));
      expect(mail.html+mail.text).not.toContain(MAIL_PURPOSE_HELP[key].trigger);
      expect(mail.html).not.toContain('mail-purpose-info');expect(mail.html).not.toContain('Para qué sirve');
    }
  });
});
