(() => {
  'use strict';
  const tabs = document.getElementById('productEditionTabs'), action = document.getElementById('productEditionAction');
  if (!tabs || !action) return;
  const form = document.getElementById('productForm'), message = document.getElementById('productEditionMessage');
  let data, selectedId, baseline, busy = false, saving = false, duplicateKey, pendingSave, loading = 0;
  const editor = () => window.CRONOX_PRODUCT_EDITOR;
  const selected = () => data?.lots.find(l => l.id === selectedId);
  const capture = () => { baseline = editor()?.fingerprint(); window.CRONOX_ADMIN_SHELL?.clear(form); };
  const needsDecision = () => !!baseline && baseline !== editor()?.fingerprint();
  const tell = text => { message.textContent = text; message.hidden = !text; };
  const request = async (suffix = '', body, key) => {
    const response = await fetch((window.CRONOX_API?.API_BASE || '') + `/api/admin/products/${data.product.id}/lots/editions${suffix}`, {
      method: body ? 'POST' : 'GET', credentials:'include', cache:'no-store',
      headers: { ...(body ? { ...(await window.CRONOX_API.getCsrfHeaders()), 'Content-Type':'application/json', 'Idempotency-Key':key || crypto.randomUUID() } : {}) },
      ...(body ? { body:JSON.stringify(body) } : {}),
    }).catch(() => { throw new Error('No se pudo confirmar el guardado. Tus datos se conservan; vuelve a intentarlo.'); });
    const result = await response.json().catch(() => { throw new Error('No se pudo confirmar la respuesta del servidor. Tus datos se conservan para reintentar.'); });
    if (!response.ok) throw new Error(response.status >= 500 ? 'El servidor no pudo confirmar el guardado. Tus datos se conservan; vuelve a intentarlo.' : Array.isArray(result.message) ? result.message.join(' · ') : result.message || 'No se pudo guardar la tirada.');
    return result;
  };
  async function decide() {
    if (!needsDecision()) return true;
    const dialog = document.createElement('dialog'); dialog.className='edition-unsaved';
    dialog.innerHTML='<h3>Cambios sin guardar</h3><p>La ficha de esta tirada tiene cambios pendientes.</p><div class="edition-decision"><button type="button" class="btn primary" data-choice="save">Guardar</button><button type="button" class="btn" data-choice="discard">Descartar</button><button type="button" class="btn" data-choice="stay">Continuar editando</button></div>';
    document.body.append(dialog); dialog.showModal();
    const choice = await new Promise(resolve => { dialog.addEventListener('cancel',e=>{e.preventDefault();resolve('stay');}); dialog.addEventListener('click',e=>{const value=e.target.closest('[data-choice]')?.dataset.choice;if(value)resolve(value);}); });
    dialog.close(); dialog.remove();
    if (choice==='stay') return false;
    if (choice==='save') { if (!form.reportValidity()) return false; return (await editor().save()) === true; }
    if (selected()) { await editor().fill(selected().profile); fillReceiptFields(); }
    capture(); return true;
  }
  async function operate(fn) {
    if (busy) return;
    busy=true; draw(); tell('');
    try { await fn(); } catch(error) { tell(error.message); }
    finally { busy=false; draw(); }
  }
  async function show(id) {
    selectedId=id;
    await editor().fill(selected().profile);
    fillReceiptFields();
    capture(); draw();
    const history = document.getElementById('editionHistory'); history.hidden=false; history.open=false;
    tell(selected().profilePending ? 'Ficha histórica pendiente de conciliar: se conserva la configuración verificable; no se han reconstruido fotos ni textos antiguos.' : '');
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = value => value == null ? 'Pendiente' : new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(value/100);
  const madridDate = value => value ? new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(value)).replace(' ', 'T') : '';
  function utcDate(value) {
    if (!value) throw new Error('Completa el inicio y fin de Oferta web (Europe/Madrid).');
    const local = Date.parse(value + 'Z');
    const candidates = [1, 2].map(offset => new Date(local - offset * 3600000)).filter(date => madridDate(date) === value);
    if (candidates.length !== 1) throw new Error('La hora indicada no existe o se repite por el cambio de hora en Europe/Madrid. Elige otra hora inequívoca.');
    return candidates[0].toISOString();
  }
  function offerFields() {
    const lot = selected(), block = document.getElementById('editionWebOffer');
    block.hidden = !lot;
    if (!lot) return;
    form.elements.webOfferEnabled.checked = lot.webOfferPriceCents != null && !lot.webOfferDisabledAt;
    form.elements.webOfferPrice.value = lot.webOfferPriceCents == null ? '' : (lot.webOfferPriceCents / 100).toFixed(2);
    form.elements.webOfferPrevious.value = lot.webOfferPreviousCents == null ? '' : (lot.webOfferPreviousCents / 100).toFixed(2);
    form.elements.webOfferStart.value = madridDate(lot.webOfferStartsAt);
    form.elements.webOfferEnd.value = madridDate(lot.webOfferEndsAt);
    form.elements.webOfferConfirmed.checked = !!lot.webOfferConfirmedAt;
    document.getElementById('webOfferDisable').disabled = !lot.webOfferPriceCents || !!lot.webOfferDisabledAt;
    const names = { SCHEDULED:'Programada', ACTIVE:'Activa', ENDED:'Finalizada', DISABLED:'Desactivada' };
    document.getElementById('webOfferStatus').textContent = (lot.webOfferPriceCents == null ? 'Sin oferta configurada' : names[lot.webOfferStatus]) + (lot.id !== data.product.activeLotId ? ' · Tirada inactiva, no se publica en la tienda.' : '');
    const variants = (lot.profile.variants || []).filter(v => v.isActive !== false);
    const distinct = new Set(variants.map(v => v.price ?? lot.profile.price));
    document.getElementById('webOfferSizes').textContent = distinct.size > 1 ? 'Revisa los precios por talla. No se puede publicar una referencia común: ' + variants.map(v => v.size + ' ' + amount(v.price ?? lot.profile.price)).join(' · ') : '';
  }
  document.getElementById('webOfferDisable').addEventListener('click', () => {
    form.elements.webOfferEnabled.checked = false;
    void editor().save();
  });
  for (const name of ['webOfferPrevious', 'webOfferStart']) form.elements[name].addEventListener('input', () => { form.elements.webOfferConfirmed.checked = false; });
  function fillReceiptFields() {
    const lot=selected(); if(!lot)return;
    offerFields();
    form.elements.editionReceivedAt.value=lot.receivedAt?.slice(0,10) || '';
    for(const name of ['editionReceiptDate','editionOther']) if(form.elements[name])form.elements[name].value='';
    const host=document.getElementById('editionReceiptsContent');if(!host)return;
    const receipts=(lot.history || []).flatMap(entry=>{
      const after=entry.after || {};
      const receipt=after.receipt || (after.received?.length ? {...after,lines:after.received,receivedAt:null} : after.lines?.length ? after : null);
      return receipt ? [{...receipt,recordedAt:entry.createdAt}] : [];
    });
    host.innerHTML=receipts.length ? `<div class="edition-receipts-scroll"><table><thead><tr><th>Fecha de entrada</th><th>Unidades y coste/u</th><th>Transporte histórico</th><th>Otros gastos</th><th>Registrado</th></tr></thead><tbody>${receipts.map(receipt=>`<tr><td>${esc(receipt.receivedAt?.slice(0,10) || 'Pendiente de conciliar')}</td><td>${receipt.lines.map(line=>`${esc(lot.profile.variants.find(v=>v.id===line.variantId)?.size || 'Variante #'+line.variantId)}: ${esc(line.quantity)} × ${amount(line.productionCents)}`).join('<br>')}${receipt.unitCostIncludesFreight?'<br><small>El coste/u ya incluye aprovisionamiento.</small>':''}</td><td>${amount(receipt.freightTotalCents)}</td><td>${amount(receipt.otherTotalCents)}</td><td>${esc(receipt.recordedAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p>No hay recepciones documentadas. Un saldo inicial no acredita una fecha ni gastos.</p>';
    const dates=(lot.history || []).filter(entry=>entry.before && entry.after && Object.hasOwn(entry.before,'receivedAt') && Object.hasOwn(entry.after,'receivedAt') && entry.before.receivedAt?.slice(0,10)!==entry.after.receivedAt?.slice(0,10));
    if(dates.length)host.insertAdjacentHTML('beforeend',`<p>Cambios de fecha de la tirada:</p><ul>${dates.map(entry=>`<li>${esc(entry.before.receivedAt || 'Pendiente')} → ${esc(entry.after.receivedAt || 'Pendiente')} · ${esc(entry.createdAt)}</li>`).join('')}</ul>`);
  }
  function draw() {
    tabs.replaceChildren(); action.replaceChildren();
    for (const lot of data?.lots ?? [{id:null,number:1}]) {
      const button=document.createElement('button'); button.type='button'; button.className='btn edition-tab'; button.setAttribute('role','tab');
      button.textContent=String(lot.number);button.setAttribute('aria-selected',String(lot.id===selectedId));button.disabled=busy || saving;
      button.onclick=()=>operate(async()=>{if(lot.id!==selectedId && await decide()) await show(lot.id);}); tabs.append(button);
    }
    const plus=document.createElement('button');plus.type='button';plus.className='btn';plus.textContent='+';plus.setAttribute('aria-label','Crear tirada desde la seleccionada');plus.disabled=busy || saving || !data;plus.title=data?'Duplicar configuración sin existencias':'Guarda primero el producto';
    plus.onclick=()=>operate(async()=>{if(!await decide())return; duplicateKey ||= crypto.randomUUID();const result=await request('/'+selectedId+'/duplicate',{revision:selected().revision},duplicateKey);duplicateKey=null;data=result;await show(result.id);});tabs.append(plus);
    if (!data || data.product.activeLotId===selectedId) {const label=document.createElement('span');label.className='edition-active';label.textContent='Lote activado';action.append(label);}
    else {const button=document.createElement('button');button.type='button';button.className='btn primary';button.textContent='Activar lote '+selected().number;button.disabled=busy || saving;button.onclick=()=>operate(async()=>{if(!await decide())return;data=await request('/'+selectedId+'/activate',{revision:selected().revision});await show(selectedId);});action.append(button);}
  }
  const money = name => {const value=String(new FormData(form).get(name)||'');if(!value)return null;if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error('Introduce importes con un máximo de dos decimales.');const [whole,part='']=value.split('.');return Number(whole)*100+Number(part.padEnd(2,'0'));};
  document.getElementById('editionHistory').addEventListener('toggle',event=>{if(event.target.open && data)window.CRONOX_LOTS?.load(data.product.id);});
  window.CRONOX_EDITIONS={
    selected, capture, needsDecision,
    setSaving(value) { saving=value;form.inert=value;if(value)tell('');draw(); },
    async leave(fn) {if(busy || saving)return;await operate(async()=>{if(await decide()){baseline=null;fn();}});},
    reset() {loading++;data=null;selectedId=null;baseline=null;tell('');document.getElementById('editionHistory').hidden=true;document.getElementById('editionWebOffer').hidden=true;draw();},
    async load(productId) {const token=++loading;data={product:{id:productId},lots:[]};const result=await request();if(token!==loading)return null;data=result;selectedId=data.product.activeLotId;pendingSave=null;baseline=null;document.getElementById('editionHistory').hidden=false;draw();if(!selected())throw new Error('No se pudo cargar el lote activo.');fillReceiptFields();return selected().profile;},
    async save(payload) {
      const values=new FormData(form);
      const version=loading, lotId=selectedId;
      const body={...payload,revision:selected().revision,expectedStocks:payload.variants.map(v=>({size:v.size,available:selected().profile.variants.find(p=>p.size===v.size)?.stockQty ?? 0})),receivedAt:values.get('editionReceivedAt')||null,receiptReceivedAt:values.get('editionReceiptDate')||undefined,otherTotalCents:money('editionOther') ?? 0};
      const enabled = form.elements.webOfferEnabled.checked;
      if (enabled) body.webOffer = { enabled, priceCents:money('webOfferPrice'), previousCents:money('webOfferPrevious'), startsAt:utcDate(values.get('webOfferStart')), endsAt:utcDate(values.get('webOfferEnd')), previousConfirmed:form.elements.webOfferConfirmed.checked };
      else if (selected().webOfferPriceCents != null && !selected().webOfferDisabledAt) body.webOffer = { enabled:false };
      if(body.isActive===data.product.isActive)delete body.isActive;
      else body.expectedVisibility=data.product.isActive;
      const serialized=JSON.stringify(body);
      if(!pendingSave || pendingSave.lotId!==lotId || pendingSave.body!==serialized)pendingSave={lotId,body:serialized,key:crypto.randomUUID()};
      const result=await request('/'+lotId,body,pendingSave.key);
      if(version!==loading)return true;
      data=result;pendingSave=null;
      await show(selectedId); tell('Cambios guardados en el lote '+selected().number+'.');return true;
    },
  };
})();
