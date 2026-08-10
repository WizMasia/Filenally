# Saved Folder Permission Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 최근 폴더나 북마크를 클릭했을 때 저장된 두 폴더의 읽기·쓰기 권한을 재확인하고, 필요한 권한을 승인한 경우에만 비교 가능한 연결 상태로 복원한다.

**Architecture:** 브라우저 권한 API는 모델을 변경하지 않는 `PermissionGate`로 격리한다. `Controller.connectStoredProfile(profileId, { requestPermission })`가 선택 프로필의 이력 조회 상태와 실제 핸들 연결 상태를 분리하며, 클릭 경로만 권한 요청을 허용하고 초기화 경로는 조회만 허용한다.

**Tech Stack:** Vanilla JavaScript, File System Access API, IndexedDB, Node.js, Playwright, Chrome stable

## Global Constraints

- `requestPermission({ mode: 'readwrite' })`은 최근 폴더 또는 북마크의 사용자 클릭 흐름에서만 호출한다.
- 두 디렉터리 핸들이 모두 `granted`인 경우에만 `trustedProfile = true`, `phase = 'ready'`, 비교 활성화 상태를 허용한다.
- 권한 실패 시 저장 프로필과 과거 이력은 유지하되 live handle, 실행 계획, 비교·동기화 권한은 제거한다.
- 한국어와 영어 상태 문구를 함께 제공한다.
- 새 런타임 의존성을 추가하지 않는다.
- `dev/` 소스를 변경한 뒤 `npm run build`로 루트 `file-nally.html`을 재생성한다.
- 설계 기준은 `docs/superpowers/specs/2026-08-10-saved-folder-permission-renewal-design.md`를 따른다.

---

### Task 1: PermissionGate와 결정 가능한 권한 모의 계층

**Files:**
- Modify: `tests/support/mock-file-system.cjs:68-136`
- Modify: `tests/support/mock-file-system.cjs:170-217`
- Modify: `tests/file-nally.e2e.cjs:430-530`
- Modify: `dev/js/file-nally.js:228-341`
- Modify: `dev/js/file-nally.js:1188-1194`
- Modify generated: `file-nally.html`

**Interfaces:**
- Consumes: `HandleStore` 레코드 `{ profileId, sourceHandle, targetHandle }`와 File System Access API의 `queryPermission()`/`requestPermission()`.
- Produces: `PermissionGate.inspect(record)`와 `PermissionGate.request(record)`, 두 함수 모두 `{ state, source, target, error }`를 반환한다.
- Produces: 테스트 전용 `window.__setMockPermission(side, options)`와 `window.__getPermissionCalls()`.

- [ ] **Step 1: 모의 핸들에 권한 조회·요청 결과와 호출 기록을 추가한다**

`MockDirectoryHandle`이 현재 상태와 요청 결과를 분리하도록 확장한다.

```js
class MockDirectoryHandle {
  constructor(name, options = {}) {
    this.kind = 'directory';
    this.name = name;
    this.entries = new Map();
    this.permission = options.permission || 'granted';
    this.requestPermissionResult = options.requestPermissionResult || 'granted';
    this.queryPermissionError = options.queryPermissionError || '';
    this.requestPermissionError = options.requestPermissionError || '';
  }

  async queryPermission() {
    window.__permissionCalls.push({ method: 'query', name: this.name });
    if (this.queryPermissionError) throw new DOMException(this.queryPermissionError, 'NotAllowedError');
    return this.permission;
  }

  async requestPermission() {
    window.__permissionCalls.push({ method: 'request', name: this.name });
    if (this.requestPermissionError) throw new DOMException(this.requestPermissionError, 'SecurityError');
    if (this.permission === 'prompt') this.permission = this.requestPermissionResult;
    return this.permission;
  }
}
```

`installMockFileSystem()` 초기화에 `window.__permissionCalls = []`를 추가하고 다음 제어 API를 노출한다.

```js
window.__setMockPermission = (side, options = {}) => {
  const handle = window.__mockPair[side];
  if ('state' in options) handle.permission = options.state;
  if ('requestResult' in options) handle.requestPermissionResult = options.requestResult;
  if ('queryError' in options) handle.queryPermissionError = options.queryError;
  if ('requestError' in options) handle.requestPermissionError = options.requestError;
};
window.__getPermissionCalls = () => [...window.__permissionCalls];
```

`window.__configureMockPair()`가 각 모의 핸들에 요청 결과와 예외 옵션을 전달하도록 source/target 생성 옵션을 확장한다.

```js
const source = buildDirectory(options.sourceName || 'source', options.source || {}, {
  permission: options.sourcePermission || 'granted',
  requestPermissionResult: options.sourceRequestPermissionResult || 'granted',
  queryPermissionError: options.sourceQueryPermissionError || '',
  requestPermissionError: options.sourceRequestPermissionError || '',
});

target = buildDirectory(options.targetName || 'target', options.target || {}, {
  permission: options.targetPermission || 'granted',
  requestPermissionResult: options.targetRequestPermissionResult || 'granted',
  queryPermissionError: options.targetQueryPermissionError || '',
  requestPermissionError: options.targetRequestPermissionError || '',
});
```

- [ ] **Step 2: PermissionGate의 실패 E2E 테스트를 작성한다**

`tests/file-nally.e2e.cjs`에 직접 권한 게이트를 검증하는 테스트를 추가한다.

```js
add('permission gate requests only prompt handles and requires both grants', async ({ page }) => {
  await configureMockPair(page, {
    sourcePermission: 'prompt',
    sourceRequestPermissionResult: 'granted',
    targetPermission: 'granted',
  });
  const result = await page.evaluate(() => window.FileNallyTest.PermissionGate.request({
    sourceHandle: window.__mockPair.source,
    targetHandle: window.__mockPair.target,
  }));
  const requests = await page.evaluate(() => window.__getPermissionCalls().filter((call) => call.method === 'request'));
  assert.equal(result.state, 'granted');
  assert.deepEqual(requests.map((call) => call.name), ['source']);
});

add('permission gate normalizes denial and permission exceptions', async ({ page }) => {
  await configureMockPair(page, { sourcePermission: 'prompt', targetPermission: 'granted' });
  await page.evaluate(() => window.__setMockPermission('source', { requestResult: 'denied' }));
  const denied = await page.evaluate(() => window.FileNallyTest.PermissionGate.request({
    sourceHandle: window.__mockPair.source,
    targetHandle: window.__mockPair.target,
  }));
  assert.equal(denied.state, 'denied');

  await page.evaluate(() => window.__setMockPermission('source', { state: 'prompt', requestError: 'Activation expired' }));
  const unavailable = await page.evaluate(() => window.FileNallyTest.PermissionGate.request({
    sourceHandle: window.__mockPair.source,
    targetHandle: window.__mockPair.target,
  }));
  assert.equal(unavailable.state, 'unavailable');
  assert.match(unavailable.error, /Activation expired/);
});
```

- [ ] **Step 3: 테스트가 구현 부재로 실패하는지 확인한다**

Run:

```bash
node --check tests/support/mock-file-system.cjs
node --check tests/file-nally.e2e.cjs
node tests/file-nally.e2e.cjs --grep 'permission gate'
```

Expected: `window.FileNallyTest.PermissionGate`가 없어 두 테스트가 FAIL.

- [ ] **Step 4: 최소 PermissionGate를 구현한다**

`HandleStore` 다음에 권한 결과를 정규화하는 객체를 추가한다.

```js
const PermissionGate = (() => {
    const descriptor = { mode: 'readwrite' };
    const normalize = (value) => ['granted', 'prompt', 'denied'].includes(value) ? value : 'unavailable';
    const summarize = (source, target, error = '') => ({
        state: source === 'granted' && target === 'granted'
            ? 'granted'
            : source === 'unavailable' || target === 'unavailable'
                ? 'unavailable'
                : source === 'denied' || target === 'denied'
                    ? 'denied'
                    : 'prompt',
        source,
        target,
        error,
    });
    const inspect = async (record) => {
        try {
            const [source, target] = await Promise.all([
                record.sourceHandle.queryPermission(descriptor),
                record.targetHandle.queryPermission(descriptor),
            ]);
            return summarize(normalize(source), normalize(target));
        } catch (error) {
            return summarize('unavailable', 'unavailable', safeMessage(error));
        }
    };
    const request = async (record) => {
        let result = await inspect(record);
        if (result.state !== 'prompt') return result;
        for (const side of ['source', 'target']) {
            if (result[side] !== 'prompt') continue;
            try {
                await record[`${side}Handle`].requestPermission(descriptor);
            } catch (error) {
                return summarize('unavailable', 'unavailable', safeMessage(error));
            }
            result = await inspect(record);
            if (result.state !== 'prompt') return result;
        }
        return result;
    };
    return Object.freeze({ inspect, request });
})();
```

`window.FileNallyTest`에 `PermissionGate`를 노출한다.

- [ ] **Step 5: 대상 테스트와 생성 산출물을 검증한다**

Run:

```bash
node --check dev/js/file-nally.js
npm run build
node tests/file-nally.e2e.cjs --grep 'permission gate'
npm run build:check
```

Expected: permission gate 테스트 2/2 PASS, 생성 HTML 최신성 PASS.

- [ ] **Step 6: Task 1을 커밋한다**

```bash
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs tests/support/mock-file-system.cjs
git commit -m "Add saved-folder permission gate"
```

---

### Task 2: 저장 프로필 재연결 상태 전이와 사용자 안내

**Files:**
- Modify: `dev/js/file-nally.js:19-53`
- Modify: `dev/js/file-nally.js:609-714`
- Modify: `dev/js/file-nally.js:918-978`
- Modify: `dev/js/file-nally.js:1169-1194`
- Modify: `tests/file-nally.e2e.cjs:730-790`
- Modify generated: `file-nally.html`

**Interfaces:**
- Consumes: Task 1의 `PermissionGate.inspect(record)`와 `PermissionGate.request(record)`.
- Produces: `Controller.connectStoredProfile(profileId, { requestPermission })`와 클릭 전용 `Controller.selectProfile(profileId)`.
- Produces: `window.FileNallyTest.connectStoredProfile(profileId, requestPermission)` 초기화 경로 검증용 테스트 인터페이스.

- [ ] **Step 1: 사용자 클릭 재승인 성공·거부·초기화 실패 테스트를 작성한다**

다음 세 E2E를 추가한다.

```js
add('saved profile click renews prompt permission before enabling compare', async ({ page }) => {
  await mountPair(page, {
    source: { 'source.txt': { content: 'source' } },
    target: {},
  });
  await page.evaluate(() => {
    window.__permissionCalls.length = 0;
    window.__setMockPermission('source', { state: 'prompt', requestResult: 'granted' });
  });
  await page.locator('#recentChips .chip').click();
  await page.waitForFunction(() => window.FileNallyTest.getModel().phase === 'ready');
  assert.equal(await page.locator('#btnCompare').isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__getPermissionCalls().some((call) => call.method === 'request')), true);
});

add('denied saved profile remains history-only and explains folder reselection', async ({ page }) => {
  await mountPair(page, {
    source: { 'source.txt': { content: 'source' } },
    target: {},
  });
  await compare(page);
  await executeCurrentPlan(page);
  await page.evaluate(() => window.__setMockPermission('source', { state: 'denied' }));
  await page.locator('#recentChips .chip').click();
  const model = await page.evaluate(() => window.FileNallyTest.getModel());
  assert.equal(model.phase, 'idle');
  assert.equal(model.trustedProfile, false);
  assert.equal(await page.locator('#btnCompare').isDisabled(), true);
  assert.match(await page.locator('#syncStatus').innerText(), /다시 선택|select.*again/i);
  assert.match(await page.locator('#historyBody').innerText(), /성공|Success/);
});

add('bootstrap inspection never requests prompt permission', async ({ page }) => {
  await mountPair(page, { source: {}, target: {} });
  const profileId = await page.evaluate(() => window.FileNallyTest.getModel().profileId);
  await page.evaluate(() => {
    window.__permissionCalls.length = 0;
    window.__setMockPermission('source', { state: 'prompt', requestResult: 'granted' });
  });
  await page.evaluate((id) => window.FileNallyTest.connectStoredProfile(id, false), profileId);
  const requests = await page.evaluate(() => window.__getPermissionCalls().filter((call) => call.method === 'request'));
  assert.deepEqual(requests, []);
  assert.equal(await page.locator('#btnCompare').isDisabled(), true);
});
```

- [ ] **Step 2: 새 테스트가 현재 잘못된 ready 전환을 재현하는지 확인한다**

Run:

```bash
node tests/file-nally.e2e.cjs --grep 'saved profile|bootstrap inspection'
```

Expected: 현재 `selectProfile()`이 권한 없이 `ready`로 전환하고 테스트 인터페이스가 없어서 FAIL.

- [ ] **Step 3: 권한 확인 중 상태와 이력 조회 전용 전이를 구현한다**

모델에 `profileConnectionPending: false`를 추가하고 `renderRecentAndBookmarks()`에서 모든 저장 프로필 칩의 `disabled`를 이 값과 연동한다.

Controller 내부에 모델 변경을 분리한 함수를 추가한다.

```js
const showStoredProfileOnly = (profile) => {
    model.source = null;
    model.target = null;
    model.profile = profile;
    model.trustedProfile = false;
    model.plan = null;
    model.state.activeProfileId = profile.id;
    StateStore.save(model.state);
    setPhase('idle');
    renderPaths();
    renderProfile();
    renderHistory();
    renderRows();
};

const connectStoredProfile = async (profileId, { requestPermission }) => {
    const profile = model.state.profiles[profileId];
    if (!profile || model.profileConnectionPending) return false;
    showStoredProfileOnly(profile);
    model.profileConnectionPending = true;
    renderRecentAndBookmarks();
    setStatus(t('permissionChecking'), 'info', 'info');
    const record = await HandleStore.get(profileId);
    if (!record) {
        setStatus(t('storedHandleMissing'), 'warning', 'alert');
        addLog(t('storedHandleMissing'));
        model.profileConnectionPending = false;
        renderRecentAndBookmarks();
        renderControls();
        return false;
    }
    const permission = requestPermission
        ? await PermissionGate.request(record)
        : await PermissionGate.inspect(record);
    if (permission.state !== 'granted') {
        const key = permission.state === 'denied' ? 'permissionDenied' : permission.state === 'prompt' ? 'permissionNeedsAction' : 'storedHandleUnavailable';
        setStatus(t(key), permission.state === 'unavailable' ? 'danger' : 'warning', 'alert');
        addLog(t(key));
        model.profileConnectionPending = false;
        renderRecentAndBookmarks();
        renderControls();
        return false;
    }
    model.source = record.sourceHandle;
    model.target = record.targetHandle;
    model.trustedProfile = profile.bindingStatus === 'verified';
    model.profileConnectionPending = false;
    renderPaths();
    setPhase('ready');
    setStatus(t(requestPermission ? 'permissionRestored' : 'pairReady'), 'success', 'check');
    renderProfile();
    renderHistory();
    renderRows();
    renderRecentAndBookmarks();
    return true;
};
```

`selectProfile(profileId)`는 `connectStoredProfile(profileId, { requestPermission: true })`를 호출한다. `initialize()`는 기존 중복 권한 코드를 제거하고 `connectStoredProfile(activeProfileId, { requestPermission: false })`를 호출한다.

- [ ] **Step 4: 한국어·영어 상태 문구를 추가한다**

`TEXT.ko`와 `TEXT.en`에 다음 키를 추가한다.

```js
permissionChecking: '저장된 폴더 권한을 확인하는 중입니다.',
permissionRestored: '폴더 권한이 확인되었습니다. 변경사항을 비교할 수 있습니다.',
permissionDenied: '폴더 권한이 승인되지 않았습니다. 원본과 대상 폴더를 다시 선택해 주세요.',
permissionNeedsAction: '저장된 폴더를 사용하려면 최근 폴더 또는 북마크를 눌러 권한을 승인해 주세요.',
storedHandleMissing: '저장된 폴더 연결을 찾을 수 없습니다. 원본과 대상 폴더를 다시 선택해 주세요.',
storedHandleUnavailable: '저장된 폴더에 접근할 수 없습니다. 원본과 대상 폴더를 다시 선택해 주세요.',
```

```js
permissionChecking: 'Checking access to the saved folders.',
permissionRestored: 'Folder access verified. You can compare changes now.',
permissionDenied: 'Folder access was not granted. Select the source and target folders again.',
permissionNeedsAction: 'Select the recent folder or bookmark to approve access before reconnecting.',
storedHandleMissing: 'The saved folder connection is unavailable. Select the source and target folders again.',
storedHandleUnavailable: 'The saved folders cannot be accessed. Select the source and target folders again.',
```

- [ ] **Step 5: Controller 테스트 인터페이스를 연결하고 대상 테스트를 통과시킨다**

`Controller` export와 `window.FileNallyTest`에 다음 연결을 추가한다.

```js
connectStoredProfile,
```

```js
connectStoredProfile: (profileId, requestPermission) => Controller.connectStoredProfile(profileId, { requestPermission }),
```

Run:

```bash
node --check dev/js/file-nally.js
npm run build
node tests/file-nally.e2e.cjs --grep 'permission gate|saved profile|bootstrap inspection'
```

Expected: 권한 관련 테스트 전체 PASS.

- [ ] **Step 6: 기존 프로필·교환·북마크 회귀를 확인한다**

Run:

```bash
node tests/file-nally.e2e.cjs --grep 'restored v2 profiles|folder swap|bookmark|saved profile|bootstrap inspection'
```

Expected: 저장 프로필, 폴더 교환, 북마크 관련 테스트 전체 PASS.

- [ ] **Step 7: Task 2를 커밋한다**

```bash
git add dev/js/file-nally.js file-nally.html tests/file-nally.e2e.cjs
git commit -m "Reconnect saved folders after permission approval"
```

---

### Task 3: 사용자 문서와 전체 릴리즈 검증

**Files:**
- Modify: `README.md:18-31`
- Modify: `README.md:143-160`
- Modify: `docs/README_en.md:18-31`
- Modify: `docs/README_en.md:139-156`
- Verify generated: `file-nally.html`
- Verify artifacts: `artifacts/visual/*.png` (gitignored)

**Interfaces:**
- Consumes: Task 2의 재연결 성공·이력 조회 전용 실패 UX.
- Produces: 사용자가 최근 폴더 기능의 권한 한계와 재선택 절차를 이해할 수 있는 한·영 문서 및 최종 검증 증거.

- [ ] **Step 1: 한국어 매뉴얼의 기능 설명과 문제 해결을 갱신한다**

`README.md`의 최근 폴더 기능 설명에 다음 의미를 반영한다.

```markdown
- 최근 폴더와 북마크는 저장된 디렉터리 핸들을 다시 사용합니다. 브라우저 권한이 만료된 경우 항목을 클릭하면 권한 재승인을 요청하며, 승인된 두 폴더만 비교할 수 있습니다.
```

“페이지를 다시 연 뒤 폴더에 접근할 수 없어요”에는 권한을 거부했거나 저장 핸들이 무효인 경우 원본과 대상 폴더를 다시 선택해야 한다고 명시한다.

- [ ] **Step 2: 영어 매뉴얼에 동일한 계약을 반영한다**

`docs/README_en.md`에 다음 의미를 추가한다.

```markdown
- Recent folders and bookmarks reuse stored directory handles. Selecting an item requests renewed permission when needed, and comparison is enabled only after both folders are granted read/write access.
```

Troubleshooting에는 denial 또는 stale handle이면 Source와 Target을 다시 선택해야 한다고 명시한다.

- [ ] **Step 3: 전체 정적·브라우저·시각 검증을 실행한다**

Run:

```bash
git diff --check
node --check dev/js/file-nally.js
node --check tests/file-nally.e2e.cjs
node --check tests/support/mock-file-system.cjs
npm run build
npm test
npm run test:visual
```

Expected:

- build pipeline PASS
- `file-nally.html is up to date`
- Chrome E2E 전체 PASS
- 375px, 768px, 1280px 캡처 생성
- 문서 수준 수평 overflow, 잘림, 권한 상태 문구의 비정상 줄바꿈 없음

- [ ] **Step 4: 실제 브라우저 사용자 흐름을 수동 검증한다**

Chrome 또는 Edge의 실제 File System Access API에서 다음을 관찰한다.

1. 폴더 쌍을 선택하고 최근 폴더 항목을 만든다.
2. origin의 파일 권한을 회수한다.
3. 페이지 로드만으로 권한 창이 뜨지 않는지 확인한다.
4. 최근 폴더 항목 클릭 시 권한 창이 뜨는지 확인한다.
5. 승인하면 비교가 활성화되는지 확인한다.
6. 거부하면 비교가 비활성화되고 폴더 재선택 안내가 표시되는지 확인한다.

- [ ] **Step 5: 문서와 최종 검증 상태를 커밋한다**

```bash
git add README.md docs/README_en.md
git commit -m "docs: explain saved-folder permission renewal"
```

- [ ] **Step 6: 이슈 #10의 구현 완료 댓글 자료를 준비한다**

댓글에는 다음 증거를 포함한다.

```markdown
- 사용자 클릭에서만 권한 재요청
- 양쪽 `granted`일 때만 연결 완료
- 거부·무효 핸들은 이력 조회 전용 및 폴더 재선택 안내
- 권한 상태별 E2E와 전체 테스트 결과
- 배포된 릴리즈 또는 커밋 링크
```
