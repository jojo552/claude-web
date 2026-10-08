export { claudeWebOnDisable, claudeWebOnDelete } from './boot-style.js?v=2.0.124';
import { installSafety } from './emergency.js?v=2.0.124';

// The extension manager also imports this file to run the disable/delete hooks. Only start the
// extension itself when it is enabled, so deleting a disabled copy does not bring the theme back.
const folder = decodeURIComponent(new URL(import.meta.url).pathname.split('/scripts/extensions/')[1]?.split('/').slice(0, -1).join('/') || '');
let disabled = false;
try {
  disabled = !!folder && (globalThis.SillyTavern?.getContext?.()?.extensionSettings?.disabledExtensions ?? []).includes(folder);
} catch {}
// Do not block the manager's import on network-dependent startup: it has a five-second hook limit.
if (!disabled) void (async () => {
  const safety = await installSafety();
  if (await safety.shouldStart() && !globalThis.__claudeWebWithdrawn) {
    try { await import('./index.js?v=2.0.124'); }
    catch (error) { safety.notify('CW 主界面加载失败：' + error.message + '。可使用这里的紧急退出。'); }
  }
})().catch(error => console.warn('[Claude Web] 启动失败：', error));
