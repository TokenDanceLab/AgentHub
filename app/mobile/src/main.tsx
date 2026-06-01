import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, persister } from "./queryClient";
import { App } from "./App";
import "./config";
import "./i18n";
import "./styles/global.css";

/**
 * Register the PWA service worker for offline shell support.
 *
 * The SW (public/sw.js) caches the app shell (HTML, JS, CSS, manifest) so
 * the app loads even when the device is completely offline. The SW does NOT
 * cache API data — that is handled by React Query persist + the offline
 * message queue.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        console.log("[SW] Registered with scope:", registration.scope);
      })
      .catch((error) => {
        console.warn("[SW] Registration failed:", error);
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister }}
      onSuccess={() => {
        // Hydration from localStorage complete — cached queries are now
        // available immediately without a network round-trip.
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);

registerServiceWorker();
