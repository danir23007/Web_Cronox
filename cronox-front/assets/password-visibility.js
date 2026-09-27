(() => {
  if (window.CRONOX_PASSWORD_VISIBILITY) return;
  window.CRONOX_PASSWORD_VISIBILITY = true;
  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const hiddenEye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M9 5.5A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-4 4M6 6a19 19 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/></svg>';
  const install = () => document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.passwordEye || input.disabled || input.readOnly || input.hasAttribute('data-secret-placeholder')) return;
    input.dataset.passwordEye = 'true';
    const wrapper = document.createElement('span');wrapper.className='password-entry';
    input.before(wrapper);wrapper.append(input);
    const button=document.createElement('button');button.type='button';button.className='password-eye';
    button.setAttribute('aria-label','Mostrar contraseña');button.setAttribute('aria-pressed','false');button.innerHTML=eye;
    let selection;
    button.addEventListener('pointerdown',event=>{selection={start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input};event.preventDefault();});
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{
      const {start,end,focused}=selection||{start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input};selection=null;
      const visible=input.type==='password';input.type=visible?'text':'password';
      button.setAttribute('aria-label',visible?'Ocultar contraseña':'Mostrar contraseña');button.setAttribute('aria-pressed',String(visible));button.innerHTML=visible?hiddenEye:eye;
      if(focused)input.focus({preventScroll:true});
      try{input.setSelectionRange(start,end);}catch{}
      requestAnimationFrame(()=>{try{input.setSelectionRange(start,end);}catch{}});
    });wrapper.append(button);
    input.form?.addEventListener('reset',()=>{input.type='password';button.setAttribute('aria-label','Mostrar contraseña');button.setAttribute('aria-pressed','false');button.innerHTML=eye;});
  });
  const start=()=>{install();new MutationObserver(install).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','readonly']});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
