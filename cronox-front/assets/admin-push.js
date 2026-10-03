/* One server-backed preference screen for existing and newly registered devices. */
(() => {
  'use strict';
  const root=document.getElementById('pushWorkspace'); if(!root)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected='',devices=[],overview,config,loading=0;
  async function api(path,method='GET',data) {
    const headers=method==='GET'?{}:await window.CRONOX_API.getCsrfHeaders();
    if(data!==undefined)headers['Content-Type']='application/json';
    const r=await fetch((window.CRONOX_API?.API_BASE||'')+'/api/admin/mailbox'+path,{method,headers,credentials:'include',cache:'no-store',body:data===undefined?undefined:JSON.stringify(data)});
    const result=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(result.message==='PUSH_PREFERENCES_CHANGED_RELOAD'?'La configuración cambió en otra sesión. Recarga antes de guardar.':`No se pudo guardar o cargar (${r.status}): ${result.message||'reintenta'}`);
    return result;
  }
  function message(text,error=false){const el=root.querySelector('[data-push-result]');if(el){el.textContent=text;el.className=error?'mail-error':'mail-muted';}}
  const guard=fn=>async e=>{try{await fn(e);}catch(err){message(err.message,true);}};
  function render() {
    const d=devices.find(d=>d.id===selected);
    root.innerHTML=`<p>Configura cada dispositivo de tu cuenta. Puedes cambiar las opciones de tu iPhone desde este ordenador. Una casilla marcada permite ese aviso; el dispositivo también debe estar activo y tener permiso del sistema.</p>
      <label>Dispositivo que estás configurando<select data-push-device><option value="">Selecciona un dispositivo</option>${devices.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)} · ${x.active?'Activo':'Desactivado'} · ${esc(new Date(x.createdAt).toLocaleDateString('es-ES'))}</option>`).join('')}</select></label>
      <div data-preferences></div><p data-push-result role="status" aria-live="polite"></p>
      <details class="mail-advanced"><summary>Configuración avanzada y permisos de este navegador</summary>
      <p>iPhone: abre CRONOX desde su icono de la pantalla de inicio (iOS 16.4 o posterior), inicia sesión y pulsa Registrar este dispositivo. Android: utiliza un navegador compatible. Permite avisos del sistema; se necesita HTTPS. El registro no prueba la recepción real.</p>
      ${!config.configured?'<p class="mail-notice">Web Push pendiente de configuración en el servidor.</p>':''}
      <label>Nombre para registrar este navegador<input data-new-device-name value="Este dispositivo" maxlength="80"></label>
      <button class="btn" data-register ${!config.configured?'disabled':''}>Registrar este dispositivo</button>
      <button class="btn" data-disable-local>Desactivar en este navegador</button></details>`;
    root.querySelector('[data-push-device]').onchange=e=>{selected=e.target.value;render();};
    const host=root.querySelector('[data-preferences]');
    if(d) {
      host.innerHTML=`<form data-preference-form><h3>${esc(d.name)}</h3><p>${d.active?'Activo':'Desactivado: vuelve a registrarlo desde ese dispositivo para reactivarlo.'}</p>
      <label>Nombre del dispositivo<input name="name" maxlength="80" value="${esc(d.name)}" required></label>
      <fieldset><legend>Tipos de aviso para este dispositivo</legend>
      <label><span><input type="checkbox" name="mailEnabled" ${d.mailEnabled?'checked':''}> Correos nuevos</span></label>
      <div data-device-boxes>${overview.boxes.map(b=>`<label><span><input type="checkbox" data-push-box value="${esc(b.id)}" ${d.mailboxIds.includes(b.id)?'checked':''}> ${esc(b.name)} · ${esc(b.address)}</span></label>`).join('')}</div>
      <label><span><input type="checkbox" name="paidOrders" ${d.paidOrdersSince?'checked':''} ${!overview.superadmin?'disabled':''}> Pedidos pagados${!overview.superadmin?' · Requiere SUPERADMIN':''}</span></label>
      <label><span><input type="checkbox" name="visits" ${d.visitsSince?'checked':''}> Nuevas visitas a la web</span></label>
      <label><span><input type="checkbox" name="waitlist" ${d.waitlistSince?'checked':''}> Nuevas solicitudes en la waitlist</span></label></fieldset>
      <label><span><input type="checkbox" name="details" ${d.details?'checked':''}> Mostrar remitente y asunto del correo en la pantalla bloqueada, si tengo permiso</span></label>
      <p>Las opciones nuevas avisan de eventos posteriores a su activación. Las visitas generan un aviso por cada visita válida, sin resumen. Desmarcar una opción cancela sus avisos pendientes.</p>
      <button class="btn" type="submit">Guardar preferencias de ${esc(d.name)}</button>${d.active?'<button class="btn" type="button" data-disable-device>Desactivar este dispositivo</button>':''}</form>`;
      const form=host.querySelector('form');
      form.onsubmit=guard(async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;message('Guardando…');try{
        const data={revision:d.preferenceRevision,name:form.elements.name.value,mailboxIds:[...form.querySelectorAll('[data-push-box]:checked')].map(i=>i.value)};
        ['mailEnabled','paidOrders','visits','waitlist','details'].forEach(k=>data[k]=form.elements[k].checked);
        if(!overview.superadmin)data.paidOrders=false;
        await api('/push/devices/'+d.id,'PATCH',data);await load();message('Preferencias guardadas para '+d.name+'.');
      } finally{if(button.isConnected)button.disabled=false;}});
      form.querySelector('[data-disable-device]')?.addEventListener('click',guard(async()=>{await api('/push/devices/'+d.id,'DELETE');await load();message('Dispositivo desactivado.');}));
    } else host.innerHTML='<p>No hay un dispositivo seleccionado. Si aún no está registrado, abre Configuración avanzada desde ese móvil.</p>';
    root.querySelector('[data-register]').onclick=guard(async()=>{
      if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('Abre CRONOX desde el icono de la pantalla de inicio en el iPhone.');
      if(await Notification.requestPermission()!=='granted')throw Error('No se ha concedido permiso. Revisa los ajustes del sistema.');
      const r=await navigator.serviceWorker.register('/mailbox-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
      let sub=await r.pushManager.getSubscription();
      if(!sub){const k=config.publicKey,bytes=Uint8Array.from(atob((k+'='.repeat((4-k.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});}
      const result=await api('/push/devices','POST',{subscription:sub.toJSON(),name:root.querySelector('[data-new-device-name]').value,mailboxIds:overview.boxes.map(b=>b.id),details:false});
      selected=result.id;sessionStorage.setItem('cronox-mail-device',selected);await load();message('Dispositivo registrado. Revisa sus opciones; la recepción real aún debe comprobarse.');
    });
    root.querySelector('[data-disable-local]').onclick=guard(async()=>{
      const id=sessionStorage.getItem('cronox-mail-device');if(id)await api('/push/devices/'+id,'DELETE');
      const r=await navigator.serviceWorker.getRegistration('/');await(await r?.pushManager.getSubscription())?.unsubscribe();sessionStorage.removeItem('cronox-mail-device');await load();message('Avisos desactivados en este navegador.');
    });
  }
  async function load(){const seq=++loading;try{const values=await Promise.all([api('/overview'),api('/push/config'),api('/push/devices')]);if(seq!==loading)return;[overview,config,devices]=values;if(!devices.some(d=>d.id===selected))selected=devices.find(d=>d.id===sessionStorage.getItem('cronox-mail-device'))?.id||devices[0]?.id||'';render();}catch(e){root.innerHTML='<p data-push-result role="alert"></p>';message(e.message,true);}}
  window.CRONOX_PUSH={load};
})();
