# File-nally (Beta v0.7.0)

[한국어](#한국어) · [English](#english)

File-nally는 Chrome 또는 Edge에서 두 로컬 폴더를 비교하고 동기화하는 단일 HTML 애플리케이션입니다. 제품 코드는 [file-nally.html](file-nally.html) 하나에만 있으며, 서버·빌드·런타임 의존성이 없습니다.

## 한국어

### 주요 기능

- 양방향 또는 원본 → 대상 단방향 동기화
- 실행 전에 파일별 변경 계획 미리보기
- `최신 파일`, `원본 우선`, `건너뛰기`, `이름 변경 보존` 충돌 정책
- 삭제 감지 시 영구 삭제 대신 `.trash/<실행 시각>/...`으로 격리
- 폴더 쌍별 매니페스트·이력 관리와 JSON schema v2 백업/복원
- 실행 중 현재 파일 작업을 마친 뒤 안전하게 중단
- 한국어·영어 UI, 375px부터 지원하는 반응형 레이아웃

### 사용법

1. `file-nally.html`을 Chrome 또는 Edge에서 엽니다.
2. 원본 폴더와 대상 폴더를 선택하고 읽기·쓰기 권한을 허용합니다.
3. 방향, 충돌 정책, 제외할 하위 폴더명을 확인합니다.
4. **변경사항 비교**로 작업 대기열을 검토합니다.
5. **동기화 실행**을 누릅니다.

같은 폴더를 양쪽에 지정하거나 한 폴더 안에 다른 폴더를 지정하는 구성은 데이터 순환을 막기 위해 거부됩니다. `.trash`는 사용자가 제외 목록에서 지워도 항상 검사 대상에서 제외됩니다.

### 충돌 정책

- **최신 파일 유지:** 수정 시간이 더 최신인 파일을 반대편에 복사합니다. 시간이 같고 내용 크기가 다르면 자동 처리하지 않습니다.
- **원본 우선 덮어쓰기:** 양쪽이 모두 변경된 충돌에서 원본 파일을 선택합니다.
- **기존 파일 건너뛰기:** 반대편 경로가 이미 있으면 덮어쓰지 않습니다.
- **이름을 바꿔 두 버전 보존:** 양쪽 파일을 각각 `.conflict-source-*`, `.conflict-target-*` 이름으로 반대편에 복사합니다.

### JSON과 개인정보

설정, 폴더 쌍 프로필, 매니페스트, 실행 이력은 `smart_sync_state` 키의 JSON으로 브라우저에 저장됩니다. 디렉터리 핸들은 JSON에 포함하지 않고 IndexedDB에 별도로 보관합니다. 백업 JSON은 최대 5MB까지 가져올 수 있습니다. 복원된 프로필과 구버전 v0.6.1 전역 매니페스트는 폴더 쌍을 다시 확인하기 전까지 삭제 판단에 사용하지 않습니다.

중요한 파일은 실행 전에 별도로 백업하세요. 브라우저 권한 해제, 디스크 오류, 운영체제 제한까지 복구할 수 있는 백업 도구를 대체하지는 않습니다.

### 개발 및 검증

제품 실행에는 Node.js가 필요하지 않습니다. 아래 명령은 개발 회귀 테스트에만 사용합니다.

```bash
npm install
npm test
npm run test:visual
```

테스트는 실제 Chrome에서 메모리 기반 File System Access API를 사용해 JSON 마이그레이션, 폴더 쌍 검증, 충돌 정책, 복사, 버전 휴지통, 중단, 쓰기 실패, XSS 방어, 모바일 오버플로를 검증합니다. UI 설계 계약은 [DESIGN.md](DESIGN.md)에 있습니다.

## English

File-nally is a single-file Chrome/Edge application for comparing and synchronizing two local folders. Open `file-nally.html`, select the source and target, review the generated plan, then run synchronization.

It supports one-way and bidirectional operation, four explicit conflict policies, versioned `.trash/<run timestamp>/...` isolation, per-folder-pair manifests, JSON schema v2 backup/restore, safe stop between file operations, Korean/English UI, and responsive layouts. Same or nested folder pairs are rejected, and `.trash` is always excluded from scans.

Application state remains JSON in localStorage; non-serializable directory handles are stored separately in IndexedDB. Restored profiles and legacy v0.6.1 manifests are unverified and cannot trigger deletion until the folder pair is verified again. Back up important data independently before use.

Node.js and Playwright are development-only. Run `npm test` for functional regression coverage and `npm run test:visual` for responsive screenshots.

## License

MIT. See [LICENSE](LICENSE).
