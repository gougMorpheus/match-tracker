"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.focusNextFormField = void 0;
// Fokus auf das nächste bedienbare Feld im selben Formular (für Enter in Eingabefeldern).
const focusNextFormField = (current) => {
    const form = current.closest("form");
    if (!form) {
        current.blur();
        return;
    }
    const fields = Array.from(form.querySelectorAll("input, select, textarea, button"))
        .filter((el) => !el.disabled && el.offsetParent !== null && el.tabIndex >= 0);
    const index = fields.indexOf(current);
    const next = fields.slice(index + 1).find((el) => el.tagName !== "BUTTON" || !el.classList.contains("choice-field__toggle"));
    if (next)
        next.focus();
    else
        current.blur();
};
exports.focusNextFormField = focusNextFormField;
