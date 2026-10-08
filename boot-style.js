// Boot stylesheet management.
//
// Luker / SillyTavern only load third-party extensions late in start-up, after the native UI has
// already been painted. The user's "Custom CSS" (power_user.custom_css) is applied much earlier,
// together with the rest of the settings. We keep one marked @import line at the top of it that
// points at styles/boot-<variant>-<layout>.css, so the Claude Web look is painted from the first
// frame and the page fills in progressively, like the native UI, instead of jumping once the
// extension finally loads. The block is maintained at runtime and removed by the disable/delete
// hooks and by the "enabled" switch in the extension's settings panel.

const BLOCK_RE = /\/\* claude-web:boot[^*]*\*\/[\s\S]*?\/\* \/claude-web:boot \*\/\n?/g;
const VERSION = new URL(import.meta.url).searchParams.get("v") || "dev";
const STYLES_BASE = new URL("./styles/", import.meta.url);

function context() {
  try {
    return globalThis.SillyTavern?.getContext?.() ?? null;
  } catch {
    return null;
  }
}

function bootHref(variant, layout) {
  const url = new URL("boot-" + variant + "-" + layout + ".css", STYLES_BASE);
  url.search = "?v=" + encodeURIComponent(VERSION);
  return url.pathname + url.search;
}

// Custom CSS is shared by every device of the user, so pick the layout with media queries that
// mirror the extension's own auto layout (phone or a window up to 700px wide).
const PHONE = "(max-width: 700px), (hover: none) and (pointer: coarse) and (max-height: 700px)";
const DESKTOP = "(min-width: 701px) and (hover: hover), (min-width: 701px) and (pointer: fine), (min-width: 701px) and (min-height: 701px)";

export function buildBootBlock({ variant, layoutChoice = "auto", followSystem = false }) {
  const layouts = layoutChoice === "pc" || layoutChoice === "mobile"
    ? [ [ layoutChoice, "" ] ]
    : [ [ "pc", DESKTOP ], [ "mobile", PHONE ] ];
  const variants = followSystem
    ? [ [ "day", "(prefers-color-scheme: light)" ], [ "night", "(prefers-color-scheme: dark)" ] ]
    : [ [ variant === "night" ? "night" : "day", "" ] ];
  const lines = [];
  for (const [layout, layoutMedia] of layouts) for (const [name, schemeMedia] of variants) {
    const media = !layoutMedia ? schemeMedia
      : !schemeMedia ? layoutMedia
      : layoutMedia.split(", ").map(part => part + " and " + schemeMedia).join(", ");
    lines.push('@import url("' + bootHref(name, layout) + '")' + (media ? " " + media : "") + ";");
  }
  return "/* claude-web:boot - added by the Claude Web extension so its look loads with the page; removed when the extension is disabled. Do not edit. */\n"
    + lines.join("\n") + "\n/* /claude-web:boot */\n";
}

export function stripBootBlock(css) {
  return String(css ?? "").replace(BLOCK_RE, "");
}

function writeCustomCss(settings, next) {
  if (settings.custom_css === next) return false;
  settings.custom_css = next;
  const textarea = globalThis.document?.getElementById("customCSS");
  textarea && (textarea.value = next);
  return true;
}

/** Puts the boot block (for the current variant/layout) at the top of Custom CSS. */
export function syncBootStyle(options) {
  if (globalThis.__claudeWebWithdrawn) return;
  const ctx = context();
  const settings = ctx?.powerUserSettings;
  if (!settings) return false;
  const changed = writeCustomCss(settings, buildBootBlock(options) + stripBootBlock(settings.custom_css));
  changed && ctx.saveSettingsDebounced?.();
  return changed;
}

/** Removes the boot block and saves immediately (used right before a reload or a disable). */
export async function removeBootStyle({save = true} = {}) {
  const ctx = context();
  const settings = ctx?.powerUserSettings;
  if (!settings) return false;
  const changed = writeCustomCss(settings, stripBootBlock(settings.custom_css));
  if (changed && save) {
    try {
      await (ctx.saveSettings ? ctx.saveSettings() : ctx.saveSettingsDebounced?.());
    } catch (error) {
      console.warn("[Claude Web] 保存设置失败：", error);
    }
  }
  return changed;
}

// Extension manager hooks (referenced from manifest.json, re-exported by the loader).
async function detachFromNativeManager() {
  // Strip the import first, even if recovery subsequently fails. Never reload from a hook: the
  // host must save its disabledExtensions list or finish its deletion before it navigates.
  globalThis.__claudeWebWithdrawn = true;
  globalThis.__claudeNativeDetachGeneration = (globalThis.__claudeNativeDetachGeneration || 0) + 1;
  void removeBootStyle({save: false});
  const { installSafety } = await import('./emergency.js?v=' + encodeURIComponent(VERSION));
  const safety = await installSafety();
  await safety.detach();
}
export const claudeWebOnDisable = detachFromNativeManager;
export const claudeWebOnDelete = detachFromNativeManager;
