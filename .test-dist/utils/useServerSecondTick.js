"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useServerSecondTick = void 0;
const react_1 = require("react");
const serverSecondTicker_1 = require("./serverSecondTicker");
const useServerSecondTick = (active) => {
    const [, render] = (0, react_1.useState)(0);
    (0, react_1.useEffect)(() => {
        if (active)
            return (0, serverSecondTicker_1.startServerSecondTicker)(() => render((tick) => tick + 1));
    }, [active]);
};
exports.useServerSecondTick = useServerSecondTick;
