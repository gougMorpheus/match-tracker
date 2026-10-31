import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DashboardAuthProvider } from "./components/DashboardAuthGate";
import { GameStoreProvider } from "./store/GameStore";
import "./styles/index.css";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DashboardAuthProvider>
      <GameStoreProvider>
        <App />
      </GameStoreProvider>
    </DashboardAuthProvider>
  </React.StrictMode>
);

registerServiceWorker();
