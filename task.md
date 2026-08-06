# Task Checklist / 작업 목록

## Phase 1: Issue #5 (Save/load last selected folders & Bookmarks) / 최근 폴더 및 북마크
- [x] Add i18n keys for bookmarks and recent folders in `dev/js/file-nally.js` / 다국어 텍스트 추가
- [x] Implement recent folders history (max 5) & bookmark state management in `dev/js/file-nally.js` / 상태 관리 추가
- [x] Add recent folders chip bar & bookmark quick actions UI in `dev/file-nally.html` and `dev/css/file-nally.css` / UI 및 CSS 구현
- [x] Add unit & E2E tests for recent folders & bookmarks in `tests/file-nally.e2e.cjs` / E2E 테스트 추가

## Phase 2: Issue #4 (Detect file/folder rename instead of copy+delete) / 이름 변경 감지
- [x] Extend `planSync` matching logic to detect deleted & added items with matching hashes/sizes / 이름 변경 감지 로직 구현
- [x] Implement `RENAME` action execution in `executePlan` / RENAME 실행 로직 구현
- [x] Add unit & E2E tests for rename detection in `tests/file-nally.e2e.cjs` / E2E 테스트 추가

## Phase 3: Issue #6 (Reverse sync & Segmented Toggle Control UI) / 역방향 동기화 및 토글 UI
- [x] Replace `<select id="syncDirection">` with glassmorphic toggle group in `dev/file-nally.html` & `dev/css/file-nally.css` / UI 토글 그룹 변경
- [x] Add `reverse` sync direction i18n keys (`directionReverse`, `directionReverseShort`) / 다국어 텍스트 추가
- [x] Implement `reverse` (`Target -> Source`) sync direction planner rule in `dev/js/file-nally.js` / 역방향 동기화 플래너 구현
- [x] Add unit & E2E tests for reverse sync and toggle controls in `tests/file-nally.e2e.cjs` / E2E 테스트 추가

## Phase 4: Build & Final Verification / 빌드 및 최종 검증
- [x] Run `npm run build` to update `file-nally.html` / 빌드 실행
- [x] Run `npm test` to pass all 31 E2E tests / 전체 테스트 검증 통과 (31/31 PASS)
