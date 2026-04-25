"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUuid = exports.createUuid = exports.createId = void 0;
const createId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
exports.createId = createId;
const createUuidFallback = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const nextValue = character === "x" ? randomValue : (randomValue & 0x3) | 0x8;
    return nextValue.toString(16);
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const createUuid = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : createUuidFallback();
exports.createUuid = createUuid;
const isUuid = (value) => UUID_PATTERN.test(value);
exports.isUuid = isUuid;
