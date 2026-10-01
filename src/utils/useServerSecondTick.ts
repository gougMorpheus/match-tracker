import { useEffect, useState } from "react";
import { startServerSecondTicker } from "./serverSecondTicker";

export const useServerSecondTick = (active: boolean): void => {
  const [, render] = useState(0);
  useEffect(() => {
    if (active) return startServerSecondTicker(() => render((tick) => tick + 1));
  }, [active]);
};
