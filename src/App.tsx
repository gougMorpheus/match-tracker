import { useEffect, useMemo, useState } from "react";
import { Navigation } from "./components/Navigation";
import { GamesPage } from "./pages/GamesPage";
import { GamePage } from "./pages/GamePage";
import { NewGamePage } from "./pages/NewGamePage";
import { StatsPage } from "./pages/StatsPage";

type Route =
  | { view: "games" }
  | { view: "new" }
  | { view: "stats" }
  | { view: "game"; gameId: string };

const parseHashRoute = (hash: string): Route => {
  const normalized = hash.replace(/^#/, "");

  if (normalized.startsWith("/game/")) {
    const gameId = normalized.replace("/game/", "");
    return gameId ? { view: "game", gameId } : { view: "games" };
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
    window.location.hash = `/game/${route.gameId}`;
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

  const navigationItems = useMemo(
    () => [
      {
        key: "games",
        label: "Spiele",
        icon: "M",
        active: route.view === "games" || route.view === "game",
        onClick: () => navigate({ view: "games" })
      },
      {
        key: "new",
        label: "Neu",
        icon: "+",
        active: route.view === "new",
        onClick: () => navigate({ view: "new" })
      },
      {
        key: "stats",
        label: "Stats",
        icon: "#",
        active: route.view === "stats",
        onClick: () => navigate({ view: "stats" })
      }
    ],
    [route.view]
  );

  return (
    <>
      {route.view === "games" ? (
        <GamesPage onOpenGame={(gameId) => navigate({ view: "game", gameId })} />
      ) : null}

      {route.view === "new" ? (
        <NewGamePage
          onCreated={(gameId) => navigate({ view: "game", gameId })}
          onBack={() => navigate({ view: "games" })}
        />
      ) : null}

      {route.view === "game" ? (
        <GamePage gameId={route.gameId} onBack={() => navigate({ view: "games" })} />
      ) : null}

      {route.view === "stats" ? <StatsPage onBack={() => navigate({ view: "games" })} /> : null}

      <Navigation items={navigationItems} />
    </>
  );
};

export default App;
