(() => {
  'use strict';
  // Move existing nodes, retaining IDs, event listeners and export semantics.
  window.CRONOX_ADMIN_HEADERS = {
    arrange() {
      document.querySelectorAll('.admin-section').forEach(section => {
        const back = section.querySelector(':scope > [data-back-target]');
        if (back) back.classList.add('admin-view-back');
        if (section.querySelector(':scope > .admin-section-heading')) return;
        const exports = section.querySelector('.excel-export-actions');
        const flat = ['section-mails','section-waitlist'].includes(section.id);
        if (!exports && !flat) return;
        const title = section.querySelector('h2');
        if (!title) return;
        const header = document.createElement('header'); header.className = 'admin-section-heading';
        const left = document.createElement('div'); left.className = 'admin-heading-copy';
        const right = document.createElement('div'); right.className = 'admin-heading-actions';
        const primary = document.createElement('div'); primary.className = 'admin-heading-primary';
        const text = document.createElement('div'); text.className = 'admin-heading-title';
        if (title.parentElement === section) {
          const description = title.nextElementSibling;
          text.append(title);
          if (description?.matches('small,p') && !description.id) text.append(description);
        } else {
          let previous = title.parentElement;
          while (previous.parentElement !== section) previous = previous.parentElement;
          let copy = title;
          while (copy.parentElement !== previous) copy = copy.parentElement;
          text.append(copy);
          [...previous.children].forEach(child => primary.append(child));
          previous.remove();
        }
        if (back) left.append(back);
        left.append(text);
        if (flat) section.querySelector('#waitlistRefresh') && primary.append(section.querySelector('#waitlistRefresh'));
        if (primary.children.length) right.append(primary);
        if (exports) right.append(exports);
        header.append(left); if (right.children.length) header.append(right);
        section.prepend(header);
      });
    },
  };
})();
