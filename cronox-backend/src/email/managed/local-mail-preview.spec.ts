import { ManagedMailService } from './managed-mail.service';
import { EmailSenderKey } from '../email.types';
describe('local mail preview never sends',()=>{
 it('renders sample content without consulting SMTP, recipients or delivery queues',async()=>{
  const before=process.env.CRONOX_LOCAL_DEV;process.env.CRONOX_LOCAL_DEV='true';
  try{
   const transport={sendMail:jest.fn()};const service=new ManagedMailService({} as any,transport as any);
   jest.spyOn(service,'template').mockResolvedValue({id:'example'} as any);
   jest.spyOn(service as any,'render').mockResolvedValue({html:'<p>Ejemplo</p>',text:'Ejemplo',subject:'Prueba'});
   expect(await service.test(EmailSenderKey.INFO,'example','external@example.test',true)).toMatchObject({localOnly:true,html:'<p>Ejemplo</p>'});
   expect(transport.sendMail).not.toHaveBeenCalled();
  }finally{if(before===undefined)delete process.env.CRONOX_LOCAL_DEV;else process.env.CRONOX_LOCAL_DEV=before;}
 });
});
