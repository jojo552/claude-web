#!/usr/bin/env node
// Generates styles/boot-<variant>-<layout>.css: the extension's own stylesheets, gated so they
// can be applied from SillyTavern/Luker "Custom CSS" before the extension JS has loaded.
// Run: (cd tools && npm i && node build-boot-css.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'styles');
// Rules stop applying when the extension is switched off, and once the extension has loaded its
// own stylesheets (it then sets data-cw-boot-off on <html>), so nothing is matched twice.
const OFF = '[data-claude-enabled="off"],[data-cw-boot-off]';
// The gate adds exactly one attribute of specificity to every rule. The boot sheet is imported at
// the top of Custom CSS, i.e. before the user's own rules; the bump keeps the extension winning
// ties against them, as it does once its stylesheets are appended to <head>.
const GATE_ROOT = ':not(' + OFF + ')';
const GATE_DESC = ':where(html):not(' + OFF + ')';

// html data-* attributes the extension sets once at start-up, with their default values.
const STATIC_DEFAULTS = {
  'data-claude-enabled': 'on', 'data-claude-mode': 'full', 'data-claude-structure': 'rail',
  'data-claude-skin': 'classic', 'data-claude-motion': 'on', 'data-claude-decorations': 'on',
  'data-claude-gen-timer': 'off', 'data-claude-bg-transparent': 'off', 'data-claude-bg-blur': 'off',
  'data-claude-quote-body-color': 'off', 'data-claude-font': 'follow', 'data-claude-clawd': 'on',
  'data-claude-avatars': 'on', 'data-claude-recents': 'xl', 'data-claude-side-swipe': 'on',
  'data-claude-bg-image-blur': 'off',
};
const NAV_ICONS = [
  ['left-nav-panel', 'sliders'], ['rm_api_block', 'plug'], ['AdvancedFormatting', 'type'],
  ['WorldInfo', 'book'], ['Backgrounds', 'image'], ['rm_extensions_block', 'puzzle'],
  ['right-nav-panel', 'card'], ['PersonaManagement', 'user'], ['user-settings-block', 'gear'],
];

const pseudoFrom = text => selectorParser().astSync(text).first.first;

function makeSelectorTransform({ layout, variant }) {
  const defaults = {
    ...STATIC_DEFAULTS,
    'data-claude-layout': layout,
    'data-claude-integrated-theme': variant,
    'data-claude-palette': variant === 'day' ? 'anthropic-light' : 'anthropic-dark',
  };
  return selectorParser(root => {
    // 1. Attributes the extension has not set yet are treated as their default values.
    root.walkAttributes(attr => {
      const name = attr.attribute;
      const quoted = attr.toString().trim();
      if (name === 'data-cw-v4' && !attr.operator) {
        attr.replaceWith(pseudoFrom(':is(' + quoted + ',:not(' + OFF + '))'));
        return;
      }
      if (!(name in defaults)) return;
      if (!attr.operator || (attr.operator === '=' && attr.value === defaults[name] && !attr.insensitive)) {
        attr.replaceWith(pseudoFrom(':is(' + quoted + ',:not([' + name + ']))'));
      }
    });
    if (layout === 'mobile') {
      root.walkClasses(cls => {
        if (cls.value === 'clawd-mobile-layout') cls.replaceWith(pseudoFrom(':is(.clawd-mobile-layout,:not(.cw-boot-never))'));
      });
    }
    // 2. Every rule only applies while the extension is not switched off (zero specificity).
    root.each(selector => {
      let firstCompoundIsRoot = false;
      for (const node of selector.nodes) {
        if (node.type === 'combinator') break;
        if ((node.type === 'tag' && node.value.toLowerCase() === 'html') || (node.type === 'pseudo' && node.value === ':root')) firstCompoundIsRoot = true;
      }
      if (firstCompoundIsRoot) {
        let index = 0;
        while (index < selector.nodes.length && selector.nodes[index].type !== 'combinator') index++;
        const boundary = selector.nodes[index];
        if (boundary) selector.insertBefore(boundary, pseudoFrom(GATE_ROOT));
        else selector.append(pseudoFrom(GATE_ROOT));
      } else {
        const first = selector.first;
        selector.prepend(selectorParser.combinator({ value: ' ' }));
        for (const node of selectorParser().astSync(GATE_DESC).first.nodes.slice().reverse()) selector.prepend(node);
        if (first && first.spaces) first.spaces.before = '';
      }
    });
  });
}

function transformCss(css, from, options) {
  const ast = postcss.parse(css, { from });
  const imports = [];
  const transform = makeSelectorTransform(options);
  ast.walkAtRules(rule => {
    if (rule.name === 'import') { imports.push('@import ' + rule.params + ';'); rule.remove(); return; }
    if (options.layout === 'mobile' && rule.name === 'media') {
      rule.params = rule.params
        .replace(/\(\s*max-width\s*:\s*700px\s*\)/g, '(min-width: 0px)')
        .replace(/\(\s*min-width\s*:\s*701px\s*\)/g, '(min-width: 99999px)');
    }
  });
  ast.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    rule.selector = transform.processSync(rule.selector);
  });
  return { imports, body: ast.toString() };
}

async function iconRules() {
  const { officialIcons } = await import(pathToFileURL(path.join(ROOT, 'official-icons.js')).href);
  const vars = Object.entries(officialIcons).map(([name, d]) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    return '  --cw-v4-icon-' + name + ':url("data:image/svg+xml,' + encodeURIComponent(svg) + '");';
  }).join('\n');
  const nav = NAV_ICONS.map(([id, icon]) => GATE_DESC + ' .drawer:has(#' + id + ') > .drawer-toggle .drawer-icon{--cw-v4-nav-icon:var(--cw-v4-icon-' + icon + ')}').join('\n');
  return ':root' + GATE_ROOT + '{\n' + vars + '\n}\n' + nav + '\n';
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const icons = await iconRules();
const official = fs.readFileSync(path.join(STYLES, 'official-layout.css'), 'utf8');
for (const variant of ['day', 'night']) for (const layout of ['pc', 'mobile']) {
  const skinName = variant + '-' + layout + '.css';
  const skin = fs.readFileSync(path.join(STYLES, skinName), 'utf8');
  const a = transformCss(official, 'official-layout.css', { variant, layout });
  const b = transformCss(skin, skinName, { variant, layout });
  const imports = [...new Set([...a.imports, ...b.imports])];
  const out = [
    '/* Claude Web ' + manifest.version + ' boot stylesheet (' + variant + '/' + layout + '). Generated by tools/build-boot-css.mjs - do not edit. */',
    ...imports, icons, '/* official-layout.css */', a.body, '/* ' + skinName + ' */', b.body, '',
  ].join('\n');
  fs.writeFileSync(path.join(STYLES, 'boot-' + variant + '-' + layout + '.css'), out);
  console.log('boot-' + variant + '-' + layout + '.css', out.length);
}
