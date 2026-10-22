// Registriert den Service Worker nur im Produktionsbuild (nicht im Vite-Dev-Server).
export const registerServiceWorker = (): void => {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        // Bei jedem Sichtbarwerden nach neuem SW suchen (neue Deploys kommen sicher an).
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) void registration?.update().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  });
};
