# 변경사항 비교 진단 — v0.15.1-debug.1

특정 폴더에서 변경사항 비교가 실패할 때 오류 위치와 파일명 특성을 확인하는 진단 프리릴리즈입니다. 파일명 특이점이 발견되어도 오류 원인으로 확정하지 않습니다.

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

Open the prerelease HTML, select the affected folders, and run **Compare changes**. On failure, use **Download diagnostic JSON** in the live log panel. Synchronization is not required. The report identifies the side, relative path, failing scan/content/rename-detection operation, error and browser information, and filename Unicode/length observations. Filename observations are not a root-cause verdict. File contents are excluded, but names and error stacks are included. A new comparison clears the previous diagnostic.
