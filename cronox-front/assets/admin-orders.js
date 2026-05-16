(function(){
  const $=(s,e=document)=>e.querySelector(s);
  const body=$('#ordersAdminBody'); if(!body) return;
  const msg=$('#ordersMessage'); const refreshBtn=$('#ordersRefreshBtn'); const exportBtn=$('#ordersExportBtn');
  const modal=$('#orderDetailModal'); const closeBtn=$('#orderDetailClose'); const title=$('#orderDetailTitle'); const detailMsg=$('#orderDetailMessage');
  const statusEl=$('#orderDetailStatus'); const carrier=$('#orderCarrier'); const tn=$('#orderTrackingNumber'); const tu=$('#orderTrackingUrl'); const note=$('#orderInternalNote');
  const saveBtn=$('#orderSaveBtn'); const shipBtn=$('#orderMarkShippedBtn'); const deliverBtn=$('#orderMarkDeliveredBtn'); const refundBtn=$('#orderRefundBtn');
  let currentOrder=null; let busy=false;
  const fmt=(d)=>d?new Date(d).toLocaleString('es-ES'):'—'; const txt=(v,f='—')=>v==null||v===''?f:String(v);
  const money=(v)=>window.CRONOX_API?.formatPrice?window.CRONOX_API.formatPrice(Number(v||0)):`${Number(v||0).toFixed(2)} €`;
  const chip=(s)=>`<span class="chip ${s==='DELIVERED'?'chip--green':s==='REFUNDED'||s==='CANCELLED'?'chip--red':s==='SHIPPED'?'chip--yellow':'chip--gray'}">${txt(s)}</span>`;
  const endpoint=(p)=>`${window.CRONOX_API?.API_BASE||''}${p}`;
  async function req(path,opts={}){const r=await fetch(endpoint(path),{credentials:'include',headers:{'Content-Type':'application/json'},...opts});const t=await r.text();const j=t?JSON.parse(t):null;if(!r.ok) throw new Error(j?.message||`Error ${r.status}`);return j;}
  function setMsg(el,text,type='success'){if(!el) return; if(!text){el.className='message';el.textContent='';return;} el.textContent=text; el.className=`message show ${type}`;}
  function setBusy(v){busy=v; [saveBtn,shipBtn,deliverBtn,refundBtn].forEach(b=>b&&(b.disabled=v));}
  function toggleModal(show){if(!modal) return; modal.classList.toggle('show',!!show);}
  function applyActions(){const s=currentOrder?.status; const blocked=s==='DELIVERED'||s==='REFUNDED'||s==='CANCELLED'; shipBtn.disabled=busy||blocked||s==='SHIPPED'; deliverBtn.disabled=busy||blocked||s==='DELIVERED'; refundBtn.disabled=busy||s==='REFUNDED';}
  function fill(order){currentOrder=order||null; title.textContent=`Pedido #${txt(order?.id)}`; statusEl.innerHTML=chip(order?.status); carrier.value=order?.shippingCarrier||''; tn.value=order?.trackingNumber||''; tu.value=order?.trackingUrl||''; note.value=order?.internalNote||''; setMsg(detailMsg,''); applyActions();}
  function norm(list){if(Array.isArray(list)) return list; if(Array.isArray(list?.items)) return list.items; if(Array.isArray(list?.data?.items)) return list.data.items; return [];}
  async function load(){body.innerHTML='<tr><td colspan="10" class="empty">Cargando pedidos…</td></tr>'; setMsg(msg,''); try{const data=await req('/api/admin/orders'); const items=norm(data); if(!items.length){body.innerHTML='<tr><td colspan="10" class="empty">Sin pedidos.</td></tr>';return;} body.innerHTML=items.map(o=>`<tr><td>${txt(o.id)}</td><td>${fmt(o.createdAt)}</td><td>${chip(o.status)}</td><td>${money(o.total)}</td><td>${txt(o.user?.email||o.email,'—')}</td><td>${txt(o.shippingCarrier,'—')}</td><td>${o.trackingNumber?txt(o.trackingNumber):'Sin tracking'}</td><td>${fmt(o.shippedAt)||'No enviado todavía'}</td><td>${fmt(o.deliveredAt)||'No entregado todavía'}</td><td><button class="btn" data-order-id="${o.id}">Gestionar</button></td></tr>`).join('');}catch(e){setMsg(msg,e.message||'Error cargando pedidos','error'); body.innerHTML='<tr><td colspan="10" class="empty">No se pudo cargar.</td></tr>';}}
  async function openOrder(id){setMsg(detailMsg,'Cargando…');toggleModal(true); try{const o=await req(`/api/admin/orders/${encodeURIComponent(id)}`); fill(o);}catch(e){setMsg(detailMsg,e.message||'Error','error');}}
  async function action(fn){if(!currentOrder?.id||busy) return; setBusy(true); try{await fn(); setMsg(detailMsg,'Acción completada','success'); await openOrder(currentOrder.id); await load();}catch(e){setMsg(detailMsg,e.message||'No se pudo completar','error');} finally{setBusy(false); applyActions();}}
  body.addEventListener('click',(ev)=>{const b=ev.target.closest('button[data-order-id]'); if(b) openOrder(b.dataset.orderId);});
  refreshBtn?.addEventListener('click',load); closeBtn?.addEventListener('click',()=>toggleModal(false));
  saveBtn?.addEventListener('click',()=>action(()=>req(`/api/admin/orders/${encodeURIComponent(currentOrder.id)}/fulfillment`,{method:'PATCH',body:JSON.stringify({shippingCarrier:carrier.value.trim()||null,trackingNumber:tn.value.trim()||null,trackingUrl:tu.value.trim()||null,internalNote:note.value.trim()||null})})));
  shipBtn?.addEventListener('click',()=>action(()=>req(`/api/admin/orders/${encodeURIComponent(currentOrder.id)}/mark-shipped`,{method:'POST'})));
  deliverBtn?.addEventListener('click',()=>action(()=>req(`/api/admin/orders/${encodeURIComponent(currentOrder.id)}/mark-delivered`,{method:'POST'})));
  refundBtn?.addEventListener('click',()=>{if(confirm('¿Confirmar reembolso?')) action(()=>req(`/api/admin/orders/${encodeURIComponent(currentOrder.id)}/refund`,{method:'POST'}));});
  exportBtn?.addEventListener('click',(e)=>{e.preventDefault(); window.open(endpoint('/api/admin/orders/export.csv'),'_blank');});
  document.querySelector('#adminTabs')?.addEventListener('click',(e)=>{const b=e.target.closest('button[data-section="section-orders"]'); if(b) setTimeout(load,50);});
})();
