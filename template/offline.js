const CACHE_NAME = "offline-cache";
const OFFLINE_URL = "{{=it.prefix}}offline.html";

self.addEventListener(
    "install",
    event => {
        var offlineRequest = new Request(OFFLINE_URL);
        event.waitUntil(
            fetch(offlineRequest).then(
                response => caches.open(CACHE_NAME).then(
                    cache => cache.put(offlineRequest, response)
                )
            )
        );
    }
);

self.addEventListener('fetch', event => {
    var request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    event.respondWith(
        fetch(request).catch(
            error => caches.open(CACHE_NAME).then(
                cache => cache.match(OFFLINE_URL)
            )
        )
    );
});
