(() => {
  const form=document.querySelector('[data-mailbox-unsubscribe]');if(!form)return;
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button'),status=document.querySelector('[role=status]');button.disabled=true;
    try {const token=document.cookie.split('; ').find(c=>c.startsWith('cronox_csrf_token='))?.split('=').slice(1).join('=');
      const response=await fetch(location.pathname,{method:'POST',headers:{'x-csrf-token':decodeURIComponent(token||'')},credentials:'same-origin'});
      if(!response.ok)throw Error('No se pudo registrar la baja. Reabre el enlace y vuelve a intentarlo.');
      status.textContent=(await response.json()).message;
    }catch(e){status.textContent=e.message;button.disabled=false;}
  };
})();
