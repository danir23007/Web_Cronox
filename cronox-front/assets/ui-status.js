(function (global) {
  const g = global || {};

  const getColumnCount = (container) => {
    const table = container?.closest?.('table');
    if (!table) return 1;
    const headers = table.querySelectorAll('thead th');
    return headers && headers.length ? headers.length : 1;
  };

  const normalizeDetails = (details) => {
    if (!details) return '';
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details, null, 2);
    } catch (error) {
      return String(details);
    }
  };

  const createActionButton = (action) => {
    const button = document.createElement('button');
    const variant = action?.variant ? ` ${action.variant}` : '';
    button.className = `btn${variant}`;
    button.type = 'button';
    button.textContent = action?.label || 'Acción';
    if (typeof action?.onClick === 'function') {
      button.addEventListener('click', action.onClick);
    } else if (action?.href) {
      button.addEventListener('click', () => {
        window.location.href = action.href;
      });
    }
    return button;
  };

  const wrapForTable = (container, element, colSpan) => {
    const span = colSpan || getColumnCount(container);
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = span;
    cell.appendChild(element);
    row.appendChild(cell);
    return row;
  };

  const renderIntoContainer = (container, element, colSpan) => {
    if (!container) return;
    container.innerHTML = '';
    const isTableBody = container.tagName === 'TBODY' || container.tagName === 'TABLE';
    const node = isTableBody ? wrapForTable(container, element, colSpan) : element;
    container.appendChild(node);
  };

  const renderBanner = (container, options = {}) => {
    if (!container) return;
    const type = options.type || 'info';
    const banner = document.createElement('div');
    banner.className = `status-banner status-banner--${type}`;

    const header = document.createElement('div');
    header.className = 'status-banner__header';

    const title = document.createElement('strong');
    title.textContent = options.title || 'Aviso';
    header.appendChild(title);

    if (options.message) {
      const message = document.createElement('p');
      message.className = 'status-banner__message';
      message.textContent = options.message;
      header.appendChild(message);
    }

    banner.appendChild(header);

    if (options.details) {
      const details = document.createElement('details');
      details.className = 'status-banner__details';
      const summary = document.createElement('summary');
      summary.textContent = 'Ver detalles';
      details.appendChild(summary);
      const pre = document.createElement('pre');
      pre.textContent = normalizeDetails(options.details);
      details.appendChild(pre);
      banner.appendChild(details);
    }

    if (Array.isArray(options.actions) && options.actions.length) {
      const actions = document.createElement('div');
      actions.className = 'status-banner__actions';
      options.actions.forEach((action) => {
        actions.appendChild(createActionButton(action));
      });
      banner.appendChild(actions);
    }

    renderIntoContainer(container, banner, options.colSpan);
  };

  const renderEmptyState = (container, options = {}) => {
    if (!container) return;
    const wrapper = document.createElement('div');
    wrapper.className = `empty-state${options.loading ? ' empty-state--loading' : ''}`;

    if (options.title) {
      const title = document.createElement('strong');
      title.textContent = options.title;
      wrapper.appendChild(title);
    }

    if (options.message) {
      const message = document.createElement('p');
      message.textContent = options.message;
      wrapper.appendChild(message);
    }

    if (options.loading) {
      const shimmer = document.createElement('div');
      shimmer.className = 'empty-state__shimmer';
      wrapper.appendChild(shimmer);
    }

    if (Array.isArray(options.actions) && options.actions.length) {
      const actions = document.createElement('div');
      actions.className = 'empty-state__actions';
      options.actions.forEach((action) => {
        actions.appendChild(createActionButton(action));
      });
      wrapper.appendChild(actions);
    }

    renderIntoContainer(container, wrapper, options.colSpan);
  };

  const setLoading = (container, isLoading, options = {}) => {
    if (!container) return;
    if (!isLoading) return;
    renderEmptyState(container, {
      title: options.title || 'Cargando…',
      message: options.message || 'Estamos preparando la información.',
      loading: true,
      colSpan: options.colSpan,
    });
  };

  g.CRONOX_UI = {
    renderBanner,
    renderEmptyState,
    setLoading,
  };
})(typeof window !== 'undefined' ? window : this);
