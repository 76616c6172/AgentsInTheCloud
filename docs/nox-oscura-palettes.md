# Nox Oscura Palette Reference

Reference record of the pure-flat dark palettes explored for `nox-oscura`, so switching or reverting later takes only token updates in:

- `packages/design-system/src/design-system.css` (`[data-theme="nox-oscura"]`)
- `packages/shared/src/theme.ts` (`agentsInTheCloudThemes`)
- `apps/web/public/nox-layout.css` (`html[data-theme="nox-oscura"]`)

---

## 1. Oscura Graphite (Explored)

Slightly darker and de-blued evolution of Original Oscura with pure-flat **Soft Lift** menus/dialogs.

| Role | Token / Selector | Value |
| --- | --- | --- |
| Sidebar | `--nox-sidebar-bg` | `#0a0a0b` |
| Main canvas | `--bg` / `--panel` | `#111113` |
| Menus / Dialogs / Popovers | `--elev` | `#151518` |
| Elevated surface (hover/chip) | *(mockup reference)* | `#1a1a1e` |
| Hairline | `--line` | `#29292e` (`#232328` on touch) |
| Strong hairline | `--line-strong` | `#393940` |
| Menu / dialog border | `.floating-surface`, `.dialog > .panel` | `rgba(242, 238, 234, 0.085)` |
| Text | `--text` | `#e4e3e0` |
| Bright text | `--text-bright` | `#f7f6f4` |
| Muted text | `--text-muted` | `#8a8987` |
| Accent | `--accent` | `#959390` |
| Success / Running | `--success` | `#4ebe96` |
| Warning / Done | `--warning` | `#e6dfa3` |
| Danger | `--danger` | `#d8596d` |
| Decorative | `--decorative` | `#8a878f` |

---

## 2. Original Nox Oscura (Active)

Original palette restored, with only the right Work-view surface subtly darkened to `#111217` (two RGB steps below the Agent canvas, `#131419`). Layout and semantic colors are unchanged; menus and dialogs retain their original colors.

Exact original palette tokens from before Oscura Graphite:

| Role | Value |
| --- | --- |
| Sidebar (Amp-deep sidebar update) | `#090a0e` |
| Main canvas (`--bg`, `--panel`, `--elev`) | `#131419` |
| Hairline (`--line`) | `#32333b` (`#24252c` on touch) |
| Strong hairline (`--line-strong`) | `#46474f` |
| Text (`--text`) | `#e6e6e6` |
| Bright text (`--text-bright`) | `#ffffff` |
| Muted / Accent (`--text-muted`, `--accent`) | `#868f97` |
| Success (`--success`) | `#4ebe96` |
| Warning (`--warning`) | `#e6e7a3` |
| Danger (`--danger`) | `#d84f68` |
| Decorative (`--decorative`) | `#7a7f92` |

```css
[data-theme="nox-oscura"] {
  color-scheme: dark;
  --bg: #131419;
  --panel: var(--bg);
  --elev: var(--bg);
  --line: #32333b;
  --line-strong: #46474f;
  --text: #e6e6e6;
  --text-bright: #ffffff;
  --text-muted: #868f97;
  --accent: #868f97;
  --accent-contrast: #131419;
  --success: #4ebe96;
  --warning: #e6e7a3;
  --danger: #d84f68;
  --decorative: #7a7f92;
  --syntax-keyword: #5c6974;
  --syntax-string: #e6e6e6;
  --syntax-number: #f9b98c;
  --syntax-comment: #46474f;
  --syntax-function: #e6e7a3;
  --syntax-variable: #e6e6e6;
  --syntax-type: #e6e6e6;
  --syntax-literal: #f9b98c;
  --syntax-attribute: #e6e6e6;
  --syntax-tag: #e6e6e6;
  --syntax-constant: #f9b98c;
  --syntax-punctuation: #5c6974;
  --terminal-black: #1b1d24;
  --terminal-red: #d84f68;
  --terminal-green: #4ebe96;
  --terminal-yellow: #e6e7a3;
  --terminal-blue: #479ffa;
  --terminal-magenta: #7a7f92;
  --terminal-cyan: #54c0a3;
  --terminal-white: #e6e6e6;
  --terminal-bright-black: #6a7782;
  --terminal-bright-red: #ff5c5c;
  --terminal-bright-green: #54c0a3;
  --terminal-bright-yellow: #e6e7a3;
  --terminal-bright-blue: #479ffa;
  --terminal-bright-magenta: #7a7f92;
  --terminal-bright-cyan: #54c0a3;
  --terminal-bright-white: #ffffff;
  --shadow: 0 22px 56px rgba(0, 0, 0, .5);
  --floating-surface-shadow: 0 22px 56px rgba(0, 0, 0, .15);
}
```

---

## 3. Abyssal Slate (Ampcode-inspired Near-Black Teal)

Near-pure ink sidebar beside deep ocean-teal near-black panes and sea-glass menu surfaces.

| Role | Value |
| --- | --- |
| Sidebar (`--nox-sidebar-bg`) | `#060708` |
| Main Agent canvas (`--bg`) | `#0b1012` |
| Work pane (optional subtle depth) | `#0a0e10` |
| Menus / Dialogs / Popovers (`--elev`) | `#0f1518` |
| Elevated surface (hover/chip) | `#131b1f` |
| Composer background | `#0d1316` |
| Whisper hairline | `rgba(185, 225, 232, 0.065)` |
| Menu / dialog border | `rgba(185, 225, 232, 0.085)` |
| Row hover / active | `rgba(190, 230, 238, 0.045)` / `rgba(190, 230, 238, 0.08)` |
| Text (`--text`) | `#d6dfe3` |
| Bright text (`--text-bright`) | `#f2f7f9` |
| Muted text (`--text-muted`) | `#708088` |
| Faint text | `#4b5960` |
| Accent (`--accent`) | `#7da6b0` |
| Success (`--success`) | `#4ebe96` |
| Warning (`--warning`) | `#e6e7a3` |
| Danger (`--danger`) | `#d84f68` |
| Decorative (`--decorative`) | `#7a8fa3` |

---

## Other Intermediate References

| Variant | Sidebar | Canvas | Menu | Elevated | Text / Muted |
| --- | --- | --- | --- | --- | --- |
| **Oscura Mid** *(half-step)* | `#090a0c` | `#121216` | `#16171c` | `#1c1d23` | `#e5e5e4` / `#888d92` |
| **Midnight Indigo** | `#060609` | `#0b0c12` | `#0f1119` | `#141722` | `#dadde8` / `#767d92` |
