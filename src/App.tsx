import { getGameRouteAccess } from "./utils/gameAccessMode";
import { useEffect, useState } from "react";
import { GamesPage } from "./pages/GamesPage";
import { GamePage } from "./pages/GamePage";
import { NewGamePage } from "./pages/NewGamePage";
import { StatsPage } from "./pages/StatsPage";
import { BattleCalPage } from "./pages/BattleCalPage";
import { BATTLE_CAL_ROUTE, isBattleCalEnabled, syncBattleCalFlagFromUrl } from "./utils/battleCalFeature";
import { SyncNotices } from "./components/SyncNotices";
import { NotificationsCenter } from "./components/NotificationsCenter";

type Route =
  | { view: "games" }
  | { view: "new" }
  | { view: "stats" }
  | { view: "battle-cal" }
  | { view: "game"; gameId: string; mode?: "overview"; tv?: boolean };

// Alte Links auf die frühere Nur-Lesen-Ansicht (/overview, ?mode=view, ?view=1, ?readonly=1) auf View only umleiten.
const normalizeLegacyGameHash = () => {
  const [path, query = ""] = window.location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/");
  const isLegacy = (params: URLSearchParams) =>
    params.get("mode") === "view" || params.get("view") === "1" || params.get("readonly") === "1";
  const legacy = parts[1] === "game" && parts[2] &&
    (parts[3] === "overview" || isLegacy(new URLSearchParams(query)) || isLegacy(new URLSearchParams(window.location.search)));
  if (!legacy) return;
  const url = new URL(window.location.href);
  ["mode", "view", "readonly"].forEach((key) => url.searchParams.delete(key));
  url.hash = `/game/${parts[2]}?tv=1`;
  window.history.replaceState(null, "", url);
};

const parseHashRoute = (hash: string): Route => {
  const normalized = hash.replace(/^#/, "").split("?")[0];
  const { tv } = getGameRouteAccess(hash, window.location.search);

  if (normalized.startsWith("/game/")) {
    const [, , gameId, mode] = normalized.split("/");
    return gameId
      ? { view: "game", gameId, tv, mode: mode === "overview" ? "overview" : undefined }
      : { view: "games" };
  }

  if (normalized === "/new") {
    return { view: "new" };
  }

  if (normalized === "/stats") {
    return { view: "stats" };
  }

  // Battle-Cal nur mit eingeschaltetem Schalter (sonst wie bisher: Spieleliste).
  if (normalized === BATTLE_CAL_ROUTE && isBattleCalEnabled()) {
    return { view: "battle-cal" };
  }

  return { view: "games" };
};

const navigate = (route: Route) => {
  if (route.view === "game") {
    window.location.hash =
      route.mode === "overview" ? `/game/${route.gameId}/overview` : `/game/${route.gameId}`;
    return;
  }

  if (route.view === "new") {
    window.location.hash = "/new";
    return;
  }

  if (route.view === "stats") {
    window.location.hash = "/stats";
    return;
  }

  if (route.view === "battle-cal") {
    window.location.hash = BATTLE_CAL_ROUTE;
    return;
  }

  window.location.hash = "/games";
};

const App = () => {
  const [route, setRoute] = useState<Route>(() => {
    normalizeLegacyGameHash();
    syncBattleCalFlagFromUrl();
    return parseHashRoute(window.location.hash);
  });

  useEffect(() => {
    const handleHashChange = () => {
      normalizeLegacyGameHash();
      syncBattleCalFlagFromUrl();
      setRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener("hashchange", handleHashChange);

    if (!window.location.hash) {
      navigate({ view: "games" });
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <>
      <SyncNotices />
      <NotificationsCenter />
      {route.view === "games" ? (
        <GamesPage
          onOpenGame={(gameId) => navigate({ view: "game", gameId })}
          onCreateGame={() => navigate({ view: "new" })}
          onOpenStats={() => navigate({ view: "stats" })}
        />
      ) : null}

      {route.view === "new" ? (
        <NewGamePage
          onCreated={(gameId) => navigate({ view: "game", gameId })}
          onBack={() => navigate({ view: "games" })}
        />
      ) : null}

      {route.view === "game" ? (
        <GamePage
          gameId={route.gameId}
          forceTv={route.tv}
          onBack={() => navigate({ view: "games" })}
        />
      ) : null}

      {route.view === "stats" ? (
        <StatsPage
          onBack={() => navigate({ view: "games" })}
          onCreateGame={() => navigate({ view: "new" })}
        />
      ) : null}

      {route.view === "battle-cal" ? (
        <BattleCalPage
          onBack={() => navigate({ view: "games" })}
          onCreateGame={() => navigate({ view: "new" })}
          onOpenStats={() => navigate({ view: "stats" })}
        />
      ) : null}
    </>
  );
};

export default App;
