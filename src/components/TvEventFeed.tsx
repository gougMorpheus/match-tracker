import { useLayoutEffect, useRef, useState } from "react";
import { TV_EVENT_LIMIT, type TvFeedEvent } from "../utils/tvDashboard";

interface FeedRow { event: TvFeedEvent; leaving: boolean; top?: number }
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const TvEventFeed = ({ feed, gameId }: { feed: TvFeedEvent[]; gameId: string }) => {
  const list = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<FeedRow[]>(() => feed.slice(0, TV_EVENT_LIMIT).map(event => ({ event, leaving: false })));
  const positions = useRef(new Map<string, number>());
  const removalTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const trackedGame = useRef(gameId);
  useLayoutEffect(() => {
    const activeFeed = feed.slice(0, TV_EVENT_LIMIT);
    const changedGame = trackedGame.current !== gameId;
    trackedGame.current = gameId;
    const activeIds = new Set(activeFeed.map(e => e.id));
    const reduce = reducedMotion();
    if (changedGame) {
      removalTimers.current.forEach(clearTimeout);
      removalTimers.current.clear(); positions.current.clear();
    }
    for (const id of activeIds) {
      const timer = removalTimers.current.get(id);
      if (timer) clearTimeout(timer);
      removalTimers.current.delete(id);
    }
    // Leaving rows are positioned outside normal flow, so only eight active rows
    // occupy the list. Their old position remains visible until the fade finishes.
    const leaving = changedGame || reduce ? [] : rows.filter(row => !activeIds.has(row.event.id))
      .map(row => ({ ...row, leaving: true, top: positions.current.get(row.event.id) ?? row.top ?? 0 }));
    for (const row of leaving) if (!removalTimers.current.has(row.event.id)) {
      const id = row.event.id;
      removalTimers.current.set(id, setTimeout(() => {
        removalTimers.current.delete(id);
        setRows(current => current.filter(item => item.event.id !== id || !item.leaving));
      }, 400));
    }
    setRows([...activeFeed.map(event => ({ event, leaving: false })), ...leaving]);
    // Only feed changes reconcile rows; the animation commit below measures them.
  }, [feed, gameId]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const nextPositions = new Map<string, number>();
    const animations: Animation[] = [];
    element.querySelectorAll<HTMLElement>(".tv-event:not(.tv-event--leaving)").forEach(row => {
      const id = row.dataset.eventId!;
      const top = row.offsetTop; // Layout position, unaffected by an in-flight transform.
      const previousTop = positions.current.get(id);
      nextPositions.set(id, top);
      if (previousTop !== undefined && Math.abs(previousTop - top) > .5 && !reducedMotion() && row.animate) {
        animations.push(row.animate([{ transform: `translateY(${previousTop - top}px)` }, { transform: "translateY(0)" }],
          { duration: 400, easing: "ease-out" }));
      }
    });
    positions.current = nextPositions;
    return () => animations.forEach(animation => animation.cancel());
  }, [rows]);
  useLayoutEffect(() => () => {
    removalTimers.current.forEach(clearTimeout);
    removalTimers.current.clear();
  }, []);
  return <div ref={list} className="tv-events tv-events__list">
    {rows.map(({ event, leaving, top }) => <div key={event.id} data-event-id={event.id}
      className={`tv-event${leaving ? " tv-event--leaving" : ""}`} style={leaving ? { top } : undefined}>
      <time dateTime={event.createdAt}>{event.time}</time><span title={event.text}>{event.text}</span>
    </div>)}
    {!rows.length && <p className="tv-empty">Noch keine Ereignisse</p>}
  </div>;
};
