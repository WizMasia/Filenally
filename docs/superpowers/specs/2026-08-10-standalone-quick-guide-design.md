# Standalone Quick Guide Design

## Goal

Make the basic File-nally workflow and its safety constraints discoverable from the standalone `file-nally.html`, without requiring a network connection or repository documentation.

## Validity

Issue #11 is valid. The release artifact is intentionally self-contained, but the current interface has no help entry point and the workflow explanation lives only in the repository manuals. A user who downloads only the HTML cannot discover the full compare-before-sync sequence, saved-folder permission recovery, or `.trash` limitations from inside the app.

## Chosen Approach

Add one quiet `사용 안내 / Quick guide` ghost button beside the language switch. It opens a native modal `<dialog>` that reuses the existing run-detail dialog's surface, close, responsive, Escape, focus containment, and focus-return conventions. This is preferable to an always-visible panel, which would compete with the primary folder workflow, and to an accordion inside the controls, which would make help harder to discover and couple explanatory content to option visibility.

## Content

The dialog presents five numbered steps:

1. Select source and target folders.
2. Check synchronization direction, conflict policy, and comparison mode.
3. Compare changes.
4. Review the generated plan and conflicts.
5. Run synchronization only after the plan is understood.

Two compact safety notes follow the steps:

- A saved folder may require permission renewal. If renewal is denied or unavailable, select the folder again.
- Back up important data first. `.trash` recovery is manual and is not an automatic rollback.

Every visible string has Korean and English text in the existing `TEXT` dictionary. The dialog always opens in the currently selected interface language.

## Interaction and Accessibility

- The trigger is a semantic button with `aria-haspopup="dialog"` and `aria-controls`.
- Native `showModal()` supplies modal semantics, focus containment, and Escape dismissal.
- The explicit close button is the initial focus target.
- The dialog `close` event returns focus to the guide trigger.
- The dialog remains dismissible and occupies no workspace area when closed.
- No decorative or layout animation is added. Existing button feedback and reduced-motion rules remain unchanged.

## Responsive Layout

The guide surface uses existing spacing, radius, border, color, and type tokens. It is centered and scrollable on larger screens, then uses the available width at the existing 760px breakpoint. Ordered steps use a fixed marker column and a flexible text column so Korean and English copy wrap naturally. The document must not overflow horizontally at 375px, 768px, or 1280px.

## Source and Build Boundaries

- Markup: `dev/file-nally.html`
- Styles: `dev/css/file-nally.css`
- Behavior and translations: `dev/js/file-nally.js`
- Generated release artifact: `file-nally.html`, produced only by `npm run build`
- Regression coverage: `tests/file-nally.e2e.cjs`

The feature adds no dependency and makes no network request.

## Verification

- Chrome E2E covers discovery, open state, Korean content, English content after language switching, Escape close, explicit close, and focus return.
- Existing accessibility checks continue to require labelled controls and unique IDs.
- Full build and test commands must pass.
- Fresh browser captures cover the closed page and open guide at 375px, 768px, and 1280px, plus keyboard focus and reduced-motion behavior.

## Scope

This issue does not add a tutorial wizard, first-run auto-open, persistent dismissal state, external documentation links, or changes to synchronization behavior.
