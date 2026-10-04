(() => {
  const labels = { NEW: 'Novedades', GARMENT: 'Tipo de prenda', DROP: 'Drop/conjunto', UNCLASSIFIED: 'Sin clasificar (asociaciones conservadas)' };
  const groupOf = category => Object.hasOwn(labels, category.group) ? category.group : 'UNCLASSIFIED';
  function render(categories, selectedIds, changed = () => {}, disabled = false) {
    const root = document.createElement('div'); root.className = 'category-control-columns';
    const selected = new Set([...selectedIds].map(Number));
    for (const group of ['NEW', 'GARMENT', 'DROP', 'UNCLASSIFIED']) {
      const entries = categories.filter(category => groupOf(category) === group);
      if (group === 'UNCLASSIFIED' && !entries.length) continue;
      const column = document.createElement('div'); column.className = 'category-control-column';
      if (group === 'UNCLASSIFIED') column.classList.add('category-control-legacy');
      const title = document.createElement('strong'); title.textContent = labels[group]; column.append(title);
      const choices = document.createElement(group === 'NEW' ? 'div' : 'details');
      if (group !== 'NEW') {
        const summary = document.createElement('summary'); choices.append(summary);
        const updateSummary = () => { summary.textContent = entries.filter(c => selected.has(Number(c.id))).map(c => c.name).join(', ') || 'Sin selección'; };
        choices.addEventListener('change', updateSummary); updateSummary();
      }
      const options = document.createElement('div'); options.className = 'category-group-options';
      for (const category of entries) {
        const label = document.createElement('label'); label.className = 'category-checkbox';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(category.id);
        input.checked = selected.has(Number(category.id)); input.disabled = disabled;
        input.dataset.categoryChoice = ''; input.dataset.categoryGroup = group;
        input.addEventListener('change', () => {
          if (input.checked) selected.add(Number(input.value)); else selected.delete(Number(input.value));
          changed(new Set(selected));
        });
        label.append(input, document.createTextNode(category.name + (category.isActive === false ? ' (inactiva)' : ''))); options.append(label);
      }
      if (!entries.length) options.textContent = 'No hay categorías disponibles.';
      choices.append(options); column.append(choices); root.append(column);
    }
    return root;
  }
  window.CRONOX_CATEGORY_CONTROLS = { render, groupOf };
})();
