import 'dotenv/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailSenderKey } from '../email.types';
import { MailTransportFactory } from '../mail-transport.factory';
import { ManagedMailService } from './managed-mail.service';

async function main() {
  const db = new PrismaService();
  try {
    await db.$connect();
    const service = new ManagedMailService(db, new MailTransportFactory());
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
