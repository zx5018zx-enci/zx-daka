self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { /* A malformed payload still shows a useful notification. */ }
  event.waitUntil(self.registration.showNotification('ZX打卡 · 同行提醒', {
    body: typeof data.body === 'string' ? data.body : '同行在等你一起打卡，照顾好今天的自己。',
    icon: '/icon-192.png', badge: '/icon-192.png', tag: 'checkin-reminder',
    data: { url: '/' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) { await client.navigate('/'); return client.focus() }
    }
    return self.clients.openWindow('/')
  })())
})
