# Saved Folder Permission Renewal Design

## Goal

최근 폴더나 북마크를 사용자가 클릭했을 때 저장된 두 디렉터리 핸들의 현재 읽기·쓰기 권한을 확인하고, 필요한 경우 브라우저 권한 재승인을 요청한다. 두 핸들이 모두 `granted`인 경우에만 폴더 쌍을 연결 완료 상태로 전환한다.

## Approved Direction

이 기능은 사용자 동작 없이 권한 창을 띄우지 않는다. 페이지 초기화는 `queryPermission({ mode: 'readwrite' })`만 수행하며, `requestPermission()`은 최근 폴더 또는 북마크 버튼의 클릭 흐름에서만 호출한다. 이는 transient user activation이 필요하다는 File System Access 보안 모델을 따른다.

재승인이 성공하면 저장된 폴더 쌍을 다시 연결한다. 권한이 거부되거나 핸들이 유효하지 않으면 해당 프로필은 이력 조회 전용 상태로 남기고, 사용자가 원본과 대상 폴더를 다시 선택해야 한다는 다음 행동을 상태 배너와 로그에 표시한다.

참고:

- https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission
- https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#stored-file-or-directory-handles-and-permissions
- https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api

## Permission Model

`PermissionGate`는 브라우저 권한 API 호출과 상태 정규화만 담당하고 애플리케이션 모델을 변경하지 않는다.

```js
PermissionGate.inspect(record)
PermissionGate.request(record)
```

두 함수는 다음 결과를 반환한다.

```js
{
    state: 'granted' | 'prompt' | 'denied' | 'unavailable',
    source: 'granted' | 'prompt' | 'denied' | 'unavailable',
    target: 'granted' | 'prompt' | 'denied' | 'unavailable',
    error: '',
}
```

`inspect()`는 `queryPermission()`만 호출한다. `request()`는 먼저 두 상태를 조회하고, `prompt`인 핸들에만 `requestPermission()`을 호출한 뒤 양쪽을 다시 조회한다. Chrome의 영구 권한 프롬프트는 한 핸들의 요청으로 같은 origin의 저장 핸들을 함께 승인할 수 있으므로 첫 요청 뒤 반드시 양쪽 상태를 다시 확인한다. 두 번째 핸들이 여전히 `prompt`이면 같은 클릭 흐름에서 한 번 더 요청하되, `SecurityError`를 포함한 예외는 `unavailable`로 정규화한다.

## State Transitions

| 진입점 | 권한 결과 | 애플리케이션 상태 |
|---|---|---|
| 페이지 초기화 | 양쪽 `granted` | 저장된 핸들 연결, `ready`, 비교 활성화 |
| 페이지 초기화 | `prompt`, `denied`, 오류 | 권한 요청 없음, 이력 조회 전용, `idle`, 비교 비활성화 |
| 최근/북마크 클릭 | 양쪽 `granted` | 요청 없이 즉시 연결 |
| 최근/북마크 클릭 | `prompt` 후 양쪽 `granted` | 재승인 완료 후 연결 |
| 최근/북마크 클릭 | `denied`, 재요청 거부, 오류 | 이력 조회 전용, 핸들 연결 해제, 재선택 안내 |
| 저장 레코드 없음 | 해당 없음 | 이력 조회 전용, 저장 핸들을 찾을 수 없다는 안내 |

연결을 시도하는 즉시 기존 실행 계획과 기존 live handle 연결을 제거한다. 이렇게 하면 사용자가 다른 저장 프로필을 클릭했는데 이전 폴더 쌍이 계속 활성화되는 혼동을 방지한다. 선택한 프로필의 요약 이력은 계속 표시하지만 `trustedProfile`은 `false`이고 원본·대상 경로는 선택되지 않은 상태로 표시한다.

## Controller Boundary

`Controller.connectStoredProfile(profileId, { requestPermission })`가 다음 순서를 소유한다.

1. 프로필과 `HandleStore` 레코드를 찾는다.
2. 선택한 프로필을 이력 조회 전용 상태로 먼저 전환한다.
3. `requestPermission: true`이면 `PermissionGate.request()`, 아니면 `PermissionGate.inspect()`를 호출한다.
4. 결과가 `granted`일 때만 `model.source`, `model.target`, `model.trustedProfile`을 커밋하고 `ready`로 전환한다.
5. 그 외에는 `idle`을 유지하고 원인 및 폴더 재선택 안내를 표시한다.

최근 폴더와 북마크 버튼은 `Controller.selectProfile(profileId)`를 호출하며 이 공개 동작은 내부적으로 `requestPermission: true`를 사용한다. `initialize()`는 동일한 연결 함수에 `requestPermission: false`를 전달한다. 따라서 초기 로딩과 클릭 재연결이 하나의 상태 전이 구현을 공유하면서도 자동 권한 요청은 구조적으로 차단된다.

## User Experience

권한 확인 중에는 최근 폴더와 북마크 칩을 잠시 비활성화하고 상태 배너에 “저장된 폴더 권한을 확인하는 중”을 표시한다. 결과 메시지는 한국어와 영어를 모두 제공한다.

- 성공: 권한이 확인되어 비교 가능함
- 거부: 권한이 승인되지 않았으며 원본과 대상 폴더를 다시 선택해야 함
- 무효 핸들/보안 오류: 저장된 폴더에 접근할 수 없으며 폴더를 다시 선택해야 함
- 저장 레코드 없음: 브라우저 저장소에서 폴더 연결을 찾지 못했으며 폴더를 다시 선택해야 함

권한 거부 시 최근/북마크 항목 자체는 삭제하지 않는다. 사용자는 과거 동기화 이력과 상세 로그를 계속 조회할 수 있다.

## Test Strategy

모의 디렉터리 핸들은 조회 상태, 요청 결과, 조회/요청 예외, 호출 횟수를 독립적으로 제어해야 한다. 테스트는 다음 경계를 고정한다.

1. `granted/granted`: 요청 없이 연결된다.
2. `prompt/granted`와 `prompt/prompt`: 사용자 클릭이 요청을 발생시키고 승인 뒤 연결된다.
3. `prompt → denied`와 초기 `denied`: 연결하지 않고 재선택 안내를 표시한다.
4. `queryPermission()` 또는 `requestPermission()` 예외: 연결하지 않고 안전한 오류 상태가 된다.
5. 초기화 경로의 `prompt`: 요청 호출 횟수가 0이며 비교가 비활성화된다.
6. 권한 실패 후에도 선택 프로필의 기존 이력은 표시된다.
7. 전체 빌드, Chrome E2E, 375/768/1280px 시각 검증이 통과한다.

## Non-Goals

- 페이지 로드 중 자동 권한 프롬프트를 띄우지 않는다.
- 브라우저의 권한 결정을 우회하거나 영구 권한을 보장하지 않는다.
- 거부된 저장 프로필이나 과거 이력을 자동 삭제하지 않는다.
- 두 폴더를 임의의 다른 경로로 자동 대체하지 않는다.
