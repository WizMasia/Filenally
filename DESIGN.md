# File-nally Design System

## 1. Atmosphere & Identity

File-nally is a calm, trust-first local file operations console. It should feel precise before it feels decorative: every surface explains what will happen, every risky action is explicit, and the user can distinguish preparation, comparison, execution, success, and failure at a glance. The signature is a split source/target workspace joined by one central action rail.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---:|---|
| Page | `--surface-page` | `#f4f6fa` | App background |
| Panel | `--surface-panel` | `#ffffff` | Cards and controls |
| Subtle | `--surface-subtle` | `#f8fafc` | Inputs and table heads |
| Strong | `--surface-strong` | `#172033` | Log panel |
| Text | `--text-primary` | `#172033` | Headings and body |
| Secondary text | `--text-secondary` | `#536078` | Descriptions and metadata |
| Muted text | `--text-muted` | `#667085` | Empty states |
| Border | `--border-default` | `#d8dee9` | Panels and inputs |
| Border strong | `--border-strong` | `#aeb8ca` | Focus-adjacent separation |
| Accent | `--accent-primary` | `#4338ca` | Primary controls and focus |
| Accent hover | `--accent-hover` | `#3730a3` | Primary hover |
| Success | `--status-success` | `#087a55` | Completed work |
| Warning | `--status-warning` | `#9a4d00` | Abort and caution |
| Danger | `--status-danger` | `#b42318` | Errors and destructive action |
| Info | `--status-info` | `#175cd3` | Comparison and progress |

Rules:

- Accent is reserved for interaction, selected state, and current progress.
- Status color always appears with a text label or icon, never alone.
- Normal text must meet WCAG 2.2 AA contrast of 4.5:1.
- No raw colors may be introduced in `file-nally.html`; extend this table first.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| Page title | `1.75rem` | 750 | 1.2 | Product name |
| Section title | `1rem` | 700 | 1.4 | Card headings |
| Body | `0.9375rem` | 400 | 1.55 | Controls and descriptions |
| Body small | `0.8125rem` | 450 | 1.5 | Metadata and table text |
| Caption | `0.75rem` | 600 | 1.4 | Badges and counters |

- Primary stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Mono stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Visible UI text is never smaller than 12px.
- Korean words use natural line breaking; paths and logs alone may wrap anywhere.

## 4. Spacing & Layout

Base unit: 4px.

| Token | Value | Usage |
|---|---:|---|
| `--space-1` | `4px` | Icon gaps |
| `--space-2` | `8px` | Inline groups |
| `--space-3` | `12px` | Compact padding |
| `--space-4` | `16px` | Default card padding |
| `--space-5` | `20px` | Comfortable controls |
| `--space-6` | `24px` | Section spacing |
| `--space-8` | `32px` | Page spacing |

- Maximum content width: 1200px.
- Page inset: 24px desktop/tablet, 16px mobile.
- Primary breakpoint: 760px. Split panels and history collapse to one column below it.
- Tables retain a 520px minimum inner width and scroll inside their panel.
- Action rows wrap; the document itself must never scroll horizontally.

## 5. Components

### Button
- Variants: primary, secondary, warning, danger, ghost.
- States: default, hover, active, focus-visible, disabled, busy.
- Minimum target height: 40px; mobile width may grow to 100%.
- Busy state exposes `aria-busy`; disabled remains visually legible.

### Panel
- Structure: optional header, content, optional footer.
- Variants: standard, emphasized status, dark log.
- Uses one border and subtle shadow; no nested decorative cards.

### Folder selector
- Button plus selected folder name and profile verification badge.
- Empty, selected, permission-needed, and invalid-pair states.
- Folder name uses text truncation; full name remains available by title.

### Field
- Label, select/text input, optional hint.
- Focus is a 3px accent ring outside the border.
- Error state includes inline text linked with `aria-describedby`.

### Status badge/banner
- Variants: neutral, info, success, warning, danger.
- Text and inline SVG communicate meaning together.
- Banner is a polite live region except failures, which use assertive announcement.

### File table
- Sticky header, status badge, relative path, size, and modified time.
- Empty and error rows span all columns.
- External strings are inserted with `textContent` only.
- Horizontal scroll belongs to the wrapper, not the page.

### Progress
- Native semantic values through `role="progressbar"` and ARIA values.
- Bar width communicates the same numeric percentage shown in text.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|---|---:|---|---|
| Micro | `120ms` | `ease-out` | Button and focus feedback |
| Standard | `200ms` | `ease-in-out` | Status/background transition |

- Motion communicates state change only.
- Only opacity, transform, filter, and color transitions are allowed.
- Progress width may update without a transition when reduced motion is enabled.
- `prefers-reduced-motion: reduce` removes nonessential transitions.

## 7. Depth & Surface

Strategy: mixed, restrained.

- Panels use `1px solid var(--border-default)` and `0 1px 2px rgb(16 24 40 / 0.06)`.
- Inputs use borders only.
- The log panel uses a tonal shift to `--surface-strong`, not additional elevation.
- No glass, gradients, decorative glow, or deep modal shadows.

## 8. Accessibility Constraints & Accepted Debt

Constraints:

- WCAG 2.2 AA; 4.5:1 normal text and 3:1 large text/control boundaries.
- Full keyboard reachability and visible focus for every interactive element.
- Semantic `header`, `main`, `section`, `footer`, labels, table headings, and live status.
- Color is never the only state signal.
- Minimum 40px pointer target for primary controls.
- `prefers-reduced-motion` is honored.

Accepted debt:

The editable design source is `dev/css/file-nally.css`; the root HTML is generated and must not be edited directly.

| Item | Location | Why accepted | Exit |
|---|---|---|---|
| Product delivery remains one generated physical file | `file-nally.html` | Explicit product requirement: runtime HTML, CSS, and JavaScript ship together | Edit `dev/` sources and regenerate with `npm run build`; split the artifact only if the product constraint changes |
