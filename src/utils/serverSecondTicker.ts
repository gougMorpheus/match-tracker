import { getServerNow } from "./serverClock";

export const getNextServerSecondDelay = (now: number): number =>
  1000 - ((now % 1000 + 1000) % 1000) + 5;

// Render-only scheduler: re-align on every tick, including after delayed tab
// wakeups or clock corrections. No elapsed-time counters or domain mutations.
export const startServerSecondTicker = (render: () => void, now = getServerNow): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      render();
      if (!stopped) arm();
    }, getNextServerSecondDelay(now()));
  };
  arm();
  return () => { stopped = true; clearTimeout(timer); };
};
