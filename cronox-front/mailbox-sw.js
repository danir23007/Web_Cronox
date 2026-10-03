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
    /^\/admin\.html\?mail=[\da-f-]{36}#section-inbox$/.test(data.url)
      ? data.url
      : "/admin.html#section-inbox";
  event.waitUntil(
    self.registration.showNotification("CRONOX · Correo", {
      body: String(
        data.body || "Tienes nuevos mensajes. Abre Correo con tu sesión.",
      ).slice(0, 300),
      tag: "cronox-mail",
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
        .getNotifications({ tag: "cronox-mail" })
        .then((notifications) => notifications.forEach((n) => n.close())),
    );
});
