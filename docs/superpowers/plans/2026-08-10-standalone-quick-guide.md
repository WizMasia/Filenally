# Standalone Quick Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bilingual, keyboard-accessible quick-start guide to the offline standalone File-nally HTML and release it as v0.13.0.

**Architecture:** Add one header trigger and one native dialog to the editable HTML, style it only with existing design tokens, and route all visible copy through the existing `TEXT` dictionary and `renderStaticText()`. Preserve the generated root HTML boundary by rebuilding through `scripts/build.cjs`.

**Tech Stack:** Semantic HTML, token-driven CSS, vanilla JavaScript, Node.js build scripts, Playwright with Chrome.

## Global Constraints

- The production artifact remains one offline `file-nally.html` with no runtime dependency or network request.
- Korean and English guide content switch with the existing language controls.
- Escape and the close button dismiss the guide; focus returns to the trigger.
- The document has no horizontal overflow at 375px, 768px, or 1280px.
- Root `file-nally.html` is generated and must never be edited directly.

---

### Task 1: Lock the guide behavior with a failing browser test

**Files:**
- Modify: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Consumes: the existing `add(name, run)` Playwright test registry and language buttons.
- Produces: required selectors `#btnQuickGuide`, `#quickGuideDialog`, and `#btnCloseQuickGuide` plus observable bilingual content and focus restoration.

- [ ] **Step 1: Write the failing test**

Add a test named `quick guide explains the safe workflow in both languages and restores focus` that opens `#btnQuickGuide`, asserts the dialog is open, checks Korean folder/plan/permission/backup/`.trash` guidance, closes with Escape and verifies focus returns. Switch to English, reopen and check equivalent content, then close with `#btnCloseQuickGuide` and verify focus returns again.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node tests/file-nally.e2e.cjs --grep "quick guide"`

Expected: FAIL because `#btnQuickGuide` does not exist.

### Task 2: Implement the accessible bilingual dialog

**Files:**
- Modify: `DESIGN.md`
- Modify: `dev/file-nally.html`
- Modify: `dev/css/file-nally.css`
- Modify: `dev/js/file-nally.js`
- Modify: `file-nally.html`
- Test: `tests/file-nally.e2e.cjs`

**Interfaces:**
- Consumes: existing button, native dialog, spacing, color, typography, i18n, and focus-return patterns.
- Produces: `#btnQuickGuide`, `#quickGuideDialog`, `#btnCloseQuickGuide`; translation keys `quickGuide*`; `openQuickGuide()` and `closeQuickGuide()` event behavior.

- [ ] **Step 1: Document the component contract**

Add a `Quick guide dialog` component to `DESIGN.md` Section 5: header trigger, numbered workflow, safety notes, native modal semantics, immediate language refresh, Escape/explicit close, and trigger focus return.

- [ ] **Step 2: Add semantic markup**

Place a ghost guide button beside the language switch and a native dialog before the existing run-detail dialog. Use `data-i18n` for all guide strings, an ordered list for the workflow, and status-styled safety notes for permission and backup warnings.

- [ ] **Step 3: Add token-driven responsive styles**

Use only existing CSS variables for the header action group, guide surface, step layout, and note treatment. At the existing 760px breakpoint, let the header actions wrap and make the dialog use the available mobile width without document overflow.

- [ ] **Step 4: Add translations and dialog behavior**

Add matching Korean/English `TEXT` keys. Cache guide elements in the existing `elements` map, open with `showModal()`, close explicitly, and restore focus from the dialog `close` event. The next open reflects the active language. Do not add custom animation or external dependencies.

- [ ] **Step 5: Build and verify GREEN**

Run: `npm run build && node tests/file-nally.e2e.cjs --grep "quick guide"`

Expected: the build succeeds and the focused test passes.

### Task 3: Prepare v0.13.0 documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/README_en.md`
- Modify: `dev/file-nally.html`
- Modify: `tests/file-nally.e2e.cjs`
- Modify: `file-nally.html`

**Interfaces:**
- Consumes: the completed guide and existing bilingual manuals.
- Produces: matching v0.13.0 version labels and manual descriptions of the in-app guide.

- [ ] **Step 1: Update version and manuals**

Change visible and tested versions from `v0.12.0` to `v0.13.0`. Add one concise in-app-guide entry to each manual's feature/use section, covering the header entry, bilingual content, keyboard close/focus return, permission renewal, backup, and `.trash` recovery.

- [ ] **Step 2: Run the complete automated suite**

Run: `npm test`

Expected: build pipeline, generated-file freshness, and every Chrome E2E test pass.

- [ ] **Step 3: Run browser and visual QA**

Run the real Chrome surface at 375px, 768px, and 1280px. Capture closed and open states, verify no horizontal overflow or CJK clipping, drive language switching, Escape, explicit close, focus return, and reduced motion, then obtain both required independent read-only visual QA passes.

- [ ] **Step 4: Commit atomically**

Commit the design and plan first. Commit implementation, tests, version, generated artifact, and matching manual updates in coherent repository-style commits after their verification commands pass.

### Task 4: Publish and close issue #11

**Files:**
- Release asset: `file-nally.html`

**Interfaces:**
- Consumes: verified `main` at v0.13.0.
- Produces: pushed feature branch and `main`, tag/release `v0.13.0`, verified release asset, issue completion comment, and closed #11.

- [ ] **Step 1: Push and integrate**

Push `issue-11-quick-guide`, fast-forward `main`, rerun `npm test` on the integrated tree, and push `main`.

- [ ] **Step 2: Publish and verify the release**

Create tag and GitHub release `v0.13.0` with `file-nally.html`. Download the published asset, compare its SHA-256 to the local artifact, and confirm the release is public.

- [ ] **Step 3: Record and close**

Comment on #11 with delivered behavior, commit/tag/release links, test and visual-QA evidence, and release checksum. Close #11, verify it is closed, and confirm the main checkout is clean and synchronized.
