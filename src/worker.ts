import { handler } from './sandbox';

addEventListener('fetch', (event) => {
  event.respondWith(handler(event.request));
});
