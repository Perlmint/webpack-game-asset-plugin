var CACHE_NAME = "offline-cache";
var OFFLINE_URL = "{{=it.prefix}}offline.html";

self.addEventListener("install", function(event) {
        var offlineRequest = new Request(OFFLINE_URL);
        event.waitUntil(
            fetch(offlineRequest).then(
                function(response) {
                    return caches.open(CACHE_NAME).then(
                        function(cache) {
                            return cache.put(offlineRequest, response);
                        }
                    );
                }
            )
        );
    }
);

self.addEventListener('fetch', function(event) {
    var request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    event.respondWith(
        fetch(request).catch(
            function(error) {
                return caches.open(CACHE_NAME).then(
                    function(cache) {
                        return cache.match(OFFLINE_URL);
                    }
                );
            }
        )
    );
});
