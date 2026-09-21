# 변경사항 비교 진단 — v0.15.2

특정 폴더에서 변경사항 비교가 실패할 때 오류 위치와 파일명 특성을 확인하는 진단 기능입니다. 파일명 특이점이 발견되어도 오류 원인으로 확정하지 않습니다.

1. 이 릴리즈의 `file-nally.html`을 Chrome 또는 Edge에서 엽니다.
2. 문제가 발생한 원본·대상 폴더와 기존 비교 설정을 선택합니다.
3. **변경사항 비교**를 실행합니다.
4. 오류가 나면 **실시간 로그**에 원본/대상, 단계, 작업, 상대 경로와 오류 이름이 표시됩니다.
5. **진단 JSON 다운로드**를 눌러 저장하고 분석에 사용합니다. 이 진단을 얻기 위해 동기화를 실행할 필요는 없습니다.

다시 비교하면 이전 진단이 초기화됩니다. 실패 시 다운로드 버튼이 활성화됩니다. 폴더 스캔은 양쪽이 끝난 뒤 결과를 수집하며 양쪽 모두 실패하면 각각의 첫 오류를 기록합니다. 폴더 목록을 열거하는 중 실패한 경우 개별 파일명을 알 수 없으므로 해당 폴더의 경로를 기록합니다.

## 기록 항목

- `side`: `source`(원본) / `target`(대상)
- `rootName`, `path`: 선택 폴더 이름과 그 아래 상대 경로. 선택 폴더 자체의 열거 실패는 빈 상대 경로입니다.
- `stage`: `scan`, `compare-content`, `rename-detection`, 또는 경로 정보가 없는 `planning`
- `operation`: `values`(폴더 열거), `validate-path`, `getFile`(파일 읽기), `arrayBuffer`(내용 읽기), `plan`
- 오류 이름·메시지·스택, 실행 시각, 브라우저·비교 설정
- 경로와 각 이름의 UTF-16 길이·UTF-8 바이트 수, Unicode 코드 포인트, NFC/NFD 정규화 차이, 제어/서식 문자, 끝 공백·점

한글 이름의 NFD/NFC 차이는 관찰 정보이며 그 자체로 잘못된 파일명이라는 의미가 아닙니다. 브라우저는 선택 폴더의 운영체제 절대 경로를 제공하지 않으므로 이 보고서로 전체 절대 경로 길이 제한을 판정할 수 없습니다.

파일 내용은 보고서에 포함하지 않습니다. 파일·폴더 이름과 오류 스택(앱을 연 위치가 포함될 수 있음)은 포함되므로 외부에 공유하기 전에 확인하세요. 보고서는 다운로드할 때 로컬 파일로 저장되며 자동 전송되지 않습니다.

## English

Open the release HTML, select the affected folders, and run **Compare changes**. On failure, use **Download diagnostic JSON** in the live log panel. Synchronization is not required. The report identifies the side, relative path, failing scan/content/rename-detection operation, error and browser information, and filename Unicode/length observations. Filename observations are not a root-cause verdict. File contents are excluded, but names and error stacks are included. A new comparison clears the previous diagnostic.

## 파일명 복구 안내 (이슈 #16)

비교가 실패하면 오류 메시지에 이름의 관찰 정보와 확인 방법을 추가합니다. Unicode나 `%` 문자가 있다는 이유로 정상 파일을 거부하지 않습니다.

- 이름 240 UTF-16 단위 이상: 긴 이름 후보로 표시합니다. **240은 안내용 기준이며 실제 파일시스템 제한이 아닙니다.**
- 상대 경로 260 UTF-16 단위 이상: 일부 Windows API의 전체 경로 제한 가능성을 표시합니다. 상위 절대 경로를 알 수 없으므로 더 짧은 상대 경로도 안전하다는 보장은 없습니다.
- `%HH` 형태: 완전한 UTF-8 퍼센트 인코딩이면 한 번 디코딩한 미리보기를 표시합니다. 잘못된 인코딩은 디코딩 불가로 표시합니다. 실제 파일명은 변경하거나 디코딩하여 조회하지 않습니다.
- Windows 제한 문자, 예약 장치 이름, 끝 공백·점: Windows에서 확인할 이름 제약으로 표시합니다. 현재 파일시스템에서의 실제 실패 원인을 확정하지 않습니다.

먼저 원본을 보존하고 같은 이름의 복사본을 더 짧은 상위 경로에서 비교해 전체 경로 길이 영향을 확인하세요. 이름을 바꿔야 한다면 복사본을 탐색기에서 짧고 유효한 이름으로 변경하고, 앱에서 폴더를 다시 선택한 후 비교하세요. **디코딩 미리보기는 추천 파일명이 아닙니다.** 미리보기에는 경로 구분자나 제어 문자가 포함될 수 있습니다.

오류가 발생하면 동기화 계획을 폐기합니다. 읽지 못한 파일을 삭제된 파일로 간주하거나 누락한 채 동기화하지 않습니다.

JSON에는 각 `segments` 항목의 `longName`, `percentEncoded`, `decodedPreview`, `windowsIssues`와 오류의 `pathLengthWarning`, `absolutePathKnown: false`가 추가됩니다. `decodedPreview: null`은 미리보기가 없다는 뜻입니다. 전체 경로 제한 판정이나 자동 파일명 복구 결과가 아닙니다.

참고: [Microsoft 이름 규칙](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file), [Windows 경로 길이 제한](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation).

### Filename recovery guidance (English)

Comparison errors now show advisory observations for long names (240 UTF-16 units), long relative paths (260 units), percent-encoding patterns and Windows naming restrictions. These are not confirmed causes or universal filesystem limits. The absolute path above the selected root is unavailable. Decoded previews are display-only and may contain unsafe filename characters; they are not rename suggestions. Malformed encodings are preserved. Try an unchanged-name copy under a shorter parent path, or manually give a copy a short valid name and reselect/recompare. Failed comparisons still discard the plan and block synchronization.


## Windows 실제 파일 재현 결과 (이슈 #18)

[이슈 #18](https://github.com/WizMasia/Filenally/issues/18)의 재발 오류를 합성 파일로 조사했습니다. 사용자 원본 경로와 개인정보는 재현 코드에 포함하지 않았습니다. `_D__` 접두부는 Windows에서 사용할 수 있으며, 최초 메시지의 `*D*` 표기는 실제 별표로 확정하지 않습니다.

Windows 10.0.26100 / Chrome 152.0.7977.83에서 `LongPathsEnabled=1`인 상태로 다음 결과를 얻었습니다. 길이는 UTF-16 단위입니다.

| 조건 | 절대 경로 길이 | Node 파일 읽기 | Chrome `getFile()` |
| --- | ---: | --- | --- |
| 짧은 이름, 불완전한 `%EC%` 포함 | 37 | 성공 | 성공 |
| 210단위 퍼센트 형태 이름, 짧은 상위 경로 | 231 | 성공 | 성공 |
| 같은 이름, 상대 경로 262단위 | 283 | 성공 | `NotFoundError` |
| 완전한 퍼센트 형태 이름, 상대 경로 262단위 | 283 | 성공 | `NotFoundError` |
| 일반 영문 이름, 상대 경로 262단위 | 283 | 성공 | `NotFoundError` |

이 실험은 경로 길이에 따른 실패를 재현합니다. 정확한 경계 길이, 모든 Windows/브라우저 버전 또는 사용자 원본 파일의 원인을 확정하는 시험은 아닙니다. 퍼센트 디코딩 실패는 진단 관찰이며, 해당 실험의 파일 접근 실패 원인이 아닙니다. 레지스트리 설정만 바꾸면 해결된다는 결론도 낼 수 없습니다.

재현 스크립트: `node tests/windows-path-probe.cjs` (Node 및 `npm ci`, 설치된 Chrome 필요). 실제 임시 디렉터리와 CDP 드롭 이벤트로 얻은 네이티브 핸들을 사용합니다. OPFS나 모의 파일 핸들이 아닙니다. 임시 합성 파일 및 Windows 임시 드라이브 연결을 만들고 종료 시 정리합니다. 결과는 `artifacts/issue-18/native-<platform>.json`에 저장합니다. 파일별 실패는 관찰값이므로 **CI 성공이 모든 파일 읽기 성공을 뜻하지 않습니다.**

[원래 경로 시험](https://github.com/WizMasia/Filenally/actions/runs/35563195979), [드라이브 별칭 시험](https://github.com/WizMasia/Filenally/actions/runs/35563397409)에서 원래 절대 경로 283단위의 세 파일은 실패했고, 파일명을 유지한 채 `subst`로 가까운 상위 폴더를 연결한 213단위 별칭 경로에서는 세 파일 모두 내용을 읽었습니다.

[하위 폴더 별칭 시험](https://github.com/WizMasia/Filenally/actions/runs/35563651473)에서도 드라이브 바로 아래 하위 폴더를 통한 231단위 경로로 세 파일 모두 읽었습니다. 이 시험 역시 폴더 선택 창 대신 드롭 이벤트로 핸들을 얻었습니다.

### 파일명을 유지하는 우회 후보

`subst`는 폴더를 드라이브 문자에 연결합니다. 실제 파일을 복사하거나 이름을 바꾸지 않습니다. 앱의 `showDirectoryPicker()`와 실제 동기화는 이 드롭 핸들 실험과 별도 검증이 필요합니다. 우선 **변경사항 비교만** 확인하세요.

1. 사용하지 않는 드라이브 문자를 확인합니다. 아래 `X:`는 예시입니다.
2. 명령 프롬프트에서 문제가 있는 폴더의 **바로 위 폴더**를 연결합니다. 경로는 실제 값으로 바꿉니다.

   ```bat
   subst X: "C:\실제\긴\상위폴더"
   ```

3. 앱에서 `X:\문서 작업`처럼 드라이브 아래 해당 하위 폴더를 새로 선택합니다. 상대 경로만 이미 262단위인 기존 최상위 폴더를 연결하면 충분히 짧아지지 않습니다. 필요한 경우 비교 범위를 하위 폴더로 좁히고 **대상도 정확히 대응하는 하위 폴더**를 선택하세요.
4. 비교 결과와 범위를 확인합니다. 별칭은 같은 실제 파일을 가리키므로 동기화를 실행하면 원본 위치에 반영됩니다. 이 시험은 쓰기·삭제·이름 변경 성공을 보장하지 않습니다.
5. 사용을 마친 뒤 연결을 해제합니다. 해제 후에는 해당 핸들을 다시 사용하지 말고 폴더를 새로 선택합니다.

   ```bat
   subst X: /D
   ```

명령 구문: [Microsoft `subst` 문서](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/subst). 웹 앱이 드라이브 연결 명령을 직접 실행하거나 불투명한 파일 핸들에 Windows 경로 접두부를 붙일 수는 없습니다. v0.15.2는 재현 결과와 우회 절차를 정리한 릴리즈이며 앱의 자동 복구 수정은 포함하지 않습니다. 사용자 요청에 따라 이슈 #18은 임시 종결합니다. 실제 사용자 환경 검증은 보류 상태이며 같은 문제가 발생하면 새 이슈에서 이어갑니다.
