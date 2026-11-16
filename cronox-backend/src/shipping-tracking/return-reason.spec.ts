import { readableReturnReason } from './return-reason';
import { TrackpubContract } from './trackpub.contract';

describe('reason from the triggering Correos return event only',()=>{
 it.each([undefined,null,'','  ','Devuelto al remitente','Envío devuelto al remitente en oficina','Se ha entregado el envío al remitente','8','SR123ABC','XX','Por definir','Sin especificar','Sin motivo','N/A','RETURNED','<b>Razón</b>'])('omits non-specific reason %s',value=>{
   expect(readableReturnReason(value)).toBeNull();
 });
 it.each(['Dirección incorrecta','No retirado en plazo','Rehusado','Destinatario desconocido'])('keeps the explicit reason %s',reason=>{
   const events=new TrackpubContract().parse({events:[{uniqueCode:'I020000V',eventDes:'Devuelto al remitente',razonDes:reason,razonCode:'8'}]});
   expect(events[0].returnReason).toBe(reason);expect(events[0].category).toBe('RETURNED');
 });
 it('does not borrow earlier descriptions or interpret any of the reason codes',()=>{
   const events=new TrackpubContract().parse({events:[
     {uniqueCode:'O07A010R',eventDate:'14/10/2026',eventHours:'12:00:00',razonDes:'Destinatario ausente'},
     {uniqueCode:'I020000V',eventDate:'15/10/2026',eventHours:'12:00:00',eventDes:'Devuelto al remitente',razonCode:'8',motiveCode:'XX',situationCode:'SR123ABC'},
   ]});
   expect(events[0]).not.toHaveProperty('returnReason');expect(events[1].returnReason).toBeNull();
   expect(new TrackpubContract().parse({events:[{uniqueCode:'I020000V',razonCode:'UNVERIFIED',razonDes:'UNVERIFIED'}]})[0].returnReason).toBeNull();
 });
 it('keeps event identity unchanged when a carrier corrects the reason description',()=>{
   const parse=(razonDes:string)=>new TrackpubContract().parse({events:[{uniqueCode:'I020000V',eventDate:'15/10/2026',eventHours:'12:00:00',razonCode:'8',razonDes}]})[0];
   expect(parse('Por definir').fingerprint).toBe(parse('Dirección incorrecta').fingerprint);
 });
});
