(function () {
  'use strict';
  const root = document.getElementById('section-favorites');
  if (!root) return;
  const $ = id => root.querySelector('#' + id);
  const number = value => new Intl.NumberFormat('es-ES').format(value);
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
  let page = 1, generation = 0, abort;
  async function load() {
    abort?.abort(); abort = new AbortController();
    const current = ++generation;
    $('favoritesMessage').textContent = 'Cargando favoritos…';
    $('favoritesSummary').textContent = '';
    $('favoritesList').replaceChildren();
    $('favoritesList').setAttribute('aria-busy', 'true');
    $('favoritesPrev').disabled = true; $('favoritesNext').disabled = true;
    $('favoritesRefresh').textContent = 'Actualizar';
    const query = new URLSearchParams({page:String(page),sort:$('favoritesSort').value,search:$('favoritesSearch').value.trim()});
    try {
      const response = await fetch((window.CRONOX_API?.API_BASE || '') + '/api/admin/favorites?' + query, {credentials:'include',cache:'no-store',signal:abort.signal});
      if (!response.ok) throw Error([401,403].includes(response.status) ? 'No tienes permisos para gestionar productos y consultar Favoritos.' : 'No se pudieron cargar los favoritos. Pulsa Reintentar.');
      const data = await response.json();
      if (current !== generation) return;
      if (page > 1 && !data.rows.length) {page = 1; return load();}
      $('favoritesSummary').textContent = `Todos los productos · ${number(data.summary.favorites)} favoritos actuales · ${number(data.summary.users)} usuarios únicos con al menos un favorito. Incluye productos activos e inactivos, independientemente de la búsqueda y la página.`;
      for (const row of data.rows) {
        const article = document.createElement('article'); article.className = 'waitlist-row';
        const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy'; image.width = 72; image.height = 90;
        if (row.image && window.CRONOX_IMAGES?.apply) window.CRONOX_IMAGES.apply(image,row.image,'small');
        else image.src = row.image?.url || '/assets/logo_browser.png';
        image.addEventListener('error', () => {image.removeAttribute('srcset'); image.src='/assets/logo_browser.png';}, {once:true});
        const content = document.createElement('div');
        content.append(text('h3',row.name),text('p',`ID #${row.id}${row.reference ? ' · Ref. ' + row.reference : ''} · ${row.slug}`),text('p',!row.isActive ? 'Inactivo / archivado' : row.available ? 'Activo · Disponible' : 'Activo · Sin stock disponible'),text('p',`${number(row.favorites)} usuarios lo tienen guardado`));
        const edit = text('button','Editar producto'); edit.type='button'; edit.className='btn'; edit.dataset.favoriteEdit=String(row.id); edit.setAttribute('aria-label','Editar producto: ' + row.name);
        content.append(edit); article.append(image,content); $('favoritesList').append(article);
      }
      const pages = Math.max(1,Math.ceil(data.total/data.pageSize));
      $('favoritesPage').textContent = `Página ${page} de ${pages} · ${number(data.total)} productos en la búsqueda`;
      $('favoritesPrev').disabled = page <= 1; $('favoritesNext').disabled = page >= pages;
      $('favoritesMessage').textContent = data.rows.length ? 'Usuarios únicos por producto · empates ordenados por ID ascendente.' : 'No hay productos con esta búsqueda.';
    } catch (error) {
      if (current !== generation || error.name === 'AbortError') return;
      $('favoritesList').replaceChildren(); $('favoritesPage').textContent='';
      $('favoritesSummary').textContent='Resumen no disponible.';
      $('favoritesMessage').textContent=error.message; $('favoritesRefresh').textContent='Reintentar';
    } finally {if(current===generation) $('favoritesList').setAttribute('aria-busy','false');}
  }
  $('favoritesFilters').addEventListener('submit',e=>{e.preventDefault();page=1;void load();});
  $('favoritesSort').addEventListener('change',()=>{page=1;void load();});
  $('favoritesRefresh').addEventListener('click',()=>void load());
  $('favoritesPrev').addEventListener('click',()=>{page--;void load();});
  $('favoritesNext').addEventListener('click',()=>{page++;void load();});
  root.addEventListener('click',e=>{
    const id=Number(e.target.closest('[data-favorite-edit]')?.dataset.favoriteEdit);
    if(Number.isInteger(id)&&id>0)window.dispatchEvent(new CustomEvent('cronox:admin-edit-product',{detail:{id}}));
  });
  window.CRONOX_FAVORITES_ADMIN = {load};
})();
