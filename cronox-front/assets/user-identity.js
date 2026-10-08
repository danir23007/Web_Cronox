(function () {
  'use strict';
  // Show the stored public code verbatim. Never pad, rank, or fall back to a PK.
  window.CRONOX_USER_IDENTITY = Object.freeze({
    format: (user) => typeof user?.memberCode === 'string' && user.memberCode ? user.memberCode : '—',
  });
})();
