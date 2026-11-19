// Service worker: PWA install + Firebase push notifications
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

try {
  importScripts('/config.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  if (self.APP_CONFIG && self.APP_CONFIG.firebase.apiKey) {
    firebase.initializeApp(self.APP_CONFIG.firebase);
    firebase.messaging(); // notification payload ko apne aap dikhata hai
  }
} catch (e) {
  // config abhi bhara nahi hai — PWA phir bhi chalega
}
