// Service worker MINIMO — solo per abilitare l'installabilità PWA.
// NIENTE offline-first, niente coda di sincronizzazione: è volutamente
// rimandato a una versione futura. Le chiamate a Supabase (rete) non
// vengono mai intercettate/servite dalla cache: se manca connessione,
// l'app mostra semplicemente un messaggio (vedi index.html).

const CACHE_NAME = "diario-shell-v2";
const SHELL_ASSETS = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first SOLO per l'app shell statica: prova sempre la rete per avere
// l'ultima versione deployata, e usa la cache come fallback solo se manca
// connessione. Tutto il resto (in particolare le richieste verso Supabase)
// passa dritto alla rete, senza intercettazione.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShellAsset = SHELL_ASSETS.some((a) => url.pathname.endsWith(a.replace("./", "")));
  if (!isShellAsset) return; // lascia passare tutto il resto alla rete normalmente

  event.respondWith(
    fetch(event.request)
      .then((risposta) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, risposta.clone()));
        return risposta;
      })
      .catch(() => caches.match(event.request))
  );
});
