import { useEffect, useMemo, useState } from "react";
import { GamesPage } from "./pages/GamesPage";
import { GamePage } from "./pages/GamePage";
import { NewGamePage } from "./pages/NewGamePage";
import { StatsPage } from "./pages/StatsPage";

type Route =
  | { view: "games" }
  | { view: "new" }
  | { view: "stats" }
  | { view: "game"; gameId: string; mode?: "overview" };

const parseHashRoute = (hash: string): Route => {
  const normalized = hash.replace(/^#/, "");

  if (normalized.startsWith("/game/")) {
    const [, , gameId, mode] = normalized.split("/");
    return gameId
      ? { view: "game", gameId, mode: mode === "overview" ? "overview" : undefined }
      : { view: "games" };
  }

  if (normalized === "/new") {
    return { view: "new" };
  }

  if (normalized === "/stats") {
    return { view: "stats" };
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

  window.location.hash = "/games";
};

const App = () => {
  const [route, setRoute] = useState<Route>(() => parseHashRoute(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setRoute(parseHashRoute(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);

    if (!window.location.hash) {
      navigate({ view: "games" });
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <>
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
          forceOverview={route.mode === "overview"}
          onBack={() => navigate({ view: "games" })}
        />
      ) : null}

      {route.view === "stats" ? (
        <StatsPage
          onBack={() => navigate({ view: "games" })}
          onCreateGame={() => navigate({ view: "new" })}
        />
      ) : null}
    </>
  );
};

export default App;
