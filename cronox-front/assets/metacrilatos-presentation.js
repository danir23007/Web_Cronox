/* One presentation for the authorized member and the isolated sample preview.
   This module renders information only: it never fetches identities, mounts a
   renderer or changes the saved/active accreditation. */
(() => {
  'use strict';
  const romans = Object.freeze(['I', 'II', 'III', 'IV', 'V']);
  const privileges = Object.freeze({
    1: Object.freeze(['Acreditación negra, miembro oficial de CRONOX. (sirve para eventos).']),
    2: Object.freeze(['Acreditación negra', 'Participación sorteo mensual de 2 códigos de descuento acumulables.']),
    3: Object.freeze(['Acreditación gris', 'Acceso anticipado en drops', 'Acceso a piezas especiales y exclusivas.']),
    4: Object.freeze(['Acreditación blanca', 'Acceso anticipado en drops', 'Acceso a piezas especiales y exclusivas',
      '10% de descuento permanente', 'Acceso a entradas para eventos privados', 'Posibilidad de salir en nuestra galería.']),
    5: Object.freeze(['Acreditación roja', 'Acceso anticipado en drops', 'Acceso a piezas especiales y exclusivas',
      '25% de descuento permanente', 'Entradas gratis a eventos privados', 'Posibilidad de recibir piezas especiales o regalos',
      'Posibilidad de salir en nuestra galería']),
  });
  let nextId = 0;
  function ensure(section) {
    if (!section) return null;
    section.classList.add('metacrilatos-presentation');
    if (!section.querySelector(':scope > .profile-card')) {
      const card = document.createElement('div');
      card.className = 'profile-card account-section--accreditation';
      const mountPoint = document.createElement('section');
      mountPoint.className = 'accreditation-stage';
      mountPoint.hidden = true;
      card.append(mountPoint);
      section.prepend(card);
    }
    if (!section.querySelector(':scope > .profile-back-wrapper')) {
      const back = document.createElement('div');
      back.className = 'profile-back-wrapper';
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'profile-back-link';
      link.dataset.profileBack = 'store';
      link.textContent = 'Volver a la tienda';
      back.append(link);
      section.append(back);
    }
    let member = section.querySelector('[data-metacrilatos-member]');
    if (member?.querySelector('[data-meta-circle]')) return member;
    if (!member) {
      member = document.createElement('aside');
      member.className = 'metacrilatos-member';
      member.dataset.metacrilatosMember = '';
      member.hidden = true;
      const back = section.querySelector('.profile-back-wrapper');
      if (back) back.before(member); else section.append(member);
    }
    const id = `metacrilatos-member-${++nextId}`;
    member.setAttribute('aria-labelledby', `${id}-title`);
    member.innerHTML = `<p class="metacrilatos-member__eyebrow">TU LUGAR EN CRONOX</p>
      <h2 id="${id}-title" class="metacrilatos-member__title">CÍRCULO <span data-meta-circle></span></h2>
      <ol class="metacrilatos-member__circles" aria-label="Círculos de CRONOX">${romans.map((roman, index) =>
        `<li data-meta-circle-marker="${index + 1}" aria-label="Círculo ${roman}">${roman}</li>`).join('')}</ol>
      <div data-meta-details>
        <section class="metacrilatos-member__section" aria-labelledby="${id}-privileges">
          <h3 id="${id}-privileges" class="metacrilatos-member__section-title">TUS PRIVILEGIOS</h3>
          <ul class="metacrilatos-member__privileges" data-meta-privileges></ul>
        </section>
        <section class="metacrilatos-member__section" data-meta-history aria-busy="true" aria-labelledby="${id}-history">
          <h3 id="${id}-history" class="metacrilatos-member__section-title">TU HISTORIAL</h3>
          <dl class="metacrilatos-member__history">
            <div><dt>Pedidos realizados</dt><dd data-meta-stat="orders">—</dd></div>
            <div><dt>Artículos adquiridos</dt><dd data-meta-stat="items">—</dd></div>
            <div><dt>Productos diferentes</dt><dd data-meta-stat="products">—</dd></div>
          </dl>
          <p class="metacrilatos-member__status" data-meta-status role="status">Cargando tu historial…</p>
          <button type="button" class="metacrilatos-member__retry" data-meta-retry hidden>Reintentar</button>
        </section>
      </div>`;
    return member;
  }
  function history(member, state, counts) {
    const block = member?.querySelector('[data-meta-history]');
    if (!block) return;
    block.dataset.state = state;
    block.setAttribute('aria-busy', String(state === 'loading'));
    block.querySelectorAll('[data-meta-stat]').forEach(field => {
      field.textContent = state === 'ready' ? String(counts[field.dataset.metaStat]) : '—';
    });
    const status = block.querySelector('[data-meta-status]');
    status.hidden = state === 'ready';
    status.textContent = state === 'loading' ? 'Cargando tu historial…'
      : state === 'error' ? 'No se pudo cargar tu historial. Puedes volver a intentarlo.' : '';
    const retry = block.querySelector('[data-meta-retry]');
    retry.hidden = state !== 'error';
    retry.disabled = state === 'loading';
  }
  function circle(member, level) {
    if (!member || !Number.isInteger(level) || level < 1 || level > 5) return;
    member.dataset.circleLevel = String(level);
    member.querySelector('[data-meta-circle]').textContent = romans[level - 1];
    member.querySelectorAll('[data-meta-circle-marker]').forEach(marker => {
      if (Number(marker.dataset.metaCircleMarker) === level) marker.setAttribute('aria-current', 'true');
      else marker.removeAttribute('aria-current');
    });
    const list = member.querySelector('[data-meta-privileges]');
    list.replaceChildren(...privileges[level].map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
    member.hidden = false;
  }
  // Legacy geometry is only the scale reference, so moving the store link to
  // its own row does not make the previously approved card/text sizes smaller.
  // The fit shell still reserves the entire NEW height, including the link.
  function scaleReferenceHeight(section, zoom, fallback) {
    const card = section.querySelector(':scope > .profile-card');
    const member = section.querySelector('[data-metacrilatos-member]');
    const back = section.querySelector(':scope > .profile-back-wrapper');
    const cardHeight = card?.getBoundingClientRect().height / zoom;
    const memberHeight = member?.getBoundingClientRect().height / zoom;
    if (!cardHeight || !memberHeight || !back) return fallback;
    const lineHeight = Number.parseFloat(getComputedStyle(back).lineHeight) || 18;
    return (Number.parseFloat(getComputedStyle(section).paddingTop) || 0)
      + Math.max(cardHeight + 16 + lineHeight, memberHeight);
  }
  window.CRONOX_METACRILATOS_PRESENTATION = Object.freeze({ ensure, circle, history, privileges, scaleReferenceHeight });
  document.querySelectorAll('[data-profile-section="accreditation"]').forEach(ensure);
})();
