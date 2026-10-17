---
kind: frontend_style
name: Tailwind CSS v4 + shadcn/ui Design System with OKLCH Tokens
category: frontend_style
scope:
    - '**'
source_files:
    - src/styles.css
    - components.json
    - package.json
    - src/components/ui/button.tsx
    - src/components/ui/alert.tsx
    - src/components/ui/badge.tsx
    - src/components/ui/sheet.tsx
    - src/components/ui/sidebar.tsx
---

# Frontend Style System

## Approach and Toolchain

The Storq POS is styled with **Tailwind CSS v4** (`tailwindcss` ^4.2.1, `@tailwindcss/vite` plugin) configured through a single entry file at `src/styles.css`. The project uses the **shadcn/ui** component library (configured via `components.json`, style preset `new-york`) whose generated primitives live under `src/components/ui/`. Primitives are built on top of:

- **Radix UI** primitives (`@radix-ui/react-*`) for accessibility and unstyled behavior.
- **class-variance-authority (cva)** to declare variant-driven class sets per component (button, badge, alert, label, sheet, sidebar, toggle-group, toggle, navigation-menu).
- **clsx** + **tailwind-merge** (via `cn` from `@/lib/utils`) for conditional class composition.
- **tw-animate-css** for reusable animation utilities.
- **Lucide React** as the icon set.

Fonts are bundled locally via `@fontsource-variable/dm-sans` and `@fontsource-variable/fraunces` (with Inter also installed); they are imported in `styles.css` so the browser fetches only the unicode-range subsets needed, avoiding cross-origin Google Fonts requests.

## Design Tokens and Theme

All visual tokens live in `src/styles.css` inside a `@theme inline { ... }` block that maps CSS custom properties to Tailwind utility names (e.g. `--color-primary` → `bg-primary`, `text-primary`). Values are defined in two places:

- `:root` — light theme values.
- `.dark` — dark theme values, activated by the `@custom-variant dark (&:is(.dark *))` rule.

The documented brand palette is GoDaddy's "Everyday Blue" teal (hue ~196): white/cool-gray surfaces, near-black ink text, and a single brand accent. Every color value is declared in **oklch** format; the CSS comments explicitly state "All colors MUST use oklch format." Semantic token groups include:

- Surface tokens: `background`, `foreground`, `card`, `popover`, `sidebar*`.
- Brand tokens: `primary`, `accent`, `secondary`, `button` (filled CTA is neutral ink, not blue-tinted charcoal).
- Status tokens: `success`, `warning`, `destructive`, plus soft tints (`*-soft`) for badges/banners/tinted cells.
- Tile palette: `tile-1`..`tile-6` with a shared `tile-foreground` for item thumbnails.
- Chart palette: `chart-1`..`chart-5`.
- Form tokens: `border`, `input`, `ring`, `rail`.
- Typography: `--font-sans` = DM Sans Variable, `--font-display` = Fraunces Variable.
- Radius scale: `--radius-sm` .. `--radius-4xl` derived from a base `--radius: 0.75rem`.

Adding a new semantic color follows the documented procedure in the `@theme` comment: add the variable to both `:root` and `.dark`, then register it in `@theme inline` as `--color-<name>: var(--<name>)`.

## Typography and Responsive Strategy

- Base font size uses a fluid clamp: `clamp(13px, 0.25vw + 10.8px, 15px)` — compact-first, starting at 13 px on small laptops (including 125% Windows scaling) and capping at 15 px on wide desktops. All rem-based spacing/typography derives from this.
- Body uses tabular-nums globally; a `.tabular` utility exists for inline numbers.
- Two typefaces: DM Sans for interface copy, Fraunces for display (logo, page titles, card titles, big totals) via the `.font-display` utility.
- No media-query breakpoints are used for layout; responsive behavior is expressed through Tailwind utilities and the fluid font-size clamp.

## Component Styling Conventions

Each shadcn/ui primitive in `src/components/ui/*.tsx` follows the same shape:

1. Define a `cva(...)` variants object declaring all visual states (e.g. `variant`, `size`).
2. Export a typed React component wrapping `forwardRef` that merges `cn(buttonVariants({ variant, size, className }))` onto the root element.
3. Use `@radix-ui/react-slot` (`Slot`) when an `asChild` prop is supported.
4. Variant classes reference design tokens via Tailwind utility names (e.g. `bg-primary`, `text-primary-foreground`, `focus-visible:ring-primary/30`).

Example from `button.tsx`: variants include `default`, `soft`, `destructive`, `outline`, `secondary`, `ghost`, `accent`, `success`, `link`; sizes include `default`, `sm`, `lg`, `xl`, `icon`.

## Animations and Motion

Animations are centralized in `styles.css`:

- `.reveal` / `.rise` for scroll-triggered fade+rise transitions.
- `.pos-card`, `.pos-tile`, `.pos-key`, `.pos-row` for POS-specific micro-interactions.
- A dedicated `.storq-workspace` scope overrides density/layout for data tables and billing cards.
- A 404 screen (`NotFound.tsx`) has its own scoped styles (`.notf-grid`, `.notf-orb`, `.notf-ring`).
- All animations respect `prefers-reduced-motion`: explicit `@media (prefers-reduced-motion: reduce)` blocks disable or zero out durations for reveal, 404, landing nav, and workspace animations.
- Comments explicitly avoid `will-change` to prevent compositing-layer bloat on weak shop hardware.

## Dark Mode

Dark mode is toggled by adding the `dark` class to the document root (the `@custom-variant dark (&:is(.dark *))` rule). The `.dark` selector re-declares every semantic token with dark-theme oklch values. Components consume tokens via Tailwind utilities, so no component-level dark-mode logic is needed.

## File Layout

| Area | Path | Role |
|---|---|---|
| Global stylesheet & tokens | `src/styles.css` | Tailwind imports, `@theme` block, `:root`/`.dark` variables, base layer, component layers, animations |
| shadcn config | `components.json` | Points to `src/styles.css`, `style: "new-york"`, `cssVariables: true`, aliases `@/components/ui` |
| UI primitives | `src/components/ui/*.tsx` | Radix + cva components |
| Font bundles | `@fontsource-variable/*` (installed) | DM Sans, Fraunces, Inter |
| Icon set | `lucide-react` | Icons consumed by components |

## Observed Constraints

- Color values are required to be in `oklch` format (documented in the `@theme` block comment in `src/styles.css`).
- New semantic colors must be added to both `:root` and `.dark` and registered in `@theme inline` (same comment).
- The `cn` helper from `@/lib/utils` is the standard way to merge Tailwind classes across components.
- Variants for UI components are declared exclusively via `class-variance-authority`'s `cva`, not ad-hoc class strings.
- Animations should avoid `will-change` and honor `prefers-reduced-motion` (enforced by the CSS comments and the presence of matching `@media` blocks throughout `styles.css`).