/* No fetch handler or cache: public routes and authenticated responses stay untouched. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    data = {};
  }
  const url =
    typeof data.url === "string" &&
    (/^\/admin\.html\?mail=[\da-f-]{36}#section-inbox$/.test(data.url) ||
      /^\/admin\.html#section-orders\?order=[1-9]\d*$/.test(data.url) ||
      ['/admin.html#section-dashboard','/admin.html#section-waitlist'].includes(data.url))
      ? data.url
      : "/admin.html#section-inbox";
  event.waitUntil(
    self.registration.showNotification(['CRONOX · Correo','CRONOX · Pedidos','CRONOX · Visitas','CRONOX · Waitlist'].includes(data.title)?data.title:'CRONOX · Correo', {
      body: String(
        data.body || "Tienes nuevos mensajes. Abre Correo con tu sesión.",
      ).slice(0, 300),
      tag: typeof data.tag==='string' && data.tag.startsWith('cronox-event-') ? data.tag.slice(0,180) : 'cronox-mail',
      data: { url },
      icon: "/assets/mailbox-icon.svg",
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(
      event.notification.data?.url || "/admin.html#section-inbox",
    ),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_MAIL_NOTIFICATIONS")
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((notifications) => notifications.filter(n=>n.tag.startsWith('cronox-')).forEach((n) => n.close())),
    );
});
