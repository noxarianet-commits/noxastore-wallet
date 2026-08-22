// Service Worker for NoxariaNet Wallet system notifications & WebView Push
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push Notification Event Listener (FCM / Web Push / Android WebView Push)
self.addEventListener('push', (event) => {
  let data = { title: 'NoxariaNet Wallet', body: 'Pemberitahuan transaksi baru!' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || 'Ada pembaruan status transaksi pada akun Anda.',
    icon: data.icon || '/loading screen noxa.png',
    badge: '/loading screen noxa.png',
    vibrate: [200, 100, 200],
    tag: 'noxa-push-' + Date.now(),
    renotify: true,
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'NoxariaNet Wallet', options)
  );
});

// Notification Click Event Listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
