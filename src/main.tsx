import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { GameStoreProvider } from "./store/GameStore";
import "./styles/index.css";
import { registerServiceWorker } from "./pwa/registerServiceWorker";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GameStoreProvider>
      <App />
    </GameStoreProvider>
  </React.StrictMode>
);

registerServiceWorker();
