import 'dotenv/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderKey } from '../email.types';
import { MailTransportFactory } from '../mail-transport.factory';
import { ManagedMailService } from './managed-mail.service';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--approved-welcome-draft') || args.length > 1)
    throw new Error('Unsupported mail import option');
  const db = new PrismaService();
  try {
    await db.$connect();
    const service = new ManagedMailService(db, new MailTransportFactory());
    if (args.includes('--approved-welcome-draft')) {
      // No Nest application or worker lifecycle is started. No publish/send.
      const result = await service.importApprovedWelcomeDraft();
      console.log(JSON.stringify({ created: result.created, id: result.template.id,
        name: result.template.name, revision: result.template.revision,
        archived: Boolean(result.template.archivedAt), publishedByImport: false }));
      return;
    }
    for (const key of Object.values(EmailSenderKey)) {
      await service.initialize(key);
      console.log(`Biblioteca inicializada: ${key}`);
    }
    console.log('No se han publicado plantillas ni enviado correos.');
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    'No se pudo inicializar la biblioteca de correo. Comprueba la migración y la conexión.',
  );
  process.exitCode = 1;
});
