# DESIGN.md — DroidBridge

## Surface Mode
**Operate** — Precision dual-pane workstation tool engineered for high-density file operations, low cognitive load, clear visual hierarchy, and fast keyboard/mouse workflows between Ubuntu and Android hardware.

## Visual World & Palette
- **Theme:** Tactile Dark Workbench (inspired by Teenage Engineering / Panic Transmit / GNOME Adwaita Dark).
- **Canvas Surfaces:**
  - App background: `#0d1014`
  - Pane surface: `#12161c`
  - Elevated header / toolbar: `#171c24`
  - Interactive row hover: `#1c232e`
  - Selected row highlight: `rgba(56, 189, 248, 0.12)` with `1px solid rgba(56, 189, 248, 0.35)`
  - Border / hairline divider: `#232b36`
- **Accents:**
  - Ubuntu Host Accent: Warm Amber `#f59e0b`
  - Android Target Accent: Emerald Mint `#10b981`
  - Primary Action / Bridge Accent: Cyan `#38bdf8`
  - Danger / Delete: Rose `#f43f5e`
- **Typography:**
  - UI Sans: `'Plus Jakarta Sans'`, `'Inter'`, system-ui
  - Technical / Paths / Sizes / Permissions: `'JetBrains Mono'`, monospace with `font-variant-numeric: tabular-nums`
- **Craft Rules:**
  - No emoji icons — use crisp 1.75px stroke Lucide SVG icons (`lucide-react`).
  - No hero metrics or marketing cards — open directly into the functional dual-pane workspace.
  - Native `<dialog closedby="any">` modals with backdrop blur and JS fallback for light-dismiss.
  - Sticky `<thead>` headers and `@container` responsive table wrappers (`tabindex="0" role="region"`).
