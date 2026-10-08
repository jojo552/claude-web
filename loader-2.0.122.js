// Public versioned loader.
export { claudeWebOnDisable, claudeWebOnDelete } from "./boot-style.js?v=2.0.122";

// The extension manager also imports this file to run the disable/delete hooks. Only start the
// extension itself when it is enabled, so deleting a disabled copy does not bring the theme back.
const folder = decodeURIComponent(new URL(import.meta.url).pathname.split("/scripts/extensions/")[1]?.split("/").slice(0, -1).join("/") || "");
let disabled = false;
try {
  disabled = !!folder && (globalThis.SillyTavern?.getContext?.()?.extensionSettings?.disabledExtensions ?? []).includes(folder);
} catch {}
if (!disabled) await import("./index.js?v=2.0.122");
