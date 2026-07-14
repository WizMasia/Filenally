# File-nally Build Guide

[한국어](#한국어) · [English](#english)

## 한국어

### 원본과 결과물

브라우저에서 편집·실행하는 원본은 다음 세 파일뿐입니다.

- `dev/file-nally.html`
- `dev/css/file-nally.css`
- `dev/js/file-nally.js`

루트의 `file-nally.html`은 위 원본을 합친 배포 결과물입니다. 직접 수정하지 말고 항상 빌드 스크립트로 다시 생성하세요.

### 준비

Node.js와 프로젝트 의존성을 준비합니다.

```bash
npm install
```

### 개발 순서

1. `dev/` 아래의 세 원본 파일 중 필요한 파일만 수정합니다.
2. 개발 페이지 `dev/file-nally.html`을 로컬 HTTP 서버로 열어 확인합니다.
3. `npm run build`로 루트 `file-nally.html`을 생성합니다.
4. 빌드 검사와 기능·시각 테스트를 실행합니다.

### 빌드 명령

```bash
npm run build
npm run build:check
npm test
npm run test:visual
```

`build:check`는 파일을 쓰지 않고 루트 결과물이 원본과 일치하는지만 검사합니다. 오래된 결과물이라는 오류가 나오면 `npm run build`를 실행하세요.

### 오류 해결

- CSS 또는 JavaScript 빌드 표식 오류는 `dev/file-nally.html`의 대응 표식이 정확히 한 쌍인지 확인합니다.
- 안전하지 않은 닫는 태그 오류는 메시지에 표시된 `dev/css/file-nally.css` 또는 `dev/js/file-nally.js`의 `</style`·`</script` 문자열을 제거하거나 안전하게 재작성합니다.
- 루트 `file-nally.html`을 직접 수정해서 오류를 고치지 마세요. 다음 빌드에서 덮어씁니다.

### 릴리즈 체크리스트

- `npm run build` 실행
- `npm run build:check` 통과
- `npm test` 통과
- `npm run test:visual` 결과 검토
- 배포에는 루트 `file-nally.html`만 포함하고 `dev/` 폴더는 포함하지 않음

## English

### Sources and artifact

Only these three browser source files are editable:

- `dev/file-nally.html`
- `dev/css/file-nally.css`
- `dev/js/file-nally.js`

The root `file-nally.html` is the distributable artifact generated from those sources. Never edit it directly; regenerate it with the build script.

### Prerequisites

Install Node.js and the project dependencies:

```bash
npm install
```

### Development workflow

1. Edit only the required source files below `dev/`.
2. Serve `dev/file-nally.html` over local HTTP while developing.
3. Run `npm run build` to generate the root `file-nally.html`.
4. Run the freshness, functional, and visual checks.

### Build commands

```bash
npm run build
npm run build:check
npm test
npm run test:visual
```

`build:check` never writes files; it only verifies that the root artifact matches the sources. If it reports a stale artifact, run `npm run build`.

### Troubleshooting

- For CSS or JavaScript marker errors, ensure `dev/file-nally.html` contains exactly one matching marker pair.
- For unsafe closing-tag errors, remove or safely rewrite the reported `</style` or `</script` string in `dev/css/file-nally.css` or `dev/js/file-nally.js`.
- Do not repair the root `file-nally.html` directly because the next build will overwrite it.

### Release checklist

- Run `npm run build`.
- Pass `npm run build:check`.
- Pass `npm test`.
- Review the output from `npm run test:visual`.
- Distribute only the root `file-nally.html`, not the `dev/` directory.
