(function () {
  const referenceEl = document.getElementById('checkout-success-reference');
  if (!referenceEl) return;

  const params = new URLSearchParams(window.location.search);
  const paymentIntent = params.get('payment_intent');
  const paymentIntentClientSecret = params.get('payment_intent_client_secret');
  const redirectStatus = params.get('redirect_status');

  if (paymentIntent) {
    referenceEl.textContent = `Referencia de pago: ${paymentIntent}`;
    referenceEl.hidden = false;
    return;
  }

  if (paymentIntentClientSecret && redirectStatus) {
    referenceEl.textContent = `Estado del pago: ${redirectStatus}`;
    referenceEl.hidden = false;
  }
})();
