(() => {
    'use strict';

    const STORAGE_KEY = 'smart_sync_state';
    const SHOW_CHANGED_ONLY_KEY = 'file_nally_show_changed_only';
    const STATE_VERSION = 2;
    const VERSION_INDEX_SCHEMA = 1;
    const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
    const MAX_VERSION_RECORDS = 100000;
    const MAX_PROFILES = 100;
    const MAX_MANIFEST_ENTRIES = 100000;
    const MAX_PROFILE_HISTORY = 30;
    const MAX_GLOBAL_HISTORY = 100;
    const RUN_LOG_PAGE_SIZE = 100;
    const CONTENT_CHUNK_BYTES = 4 * 1024 * 1024;
    const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const RESERVED_EXCLUDES = ['.trash', '.filenally'];
    const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'temp', ...RESERVED_EXCLUDES];

    const MAX_BOOKMARKS = 20;
    const MAX_RECENT_FOLDERS = 5;

    const TEXT = {
        ko: {
            versionsTitle: '버전 관리', versionsDescription: '현재 연결된 두 폴더의 캡처본입니다. 복원은 버전을 보관한 폴더의 원래 경로에 적용됩니다.', owningRoot: '보관 폴더', capturedAt: '캡처 시각', versionReason: '보관 이유', beforeOverwrite: '덮어쓰기 전', beforeRestore: '복원 전', versionDownload: '다운로드', versionRestore: '복원', versionCompare: '비교', versionRefresh: '새로고침', versionsEmpty: '보관된 버전이 없습니다.', versionsLoading: '버전을 읽는 중입니다.', versionFailed: '버전 작업 실패: {message}', restoreTitle: '버전 복원 확인', restoreDescription: '선택한 버전과 현재 파일을 확인한 뒤 복원을 실행하세요.', selectedVersion: '선택한 버전', currentFile: '현재 파일', restoreReplace: '현재 파일을 새 버전으로 먼저 보관한 뒤 선택한 버전으로 교체합니다.', restoreCreate: '현재 파일이 없습니다. 원래 경로에 새 파일을 만듭니다.', cancelRestore: '취소', confirmRestore: '이 버전 복원', restoreWriting: '복원 중입니다. 파일 쓰기가 끝날 때까지 기다려 주세요.', restoreDone: '복원이 완료되었습니다. 동기화 전에 변경사항을 다시 비교하세요.', restoreFailed: '복원 실패: {message}. 버전을 다시 선택하여 확인해 주세요.', retainedBackup: '보관된 백업: {id} · .filenally/{path}', versionDirection: '다음 동기화: {direction}. 수동 복원은 표시된 보관 폴더에만 적용됩니다.',
            comparisonTitle: '버전 비교', comparisonDescription: '선택한 버전을 왼쪽에 두고 읽기 전용으로 비교합니다. 동기화 방향은 변경되지 않습니다.', comparisonTarget: '오른쪽 비교 대상', comparisonLeft: '왼쪽', comparisonRight: '오른쪽', comparisonChoose: '비교 대상을 선택하세요', comparisonRun: '비교', comparisonAgain: '다시 비교', comparisonStop: '비교 중지', comparisonStopping: '비교 중지 중…', comparisonStopped: '비교를 중지했습니다.', comparisonReady: '대상을 확인한 뒤 비교를 실행하세요.', comparisonLoading: '비교 대상을 읽는 중…', comparisonWorking: '비교 중: {stage} ({done}/{total})', comparisonBytes: '바이트', comparisonText: '텍스트', comparisonHash: '지문', comparisonFailed: '비교 실패: {message}', comparisonIdentical: '바이트가 같습니다.', comparisonDifferent: '바이트가 다릅니다.', comparisonMissing: '현재 파일이 없어 비교하지 않았습니다.', comparisonLineEqual: '줄 내용은 같습니다. BOM·줄바꿈 형식 또는 위치가 다릅니다.', comparisonCounts: '왼쪽 → 오른쪽: 추가 {added}줄, 삭제 {removed}줄', comparisonSnapshot: '각 읽기 시점의 스냅샷입니다. 외부 변경을 원자적으로 잠그지 않으며 같은 크기·수정 시각의 후속 변경은 감지되지 않을 수 있습니다.', comparisonReadAt: '읽은 시각', comparisonType: 'MIME 유형', comparisonPresence: '파일 상태', comparisonPresent: '있음', comparisonAbsent: '없음', comparisonUnavailable: '정보 없음', comparisonFormat: 'BOM: {bom} · CRLF {crlf} · LF {lf} · CR {cr} · 마지막 줄바꿈: {final}', comparisonYes: '있음', comparisonNo: '없음', comparisonSize: '텍스트 크기 한도(파일당 512 KiB)를 초과했습니다.', comparisonEncoding: '유효한 UTF-8 텍스트가 아닙니다.', comparisonControl: '텍스트로 표시하지 않는 제어 문자가 있습니다.', comparisonLineCount: '파일당 5,000줄 한도를 초과했습니다.', comparisonLineLength: '한 줄 8,192 UTF-16 코드 단위 한도를 초과했습니다.', comparisonWorkLimit: '줄 차이 계산 한도(2,000,000셀)를 초과했습니다.', comparisonHashLarge: 'SHA-256 미계산: 파일당 16 MiB 한도 초과', comparisonHashUnavailable: 'SHA-256 미계산: Web Crypto를 사용할 수 없습니다.', comparisonHashMissing: 'SHA-256 미계산: 파일 없음', comparisonLegend: '왼쪽 줄 / 오른쪽 줄 · − 삭제 · + 추가 · = 문맥', comparisonGap: '문맥 {count}줄 생략: 왼쪽 {left}, 오른쪽 {right}',
            desc: '두 로컬 폴더를 비교한 뒤 변경 계획을 검토하고 안전하게 동기화합니다.', controlTitle: '동기화 제어', selectSource: '원본 폴더 선택', selectTarget: '대상 폴더 선택', notSelected: '선택되지 않음', languageLabel: '언어', progressLabel: '작업 진행률', workspaceLabel: '폴더 비교 결과', activityLabel: '동기화 기록',
            profileNone: '선택된 동기화 프로필이 없습니다.', profileUnverified: '폴더 쌍 미확인', profileVerified: '폴더 쌍 확인됨', profileLabel: '{source} ⇄ {target}',
            directionLabel: '동기화 방향', directionBoth: '양방향 (원본 ⇄ 대상)', directionOne: '단방향 (원본 → 대상)', directionReverse: '역방향 (대상 → 원본)', policyLabel: '충돌 해결 정책', policyLatest: '최신 파일 유지', policySource: '원본 우선 덮어쓰기', policySkip: '기존 파일 건너뛰기', policyRename: '이름을 바꿔 두 버전 보존', comparisonLabel: '비교 모드', comparisonQuick: '빠른 비교 (크기 + 수정 시각, 기본값)', comparisonExact: '정확 비교 (바이트 단위, 느림)', excludeLabel: '제외할 하위 폴더명',
            defaultJson: '기본 JSON', exportJson: 'JSON 백업', importJson: 'JSON 복원', compare: '변경사항 비교', sync: '동기화 실행', abort: '안전하게 중지', waiting: '폴더를 선택해 주세요.', preparing: '준비 중',
            sourceTitle: '원본 폴더', targetTitle: '대상 폴더', showChangedOnly: '변경된 항목만 보기', pathHead: '항목명과 경로', sizeHead: '크기', dateHead: '수정일', stateHead: '상태', logTitle: '실시간 로그', idle: '대기', historyTitle: '동기화 이력', clearHistory: '이력 초기화', timeHead: '실행 시간', directionHead: '방향', processedHead: '처리',
            disclaimer: '중요한 데이터는 동기화 전에 별도로 백업하세요. 브라우저와 운영체제의 파일 권한 또는 예기치 않은 중단으로 인한 손실 가능성이 있습니다.',
            emptyFiles: '표시할 항목이 없습니다.', emptyChangedFiles: '변경된 항목이 없습니다.', emptyHistory: '기록된 동기화 이력이 없습니다.', selected: '{name} 선택됨', pairReady: '폴더 쌍이 확인되었습니다. 변경사항을 비교할 수 있습니다.', sameFolder: '같은 폴더를 원본과 대상으로 사용할 수 없습니다.', nestedFolder: '한 폴더가 다른 폴더 안에 있습니다. 중첩 폴더는 동기화할 수 없습니다.', pickCancelled: '폴더 선택이 취소되었습니다.', pickFailed: '폴더를 선택하지 못했습니다: {message}',
            comparing: '폴더를 검사하고 변경 계획을 계산하는 중입니다.', compareStopping: '현재 파일 비교를 마친 뒤 중지합니다.', compareStopped: '파일 비교가 중지되었습니다.', compareDone: '비교 완료 · 실행할 작업 {count}건', compareNone: '비교 완료 · 실행할 변경사항이 없습니다.', compareFailed: '비교 중 오류가 발생했습니다: {message}',
            syncing: '동기화 실행 중 · {current}/{total}', syncDone: '동기화 완료 · {count}건 처리', syncAborted: '동기화가 안전하게 중단되었습니다. {count}건 처리됨', syncFailed: '동기화 중 오류가 발생했습니다: {message}', aborting: '현재 파일 작업을 마친 뒤 중단합니다.',
            importDone: 'JSON 데이터를 복원했습니다.', importFailed: 'JSON을 복원하지 못했습니다: {message}', exportDone: 'JSON 백업을 생성했습니다.', defaultDone: '기본 JSON을 생성했습니다.', historyCleared: '동기화 이력을 초기화했습니다.', confirmClear: '현재 프로필과 전체 동기화 이력을 초기화할까요?',
            statusUnchanged: '변경 없음', statusBaseline: '기준 저장', statusCopyOut: '보내기', statusCopyIn: '받기', statusTrash: '휴지통 이동', statusCreateDirectory: '폴더 생성', statusBaselineDirectory: '폴더 기준 저장', statusTrashDirectory: '폴더 휴지통 이동', statusConflict: '충돌 · 확인 필요', statusSkipped: '정책에 따라 건너뜀', statusProtected: '단방향 보호', statusNew: '신규', statusRename: '이름 변경',
            phaseReady: '준비', phaseComparing: '비교', phasePlanned: '계획됨', phaseSyncing: '실행', phaseSuccess: '완료', phaseError: '오류', phaseAborted: '중단', directionBothShort: '양방향', directionOneShort: '단방향', directionReverseShort: '역방향', success: '성공', failed: '실패', aborted: '중단',
            bookmarkAdded: '북마크가 추가되었습니다.', bookmarkRemoved: '북마크가 해제되었습니다.', swapFolders: '원본과 대상 폴더 교환', foldersSwapped: '원본과 대상 폴더를 교환했습니다.', advancedOptions: '동기화 옵션', showOptions: '옵션 보기', hideOptions: '옵션 숨기기',
            permissionChecking: '저장된 폴더 권한을 확인하는 중입니다.', permissionRestored: '폴더 권한이 확인되었습니다. 변경사항을 비교할 수 있습니다.', permissionDenied: '폴더 권한이 승인되지 않았습니다. 원본과 대상 폴더를 다시 선택해 주세요.', permissionNeedsAction: '저장된 폴더를 사용하려면 최근 폴더 또는 북마크를 눌러 권한을 승인해 주세요.', storedHandleMissing: '저장된 폴더 연결을 찾을 수 없습니다. 원본과 대상 폴더를 다시 선택해 주세요.', storedHandleUnavailable: '저장된 폴더에 접근할 수 없습니다. 원본과 대상 폴더를 다시 선택해 주세요.',
            quickGuideButton: '사용 안내', quickGuideTitle: '사용 안내', quickGuideDescription: '비교부터 동기화까지, 안전한 기본 흐름을 확인하세요.', quickGuideStepFolders: '원본 폴더와 대상 폴더를 선택합니다.', quickGuideStepOptions: '동기화 방향, 충돌 정책, 비교 모드를 확인합니다.', quickGuideStepCompare: '변경사항 비교를 실행합니다.', quickGuideStepPlan: '생성된 작업 계획과 충돌 항목을 검토합니다.', quickGuideStepSync: '계획을 확인한 뒤 동기화를 실행합니다.', quickGuidePermission: '저장된 폴더는 권한 재승인이 필요할 수 있습니다. 승인할 수 없으면 원본과 대상 폴더를 다시 선택하세요.', quickGuideSafety: '중요한 데이터는 먼저 백업하세요. `.trash` 복구는 수동이며 자동 롤백이 아닙니다.',
            detailsHead: '상세', details: '상세 보기', runDetailTitle: '실행 상세', runDetailDescription: '실행 중 처리한 모든 작업과 결과입니다.', close: '닫기', loadingDetails: '상세 기록을 불러오는 중입니다.', detailsUnavailable: '상세 기록을 찾을 수 없습니다.', durationHead: '소요 시간', sequenceHead: '순서', actionHead: '작업', versionIdHead: '버전 ID', versionPathHead: '버전 경로', errorHead: '오류', previousPage: '이전', nextPage: '다음', downloadCsv: 'CSV 다운로드', downloadRunJson: 'JSON 다운로드', entrySuccess: '성공', entryFailed: '실패', entryNotRun: '미실행', actionCopy: '복사', actionRename: '이름 변경', actionTrash: '휴지통 이동', actionBaseline: '기준 저장', actionCreateDirectory: '폴더 생성', actionBaselineDirectory: '폴더 기준 저장', actionTrashDirectory: '폴더 휴지통 이동', actionUnknown: '기타',
        },
        en: {
            versionsTitle: 'Version manager', versionsDescription: 'Captured files in both connected folders. Restore applies to the original path in the folder that stores the version.', owningRoot: 'Owning folder', capturedAt: 'Captured', versionReason: 'Reason', beforeOverwrite: 'Before overwrite', beforeRestore: 'Before restore', versionDownload: 'Download', versionRestore: 'Restore', versionCompare: 'Compare', versionRefresh: 'Refresh', versionsEmpty: 'No saved versions.', versionsLoading: 'Reading versions.', versionFailed: 'Version operation failed: {message}', restoreTitle: 'Confirm version restore', restoreDescription: 'Review the selected version and current file before restoring.', selectedVersion: 'Selected version', currentFile: 'Current file', restoreReplace: 'Save the current file as a new version first, then replace it with the selected version.', restoreCreate: 'The current file is missing. Create a new file at the original path.', cancelRestore: 'Cancel', confirmRestore: 'Restore this version', restoreWriting: 'Restoring. Please wait until the file write finishes.', restoreDone: 'Restore complete. Compare changes again before synchronizing.', restoreFailed: 'Restore failed: {message}. Select the version again for a fresh confirmation.', retainedBackup: 'Retained backup: {id} · .filenally/{path}', versionDirection: 'Next synchronization: {direction}. Manual restore affects only the displayed owning folder.',
            comparisonTitle: 'Version comparison', comparisonDescription: 'Read-only comparison with the selected version on the left. Sync direction is unchanged.', comparisonTarget: 'Right-hand counterpart', comparisonLeft: 'Left', comparisonRight: 'Right', comparisonChoose: 'Choose a counterpart', comparisonRun: 'Compare', comparisonAgain: 'Compare again', comparisonStop: 'Stop comparison', comparisonStopping: 'Stopping comparison…', comparisonStopped: 'Comparison stopped.', comparisonReady: 'Check the counterpart, then start comparison.', comparisonLoading: 'Reading comparison choices…', comparisonWorking: 'Comparing: {stage} ({done}/{total})', comparisonBytes: 'Bytes', comparisonText: 'Text', comparisonHash: 'Fingerprints', comparisonFailed: 'Comparison failed: {message}', comparisonIdentical: 'Bytes are identical.', comparisonDifferent: 'Bytes are different.', comparisonMissing: 'Current file is missing; not compared.', comparisonLineEqual: 'Line content is equal; BOM or line-ending format/positions differ.', comparisonCounts: 'Left → right: {added} added, {removed} removed', comparisonSnapshot: 'Snapshots at their read times, not an atomic lock. Later edits retaining size and mtime may be undetected.', comparisonReadAt: 'Read time', comparisonType: 'MIME type', comparisonPresence: 'File presence', comparisonPresent: 'Present', comparisonAbsent: 'Missing', comparisonUnavailable: 'Unavailable', comparisonFormat: 'BOM: {bom} · CRLF {crlf} · LF {lf} · CR {cr} · Final newline: {final}', comparisonYes: 'Yes', comparisonNo: 'No', comparisonSize: 'Text exceeds the 512 KiB per-file limit.', comparisonEncoding: 'Not valid UTF-8 text.', comparisonControl: 'Contains control characters not displayed as text.', comparisonLineCount: 'Exceeds 5,000 lines per file.', comparisonLineLength: 'Exceeds 8,192 UTF-16 code units per line.', comparisonWorkLimit: 'Exceeds the 2,000,000-cell line-diff limit.', comparisonHashLarge: 'SHA-256 not computed: exceeds 16 MiB per file', comparisonHashUnavailable: 'SHA-256 not computed: Web Crypto unavailable.', comparisonHashMissing: 'SHA-256 not computed: file missing', comparisonLegend: 'Left line / right line · − removed · + added · = context', comparisonGap: '{count} context lines omitted: left {left}, right {right}',
            desc: 'Compare two local folders, review the change plan, and synchronize them safely.', controlTitle: 'Synchronization controls', selectSource: 'Select source folder', selectTarget: 'Select target folder', notSelected: 'Not selected', languageLabel: 'Language', progressLabel: 'Operation progress', workspaceLabel: 'Folder comparison results', activityLabel: 'Synchronization activity',
            profileNone: 'No synchronization profile is selected.', profileUnverified: 'Folder pair unverified', profileVerified: 'Folder pair verified', profileLabel: '{source} ⇄ {target}',
            directionLabel: 'Synchronization direction', directionBoth: 'Bidirectional (Source ⇄ Target)', directionOne: 'One-way (Source → Target)', directionReverse: 'Reverse (Target → Source)', policyLabel: 'Conflict policy', policyLatest: 'Keep the latest file', policySource: 'Source wins conflicts', policySkip: 'Skip existing files', policyRename: 'Rename and preserve both versions', comparisonLabel: 'Comparison mode', comparisonQuick: 'Quick comparison (size + modified time, default)', comparisonExact: 'Exact comparison (byte-by-byte, slower)', excludeLabel: 'Excluded directory names',
            defaultJson: 'Default JSON', exportJson: 'Back up JSON', importJson: 'Restore JSON', compare: 'Compare changes', sync: 'Run synchronization', abort: 'Stop safely', waiting: 'Select both folders to begin.', preparing: 'Preparing',
            sourceTitle: 'Source folder', targetTitle: 'Target folder', showChangedOnly: 'Show changed items only', pathHead: 'Item and path', sizeHead: 'Size', dateHead: 'Modified', stateHead: 'Status', logTitle: 'Live log', idle: 'Idle', historyTitle: 'Synchronization history', clearHistory: 'Clear history', timeHead: 'Run time', directionHead: 'Direction', processedHead: 'Processed',
            disclaimer: 'Back up important data before synchronization. Browser or operating-system permissions and unexpected interruption can still cause data loss.',
            emptyFiles: 'No items to display.', emptyChangedFiles: 'No changed items to display.', emptyHistory: 'No synchronization history recorded.', selected: '{name} selected', pairReady: 'Folder pair verified. You can compare changes now.', sameFolder: 'The same folder cannot be both source and target.', nestedFolder: 'One selected folder is inside the other. Nested pairs are not supported.', pickCancelled: 'Folder selection was cancelled.', pickFailed: 'Could not select the folder: {message}',
            comparing: 'Scanning folders and calculating the change plan.', compareStopping: 'Stopping after the current content chunk.', compareStopped: 'File comparison stopped.', compareDone: 'Compare Complete · {count} queued actions', compareNone: 'Compare Complete · no changes to apply', compareFailed: 'Comparison failed: {message}',
            syncing: 'Synchronizing · {current}/{total}', syncDone: 'Synchronization Complete · {count} actions processed', syncAborted: 'Synchronization stopped safely after {count} actions', syncFailed: 'Synchronization failed: {message}', aborting: 'Stopping after the current file operation finishes.',
            importDone: 'JSON data restored.', importFailed: 'Could not restore JSON: {message}', exportDone: 'JSON backup created.', defaultDone: 'Default JSON created.', historyCleared: 'Synchronization history cleared.', confirmClear: 'Clear the active profile and global synchronization history?',
            statusUnchanged: 'No change', statusBaseline: 'Save baseline', statusCopyOut: 'Send', statusCopyIn: 'Receive', statusTrash: 'Move to trash', statusCreateDirectory: 'Create folder', statusBaselineDirectory: 'Save folder baseline', statusTrashDirectory: 'Move folder to trash', statusConflict: 'Conflict · review', statusSkipped: 'Skipped by policy', statusProtected: 'Protected by one-way mode', statusNew: 'New', statusRename: 'Rename',
            phaseReady: 'Ready', phaseComparing: 'Comparing', phasePlanned: 'Planned', phaseSyncing: 'Running', phaseSuccess: 'Complete', phaseError: 'Error', phaseAborted: 'Stopped', directionBothShort: 'Bidirectional', directionOneShort: 'One-way', directionReverseShort: 'Reverse', success: 'Success', failed: 'Failed', aborted: 'Stopped',
            bookmarkAdded: 'Bookmark added.', bookmarkRemoved: 'Bookmark removed.', swapFolders: 'Swap source and target folders', foldersSwapped: 'Source and target folders swapped.', advancedOptions: 'Synchronization options', showOptions: 'Show options', hideOptions: 'Hide options',
            permissionChecking: 'Checking access to the saved folders.', permissionRestored: 'Folder access verified. You can compare changes now.', permissionDenied: 'Folder access was not granted. Select the source and target folders again.', permissionNeedsAction: 'Select the recent folder or bookmark to approve access before reconnecting.', storedHandleMissing: 'The saved folder connection is unavailable. Select the source and target folders again.', storedHandleUnavailable: 'The saved folders cannot be accessed. Select the source and target folders again.',
            quickGuideButton: 'Quick guide', quickGuideTitle: 'Quick guide', quickGuideDescription: 'Follow the safe path from comparison to synchronization.', quickGuideStepFolders: 'Select the source and target folders.', quickGuideStepOptions: 'Check the synchronization direction, conflict policy, and comparison mode.', quickGuideStepCompare: 'Compare the changes.', quickGuideStepPlan: 'Review the generated work plan and any conflicts.', quickGuideStepSync: 'Run synchronization only after reviewing the plan.', quickGuidePermission: 'Saved folders may require you to renew permission. If access cannot be renewed, select the source and target folders again.', quickGuideSafety: 'Create a backup of important data first. `.trash` recovery is manual and is not an automatic rollback.',
            detailsHead: 'Details', details: 'View details', runDetailTitle: 'Run details', runDetailDescription: 'Every action processed during this synchronization run.', close: 'Close', loadingDetails: 'Loading run details.', detailsUnavailable: 'Run details are unavailable.', durationHead: 'Duration', sequenceHead: 'Sequence', actionHead: 'Action', versionIdHead: 'Version ID', versionPathHead: 'Version path', errorHead: 'Error', previousPage: 'Previous', nextPage: 'Next', downloadCsv: 'Download CSV', downloadRunJson: 'Download JSON', entrySuccess: 'Success', entryFailed: 'Failed', entryNotRun: 'Not run', actionCopy: 'Copy', actionRename: 'Rename', actionTrash: 'Move to trash', actionBaseline: 'Save baseline', actionCreateDirectory: 'Create folder', actionBaselineDirectory: 'Save folder baseline', actionTrashDirectory: 'Move folder to trash', actionUnknown: 'Other',
        },
    };

    const $ = (selector) => document.querySelector(selector);
    const uid = () => globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const nowIso = () => new Date().toISOString();
    const runStamp = () => new Date().toISOString().replace(/[-:TZ]/g, '').replace('.', '-');
    const cloneJson = (value) => JSON.parse(JSON.stringify(value));
    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const normalizeExcludes = (value) => {
        const values = Array.isArray(value) ? value : String(value || '').split(',');
        const normalized = values.map((item) => String(item).trim()).filter((item) => item && !RESERVED_EXCLUDES.includes(item));
        return [...new Set(normalized)].slice(0, 100).concat(RESERVED_EXCLUDES);
    };
    const format = (template, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
    const safeMessage = (error) => error instanceof Error || error instanceof DOMException ? error.message : String(error || 'Unknown error');
    const safeSegments = (path) => {
        const parts = String(path).split('/');
        if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe relative path: ${path}`);
        return parts;
    };

    const rejectForbidden = (value, allowDirectoryPaths = false, seen = new Set(), location = []) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        // Only directory-manifest keys are filesystem paths; their values remain checked.
        const directoryPaths = allowDirectoryPaths && location.length === 3 && location[0] === 'profiles' && location[2] === 'directoryManifest';
        for (const key of Object.keys(value)) {
            if (!directoryPaths && FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden JSON key: ${key}`);
            rejectForbidden(value[key], allowDirectoryPaths, seen, [...location, key]);
        }
        seen.delete(value);
    };

    const comparisonCheck = (isCancelled) => {
        if (isCancelled()) throw new DOMException('Comparison stopped', 'AbortError');
    };
    const directoryFor = async (root, parts, create, check = () => {}) => {
        let directory = root;
        check();
        for (const part of parts) {
            directory = await directory.getDirectoryHandle(part, { create });
            check();
        }
        return directory;
    };
    const fileHandleFor = async (root, path, check = () => {}) => {
        const parts = safeSegments(path);
        const name = parts.pop();
        check();
        const directory = await directoryFor(root, parts, false, check);
        check();
        const handle = await directory.getFileHandle(name);
        check();
        return handle;
    };
    const equalFileBytes = async (sourceFile, targetFile, onProgress = () => {}, isCancelled = () => false) => {
        if (sourceFile.size !== targetFile.size) return false;
        const totalBytes = sourceFile.size * 2;
        if (!totalBytes) {
            await Promise.all([sourceFile.slice(0, 0).arrayBuffer(), targetFile.slice(0, 0).arrayBuffer()]);
            onProgress(0, 0);
            return true;
        }
        for (let offset = 0; offset < sourceFile.size; offset += CONTENT_CHUNK_BYTES) {
            if (isCancelled()) throw new DOMException('Comparison stopped', 'AbortError');
            const end = Math.min(offset + CONTENT_CHUNK_BYTES, sourceFile.size);
            const [sourceBuffer, targetBuffer] = await Promise.all([
                sourceFile.slice(offset, end).arrayBuffer(),
                targetFile.slice(offset, end).arrayBuffer(),
            ]);
            if (isCancelled()) throw new DOMException('Comparison stopped', 'AbortError');
            const sourceBytes = new Uint8Array(sourceBuffer);
            const targetBytes = new Uint8Array(targetBuffer);
            if (sourceBytes.length !== targetBytes.length) return false;
            for (let index = 0; index < sourceBytes.length; index += 1) if (sourceBytes[index] !== targetBytes[index]) return false;
            onProgress(end * 2, totalBytes);
        }
        return true;
    };

    const VersionStore = (() => {
        const preparedRestores = new WeakMap();
        const cleanupPreparations = new WeakMap();
        const recoveryPreparations = new WeakMap();
        let versionWriting = false;
        const emptyIndex = () => ({ schemaVersion: VERSION_INDEX_SCHEMA, versions: [] });
        const hasKeys = (value, keys) => Object.keys(value).length === keys.length
            && keys.every(key => Object.hasOwn(value, key));
        const validCompletedBytes = (value, count) => typeof value === 'string'
            && value.length <= 18 && /^(0|[1-9][0-9]*)$/.test(value)
            && BigInt(value) <= 100n * BigInt(Number.MAX_SAFE_INTEGER)
            && (count !== 0 || value === '0');
        const originalSegments = (path) => {
            const parts = safeSegments(path);
            if (parts.some((part) => RESERVED_EXCLUDES.includes(part.toLowerCase()) || /[\\\0]/.test(part))) {
                throw new Error(`Unsafe version original path: ${path}`);
            }
            return parts;
        };
        const cleanRecord = (value, strictSize = false) => {
            if (!isObject(value)
                || typeof value.id !== 'string' || !value.id
                || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))
                || typeof value.originalPath !== 'string'
                || typeof value.storedPath !== 'string'
                || !Number.isFinite(Number(value.size))
                || (strictSize && (!Number.isSafeInteger(value.size) || value.size < 0))
                || !Number.isFinite(Number(value.lastModified))
                || !['before-overwrite', 'before-restore'].includes(value.reason)
                || !['bidirectional', 'unidirectional', 'reverse'].includes(value.direction)
                || !['source', 'target'].includes(value.fromSide)
                || !['source', 'target'].includes(value.toSide)
                || (value.reason === 'before-overwrite' ? value.fromSide === value.toSide : value.fromSide !== value.toSide)) return null;
            if (safeSegments(value.id).length !== 1 || /[\\\0]/.test(value.id)) return null;
            const expectedStoredPath = ['versions', value.id, ...originalSegments(value.originalPath)].join('/');
            if (value.storedPath !== expectedStoredPath) return null;
            return {
                id: value.id,
                capturedAt: value.capturedAt,
                originalPath: value.originalPath,
                storedPath: expectedStoredPath,
                size: Number(value.size),
                type: typeof value.type === 'string' ? value.type : '',
                lastModified: Number(value.lastModified),
                reason: value.reason,
                runId: typeof value.runId === 'string' ? value.runId : '',
                direction: value.direction,
                fromSide: value.fromSide,
                toSide: value.toSide,
            };
        };
        const parseIndexText = (text) => {
            if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('Version index exceeds 5MB');
            const raw = JSON.parse(text);
            rejectForbidden(raw);
            if (!isObject(raw) || ![1, 2].includes(raw.schemaVersion) || !Array.isArray(raw.versions)) {
                throw new Error('Unsupported version index');
            }
            if (raw.schemaVersion === 2 && !Object.hasOwn(raw, 'cleanup')) {
                throw new Error('Unsupported version index');
            }
            if (raw.schemaVersion === 2 && !hasKeys(raw, ['schemaVersion', 'versions', 'cleanup'])) {
                throw new Error('Malformed version index');
            }
            if (raw.versions.length > MAX_VERSION_RECORDS) throw new Error('Version index has too many records');
            const versions = raw.versions.map((record) => cleanRecord(record, raw.schemaVersion === 2));
            if (versions.some((record) => !record)) throw new Error('Malformed version record');
            const versionIds = new Set(versions.map((record) => record.id));
            if (versionIds.size !== versions.length) throw new Error('Duplicate version IDs');
            if (raw.schemaVersion === 1) return { schemaVersion: 1, versions };
            if (raw.cleanup === null) return { schemaVersion: 2, versions, cleanup: null };
            const cleanup = raw.cleanup;
            if (!isObject(cleanup) || !hasKeys(cleanup,
                ['id', 'startedAt', 'remainingIds', 'completedCount', 'completedBytes'])
                || typeof cleanup.id !== 'string' || !cleanup.id
                || safeSegments(cleanup.id).length !== 1 || /[\\\0]/.test(cleanup.id)
                || typeof cleanup.startedAt !== 'string'
                || !Number.isFinite(Date.parse(cleanup.startedAt))
                || new Date(cleanup.startedAt).toISOString() !== cleanup.startedAt
                || !Array.isArray(cleanup.remainingIds) || !cleanup.remainingIds.length
                || cleanup.remainingIds.length > 100
                || new Set(cleanup.remainingIds).size !== cleanup.remainingIds.length
                || cleanup.remainingIds.some((id) => typeof id !== 'string' || !versionIds.has(id))
                || !Number.isInteger(cleanup.completedCount) || cleanup.completedCount < 0
                || cleanup.completedCount > 100
                || cleanup.completedCount + cleanup.remainingIds.length > 100
                || !validCompletedBytes(cleanup.completedBytes, cleanup.completedCount)) {
                throw new Error('Malformed version cleanup');
            }
            return { schemaVersion: 2, versions, cleanup: {
                id: cleanup.id,
                startedAt: cleanup.startedAt,
                remainingIds: [...cleanup.remainingIds],
                completedCount: cleanup.completedCount,
                completedBytes: cleanup.completedBytes,
            } };
        };
        const requireIdleIndex = (index) => {
            if (!index.cleanup) return;
            const error = new Error('Version cleanup requires recovery');
            error.code = 'VERSION_CLEANUP_PENDING';
            error.cleanup = Object.freeze({ ...index.cleanup,
                remainingIds: Object.freeze([...index.cleanup.remainingIds]) });
            throw error;
        };
        const getExistingFile = async (root, path, check = () => {}) => {
            check();
            try {
                const handle = await fileHandleFor(root, path, check);
                check();
                return handle;
            } catch (error) {
                check();
                if (error?.name === 'NotFoundError') return null;
                throw error;
            }
        };
        const readIndexSnapshot = async (root, check = () => {}) => {
            check();
            let versionRoot;
            try { versionRoot = await root.getDirectoryHandle('.filenally'); }
            catch (error) {
                check();
                if (error?.name === 'NotFoundError') {
                    return { root, versionRoot: null, indexHandle: null, indexFile: null,
                        text: null, index: emptyIndex() };
                }
                throw error;
            }
            check();
            const indexHandle = await getExistingFile(versionRoot, 'index.json', check);
            check();
            if (!indexHandle) return { root, versionRoot, indexHandle: null, indexFile: null,
                text: null, index: emptyIndex() };
            const indexFile = await indexHandle.getFile();
            check();
            if (indexFile.size > MAX_IMPORT_BYTES) throw new Error('Version index exceeds 5MB');
            const text = await indexFile.text();
            check();
            return { root, versionRoot, indexHandle, indexFile, text, index: parseIndexText(text) };
        };
        const sameSnapshotHandle = async (before, after, strict, check) => {
            check();
            if (Boolean(before) !== Boolean(after)) throw new Error('Version index changed');
            if (!before) return;
            if (strict && (typeof before.isSameEntry !== 'function'
                || typeof after.isSameEntry !== 'function')) throw new Error('Handle identity unavailable');
            if (typeof before.isSameEntry === 'function' && !await before.isSameEntry(after)) {
                throw new Error('Version index identity changed');
            }
            check();
        };
        const validateIndexSnapshot = async (snapshot, check = () => {}, strictIdentity = false) => {
            check();
            if (strictIdentity) await sameSnapshotHandle(snapshot.root, snapshot.root, true, check);
            const fresh = await readIndexSnapshot(snapshot.root, check);
            check();
            await sameSnapshotHandle(snapshot.versionRoot, fresh.versionRoot, strictIdentity, check);
            await sameSnapshotHandle(snapshot.indexHandle, fresh.indexHandle, strictIdentity, check);
            if (snapshot.text !== fresh.text) throw new Error('Version index changed');
            return fresh;
        };
        const writeFile = async (root, path, value, handle = null) => {
            if (!handle) {
                const parts = safeSegments(path);
                const name = parts.pop();
                const directory = await directoryFor(root, parts, true);
                handle = await directory.getFileHandle(name, { create: true });
            }
            const writable = await handle.createWritable();
            try {
                await writable.write(value);
                await writable.close();
            } catch (error) {
                try { await writable.abort?.(); } catch { /* Preserve the write failure. */ }
                throw error;
            }
        };
        const writeIndexSnapshot = async (snapshot, nextIndex) => {
            if (!snapshot.versionRoot) throw new Error('Version store is missing');
            const requestedText = JSON.stringify(nextIndex);
            const parsed = parseIndexText(requestedText);
            const text = parsed.schemaVersion === 1
                ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
            parseIndexText(text);
            const current = await validateIndexSnapshot(snapshot);
            let indexHandle = current.indexHandle;
            if (!indexHandle) {
                if (parsed.schemaVersion !== 1) throw new Error('Version index is missing');
                indexHandle = await current.versionRoot.getFileHandle('index.json', { create: true });
            }
            await writeFile(current.versionRoot, 'index.json', text, indexHandle);
            const fresh = await readIndexSnapshot(current.root);
            await sameSnapshotHandle(current.versionRoot, fresh.versionRoot, false, () => {});
            await sameSnapshotHandle(indexHandle, fresh.indexHandle, false, () => {});
            if (fresh.text !== text) throw new Error('Version index write was not verified');
            return fresh;
        };
        const summarizeUsage = (records) => {
            const paths = new Map();
            let bytes = 0n;
            for (const record of records) {
                if (!Number.isSafeInteger(record.size) || record.size < 0) throw new Error('Invalid version size');
                const size = BigInt(record.size);
                bytes += size;
                const value = paths.get(record.originalPath)
                    || { path: record.originalPath, count: 0, bytes: 0n };
                value.count += 1;
                value.bytes += size;
                paths.set(value.path, value);
            }
            const values = [...paths.values()]
                .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
                .map((value) => Object.freeze({ ...value, bytes: value.bytes.toString() }));
            return Object.freeze({
                count: records.length,
                pathCount: paths.size,
                bytes: bytes.toString(),
                paths: Object.freeze(values),
            });
        };
        const freezeCleanup = (cleanup) => cleanup && Object.freeze({ ...cleanup,
            remainingIds: Object.freeze([...cleanup.remainingIds]) });
        const usageReadError = (error, path) => {
            const wrapped = new Error(safeMessage(error));
            wrapped.code = error?.code;
            wrapped.usagePath = path;
            return wrapped;
        };
        const readRawIndexSnapshot = async (root, check = () => {}) => {
            check();
            let versionRoot;
            try { versionRoot = await root.getDirectoryHandle('.filenally'); }
            catch (error) {
                check();
                if (error?.name === 'NotFoundError') return { root, versionRoot: null,
                    indexHandle: null, indexFile: null, text: null };
                throw usageReadError(error, '.filenally');
            }
            check();
            let indexHandle;
            try { indexHandle = await getExistingFile(versionRoot, 'index.json', check); }
            catch (error) { throw usageReadError(error, 'index.json'); }
            check();
            if (!indexHandle) return { root, versionRoot, indexHandle: null, indexFile: null, text: null };
            let indexFile;
            try { indexFile = await indexHandle.getFile(); }
            catch (error) { throw usageReadError(error, 'index.json'); }
            check();
            if (indexFile.size > MAX_IMPORT_BYTES) return { root, versionRoot, indexHandle,
                indexFile, text: null, unverifiable: true };
            let text;
            try { text = await indexFile.text(); }
            catch (error) { throw usageReadError(error, 'index.json'); }
            check();
            return { root, versionRoot, indexHandle, indexFile, text };
        };
        const validateRawIndexSnapshot = async (snapshot, check = () => {}) => {
            const fresh = await readRawIndexSnapshot(snapshot.root, check);
            await sameSnapshotHandle(snapshot.versionRoot, fresh.versionRoot, false, check);
            await sameSnapshotHandle(snapshot.indexHandle, fresh.indexHandle, false, check);
            if (snapshot.text !== fresh.text) throw new Error('Version index changed');
            return fresh;
        };
        const inspectUsage = async (root, {
            scan = true, isCancelled = () => false, onProgress = () => {},
        } = {}) => {
            const report = {
                indexStatus: 'error', indexError: null, registered: null, cleanup: null,
                observed: null, inspection: 'not-run', readAt: nowIso(), visited: 0,
                errors: [], errorCount: 0,
            };
            const recordError = (path, error) => {
                report.errorCount += 1;
                if (report.errors.length < 100) report.errors.push({ path, message: safeMessage(error) });
            };
            const observed = {
                count: 0, bytes: 0n, indexBytes: 0n,
                registeredCount: 0, registeredBytes: 0n,
                unregisteredCount: 0, unregisteredBytes: 0n,
                otherCount: 0, otherBytes: 0n, missingIds: [], mismatchedIds: [], unknownCount: 0,
            };
            const publicObserved = () => ({
                count: observed.count,
                bytes: observed.bytes.toString(),
                indexBytes: observed.indexBytes.toString(),
                registeredCount: observed.registeredCount,
                registeredBytes: observed.registeredBytes === null ? null : observed.registeredBytes.toString(),
                unregisteredCount: observed.unregisteredCount,
                unregisteredBytes: observed.unregisteredBytes === null ? null : observed.unregisteredBytes.toString(),
                otherCount: observed.otherCount,
                otherBytes: observed.otherBytes.toString(),
                missingIds: Object.freeze([...observed.missingIds]),
                mismatchedIds: Object.freeze([...observed.mismatchedIds]),
                unknownCount: observed.unknownCount,
            });
            const finish = () => {
                if (scan) {
                    if (report.indexStatus !== 'valid') {
                        observed.registeredCount = null;
                        observed.registeredBytes = null;
                        observed.unregisteredCount = null;
                        observed.unregisteredBytes = null;
                    }
                    report.observed = Object.freeze(publicObserved());
                }
                report.errors = Object.freeze(report.errors.map(Object.freeze));
                return Object.freeze(report);
            };
            const check = () => {
                let cancelled;
                try { cancelled = isCancelled(); }
                catch (error) {
                    const callbackError = new Error(safeMessage(error));
                    callbackError.code = 'VERSION_USAGE_CALLBACK';
                    throw callbackError;
                }
                if (cancelled) {
                    const error = new Error('Version usage inspection cancelled');
                    error.code = 'VERSION_USAGE_CANCELLED';
                    throw error;
                }
            };
            const applyStop = (error) => {
                if (error?.code === 'VERSION_USAGE_CANCELLED') report.inspection = 'cancelled';
                else {
                    recordError('', error);
                    report.inspection = 'partial';
                }
            };
            try { check(); }
            catch (error) {
                report.indexError = safeMessage(error);
                applyStop(error);
                return finish();
            }

            let snapshot = null;
            let rawSnapshot = null;
            let index = null;
            let initialReadIncomplete = false;
            try {
                snapshot = await readIndexSnapshot(root, check);
                rawSnapshot = snapshot;
                index = snapshot.index;
                report.indexStatus = snapshot.indexHandle ? 'valid' : 'missing';
                try { report.registered = summarizeUsage(index.versions); }
                catch (error) {
                    index = null;
                    report.indexStatus = 'error';
                    report.indexError = safeMessage(error);
                }
            } catch (error) {
                if (['VERSION_USAGE_CANCELLED', 'VERSION_USAGE_CALLBACK'].includes(error?.code)) {
                    report.indexError = safeMessage(error);
                    applyStop(error);
                    return finish();
                }
                report.indexError = safeMessage(error);
                try {
                    rawSnapshot = await readRawIndexSnapshot(root, check);
                    if (rawSnapshot.unverifiable) initialReadIncomplete = true;
                    else {
                        try {
                            parseIndexText(rawSnapshot.text);
                            initialReadIncomplete = true;
                            recordError('index.json', error);
                        }
                        catch { /* A stable malformed index can still have a complete physical scan. */ }
                    }
                } catch (rawError) {
                    if (['VERSION_USAGE_CANCELLED', 'VERSION_USAGE_CALLBACK'].includes(rawError?.code)) {
                        applyStop(rawError);
                        return finish();
                    }
                    initialReadIncomplete = true;
                    recordError(rawError.usagePath || '.filenally', rawError);
                    try {
                        const versionRoot = await root.getDirectoryHandle('.filenally');
                        check();
                        rawSnapshot = { root, versionRoot, indexHandle: null,
                            indexFile: null, text: null, unverifiable: true };
                    } catch (rootError) {
                        if (['VERSION_USAGE_CANCELLED', 'VERSION_USAGE_CALLBACK'].includes(rootError?.code)) {
                            applyStop(rootError);
                            return finish();
                        }
                    }
                }
            }
            report.cleanup = freezeCleanup(index?.cleanup || null);
            if (!scan) return finish();
            report.inspection = initialReadIncomplete ? 'partial' : 'complete';

            const classificationIndex = report.indexStatus === 'valid' ? index : null;
            if (!classificationIndex) {
                observed.registeredCount = null;
                observed.registeredBytes = null;
                observed.unregisteredCount = null;
                observed.unregisteredBytes = null;
            }
            const registeredPaths = new Map((classificationIndex?.versions || [])
                .map((record) => [record.storedPath, record]));
            const present = new Set();
            const mismatchedIds = new Set();
            const frames = [];
            const closeIterator = async (frame) => {
                try { await frame.iterator.return?.(); }
                catch (error) {
                    recordError(frame.path, error);
                    if (report.inspection !== 'cancelled') report.inspection = 'partial';
                }
            };
            const closeFrames = async () => {
                while (frames.length) await closeIterator(frames.pop());
            };
            if (rawSnapshot?.versionRoot) {
                try {
                    frames.push({ directory: rawSnapshot.versionRoot,
                        iterator: rawSnapshot.versionRoot.values()[Symbol.asyncIterator](), path: '', depth: 0 });
                } catch (error) {
                    recordError('', error);
                    report.inspection = 'partial';
                }
            } else if (!rawSnapshot) {
                report.inspection = 'partial';
            }

            let stopped = false;
            while (frames.length && !stopped) {
                const frame = frames.at(-1);
                try { check(); }
                catch (error) { applyStop(error); stopped = true; break; }
                let next;
                try {
                    next = await frame.iterator.next();
                    check();
                } catch (error) {
                    if (['VERSION_USAGE_CANCELLED', 'VERSION_USAGE_CALLBACK'].includes(error?.code)) {
                        applyStop(error);
                        stopped = true;
                        break;
                    }
                    recordError(frame.path, error);
                    report.inspection = 'partial';
                    frames.pop();
                    await closeIterator(frame);
                    continue;
                }
                if (next.done) { frames.pop(); continue; }
                if (report.visited >= 100000) {
                    recordError(frame.path, new Error('Version usage entry limit 100000 reached'));
                    report.inspection = 'partial';
                    stopped = true;
                    break;
                }
                const entry = next.value;
                const path = frame.path ? `${frame.path}/${entry.name}` : entry.name;
                report.visited += 1;
                if (frame.depth + 1 > 256) {
                    recordError(frame.path, new Error('Version usage depth limit 256 reached'));
                    report.inspection = 'partial';
                    stopped = true;
                    break;
                }
                if (path.length > 8192) {
                    recordError(frame.path, new Error('Version usage path limit 8192 reached'));
                    report.inspection = 'partial';
                    stopped = true;
                    break;
                }
                if (entry.kind === 'directory') {
                    const record = registeredPaths.get(path);
                    if (record) { present.add(record.id); mismatchedIds.add(record.id); }
                    try {
                        frames.push({ directory: entry, iterator: entry.values()[Symbol.asyncIterator](),
                            path, depth: frame.depth + 1 });
                    } catch (error) {
                        recordError(path, error);
                        report.inspection = 'partial';
                    }
                } else if (entry.kind === 'file') {
                    let file;
                    try {
                        check();
                        file = await entry.getFile();
                        check();
                    } catch (error) {
                        if (['VERSION_USAGE_CANCELLED', 'VERSION_USAGE_CALLBACK'].includes(error?.code)) {
                            applyStop(error);
                            stopped = true;
                            break;
                        }
                        recordError(path, error);
                        report.inspection = 'partial';
                    }
                    if (file && (!Number.isSafeInteger(file.size) || file.size < 0)) {
                        recordError(path, new Error('Invalid observed file size'));
                        report.inspection = 'partial';
                        file = null;
                    }
                    if (file) {
                        const size = BigInt(file.size);
                        observed.count += 1;
                        observed.bytes += size;
                        if (path === 'index.json') observed.indexBytes += size;
                        else if (classificationIndex && registeredPaths.has(path)) {
                            const record = registeredPaths.get(path);
                            present.add(record.id);
                            observed.registeredCount += 1;
                            observed.registeredBytes += size;
                            if (file.size !== record.size) mismatchedIds.add(record.id);
                        } else if (classificationIndex && path.startsWith('versions/')) {
                            observed.unregisteredCount += 1;
                            observed.unregisteredBytes += size;
                        } else if (path.startsWith('versions/')) observed.unknownCount += 1;
                        else {
                            observed.otherCount += 1;
                            observed.otherBytes += size;
                        }
                    }
                }
                if (report.visited % 128 === 0) {
                    try { await onProgress({ visited: report.visited }); }
                    catch (error) {
                        recordError('', error);
                        report.inspection = 'partial';
                        stopped = true;
                        break;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 0));
                    try { check(); }
                    catch (error) { applyStop(error); stopped = true; break; }
                }
            }
            if (frames.length) await closeFrames();
            observed.mismatchedIds = [...mismatchedIds]
                .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

            if (report.inspection !== 'cancelled') {
                try {
                    if (snapshot) await validateIndexSnapshot(snapshot, check);
                    else if (rawSnapshot && !rawSnapshot.unverifiable) {
                        await validateRawIndexSnapshot(rawSnapshot, check);
                    }
                } catch (error) {
                    if (error?.code === 'VERSION_USAGE_CANCELLED') report.inspection = 'cancelled';
                    else if (error?.code === 'VERSION_USAGE_CALLBACK') applyStop(error);
                    else {
                        recordError('index.json', error);
                        report.inspection = 'stale';
                    }
                }
            }
            if (report.inspection === 'complete' && classificationIndex) {
                observed.missingIds = classificationIndex.versions
                    .filter((record) => !present.has(record.id)).map((record) => record.id)
                    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
            }
            return finish();
        };
        const withVersionWriter = async (work) => {
            if (versionWriting) throw new Error('Version write already running');
            versionWriting = true;
            try { return await work(); }
            finally { versionWriting = false; }
        };
        const captureOwned = async ({ action, handles, runId, direction, reason = 'before-overwrite' }) => {
            const root = handles[action.toSide];
            const destinationPath = action.destinationPath || action.path;
            const parts = originalSegments(destinationPath);
            const destination = await getExistingFile(root, destinationPath);
            if (!destination) return null;
            const destinationFile = await destination.getFile();
            let indexSnapshot = await readIndexSnapshot(root);
            requireIdleIndex(indexSnapshot.index);
            if (!indexSnapshot.versionRoot) {
                await validateIndexSnapshot(indexSnapshot);
                const versionRoot = await directoryFor(root, ['.filenally'], true);
                indexSnapshot = await readIndexSnapshot(root);
                await sameSnapshotHandle(versionRoot, indexSnapshot.versionRoot, false, () => {});
                if (indexSnapshot.indexHandle) throw new Error('Version index changed');
            }
            const id = uid();
            const storedPath = ['versions', id, ...parts].join('/');
            const record = cleanRecord({
                id,
                capturedAt: nowIso(),
                originalPath: destinationPath,
                storedPath,
                size: destinationFile.size,
                type: destinationFile.type,
                lastModified: destinationFile.lastModified,
                reason,
                runId,
                direction,
                fromSide: action.fromSide,
                toSide: action.toSide,
            });
            if (!record) throw new Error('Could not create version record');
            if (indexSnapshot.index.versions.some((item) => item.id === record.id)) {
                throw new Error('Duplicate version IDs');
            }
            await writeFile(indexSnapshot.versionRoot, storedPath, destinationFile);
            indexSnapshot = await validateIndexSnapshot(indexSnapshot);
            requireIdleIndex(indexSnapshot.index);
            const index = { ...indexSnapshot.index, versions: [...indexSnapshot.index.versions, record] };
            await writeIndexSnapshot(indexSnapshot, index);
            return Object.freeze(record);
        };
        const capture = (options) => withVersionWriter(() => captureOwned(options));
        const list = async (root, check = () => {}) => {
            check();
            const snapshot = await readIndexSnapshot(root, check);
            check();
            requireIdleIndex(snapshot.index);
            check();
            return snapshot.index.versions.map(Object.freeze);
        };
        const selectedRecord = (records, selected) => {
            const expected = cleanRecord(selected);
            if (!expected) throw new Error('Invalid selected version');
            const record = records.find((record) => record.id === expected.id);
            if (!record || JSON.stringify(record) !== JSON.stringify(expected)) throw new Error('Selected version record changed');
            return record;
        };
        const readVersion = async (root, selected, check = () => {}) => {
            check();
            const records = await list(root, check);
            check();
            const record = selectedRecord(records, selected);
            const path = ['.filenally', 'versions', record.id, ...originalSegments(record.originalPath)].join('/');
            const handle = await fileHandleFor(root, path, check);
            check();
            const file = await handle.getFile();
            check();
            if (file.size !== record.size) throw new Error('Stored version size changed');
            return { record, handle, file };
        };
        const read = async (root, record) => (await readVersion(root, record)).file;
        const freezeRecords = (records) => Object.freeze(records.map(record => Object.freeze({ ...record })));
        const takePreparation = (map, prepared) => {
            const state = map.get(prepared);
            if (!state) throw new Error('Invalid or consumed version preparation');
            map.delete(prepared);
            return state;
        };
        const cleanupCheck = (isCancelled) => () => {
            let cancelled;
            try { cancelled = isCancelled(); }
            catch (error) {
                const failure = new Error(safeMessage(error));
                failure.code = 'VERSION_CLEANUP_CALLBACK';
                throw failure;
            }
            if (cancelled) {
                const error = new Error('Version cleanup stopped');
                error.code = 'VERSION_CLEANUP_CANCELLED';
                throw error;
            }
        };
        const requireCleanupIndex = (snapshot) => {
            if (!snapshot.indexHandle) throw new Error('Version index is missing');
            for (const record of snapshot.index.versions) {
                if (!/^[a-z0-9-]+$/.test(record.id)) throw new Error('Unsafe cleanup capture ID');
                if (!Number.isSafeInteger(record.size) || record.size < 0) throw new Error('Invalid version size');
            }
        };
        const pinCleanupFile = async (snapshot, record, check, allowMissing = false) => {
            const parts = ['versions', record.id, ...originalSegments(record.originalPath)];
            const name = parts.pop();
            const parents = [snapshot.versionRoot];
            let directory = snapshot.versionRoot;
            await sameSnapshotHandle(directory, directory, true, check);
            for (const part of parts) {
                check();
                try { directory = await directory.getDirectoryHandle(part); }
                catch (error) {
                    check();
                    if (allowMissing && error?.name === 'NotFoundError') return { record, parents, handle: null, file: null };
                    throw error;
                }
                check();
                if (directory.name !== part) throw new Error('Cleanup directory name changed');
                await sameSnapshotHandle(directory, directory, true, check);
                parents.push(directory);
            }
            let handle;
            check();
            try { handle = await directory.getFileHandle(name); }
            catch (error) {
                check();
                if (allowMissing && error?.name === 'NotFoundError') return { record, parents, handle: null, file: null };
                throw error;
            }
            check();
            if (handle.kind !== 'file' || handle.name !== name) throw new Error('Cleanup file changed');
            await sameSnapshotHandle(handle, handle, true, check);
            const file = await handle.getFile();
            check();
            if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size !== record.size) {
                throw new Error('Stored version size changed');
            }
            return { record, parents, handle, file };
        };
        const validateCleanupFile = async (snapshot, pinned, check, compareBytes) => {
            const record = selectedRecord(snapshot.index.versions, pinned.record);
            const fresh = await pinCleanupFile(snapshot, record, check, !pinned.handle);
            if (pinned.parents.length !== fresh.parents.length) throw new Error('Cleanup path presence changed');
            for (let i = 0; i < pinned.parents.length; i += 1) {
                await sameSnapshotHandle(pinned.parents[i], fresh.parents[i], true, check);
            }
            await sameSnapshotHandle(pinned.handle, fresh.handle, true, check);
            if (pinned.file && (pinned.file.size !== fresh.file.size
                || pinned.file.lastModified !== fresh.file.lastModified)) throw new Error('Cleanup file metadata changed');
            // Native identity compares locators; it is not an inode-history guarantee.
            if (compareBytes && pinned.file && !await equalFileBytes(pinned.file, fresh.file,
                () => {}, () => { check(); return false; })) throw new Error('Cleanup file bytes changed');
            check();
            return fresh;
        };
        const prepareCleanup = async (root, records, { isCancelled = () => false } = {}) => {
            const check = cleanupCheck(isCancelled);
            check();
            if (!Array.isArray(records) || !records.length || records.length > 100
                || new Set(records.map(record => record?.id)).size !== records.length) {
                throw new Error('Select 1 to 100 distinct versions');
            }
            const snapshot = await readIndexSnapshot(root, check);
            requireIdleIndex(snapshot.index);
            requireCleanupIndex(snapshot);
            await validateIndexSnapshot(snapshot, check, true);
            const selected = records.map(record => selectedRecord(snapshot.index.versions, record))
                .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)
                    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            const pinned = [];
            for (const record of selected) pinned.push(await pinCleanupFile(snapshot, record, check));
            const selectedIds = new Set(selected.map(record => record.id));
            const witnesses = new Map(), lastPaths = [];
            for (const path of new Set(selected.map(record => record.originalPath))) {
                for (const record of snapshot.index.versions) {
                    if (record.originalPath !== path || selectedIds.has(record.id)) continue;
                    try {
                        witnesses.set(path, await pinCleanupFile(snapshot, record, check));
                        break;
                    } catch (error) {
                        check();
                        if (['VERSION_CLEANUP_CANCELLED', 'VERSION_CLEANUP_CALLBACK'].includes(error?.code)) throw error;
                        // An unreadable retained file cannot exempt the last-copy warning.
                    }
                }
                if (!witnesses.has(path)) lastPaths.push(path);
            }
            await validateIndexSnapshot(snapshot, check, true);
            const prepared = Object.freeze({ summary: Object.freeze({ records: freezeRecords(selected),
                count: selected.length, bytes: selected.reduce((sum, record) => sum + BigInt(record.size), 0n).toString(),
                lastPaths: Object.freeze(lastPaths), upgradesIndex: snapshot.index.schemaVersion === 1 }) });
            cleanupPreparations.set(prepared, { snapshot, pinned, witnesses, lastPaths });
            return prepared;
        };
        const nextCleanupIndex = (index, record) => {
            const remainingIds = index.cleanup.remainingIds.filter(id => id !== record.id);
            return { schemaVersion: 2,
                versions: index.versions.filter(value => value.id !== record.id),
                cleanup: remainingIds.length ? { ...index.cleanup, remainingIds,
                    completedCount: index.cleanup.completedCount + 1,
                    completedBytes: (BigInt(index.cleanup.completedBytes) + BigInt(record.size)).toString(),
                } : null };
        };
        const writeCleanupIndex = async (snapshot, nextIndex) => {
            await validateIndexSnapshot(snapshot, () => {}, true);
            const fresh = await writeIndexSnapshot(snapshot, nextIndex);
            await sameSnapshotHandle(snapshot.root, fresh.root, true, () => {});
            await sameSnapshotHandle(snapshot.versionRoot, fresh.versionRoot, true, () => {});
            await sameSnapshotHandle(snapshot.indexHandle, fresh.indexHandle, true, () => {});
            await validateIndexSnapshot(fresh, () => {}, true);
            return fresh;
        };
        const cleanup = (prepared, { acknowledgeLastVersions = false, isCancelled = () => false,
            onProgress = () => {} } = {}) => withVersionWriter(async () => {
            const state = takePreparation(cleanupPreparations, prepared);
            const { pinned, witnesses, lastPaths } = state;
            let snapshot = state.snapshot, operationId = null, intentAttempted = false, failedId = null;
            const completedIds = [];
            let completedBytes = 0n;
            const check = cleanupCheck(isCancelled);
            const result = (status, error = null) => Object.freeze({ operationId, status,
                completedIds: Object.freeze([...completedIds]), completedBytes: completedBytes.toString(),
                remainingIds: Object.freeze(pinned.map(value => value.record.id).filter(id => !completedIds.includes(id))),
                failedId, recoveryRequired: intentAttempted && completedIds.length < pinned.length, error });
            try {
                check();
                if (await snapshot.root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
                    throw new Error('Cleanup write permission is not granted');
                }
                check();
                if (lastPaths.length && acknowledgeLastVersions !== true) throw new Error('Confirm removal of last stored versions');
                await validateIndexSnapshot(snapshot, check, true);
                for (const value of pinned) await validateCleanupFile(snapshot, value, check, true);
                for (const value of witnesses.values()) await validateCleanupFile(snapshot, value, check, false);
                check();
                operationId = uid();
                const intent = { schemaVersion: 2, versions: snapshot.index.versions,
                    cleanup: { id: operationId, startedAt: nowIso(), remainingIds: pinned.map(value => value.record.id),
                        completedCount: 0, completedBytes: '0' } };
                parseIndexText(JSON.stringify(intent));
                check();
                intentAttempted = true;
                snapshot = await writeCleanupIndex(snapshot, intent);
                for (const value of pinned) {
                    check();
                    failedId = value.record.id;
                    await validateIndexSnapshot(snapshot, check, true);
                    if (snapshot.index.cleanup?.id !== operationId
                        || !snapshot.index.cleanup.remainingIds.includes(failedId)) throw new Error('Cleanup ownership changed');
                    const fresh = await validateCleanupFile(snapshot, value, check, true);
                    const witness = witnesses.get(value.record.originalPath);
                    if (witness) await validateCleanupFile(snapshot, witness, check, false);
                    check();
                    // One commit unit: do not call UI cancellation/progress until index readback finishes.
                    const parent = fresh.parents.at(-1), name = fresh.handle.name;
                    await parent.removeEntry(name);
                    try {
                        await parent.getFileHandle(name);
                        throw new Error('Cleanup removal was not verified');
                    } catch (error) {
                        if (error?.name !== 'NotFoundError') throw error;
                    }
                    const absent = await pinCleanupFile(snapshot, value.record, () => {}, true);
                    if (absent.handle || absent.parents.length !== fresh.parents.length) {
                        throw new Error('Cleanup path changed during removal');
                    }
                    for (let i = 0; i < fresh.parents.length; i += 1) {
                        await sameSnapshotHandle(fresh.parents[i], absent.parents[i], true, () => {});
                    }
                    await validateIndexSnapshot(snapshot, () => {}, true);
                    snapshot = await writeCleanupIndex(snapshot, nextCleanupIndex(snapshot.index, value.record));
                    completedIds.push(value.record.id);
                    completedBytes += BigInt(value.record.size);
                    failedId = null;
                    await onProgress(Object.freeze({ operationId,
                        completedIds: Object.freeze([...completedIds]), completedBytes: completedBytes.toString(),
                        remainingIds: Object.freeze([...snapshot.index.cleanup?.remainingIds || []]) }));
                }
                return result('complete');
            } catch (error) {
                if (error?.code === 'VERSION_CLEANUP_CANCELLED') return result('stopped');
                const failure = new Error(safeMessage(error));
                failure.cleanupResult = result('failed', safeMessage(error));
                throw failure;
            }
        });
        const prepareCleanupRecovery = async (root, { isCancelled = () => false } = {}) => {
            const check = cleanupCheck(isCancelled);
            const snapshot = await readIndexSnapshot(root, check);
            requireCleanupIndex(snapshot);
            if (!snapshot.index.cleanup) throw new Error('No version cleanup requires recovery');
            await validateIndexSnapshot(snapshot, check, true);
            const pinned = [];
            const byId = new Map(snapshot.index.versions.map(record => [record.id, record]));
            for (const id of snapshot.index.cleanup.remainingIds) {
                pinned.push(await pinCleanupFile(snapshot, byId.get(id), check, true));
            }
            await validateIndexSnapshot(snapshot, check, true);
            const intent = snapshot.index.cleanup;
            const prepared = Object.freeze({ summary: Object.freeze({ operationId: intent.id,
                missingRecords: freezeRecords(pinned.filter(value => !value.handle).map(value => value.record)),
                preservedRecords: freezeRecords(pinned.filter(value => value.handle).map(value => value.record)),
                completedCount: intent.completedCount, completedBytes: intent.completedBytes }) });
            recoveryPreparations.set(prepared, { snapshot, pinned });
            return prepared;
        };
        const recoverCleanup = (prepared) => withVersionWriter(async () => {
            const { snapshot, pinned } = takePreparation(recoveryPreparations, prepared);
            if (await snapshot.root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
                throw new Error('Cleanup recovery write permission is not granted');
            }
            await validateIndexSnapshot(snapshot, () => {}, true);
            for (const value of pinned) await validateCleanupFile(snapshot, value, () => {}, false);
            const missingIds = new Set(pinned.filter(value => !value.handle).map(value => value.record.id));
            await writeCleanupIndex(snapshot, { schemaVersion: 2,
                versions: snapshot.index.versions.filter(record => !missingIds.has(record.id)), cleanup: null });
            return Object.freeze({ operationId: snapshot.index.cleanup.id,
                removedIds: Object.freeze([...missingIds]),
                preservedIds: Object.freeze(pinned.filter(value => value.handle).map(value => value.record.id)) });
        });
        const prepareRestore = async (root, record) => {
            const version = await readVersion(root, record);
            const currentHandle = await getExistingFile(root, version.record.originalPath);
            const currentFile = currentHandle ? await currentHandle.getFile() : null;
            const prepared = Object.freeze({ root, record: version.record, versionFile: version.file, currentFile, currentHandle });
            preparedRestores.set(prepared, version.handle);
            return prepared;
        };
        const comparisonChoices = async (root, selected, { isCancelled = () => false } = {}) => {
            const check = () => comparisonCheck(isCancelled);
            check();
            const records = await list(root, check);
            check();
            const left = selectedRecord(records, selected);
            return records.filter((record) => record.id !== left.id && record.originalPath === left.originalPath)
                .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || a.id.localeCompare(b.id));
        };
        const prepareComparison = async (root, leftRecord, rightRecord = null, { isCancelled = () => false } = {}) => {
            const check = () => comparisonCheck(isCancelled);
            check();
            const version = await readVersion(root, leftRecord, check);
            check();
            const left = Object.freeze({ kind: 'version', ...version, readAt: nowIso() });
            let right;
            if (rightRecord !== null) {
                if (rightRecord.id === left.record.id || rightRecord.originalPath !== left.record.originalPath) {
                    throw new Error('Counterpart must be a different version of the same path');
                }
                const other = await readVersion(root, rightRecord, check);
                check();
                right = { kind: 'version', ...other, readAt: nowIso() };
            } else {
                const handle = await getExistingFile(root, left.record.originalPath, check);
                check();
                const file = handle ? await handle.getFile() : null;
                check();
                right = { kind: 'current', record: null, handle, file, readAt: nowIso() };
            }
            return Object.freeze({ root, path: left.record.originalPath, left, right: Object.freeze(right) });
        };
        const validateComparison = async (snapshot, { isCancelled = () => false } = {}) => {
            const check = () => comparisonCheck(isCancelled);
            check();
            const fresh = await prepareComparison(snapshot.root, snapshot.left.record,
                snapshot.right.kind === 'version' ? snapshot.right.record : null, { isCancelled });
            check();
            for (const key of ['left', 'right']) {
                const old = snapshot[key], next = fresh[key];
                if (Boolean(old.handle) !== Boolean(next.handle)) throw new Error('Comparison file changed');
                if (!old.handle) continue;
                if (old.handle.isSameEntry) {
                    const same = await old.handle.isSameEntry(next.handle);
                    check();
                    if (!same) throw new Error('Comparison file identity changed');
                }
                if (old.file.size !== next.file.size || old.file.type !== next.file.type
                    || old.file.lastModified !== next.file.lastModified) throw new Error('Comparison file changed');
            }
        };
        const requireSameFile = async (expectedHandle, expectedFile, handle, file) => {
            if (Boolean(expectedHandle) !== Boolean(handle)) throw new Error('Restore file appeared or disappeared');
            if (!handle) return;
            if ((expectedHandle.isSameEntry && !await expectedHandle.isSameEntry(handle))
                || expectedFile.size !== file.size || expectedFile.lastModified !== file.lastModified
                || expectedFile.type !== file.type || !await equalFileBytes(expectedFile, file)) {
                throw new Error('Restore file changed; confirm again');
            }
        };
        const checkPrepared = async (prepared, versionHandle) => {
            const { root, record, versionFile, currentHandle, currentFile } = prepared;
            const version = await readVersion(root, record);
            await requireSameFile(versionHandle, versionFile, version.handle, version.file);
            const current = await getExistingFile(root, record.originalPath);
            await requireSameFile(currentHandle, currentFile, current, current ? await current.getFile() : null);
            return current;
        };
        const restoreOwned = async (prepared, { side, direction, runId }) => {
            if (!preparedRestores.has(prepared)) throw new Error('Restore confirmation expired or restore already running');
            if (!['source', 'target'].includes(side) || !['bidirectional', 'unidirectional', 'reverse'].includes(direction)
                || typeof runId !== 'string' || !runId) throw new Error('Invalid restore operation');
            const versionHandle = preparedRestores.get(prepared);
            preparedRestores.delete(prepared);
            let backup = null;
            try {
                const { root, record, currentFile, versionFile } = prepared;
                if (await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Restore write permission is not granted');
                await checkPrepared(prepared, versionHandle);
                if (currentFile) {
                    backup = await captureOwned({ action: { path: record.originalPath, fromSide: side, toSide: side },
                        handles: { [side]: root }, direction, runId, reason: 'before-restore' });
                    if (!backup) throw new Error('Restore destination disappeared before backup');
                }
                const current = await checkPrepared(prepared, versionHandle);
                await writeFile(root, record.originalPath, versionFile, current);
                return { record, backup };
            } catch (error) {
                if (backup) error.backup = backup;
                throw error;
            }
        };
        const restore = (prepared, options) => withVersionWriter(() => restoreOwned(prepared, options));
        return Object.freeze({ capture, cleanRecord, emptyIndex, parseIndexText, inspectUsage, list, read, prepareRestore, restore,
            comparisonChoices, prepareComparison, validateComparison, prepareCleanup, cleanup,
            prepareCleanupRecovery, recoverCleanup });
    })();

    const VersionComparison = (() => {
        const TEXT_BYTES = 524288;
        const TEXT_LINES = 5000;
        const LINE_UNITS = 8192;
        const MATRIX_CELLS = 2000000;
        const HASH_BYTES = 16777216;
        const pause = async (isCancelled) => {
            comparisonCheck(isCancelled);
            await new Promise((resolve) => setTimeout(resolve, 0));
            comparisonCheck(isCancelled);
        };
        const decode = async (file, isCancelled) => {
            comparisonCheck(isCancelled);
            if (file.size > TEXT_BYTES) return { reason: 'size', format: null };
            const bytes = new Uint8Array(await file.arrayBuffer());
            comparisonCheck(isCancelled);
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
            catch { return { reason: 'encoding', format: null }; }
            const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
            if (bom) text = text.slice(1);
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return { reason: 'control', format: null };
            const format = { bom, crlf: 0, lf: 0, cr: 0, finalNewline: /[\r\n]$/.test(text) };
            const lines = [];
            let start = 0;
            for (const match of text.matchAll(/\r\n|\r|\n/g)) {
                format[match[0] === '\r\n' ? 'crlf' : match[0] === '\n' ? 'lf' : 'cr'] += 1;
                if (match.index - start > LINE_UNITS) return { reason: 'line-length', format: null };
                if (lines.length === TEXT_LINES) return { reason: 'line-count', format: null };
                lines.push(text.slice(start, match.index));
                start = match.index + match[0].length;
            }
            if (start < text.length) {
                if (text.length - start > LINE_UNITS) return { reason: 'line-length', format: null };
                if (lines.length === TEXT_LINES) return { reason: 'line-count', format: null };
                lines.push(text.slice(start));
            }
            return { reason: null, format, lines };
        };
        const lineDiff = async (left, right, isCancelled, onProgress) => {
            let prefix = 0;
            let suffix = 0;
            while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
            while (suffix < left.length - prefix && suffix < right.length - prefix
                && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix += 1;
            const n = left.length - prefix - suffix;
            const m = right.length - prefix - suffix;
            if (!n && !m) return { reason: null, lineContentEqual: true, rows: [], added: 0, removed: 0 };
            const cells = (n + 1) * (m + 1);
            if (n && m && cells > MATRIX_CELLS) return { reason: 'work-limit' };
            let matrix = null;
            if (n && m) {
                matrix = new Uint32Array(cells);
                let done = 0;
                for (let i = n - 1; i >= 0; i -= 1) {
                    for (let j = m - 1; j >= 0; j -= 1) {
                        const at = i * (m + 1) + j;
                        matrix[at] = left[prefix + i] === right[prefix + j]
                            ? matrix[at + m + 2] + 1 : Math.max(matrix[at + m + 1], matrix[at + 1]);
                        done += 1;
                        if (done % 16384 === 0) {
                            onProgress({ stage: 'text', done, total: n * m });
                            await pause(isCancelled);
                        }
                    }
                }
                onProgress({ stage: 'text', done: n * m, total: n * m });
            }
            comparisonCheck(isCancelled);
            const full = [];
            let added = 0;
            let removed = 0;
            const append = (kind, i, j, text) => {
                full.push({ kind, leftLine: i === null ? null : i + 1, rightLine: j === null ? null : j + 1, text });
                if (kind === 'add') added += 1;
                if (kind === 'remove') removed += 1;
            };
            for (let k = 0; k < prefix; k += 1) {
                append('context', k, k, left[k]);
                if (full.length % 256 === 0) await pause(isCancelled);
            }
            let i = 0;
            let j = 0;
            while (i < n || j < m) {
                if (i < n && j < m && left[prefix + i] === right[prefix + j]) {
                    append('context', prefix + i, prefix + j, left[prefix + i]);
                    i += 1;
                    j += 1;
                } else if (i < n && (j === m || (matrix
                    && matrix[(i + 1) * (m + 1) + j] >= matrix[i * (m + 1) + j + 1]))) {
                    append('remove', prefix + i, null, left[prefix + i]);
                    i += 1;
                } else {
                    append('add', null, prefix + j, right[prefix + j]);
                    j += 1;
                }
                if (full.length % 256 === 0) await pause(isCancelled);
            }
            matrix = null;
            for (let k = suffix; k > 0; k -= 1) {
                append('context', left.length - k, right.length - k, left[left.length - k]);
                if (full.length % 256 === 0) await pause(isCancelled);
            }
            const visible = new Uint8Array(full.length);
            for (let k = 0; k < full.length; k += 1) {
                if (full[k].kind !== 'context') visible.fill(1, Math.max(0, k - 3), Math.min(full.length, k + 4));
                if (k % 256 === 255) await pause(isCancelled);
            }
            const rows = [];
            let gap = null;
            for (let k = 0; k < full.length; k += 1) {
                if (visible[k]) {
                    gap = null;
                    rows.push(full[k]);
                } else if (gap) gap.count += 1;
                else {
                    gap = { kind: 'gap', leftLine: full[k].leftLine, rightLine: full[k].rightLine, text: '', count: 1 };
                    rows.push(gap);
                }
                if (k % 256 === 255) await pause(isCancelled);
            }
            comparisonCheck(isCancelled);
            return { reason: null, lineContentEqual: false, rows, added, removed };
        };
        const fingerprint = async (file, isCancelled) => {
            comparisonCheck(isCancelled);
            if (!file) return { status: 'missing', value: '' };
            if (file.size > HASH_BYTES) return { status: 'too-large', value: '' };
            if (!globalThis.crypto?.subtle?.digest) return { status: 'unavailable', value: '' };
            let buffer = await file.arrayBuffer();
            comparisonCheck(isCancelled);
            let digest;
            try { digest = await crypto.subtle.digest('SHA-256', buffer); }
            catch {
                comparisonCheck(isCancelled);
                return { status: 'unavailable', value: '' };
            } finally { buffer = null; }
            comparisonCheck(isCancelled);
            return { status: 'ok', value: Array.from(new Uint8Array(digest),
                (byte) => byte.toString(16).padStart(2, '0')).join('') };
        };
        const analyze = async (leftFile, rightFile, { isCancelled = () => false, onProgress = () => {} } = {}) => {
            comparisonCheck(isCancelled);
            const result = { kind: 'missing', equal: null, reason: null,
                formats: { left: null, right: null }, lineContentEqual: null, rows: [], added: 0, removed: 0, hashes: null };
            if (rightFile) {
                result.equal = await equalFileBytes(leftFile, rightFile,
                    (done, total) => onProgress({ stage: 'bytes', done, total }), isCancelled);
                comparisonCheck(isCancelled);
                result.kind = result.equal ? 'identical' : 'summary';
                if (!result.equal) {
                    if (leftFile.size > TEXT_BYTES || rightFile.size > TEXT_BYTES) result.reason = 'size';
                    else {
                        const left = await decode(leftFile, isCancelled);
                        comparisonCheck(isCancelled);
                        const right = await decode(rightFile, isCancelled);
                        comparisonCheck(isCancelled);
                        result.formats = { left: left.format, right: right.format };
                        result.reason = left.reason || right.reason;
                        if (!result.reason) {
                            const diff = await lineDiff(left.lines, right.lines, isCancelled, onProgress);
                            comparisonCheck(isCancelled);
                            result.reason = diff.reason;
                            if (!diff.reason) {
                                Object.assign(result, diff);
                                result.kind = 'text';
                            }
                        }
                    }
                }
            }
            const left = await fingerprint(leftFile, isCancelled);
            comparisonCheck(isCancelled);
            onProgress({ stage: 'hash', done: 1, total: rightFile ? 2 : 1 });
            const right = result.equal ? { ...left } : await fingerprint(rightFile, isCancelled);
            comparisonCheck(isCancelled);
            onProgress({ stage: 'hash', done: rightFile ? 2 : 1, total: rightFile ? 2 : 1 });
            comparisonCheck(isCancelled);
            result.hashes = { left, right };
            return result;
        };
        return Object.freeze({ analyze });
    })();

    const StateStore = (() => {
        const createDefault = () => ({
            schemaVersion: STATE_VERSION,
            config: { direction: 'bidirectional', conflictPolicy: 'latest', comparisonMode: 'quick', excludeDirs: [...DEFAULT_EXCLUDES], lang: navigator.language?.startsWith('ko') ? 'ko' : 'en' },
            activeProfileId: null,
            profiles: {},
            globalHistory: [],
            bookmarks: [],
            recentFolders: [],
            ui: { advancedExpanded: null },
        });

        const cleanConfig = (raw = {}) => ({
            direction: ['bidirectional', 'unidirectional', 'reverse'].includes(raw.direction) ? raw.direction : 'bidirectional',
            conflictPolicy: ['latest', 'source-overwrite', 'skip', 'rename'].includes(raw.conflictPolicy) ? raw.conflictPolicy : raw.conflictPolicy === 'overwrite' ? 'source-overwrite' : 'latest',
            comparisonMode: raw.comparisonMode === 'exact' ? 'exact' : 'quick',
            excludeDirs: normalizeExcludes(raw.excludeDirs || DEFAULT_EXCLUDES),
            lang: raw.lang === 'en' ? 'en' : 'ko',
        });
        const cleanUi = (raw = {}) => ({ advancedExpanded: typeof raw.advancedExpanded === 'boolean' ? raw.advancedExpanded : null });

        const cleanSnapshot = (value) => isObject(value) && Number.isFinite(Number(value.size)) && Number.isFinite(Number(value.lastModified))
            ? { size: Number(value.size), lastModified: Number(value.lastModified) }
            : null;

        const cleanManifest = (raw) => {
            const result = {};
            if (!isObject(raw)) return result;
            for (const [path, entry] of Object.entries(raw).slice(0, MAX_MANIFEST_ENTRIES)) {
                if (typeof path !== 'string' || !path || FORBIDDEN_KEYS.has(path)) continue;
                if (isObject(entry) && ('source' in entry || 'target' in entry)) {
                    result[path] = { source: cleanSnapshot(entry.source), target: cleanSnapshot(entry.target) };
                } else if (isObject(entry)) {
                    result[path] = {
                        source: Number.isFinite(Number(entry.srcTime)) ? { size: Number(entry.size || 0), lastModified: Number(entry.srcTime) } : null,
                        target: Number.isFinite(Number(entry.tgtTime)) ? { size: Number(entry.size || 0), lastModified: Number(entry.tgtTime) } : null,
                    };
                }
            }
            return result;
        };

        const cleanDirectoryManifest = (raw) => {
            const result = Object.create(null);
            if (!isObject(raw)) return result;
            for (const [path, entry] of Object.entries(raw).slice(0, MAX_MANIFEST_ENTRIES)) {
                try { safeSegments(path); } catch { continue; }
                if (!isObject(entry)) continue;
                const source = entry.source === true;
                const target = entry.target === true;
                if (source || target) result[path] = { source, target };
            }
            return result;
        };

        const cleanHistory = (raw, limit) => Array.isArray(raw) ? raw.slice(0, limit).map((entry) => {
            const filesCount = Number(entry?.filesCount || 0);
            return {
                time: String(entry?.time || ''),
                logId: typeof entry?.logId === 'string' ? entry.logId : null,
                startedAt: String(entry?.startedAt || ''),
                endedAt: String(entry?.endedAt || ''),
                durationMs: Math.max(0, Number(entry?.durationMs) || 0),
                direction: ['bidirectional', 'unidirectional', 'reverse'].includes(entry?.direction) ? entry.direction : 'bidirectional',
                filesCount: Number.isFinite(filesCount) ? Math.max(0, filesCount) : 0,
                totalFiles: Math.max(0, Number(entry?.totalFiles) || filesCount || 0),
                status: ['success', 'failed', 'aborted', '성공'].includes(entry?.status) ? entry.status === '성공' ? 'success' : entry.status : 'failed',
            };
        }) : [];

        const cleanBookmarks = (raw) => Array.isArray(raw) ? raw.slice(0, MAX_BOOKMARKS).filter(isObject).map((b) => ({
            profileId: String(b.profileId || ''),
            sourceName: String(b.sourceName || ''),
            targetName: String(b.targetName || ''),
            createdAt: String(b.createdAt || nowIso()),
        })) : [];

        const cleanRecentFolders = (raw) => Array.isArray(raw) ? raw.slice(0, MAX_RECENT_FOLDERS).filter(isObject).map((r) => ({
            profileId: String(r.profileId || ''),
            sourceName: String(r.sourceName || ''),
            targetName: String(r.targetName || ''),
            lastUsedAt: String(r.lastUsedAt || nowIso()),
        })) : [];

        const cleanCheckpoint = (raw) => {
            if (!isObject(raw)) return null;
            const completed = Number(raw.completed);
            const total = Number(raw.total);
            if (typeof raw.planId !== 'string' || !Number.isFinite(completed) || !Number.isFinite(total)) return null;
            return {
                planId: raw.planId,
                completed: Math.max(0, completed),
                total: Math.max(0, total),
                updatedAt: String(raw.updatedAt || nowIso()),
            };
        };

        const sanitizeV2 = (raw) => {
            rejectForbidden(raw, true);
            const state = createDefault();
            state.config = cleanConfig(raw.config);
            state.globalHistory = cleanHistory(raw.globalHistory, MAX_GLOBAL_HISTORY);
            state.bookmarks = cleanBookmarks(raw.bookmarks);
            state.recentFolders = cleanRecentFolders(raw.recentFolders);
            state.ui = cleanUi(raw.ui);
            if (isObject(raw.profiles)) {
                for (const [id, profile] of Object.entries(raw.profiles).slice(0, MAX_PROFILES)) {
                    if (!isObject(profile) || FORBIDDEN_KEYS.has(id)) continue;
                    const checkpoint = cleanCheckpoint(profile.lastCheckpoint);
                    state.profiles[id] = {
                        id,
                        sourceName: String(profile.sourceName || ''),
                        targetName: String(profile.targetName || ''),
                        bindingStatus: profile.bindingStatus === 'verified' ? 'verified' : 'unverified',
                        createdAt: String(profile.createdAt || nowIso()),
                        lastUsedAt: String(profile.lastUsedAt || nowIso()),
                        manifest: cleanManifest(profile.manifest),
                        directoryManifest: cleanDirectoryManifest(profile.directoryManifest),
                        history: cleanHistory(profile.history, MAX_PROFILE_HISTORY),
                    };
                    if (checkpoint) state.profiles[id].lastCheckpoint = checkpoint;
                }
            }
            state.activeProfileId = typeof raw.activeProfileId === 'string' && state.profiles[raw.activeProfileId] ? raw.activeProfileId : null;
            return state;
        };

        const migrate = (raw) => {
            rejectForbidden(raw, true);
            if (raw?.schemaVersion === STATE_VERSION) return sanitizeV2(raw);
            const state = createDefault();
            state.config = cleanConfig(raw?.config);
            const history = cleanHistory(raw?.history, MAX_PROFILE_HISTORY);
            const manifest = cleanManifest(raw?.manifest);
            if (history.length || Object.keys(manifest).length) {
                const id = `legacy-${uid()}`;
                state.profiles[id] = { id, sourceName: '', targetName: '', bindingStatus: 'unverified', createdAt: nowIso(), lastUsedAt: nowIso(), manifest, directoryManifest: {}, history };
                state.globalHistory = history.slice(0, MAX_GLOBAL_HISTORY);
            }
            return state;
        };

        const load = () => {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return createDefault();
            try { return migrate(JSON.parse(raw)); } catch (error) { console.warn('State reset:', safeMessage(error)); return createDefault(); }
        };
        const save = (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeV2(state)));
        const exportState = (state) => cloneJson(sanitizeV2(state));
        const importText = (text) => {
            if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new Error('JSON file exceeds 5MB');
            const state = migrate(JSON.parse(text));
            for (const profile of Object.values(state.profiles)) profile.bindingStatus = 'unverified';
            return state;
        };
        return Object.freeze({ createDefault, export: exportState, importText, load, migrate, sanitize: sanitizeV2, save });
    })();

    const HandleStore = (() => {
        const memory = new Map();
        let dbPromise = null;
        const open = () => {
            if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
            if (dbPromise) return dbPromise;
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open('file-nally-handles', 2);
                request.onupgradeneeded = () => {
                    if (!request.result.objectStoreNames.contains('pairs')) request.result.createObjectStore('pairs', { keyPath: 'profileId' });
                    if (!request.result.objectStoreNames.contains('runLogs')) request.result.createObjectStore('runLogs', { keyPath: 'id' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
            });
            return dbPromise;
        };
        const list = async () => {
            const values = [...memory.values()];
            try {
                const db = await open();
                const stored = await new Promise((resolve, reject) => {
                    const request = db.transaction('pairs', 'readonly').objectStore('pairs').getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
                for (const item of stored) {
                    if (!memory.has(item.profileId)) memory.set(item.profileId, item);
                    if (!values.some((value) => value.profileId === item.profileId)) values.push(item);
                }
            } catch { /* memory-only safe fallback */ }
            return values;
        };
        const put = async (profileId, sourceHandle, targetHandle) => {
            const record = { profileId, sourceHandle, targetHandle, updatedAt: nowIso() };
            memory.set(profileId, record);
            try {
                const db = await open();
                await new Promise((resolve, reject) => {
                    const request = db.transaction('pairs', 'readwrite').objectStore('pairs').put(record);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            } catch { /* mock handles and private modes may not be cloneable */ }
        };
        const findMatching = async (sourceHandle, targetHandle) => {
            for (const record of await list()) {
                try {
                    if (await sourceHandle.isSameEntry(record.sourceHandle) && await targetHandle.isSameEntry(record.targetHandle)) return record;
                } catch { /* stale handle */ }
            }
            return null;
        };
        const get = async (profileId) => memory.get(profileId) || (await list()).find((record) => record.profileId === profileId) || null;
        const peek = (profileId) => memory.get(profileId) || null;
        const warm = async () => { await list(); };
        return Object.freeze({ findMatching, get, open, peek, put, warm });
    })();

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

    const RunLogStore = (() => {
        const memory = new Map();
        const normalize = (record) => {
            const normalized = cloneJson(record);
            if (Array.isArray(normalized.entries)) normalized.entries = normalized.entries.map((entry) => ({
                ...entry,
                versionId: typeof entry.versionId === 'string' ? entry.versionId : '',
                versionPath: typeof entry.versionPath === 'string' ? entry.versionPath : '',
            }));
            return normalized;
        };
        const requestValue = (request) => new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
        const put = async (record) => {
            const stored = normalize(record);
            memory.set(stored.id, stored);
            try {
                const db = await HandleStore.open();
                await requestValue(db.transaction('runLogs', 'readwrite').objectStore('runLogs').put(stored));
            } catch {}
        };
        const get = async (id) => {
            if (memory.has(id)) return cloneJson(memory.get(id));
            try {
                const db = await HandleStore.open();
                const stored = await requestValue(db.transaction('runLogs', 'readonly').objectStore('runLogs').get(id));
                if (!stored) return null;
                const normalized = normalize(stored);
                memory.set(id, normalized);
                return cloneJson(normalized);
            } catch { return null; }
        };
        const peek = (id) => memory.has(id) ? cloneJson(memory.get(id)) : null;
        const hydrate = async (ids) => { await Promise.all(ids.map((id) => get(id))); };
        const count = async () => {
            try {
                const db = await HandleStore.open();
                return Number(await requestValue(db.transaction('runLogs', 'readonly').objectStore('runLogs').count()));
            } catch { return memory.size; }
        };
        const clear = async () => {
            memory.clear();
            try {
                const db = await HandleStore.open();
                await requestValue(db.transaction('runLogs', 'readwrite').objectStore('runLogs').clear());
            } catch {}
        };
        const prune = async (allowedIds) => {
            const allowed = new Set(allowedIds);
            for (const id of memory.keys()) if (!allowed.has(id)) memory.delete(id);
            try {
                const db = await HandleStore.open();
                const keys = await requestValue(db.transaction('runLogs', 'readonly').objectStore('runLogs').getAllKeys());
                const stale = keys.filter((id) => !allowed.has(id));
                if (!stale.length) return;
                const transaction = db.transaction('runLogs', 'readwrite');
                const store = transaction.objectStore('runLogs');
                await Promise.all(stale.map((id) => requestValue(store.delete(id))));
            } catch {}
        };
        return Object.freeze({ clear, count, get, hydrate, peek, prune, put });
    })();

    const validateFolderPair = async (sourceHandle, targetHandle) => {
        if (await sourceHandle.isSameEntry(targetHandle)) return 'same';
        if (typeof sourceHandle.resolve === 'function' && (await sourceHandle.resolve(targetHandle))?.length) return 'nested';
        if (typeof targetHandle.resolve === 'function' && (await targetHandle.resolve(sourceHandle))?.length) return 'nested';
        return null;
    };

    const directoryEntry = (path) => ({ kind: 'directory', name: safeSegments(path).at(-1), path });
    const renameMatchKey = (trash, copy) => JSON.stringify([trash.side, trash.path, copy.fromSide, copy.sourcePath, copy.toSide]);

    const SyncPlanner = (() => {
        const asMap = (value) => value instanceof Map ? value : new Map(Object.entries(value || {}));
        const asSet = (value) => value instanceof Set ? value : new Set(value || []);
        const snapshot = (file) => file ? { size: Number(file.size), lastModified: Number(file.lastModified) } : null;
        const sameSnapshot = (file, previous) => Boolean(file && previous && Number(file.size) === Number(previous.size) && Number(file.lastModified) === Number(previous.lastModified));
        const depth = (path) => safeSegments(path).length;
        const conflictName = (path, side, stamp) => {
            const parts = safeSegments(path);
            const file = parts.pop();
            const dot = file.lastIndexOf('.');
            const stem = dot > 0 ? file.slice(0, dot) : file;
            const ext = dot > 0 ? file.slice(dot) : '';
            return [...parts, `${stem}.conflict-${side}-${stamp}${ext}`].join('/');
        };

        const plan = ({
            source, target, manifest = {}, sourceDirectories = [], targetDirectories = [],
            directoryManifest = {}, trustedManifest = false, direction = 'bidirectional',
            conflictPolicy = 'latest', contentEquality, renameMatches = [], stamp = runStamp(),
        }) => {
            const src = asMap(source);
            const tgt = asMap(target);
            const exact = asMap(contentEquality);
            const confirmedRenames = asSet(renameMatches);
            const actions = [];
            const rows = [];
            let conflicts = 0;
            const allPaths = new Set([...src.keys(), ...tgt.keys(), ...Object.keys(manifest || {})]);
            const pushCopy = (path, fromSide, toSide, destinationPath = path) => actions.push({ type: 'copy', path, sourcePath: path, destinationPath, fromSide, toSide });
            const resolveConflict = (path, sourceFile, targetFile, sourceStatus, targetStatus) => {
                if (conflictPolicy === 'skip') { conflicts += 1; return { sourceStatus: 'skipped', targetStatus: 'skipped' }; }
                if (conflictPolicy === 'rename') {
                    pushCopy(path, 'source', 'target', conflictName(path, 'source', stamp));
                    pushCopy(path, 'target', 'source', conflictName(path, 'target', stamp));
                    return { sourceStatus: 'copy-out', targetStatus: 'copy-out' };
                }
                if (conflictPolicy === 'source-overwrite') { pushCopy(path, 'source', 'target'); return { sourceStatus: 'copy-out', targetStatus: 'copy-in' }; }
                if (sourceFile.lastModified > targetFile.lastModified) { pushCopy(path, 'source', 'target'); return { sourceStatus: 'copy-out', targetStatus: 'copy-in' }; }
                if (targetFile.lastModified > sourceFile.lastModified) { pushCopy(path, 'target', 'source'); return { sourceStatus: 'copy-in', targetStatus: 'copy-out' }; }
                conflicts += 1;
                return { sourceStatus: sourceStatus || 'conflict', targetStatus: targetStatus || 'conflict' };
            };

            for (const path of allPaths) {
                const sourceFile = src.get(path) || null;
                const targetFile = tgt.get(path) || null;
                const previous = trustedManifest ? manifest[path] : null;
                let sourceStatus = sourceFile ? 'unchanged' : 'missing';
                let targetStatus = targetFile ? 'unchanged' : 'missing';

                if (sourceFile && targetFile) {
                    const hasExactResult = exact.has(path);
                    const sourceEqualsTarget = hasExactResult ? exact.get(path) : sourceFile.size === targetFile.size && sourceFile.lastModified === targetFile.lastModified;
                    if (!previous) {
                        if (sourceEqualsTarget) { actions.push({ type: 'baseline', path }); sourceStatus = targetStatus = 'baseline'; }
                        else if (direction === 'unidirectional') {
                            if (conflictPolicy === 'skip') sourceStatus = targetStatus = 'skipped';
                            else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                        } else if (direction === 'reverse') {
                            if (conflictPolicy === 'skip') sourceStatus = targetStatus = 'skipped';
                            else { pushCopy(path, 'target', 'source'); sourceStatus = 'copy-in'; targetStatus = 'copy-out'; }
                        } else ({ sourceStatus, targetStatus } = resolveConflict(path, sourceFile, targetFile));
                    } else {
                        const sourceChanged = !sameSnapshot(sourceFile, previous.source);
                        const targetChanged = !sameSnapshot(targetFile, previous.target);
                        if (!sourceChanged && !targetChanged && hasExactResult && !sourceEqualsTarget) { sourceStatus = targetStatus = 'conflict'; conflicts += 1; }
                        else if (sourceEqualsTarget && (sourceChanged || targetChanged)) { actions.push({ type: 'baseline', path }); sourceStatus = targetStatus = 'baseline'; }
                        else if (!sourceChanged && !targetChanged) { sourceStatus = targetStatus = 'unchanged'; }
                        else if (direction === 'unidirectional') {
                            if (conflictPolicy === 'skip') sourceStatus = targetStatus = 'skipped';
                            else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                        } else if (direction === 'reverse') {
                            if (conflictPolicy === 'skip') sourceStatus = targetStatus = 'skipped';
                            else { pushCopy(path, 'target', 'source'); sourceStatus = 'copy-in'; targetStatus = 'copy-out'; }
                        } else if (sourceChanged && !targetChanged) { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                        else if (!sourceChanged && targetChanged) { pushCopy(path, 'target', 'source'); sourceStatus = 'copy-in'; targetStatus = 'copy-out'; }
                        else ({ sourceStatus, targetStatus } = resolveConflict(path, sourceFile, targetFile));
                    }
                } else if (sourceFile) {
                    if (direction === 'unidirectional') {
                        pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in';
                    } else if (previous?.source && previous?.target) {
                        if (sameSnapshot(sourceFile, previous.source)) { actions.push({ type: 'trash', path, side: 'source' }); sourceStatus = 'trash'; }
                        else { sourceStatus = 'conflict'; conflicts += 1; }
                    } else if (direction === 'reverse') { sourceStatus = 'protected'; }
                    else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                } else if (targetFile) {
                    if (direction === 'reverse') {
                        pushCopy(path, 'target', 'source'); targetStatus = 'copy-out'; sourceStatus = 'copy-in';
                    } else if (previous?.source && previous?.target) {
                        if (sameSnapshot(targetFile, previous.target)) { actions.push({ type: 'trash', path, side: 'target' }); targetStatus = 'trash'; }
                        else { targetStatus = 'conflict'; conflicts += 1; }
                    } else if (direction === 'bidirectional') { pushCopy(path, 'target', 'source'); targetStatus = 'copy-out'; sourceStatus = 'copy-in'; }
                    else targetStatus = 'protected';
                } else if (previous) actions.push({ type: 'forget', path });

                if (sourceFile || targetFile) rows.push({ kind: 'file', path, source: sourceFile, target: targetFile, sourceStatus, targetStatus });
            }

            // Convert only byte-verified, unambiguous delete/add pairs into renames.
            const trashes = actions.filter((a) => a.type === 'trash');
            const copies = actions.filter((a) => a.type === 'copy' && a.sourcePath === a.destinationPath);
            const matchedTrashIndices = new Set();
            const matchedCopyIndices = new Set();

            for (let i = 0; i < trashes.length; i += 1) {
                const trash = trashes[i];
                const trashFile = trash.side === 'source' ? src.get(trash.path) || (trustedManifest && manifest[trash.path]?.source) : tgt.get(trash.path) || (trustedManifest && manifest[trash.path]?.target);
                if (!trashFile) continue;

                for (let j = 0; j < copies.length; j += 1) {
                    if (matchedCopyIndices.has(j)) continue;
                    const copy = copies[j];
                    const copyFile = copy.fromSide === 'source' ? src.get(copy.sourcePath) : tgt.get(copy.sourcePath);
                    if (!copyFile) continue;

                    if (Number(trashFile.size) === Number(copyFile.size) && trash.side === copy.toSide && confirmedRenames.has(renameMatchKey(trash, copy))) {
                        matchedTrashIndices.add(i);
                        matchedCopyIndices.add(j);
                        copy.type = 'rename';
                        copy.oldPath = trash.path;
                        copy.side = copy.toSide;

                        // Update row status
                        const copyRow = rows.find((r) => r.path === copy.sourcePath);
                        if (copyRow) {
                            if (copy.toSide === 'target') copyRow.targetStatus = 'rename';
                            else copyRow.sourceStatus = 'rename';
                        }
                        break;
                    }
                }
            }

            if (matchedTrashIndices.size > 0) {
                const trashesToRemove = new Set(Array.from(matchedTrashIndices).map((idx) => trashes[idx]));
                for (let i = actions.length - 1; i >= 0; i -= 1) {
                    if (trashesToRemove.has(actions[i])) actions.splice(i, 1);
                }
            }

            const sourceDirs = asSet(sourceDirectories);
            const targetDirs = asSet(targetDirectories);
            const directoryActions = [];
            for (const path of new Set([...sourceDirs, ...targetDirs, ...Object.keys(directoryManifest || {})])) {
                const hasSource = sourceDirs.has(path);
                const hasTarget = targetDirs.has(path);
                const previous = trustedManifest && directoryManifest && Object.hasOwn(directoryManifest, path) ? directoryManifest[path] : null;
                const previousBoth = previous?.source && previous?.target;
                let sourceStatus = hasSource ? 'unchanged' : 'missing';
                let targetStatus = hasTarget ? 'unchanged' : 'missing';
                if (hasSource && hasTarget) {
                    if (!previous) {
                        directoryActions.push({ type: 'baseline-directory', path });
                        sourceStatus = targetStatus = 'baseline-directory';
                    }
                } else if (hasSource) {
                    if (direction === 'unidirectional') {
                        directoryActions.push({ type: 'create-directory', path, side: 'target' });
                        sourceStatus = 'copy-out'; targetStatus = 'create-directory';
                    } else if (previousBoth) {
                        directoryActions.push({ type: 'trash-directory', path, side: 'source' });
                        sourceStatus = 'trash-directory';
                    } else if (direction === 'reverse') sourceStatus = 'protected';
                    else {
                        directoryActions.push({ type: 'create-directory', path, side: 'target' });
                        sourceStatus = 'copy-out'; targetStatus = 'create-directory';
                    }
                } else if (hasTarget) {
                    if (direction === 'reverse') {
                        directoryActions.push({ type: 'create-directory', path, side: 'source' });
                        targetStatus = 'copy-out'; sourceStatus = 'create-directory';
                    } else if (previousBoth) {
                        directoryActions.push({ type: 'trash-directory', path, side: 'target' });
                        targetStatus = 'trash-directory';
                    } else if (direction === 'bidirectional') {
                        directoryActions.push({ type: 'create-directory', path, side: 'source' });
                        targetStatus = 'copy-out'; sourceStatus = 'create-directory';
                    } else targetStatus = 'protected';
                }
                if (hasSource || hasTarget) rows.push({
                    kind: 'directory', path,
                    source: hasSource ? directoryEntry(path) : null,
                    target: hasTarget ? directoryEntry(path) : null,
                    sourceStatus, targetStatus,
                });
            }
            const creates = directoryActions.filter((a) => a.type === 'create-directory').sort((a, b) => depth(a.path) - depth(b.path));
            const baselines = directoryActions.filter((a) => a.type === 'baseline-directory');
            const directoryTrashes = directoryActions.filter((a) => a.type === 'trash-directory').sort((a, b) => depth(b.path) - depth(a.path));
            actions.unshift(...creates, ...baselines);
            actions.push(...directoryTrashes);
            return { id: uid(), stamp, actions, rows, summary: { actions: actions.length, conflicts } };
        };
        return Object.freeze({ plan, snapshot });
    })();

    const FileAdapter = (() => {
        const scan = async (directory, excludes, currentPath = '') => {
            const files = new Map();
            const directories = new Set();
            for await (const entry of directory.values()) {
                const path = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                safeSegments(path);
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    files.set(path, { kind: 'file', name: entry.name, path, size: file.size, lastModified: file.lastModified, handle: entry });
                } else if (!excludes.includes(entry.name)) {
                    directories.add(path);
                    const nested = await scan(entry, excludes, path);
                    for (const [key, value] of nested.files) files.set(key, value);
                    for (const nestedPath of nested.directories) directories.add(nestedPath);
                }
            }
            return { files, directories };
        };
        const compareContent = async (source, target, onProgress, isCancelled) => {
            if (source.size !== target.size) return false;
            const [sourceFile, targetFile] = await Promise.all([source.handle.getFile(), target.handle.getFile()]);
            if (sourceFile.size !== source.size || targetFile.size !== target.size
                || sourceFile.lastModified !== source.lastModified || targetFile.lastModified !== target.lastModified
                || sourceFile.size !== targetFile.size) return false;
            return equalFileBytes(sourceFile, targetFile, onProgress, isCancelled);
        };
        const verifyRenameMatches = async (actions, files, isCancelled) => {
            const trashes = actions.filter((action) => action.type === 'trash');
            const copies = actions.filter((action) => action.type === 'copy' && action.sourcePath === action.destinationPath);
            const matches = [];
            for (let trashIndex = 0; trashIndex < trashes.length; trashIndex += 1) {
                const trash = trashes[trashIndex];
                const trashFile = files[trash.side].get(trash.path);
                if (!trashFile) continue;
                for (let copyIndex = 0; copyIndex < copies.length; copyIndex += 1) {
                    const copy = copies[copyIndex];
                    if (trash.side !== copy.toSide) continue;
                    const copyFile = files[copy.fromSide].get(copy.sourcePath);
                    if (!copyFile || Number(trashFile.size) !== Number(copyFile.size)) continue;
                    if (await compareContent(trashFile, copyFile, () => {}, isCancelled)) {
                        matches.push({ trashIndex, copyIndex, key: renameMatchKey(trash, copy) });
                    }
                }
            }
            const trashCounts = new Map();
            const copyCounts = new Map();
            for (const match of matches) {
                trashCounts.set(match.trashIndex, (trashCounts.get(match.trashIndex) || 0) + 1);
                copyCounts.set(match.copyIndex, (copyCounts.get(match.copyIndex) || 0) + 1);
            }
            return new Set(matches
                .filter((match) => trashCounts.get(match.trashIndex) === 1 && copyCounts.get(match.copyIndex) === 1)
                .map((match) => match.key));
        };
        const copy = async (action, handles) => {
            const sourceRoot = handles[action.fromSide];
            const targetRoot = handles[action.toSide];
            const sourceHandle = await fileHandleFor(sourceRoot, action.sourcePath);
            const sourceFile = await sourceHandle.getFile();
            const parts = safeSegments(action.destinationPath);
            const name = parts.pop();
            const targetDirectory = await directoryFor(targetRoot, parts, true);
            const targetHandle = await targetDirectory.getFileHandle(name, { create: true });
            const writable = await targetHandle.createWritable();
            await writable.write(sourceFile);
            await writable.close();
        };
        const moveToTrash = async (action, handles, stamp) => {
            const root = handles[action.side];
            const sourceHandle = await fileHandleFor(root, action.path);
            const sourceFile = await sourceHandle.getFile();
            const originalParts = safeSegments(action.path);
            const name = originalParts.pop();
            const trashDirectory = await directoryFor(root, ['.trash', stamp, ...originalParts], true);
            let trashName = name;
            for (let suffix = 1; suffix < 10000; suffix += 1) {
                try {
                    await trashDirectory.getFileHandle(trashName);
                    const dot = name.lastIndexOf('.');
                    const stem = dot > 0 ? name.slice(0, dot) : name;
                    const extension = dot > 0 ? name.slice(dot) : '';
                    trashName = `${stem}.${suffix}${extension}`;
                } catch (error) {
                    if (error?.name === 'NotFoundError') break;
                    throw error;
                }
            }
            const trashHandle = await trashDirectory.getFileHandle(trashName, { create: true });
            const writable = await trashHandle.createWritable();
            await writable.write(sourceFile);
            await writable.close();
            const originalDirectory = await directoryFor(root, originalParts, false);
            await originalDirectory.removeEntry(name);
        };
        const createDirectory = async (action, handles) => {
            await directoryFor(handles[action.side], safeSegments(action.path), true);
        };
        const moveDirectoryToTrash = async (action, handles, stamp) => {
            const root = handles[action.side];
            const parts = safeSegments(action.path);
            const name = parts.pop();
            const parent = await directoryFor(root, parts, false);
            const directory = await parent.getDirectoryHandle(name);
            for await (const entry of directory.values()) {
                throw new DOMException(`Directory is not empty: ${entry.name}`, 'InvalidModificationError');
            }
            await directoryFor(root, ['.trash', stamp, ...parts, name], true);
            await parent.removeEntry(name);
        };
        const rename = async (action, handles) => {
            const root = handles[action.side || action.toSide || 'target'];
            const oldPath = action.oldPath || action.sourcePath;
            const newPath = action.destinationPath || action.path;

            const oldParts = safeSegments(oldPath);
            const oldName = oldParts.pop();
            const oldDirectory = await directoryFor(root, oldParts, false);

            const newParts = safeSegments(newPath);
            const newName = newParts.pop();
            const newDirectory = await directoryFor(root, newParts, true);

            const sourceHandle = await oldDirectory.getFileHandle(oldName);

            if (typeof sourceHandle.move === 'function') {
                try {
                    await sourceHandle.move(newDirectory, newName);
                    return;
                } catch {
                    // Fallback to copy + remove
                }
            }

            const sourceFile = await sourceHandle.getFile();
            const newHandle = await newDirectory.getFileHandle(newName, { create: true });
            const writable = await newHandle.createWritable();
            await writable.write(sourceFile);
            await writable.close();
            await oldDirectory.removeEntry(oldName);
        };
        return Object.freeze({ compareContent, copy, createDirectory, moveDirectoryToTrash, moveToTrash, rename, scan, verifyRenameMatches });
    })();

    const elements = {
        btnSrc: $('#btnSrc'), btnTgt: $('#btnTgt'), btnSwap: $('#btnSwapFolders'), pathSrc: $('#pathSrc'), pathTgt: $('#pathTgt'), profileText: $('#profileText'), profileBadge: $('#profileBadge'),
        btnBookmark: $('#btnBookmark'), bookmarkChips: $('#bookmarkChips'), recentChips: $('#recentChips'),
        advancedToggle: $('#btnAdvancedToggle'), advancedToggleLabel: $('#advancedToggleLabel'), advancedSummary: $('#advancedSummary'), advancedControls: $('#advancedControls'),
        directionToggle: $('#syncDirectionToggle'), dirBoth: $('#dirBoth'), dirOne: $('#dirOne'), dirReverse: $('#dirReverse'),
        direction: $('#syncDirection'), policy: $('#conflictPolicy'), comparison: $('#comparisonMode'), excludes: $('#excludeDirs'), btnCompare: $('#btnCompare'), btnSync: $('#btnSync'), btnAbort: $('#btnAbort'),
        status: $('#syncStatus'), statusText: $('#syncStatusText'), phaseLabel: $('#phaseLabel'), progress: $('#progressContainer'), progressText: $('#currentFileText'), progressPercent: $('#progressPercentText'), progressBar: $('#progressBar'), progressFill: $('#progressBar .progress-bar'),
        changedOnly: $('#showChangedOnly'), srcBody: $('#srcFileBody'), tgtBody: $('#tgtFileBody'), srcCount: $('#srcCount'), tgtCount: $('#tgtCount'), log: $('#logBox'), history: $('#historyBody'),
        btnQuickGuide: $('#btnQuickGuide'), quickGuideDialog: $('#quickGuideDialog'), btnCloseQuickGuide: $('#btnCloseQuickGuide'),
        runDetailDialog: $('#runDetailDialog'), runDetailLoading: $('#runDetailLoading'), runDetailContent: $('#runDetailContent'), runDetailBody: $('#runDetailBody'), runDetailTime: $('#runDetailTime'), runDetailDirection: $('#runDetailDirection'), runDetailProcessed: $('#runDetailProcessed'), runDetailStatus: $('#runDetailStatus'), runDetailDuration: $('#runDetailDuration'), runDetailPageStatus: $('#runDetailPageStatus'), btnRunPreviousPage: $('#btnRunPreviousPage'), btnRunNextPage: $('#btnRunNextPage'), btnDownloadRunCsv: $('#btnDownloadRunCsv'), btnDownloadRunJson: $('#btnDownloadRunJson'), btnCloseRunDetail: $('#btnCloseRunDetail'),
    };

    const model = {
        versionBusy: false, appOperation: false,
        state: StateStore.load(), showChangedOnly: sessionStorage.getItem(SHOW_CHANGED_ONLY_KEY) === 'true', source: null, target: null, profile: null, trustedProfile: false, sourceFiles: new Map(), targetFiles: new Map(), sourceDirectories: new Set(), targetDirectories: new Set(), plan: null, phase: 'idle', abortRequested: false, profileConnectionPending: false, logs: [], advancedExpanded: null, selectedRun: null, runDetailPage: 0, runDetailTrigger: null,
    };
    model.advancedExpanded = typeof model.state.ui?.advancedExpanded === 'boolean'
        ? model.state.ui.advancedExpanded
        : !window.matchMedia('(max-width: 760px)').matches;

    const operationBlocked = () => model.versionBusy || model.appOperation || model.profileConnectionPending || ['comparing', 'syncing', 'aborting'].includes(model.phase);
    // One owner for the connected pair, including awaits in pickers and imports.
    const appOperation = (action) => async (...args) => {
        if (operationBlocked()) return;
        model.appOperation = true;
        renderControls();
        try { return await action(...args); }
        finally { model.appOperation = false; renderControls(); }
    };

    const language = () => model.state.config.lang === 'en' ? 'en' : 'ko';
    const t = (key, values) => format(TEXT[language()][key] || TEXT.ko[key] || key, values);
    const makeIcon = (name) => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#icon-${name}`); svg.append(use); return svg;
    };
    const setStatus = (message, tone = 'neutral', iconName = 'info') => {
        const assertive = iconName === 'alert';
        elements.status.setAttribute('role', assertive ? 'alert' : 'status');
        elements.status.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
        elements.status.dataset.tone = tone;
        const oldIcon = elements.status.querySelector('svg');
        oldIcon?.replaceWith(makeIcon(iconName));
        elements.statusText.textContent = message;
    };
    const addLog = (message) => {
        const entry = `[${new Date().toLocaleTimeString(language())}] ${String(message)}`;
        model.logs.push(entry);
        if (model.logs.length > 500) model.logs.shift();
        const line = document.createElement('div'); line.className = 'log-line'; line.textContent = entry;
        elements.log.append(line);
        while (elements.log.children.length > 500) elements.log.firstElementChild.remove();
        elements.log.scrollTop = elements.log.scrollHeight;
    };
    const phaseKey = { idle: 'idle', ready: 'phaseReady', comparing: 'phaseComparing', planned: 'phasePlanned', syncing: 'phaseSyncing', aborting: 'phaseSyncing', success: 'phaseSuccess', error: 'phaseError', aborted: 'phaseAborted' };
    const setPhase = (phase) => { model.phase = phase; elements.phaseLabel.textContent = t(phaseKey[phase] || 'idle'); renderControls(); };
    const renderControls = () => {
        const busy = operationBlocked();
        const paired = Boolean(model.source && model.target && model.profile && model.trustedProfile);
        elements.btnSrc.disabled = busy; elements.btnTgt.disabled = busy;
        elements.direction.disabled = busy; elements.policy.disabled = busy; elements.comparison.disabled = busy; elements.excludes.disabled = busy;
        if (elements.dirBoth) elements.dirBoth.disabled = busy;
        if (elements.dirOne) elements.dirOne.disabled = busy;
        if (elements.dirReverse) elements.dirReverse.disabled = busy;
        elements.btnSwap.disabled = busy || !paired;
        elements.btnCompare.disabled = busy || !paired;
        elements.btnSync.disabled = busy || model.phase !== 'planned' || !model.plan?.actions.length;
        $('#btnVersions').disabled = busy || !paired;
        ['#btnImport', '#fileImporter', '#btnLangKo', '#btnLangEn'].forEach(selector => { $(selector).disabled = busy; });
        elements.btnBookmark.disabled = busy || !model.profile;
        document.querySelectorAll('#recentChips button, #bookmarkChips button').forEach(button => { button.disabled = busy; });
        elements.btnAbort.disabled = !['comparing', 'syncing'].includes(model.phase) || model.abortRequested;
    };
    const renderDirectionToggle = () => {
        const val = model.state.config.direction || 'bidirectional';
        elements.direction.value = val;
        elements.dirBoth?.setAttribute('aria-checked', String(val === 'bidirectional'));
        elements.dirOne?.setAttribute('aria-checked', String(val === 'unidirectional'));
        elements.dirReverse?.setAttribute('aria-checked', String(val === 'reverse'));
    };
    const renderAdvancedControls = () => {
        const expanded = Boolean(model.advancedExpanded);
        elements.advancedToggle.setAttribute('aria-expanded', String(expanded));
        elements.advancedToggleLabel.textContent = t(expanded ? 'hideOptions' : 'showOptions');
        elements.advancedControls.hidden = !expanded;
        const directionKey = model.state.config.direction === 'unidirectional' ? 'directionOneShort' : model.state.config.direction === 'reverse' ? 'directionReverseShort' : 'directionBothShort';
        elements.advancedSummary.textContent = [t(directionKey), elements.policy.selectedOptions[0]?.textContent || '', elements.comparison.selectedOptions[0]?.textContent || ''].filter(Boolean).join(' · ');
    };
    const renderRecentAndBookmarks = () => {
        if (!elements.bookmarkChips || !elements.recentChips) return;
        elements.bookmarkChips.replaceChildren();
        elements.recentChips.replaceChildren();

        const bookmarks = model.state.bookmarks || [];
        const recents = model.state.recentFolders || [];
        const bookmarkedIds = new Set(bookmarks.map((b) => b.profileId));

        if (model.profile) {
            const isBookmarked = bookmarkedIds.has(model.profile.id);
            elements.btnBookmark.dataset.bookmarked = String(isBookmarked);
            elements.btnBookmark.disabled = operationBlocked();
        } else {
            elements.btnBookmark.dataset.bookmarked = 'false';
            elements.btnBookmark.disabled = true;
        }

        for (const b of bookmarks) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip chip-bookmark';
            chip.textContent = `★ ${b.sourceName || '?'} ⇄ ${b.targetName || '?'}`;
            chip.disabled = operationBlocked();
            chip.addEventListener('click', () => Controller.selectProfile(b.profileId));
            elements.bookmarkChips.append(chip);
        }

        for (const r of recents) {
            if (bookmarkedIds.has(r.profileId)) continue;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.textContent = `🕒 ${r.sourceName || '?'} ⇄ ${r.targetName || '?'}`;
            chip.disabled = operationBlocked();
            chip.addEventListener('click', () => Controller.selectProfile(r.profileId));
            elements.recentChips.append(chip);
        }
    };
    const renderStaticText = () => {
        document.documentElement.lang = language();
        document.querySelectorAll('[data-i18n]').forEach((node) => { const key = node.dataset.i18n; if (TEXT[language()][key]) node.textContent = TEXT[language()][key]; });
        $('#btnLangKo').setAttribute('aria-pressed', String(language() === 'ko'));
        $('#btnLangEn').setAttribute('aria-pressed', String(language() === 'en'));
        $('.language-switch').setAttribute('aria-label', t('languageLabel'));
        elements.progressBar.setAttribute('aria-label', t('progressLabel'));
        $('#workspaceResults').setAttribute('aria-label', t('workspaceLabel'));
        $('#activityResults').setAttribute('aria-label', t('activityLabel'));
        elements.excludes.value = model.state.config.excludeDirs.join(', ');
        elements.direction.value = model.state.config.direction;
        elements.policy.value = model.state.config.conflictPolicy;
        elements.comparison.value = model.state.config.comparisonMode;
        elements.changedOnly.checked = model.showChangedOnly;
        renderDirectionToggle();
        renderAdvancedControls();
        renderRecentAndBookmarks();
        renderPaths(); renderProfile(); renderHistory(); renderRows(); renderControls();
    };
    const renderPaths = () => {
        elements.pathSrc.textContent = model.source?.name || t('notSelected');
        elements.pathSrc.title = model.source?.name || '';
        elements.pathTgt.textContent = model.target?.name || t('notSelected');
        elements.pathTgt.title = model.target?.name || '';
    };
    const renderProfile = () => {
        if (!model.profile) {
            elements.profileText.textContent = t('profileNone');
            elements.profileBadge.dataset.verified = 'false';
            elements.profileBadge.querySelector('span').textContent = t('profileUnverified');
            renderRecentAndBookmarks();
            return;
        }
        elements.profileText.textContent = t('profileLabel', { source: model.profile.sourceName, target: model.profile.targetName });
        elements.profileBadge.dataset.verified = String(model.trustedProfile);
        elements.profileBadge.querySelector('span').textContent = t(model.trustedProfile ? 'profileVerified' : 'profileUnverified');
        renderRecentAndBookmarks();
    };
    const statusPresentation = (code) => ({
        unchanged: ['statusUnchanged', 'neutral'], baseline: ['statusBaseline', 'info'], 'copy-out': ['statusCopyOut', 'success'], 'copy-in': ['statusCopyIn', 'info'], trash: ['statusTrash', 'danger'], 'create-directory': ['statusCreateDirectory', 'success'], 'baseline-directory': ['statusBaselineDirectory', 'info'], 'trash-directory': ['statusTrashDirectory', 'danger'], conflict: ['statusConflict', 'warning'], skipped: ['statusSkipped', 'warning'], protected: ['statusProtected', 'neutral'], missing: ['statusNew', 'neutral'], rename: ['statusRename', 'info'],
    }[code] || ['statusUnchanged', 'neutral']);
    const appendEmptyRow = (body, text) => { body.replaceChildren(); const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = 'empty-cell'; cell.textContent = text; };
    const appendEntryRow = (body, entry, path, status) => {
        const row = body.insertRow();
        const nameCell = row.insertCell();
        const isDirectory = entry.kind === 'directory';
        const name = document.createElement('div'); name.className = 'file-name'; name.textContent = isDirectory ? `${entry.name}/` : entry.name;
        const pathText = document.createElement('div'); pathText.className = 'file-path'; pathText.textContent = isDirectory ? `${path}/` : path;
        nameCell.append(name, pathText);
        row.insertCell().textContent = isDirectory ? '—' : entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`;
        row.insertCell().textContent = isDirectory ? '—' : new Date(entry.lastModified).toLocaleString(language());
        const statusCell = row.insertCell();
        const [key, tone] = statusPresentation(status);
        const badge = document.createElement('span'); badge.className = `badge badge-${tone}`; badge.textContent = t(key);
        statusCell.append(badge);
    };
    const renderRows = () => {
        elements.srcBody.replaceChildren(); elements.tgtBody.replaceChildren();
        const rows = model.plan?.rows || [...new Set([...model.sourceFiles.keys(), ...model.targetFiles.keys(), ...model.sourceDirectories, ...model.targetDirectories])].map((path) => ({
            path,
            source: model.sourceFiles.get(path) || (model.sourceDirectories.has(path) ? directoryEntry(path) : null),
            target: model.targetFiles.get(path) || (model.targetDirectories.has(path) ? directoryEntry(path) : null),
            sourceStatus: 'unchanged',
            targetStatus: 'unchanged',
        }));
        const visibleRows = model.showChangedOnly ? rows.filter((row) => !['unchanged', 'baseline', 'baseline-directory'].includes(row.sourceStatus) || !['unchanged', 'baseline', 'baseline-directory'].includes(row.targetStatus)) : rows;
        for (const row of visibleRows) {
            if (row.source) appendEntryRow(elements.srcBody, row.source, row.path, row.sourceStatus);
            else if (row.sourceStatus === 'create-directory') appendEntryRow(elements.srcBody, directoryEntry(row.path), row.path, row.sourceStatus);
            if (row.target) appendEntryRow(elements.tgtBody, row.target, row.path, row.targetStatus);
            else if (row.targetStatus === 'create-directory') appendEntryRow(elements.tgtBody, directoryEntry(row.path), row.path, row.targetStatus);
        }
        const emptyKey = model.showChangedOnly ? 'emptyChangedFiles' : 'emptyFiles';
        if (!elements.srcBody.children.length) appendEmptyRow(elements.srcBody, t(emptyKey));
        if (!elements.tgtBody.children.length) appendEmptyRow(elements.tgtBody, t(emptyKey));
        elements.srcCount.textContent = String(visibleRows.filter((row) => row.source).length);
        elements.tgtCount.textContent = String(visibleRows.filter((row) => row.target).length);
    };
    const directionText = (direction) => t(direction === 'unidirectional' ? 'directionOneShort' : direction === 'reverse' ? 'directionReverseShort' : 'directionBothShort');
    const runStatusText = (status) => t(status === 'success' ? 'success' : status === 'aborted' ? 'aborted' : 'failed');
    const entryStatusText = (status) => t(status === 'success' ? 'entrySuccess' : status === 'failed' ? 'entryFailed' : 'entryNotRun');
    const actionText = (action) => t({ copy: 'actionCopy', rename: 'actionRename', trash: 'actionTrash', baseline: 'actionBaseline', 'create-directory': 'actionCreateDirectory', 'baseline-directory': 'actionBaselineDirectory', 'trash-directory': 'actionTrashDirectory' }[action] || 'actionUnknown');
    const renderRunDetails = () => {
        const run = model.selectedRun;
        if (!run) return;
        const headerRow = elements.runDetailBody.closest('table').tHead.rows[0];
        if (!headerRow.querySelector('[data-i18n="versionIdHead"]')) headerRow.cells[3].before(...['versionIdHead', 'versionPathHead'].map((key) => {
            const head = document.createElement('th'); head.dataset.i18n = key; head.textContent = t(key); return head;
        }));
        const totalPages = Math.max(1, Math.ceil(run.entries.length / RUN_LOG_PAGE_SIZE));
        model.runDetailPage = Math.min(model.runDetailPage, totalPages - 1);
        const start = model.runDetailPage * RUN_LOG_PAGE_SIZE;
        elements.runDetailBody.replaceChildren();
        for (const entry of run.entries.slice(start, start + RUN_LOG_PAGE_SIZE)) {
            const row = elements.runDetailBody.insertRow();
            const values = [
                [t('sequenceHead'), String(entry.sequence)],
                [t('actionHead'), actionText(entry.action)],
                [t('pathHead'), entry.path],
                [t('versionIdHead'), entry.versionId || '—'],
                [t('versionPathHead'), entry.versionPath ? `.filenally/${entry.versionPath}` : '—'],
                [t('durationHead'), `${Math.max(0, Number(entry.durationMs) || 0)} ms`],
                [t('stateHead'), entryStatusText(entry.status)],
                [t('errorHead'), entry.error || '—'],
            ];
            for (const [label, value] of values) {
                const cell = row.insertCell();
                cell.dataset.label = label;
                cell.textContent = value;
            }
        }
        elements.runDetailTime.textContent = new Date(run.startedAt).toLocaleString(language());
        elements.runDetailDirection.textContent = directionText(run.direction);
        elements.runDetailProcessed.textContent = `${run.completed}/${run.total}`;
        elements.runDetailStatus.textContent = runStatusText(run.status);
        elements.runDetailDuration.textContent = `${Math.max(0, Number(run.durationMs) || 0)} ms`;
        elements.runDetailPageStatus.textContent = `${model.runDetailPage + 1} / ${totalPages}`;
        elements.btnRunPreviousPage.disabled = model.runDetailPage === 0;
        elements.btnRunNextPage.disabled = model.runDetailPage >= totalPages - 1;
    };
    const showRunDetails = (run) => {
        if (!run) {
            elements.runDetailLoading.textContent = t('detailsUnavailable');
            return;
        }
        model.selectedRun = run;
        elements.runDetailLoading.hidden = true;
        elements.runDetailContent.hidden = false;
        renderRunDetails();
    };
    const openRunDetails = (item, trigger) => {
        model.selectedRun = null;
        model.runDetailPage = 0;
        model.runDetailTrigger = trigger;
        elements.runDetailLoading.textContent = t('loadingDetails');
        elements.runDetailLoading.hidden = false;
        elements.runDetailContent.hidden = true;
        if (!elements.runDetailDialog.open) elements.runDetailDialog.showModal();
        const cached = RunLogStore.peek(item.logId);
        if (cached) showRunDetails(cached);
        else RunLogStore.get(item.logId).then(showRunDetails);
    };
    const renderHistory = () => {
        elements.history.replaceChildren();
        const history = model.profile?.history || model.state.globalHistory || [];
        if (!history.length) { const row = elements.history.insertRow(); const cell = row.insertCell(); cell.colSpan = 5; cell.className = 'empty-cell'; cell.textContent = t('emptyHistory'); return; }
        for (const item of history.slice(0, MAX_PROFILE_HISTORY)) {
            const row = elements.history.insertRow();
            row.insertCell().textContent = item.time;
            row.insertCell().textContent = directionText(item.direction);
            row.insertCell().textContent = item.totalFiles ? `${item.filesCount}/${item.totalFiles}` : String(item.filesCount);
            row.insertCell().textContent = runStatusText(item.status);
            const detailCell = row.insertCell();
            if (item.logId) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'button-ghost history-detail-button';
                button.textContent = t('details');
                button.setAttribute('aria-label', `${t('details')}: ${item.time}`);
                button.addEventListener('click', () => openRunDetails(item, button));
                detailCell.append(button);
            }
        }
    };
    const formatBytes = (value) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
    const updateProgress = (current, total, path = '', unit = 'items') => {
        const percent = total ? Math.round((current / total) * 100) : 0;
        const detail = unit === 'bytes' ? `${formatBytes(current)} / ${formatBytes(total)}` : `${current}/${total}`;
        elements.progress.dataset.visible = 'true'; elements.progressText.textContent = path || t('preparing'); elements.progressPercent.textContent = `${percent}% (${detail})`;
        elements.progressFill.style.width = `${percent}%`; elements.progressBar.setAttribute('aria-valuenow', String(percent));
    };

    const buildManifest = (sourceFiles, targetFiles) => {
        const manifest = {};
        const allPaths = new Set([...sourceFiles.keys(), ...targetFiles.keys()]);
        for (const path of allPaths) manifest[path] = { source: SyncPlanner.snapshot(sourceFiles.get(path)), target: SyncPlanner.snapshot(targetFiles.get(path)) };
        return manifest;
    };
    const buildDirectoryManifest = (sourceDirectories, targetDirectories) => {
        const manifest = Object.create(null);
        for (const path of new Set([...sourceDirectories, ...targetDirectories])) {
            manifest[path] = { source: sourceDirectories.has(path), target: targetDirectories.has(path) };
        }
        return manifest;
    };
    const applyScans = (sourceScan, targetScan) => {
        model.sourceFiles = sourceScan.files;
        model.targetFiles = targetScan.files;
        model.sourceDirectories = sourceScan.directories;
        model.targetDirectories = targetScan.directories;
    };

    const SyncExecutor = (() => {
        const run = async (plan, context) => {
            const startedAt = nowIso();
            const startedMs = Date.now();
            let completed = 0;
            const entries = plan.actions.map((action, index) => ({
                sequence: index + 1,
                action: action.type,
                path: action.path || action.sourcePath || action.destinationPath || '',
                sourcePath: action.sourcePath || action.path || '',
                destinationPath: action.destinationPath || action.path || '',
                fromSide: action.fromSide || '',
                toSide: action.toSide || '',
                startedAt: '',
                endedAt: '',
                durationMs: 0,
                status: 'not-run',
                error: '',
                versionId: '',
                versionPath: '',
            }));
            const finish = (status, errors) => {
                const endedAt = nowIso();
                const runLog = { id: plan.id, profileId: context.profile.id, startedAt, endedAt, durationMs: Date.now() - startedMs, direction: context.direction, status, completed, total: plan.actions.length, errors, entries };
                return { status, completed, total: plan.actions.length, errors, runLog };
            };
            for (let index = 0; index < plan.actions.length; index += 1) {
                const action = plan.actions[index];
                if (model.abortRequested) return finish('aborted', []);
                updateProgress(completed, plan.actions.length, action.path);
                const entry = entries[index];
                const actionStartedMs = Date.now();
                entry.startedAt = nowIso();
                try {
                    if (action.type === 'copy' || action.type === 'rename') {
                        const version = await VersionStore.capture({
                            action,
                            handles: context.handles,
                            runId: plan.id,
                            direction: context.direction,
                        });
                        if (version) {
                            entry.versionId = version.id;
                            entry.versionPath = version.storedPath;
                        }
                    }
                    if (action.type === 'copy') await FileAdapter.copy(action, context.handles);
                    else if (action.type === 'rename') await FileAdapter.rename(action, context.handles);
                    else if (action.type === 'trash') await FileAdapter.moveToTrash(action, context.handles, plan.stamp);
                    else if (action.type === 'create-directory') await FileAdapter.createDirectory(action, context.handles);
                    else if (action.type === 'trash-directory') await FileAdapter.moveDirectoryToTrash(action, context.handles, plan.stamp);
                } catch (error) {
                    entry.endedAt = nowIso();
                    entry.durationMs = Date.now() - actionStartedMs;
                    entry.status = 'failed';
                    entry.error = safeMessage(error);
                    return finish('failed', [entry.error]);
                }
                entry.endedAt = nowIso();
                entry.durationMs = Date.now() - actionStartedMs;
                entry.status = 'success';
                completed += 1;
                context.profile.lastCheckpoint = { planId: plan.id, completed, total: plan.actions.length, updatedAt: nowIso() };
                StateStore.save(context.state);
            }
            updateProgress(completed, plan.actions.length, '');
            return finish('success', []);
        };
        return Object.freeze({ run });
    })();

    const Controller = (() => {
        const saveConfig = () => {
            if (operationBlocked()) return;
            model.state.config = { direction: elements.direction.value, conflictPolicy: elements.policy.value, comparisonMode: elements.comparison.value, excludeDirs: normalizeExcludes(elements.excludes.value), lang: language() };
            StateStore.save(model.state);
        };
        const invalidatePlan = () => { model.plan = null; if (model.source && model.target && model.profile) setPhase('ready'); else setPhase('idle'); renderRows(); };
        const bindPair = async () => {
            if (!model.source || !model.target) return;
            const problem = await validateFolderPair(model.source, model.target);
            if (problem) {
                model.profile = null; model.trustedProfile = false; model.target = null; elements.pathTgt.textContent = t('notSelected'); elements.pathTgt.title = '';
                setPhase('error'); setStatus(t(problem === 'same' ? 'sameFolder' : 'nestedFolder'), 'danger', 'alert'); renderProfile(); return;
            }
            const matching = await HandleStore.findMatching(model.source, model.target);
            let profile = matching ? model.state.profiles[matching.profileId] : null;
            if (!profile) {
                const id = uid();
                profile = { id, sourceName: model.source.name, targetName: model.target.name, bindingStatus: 'verified', createdAt: nowIso(), lastUsedAt: nowIso(), manifest: {}, directoryManifest: {}, history: [] };
                model.state.profiles[id] = profile;
            }
            profile.sourceName = model.source.name; profile.targetName = model.target.name; profile.bindingStatus = 'verified'; profile.lastUsedAt = nowIso();
            model.state.activeProfileId = profile.id; model.profile = profile; model.trustedProfile = true;
            const recents = model.state.recentFolders.filter((r) => r.profileId !== profile.id);
            recents.unshift({ profileId: profile.id, sourceName: profile.sourceName, targetName: profile.targetName, lastUsedAt: nowIso() });
            model.state.recentFolders = recents.slice(0, MAX_RECENT_FOLDERS);
            await HandleStore.put(profile.id, model.source, model.target); StateStore.save(model.state);
            setPhase('ready'); setStatus(t('pairReady'), 'success', 'check'); renderProfile(); renderHistory();
        };
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
            try {
                const record = HandleStore.peek(profileId) || await HandleStore.get(profileId);
                if (!record) {
                    setStatus(t('storedHandleMissing'), 'warning', 'alert');
                    addLog(t('storedHandleMissing'));
                    return false;
                }
                const permission = requestPermission
                    ? await PermissionGate.request(record)
                    : await PermissionGate.inspect(record);
                if (permission.state !== 'granted') {
                    const key = permission.state === 'denied'
                        ? 'permissionDenied'
                        : permission.state === 'prompt'
                            ? 'permissionNeedsAction'
                            : 'storedHandleUnavailable';
                    setStatus(t(key), permission.state === 'unavailable' ? 'danger' : 'warning', 'alert');
                    addLog(t(key));
                    return false;
                }
                model.source = record.sourceHandle;
                model.target = record.targetHandle;
                model.trustedProfile = profile.bindingStatus === 'verified';
                renderPaths();
                setPhase('ready');
                setStatus(t(requestPermission ? 'permissionRestored' : 'pairReady'), 'success', 'check');
                renderProfile();
                renderHistory();
                renderRows();
                return true;
            } finally {
                model.profileConnectionPending = false;
                renderRecentAndBookmarks();
                renderControls();
            }
        };
        const selectProfile = (profileId) => connectStoredProfile(profileId, { requestPermission: true });
        const swapFolders = async () => {
            if (!model.source || !model.target || !model.profile || !model.trustedProfile || ['comparing', 'syncing', 'aborting'].includes(model.phase)) return;
            elements.btnSwap.disabled = true;
            [model.source, model.target] = [model.target, model.source];
            model.profile = null;
            model.trustedProfile = false;
            model.plan = null;
            renderPaths();
            renderRows();
            await bindPair();
            setStatus(t('foldersSwapped'), 'success', 'check');
            addLog(t('foldersSwapped'));
        };
        const toggleBookmark = () => {
            if (operationBlocked() || !model.profile) return;
            const id = model.profile.id;
            const existingIndex = model.state.bookmarks.findIndex((b) => b.profileId === id);
            if (existingIndex >= 0) {
                model.state.bookmarks.splice(existingIndex, 1);
                setStatus(t('bookmarkRemoved'), 'info', 'info');
            } else {
                model.state.bookmarks.unshift({
                    profileId: id,
                    sourceName: model.profile.sourceName,
                    targetName: model.profile.targetName,
                    createdAt: nowIso(),
                });
                model.state.bookmarks = model.state.bookmarks.slice(0, MAX_BOOKMARKS);
                setStatus(t('bookmarkAdded'), 'success', 'check');
            }
            StateStore.save(model.state);
            renderRecentAndBookmarks();
        };
        const pick = async (side) => {
            try {
                const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                model[side] = handle;
                const pathElement = side === 'source' ? elements.pathSrc : elements.pathTgt;
                pathElement.textContent = handle.name; pathElement.title = handle.name;
                addLog(t('selected', { name: handle.name })); invalidatePlan(); await bindPair();
            } catch (error) {
                if (error?.name === 'AbortError') setStatus(t('pickCancelled'), 'warning', 'info');
                else setStatus(t('pickFailed', { message: safeMessage(error) }), 'danger', 'alert');
            }
        };
        const compare = async () => {
            if (!model.profile || !model.source || !model.target) return;
            model.abortRequested = false;
            setPhase('comparing'); setStatus(t('comparing'), 'info', 'compare'); elements.progress.dataset.visible = 'false';
            try {
                const excludes = normalizeExcludes(elements.excludes.value);
                const [sourceScan, targetScan] = await Promise.all([
                    FileAdapter.scan(model.source, excludes),
                    FileAdapter.scan(model.target, excludes),
                ]);
                applyScans(sourceScan, targetScan);
                if (model.abortRequested) throw new DOMException('Comparison stopped', 'AbortError');
                const contentEquality = new Map();
                if (elements.comparison.value === 'exact') {
                    const pairs = [...model.sourceFiles.entries()].filter(([path]) => model.targetFiles.has(path));
                    const totalBytes = pairs.reduce((total, [path, source]) => {
                        const target = model.targetFiles.get(path);
                        return total + (source.size === target.size ? source.size * 2 : 0);
                    }, 0);
                    let completedBytes = 0;
                    for (const [path, source] of pairs) {
                        if (model.abortRequested) throw new DOMException('Comparison stopped', 'AbortError');
                        const target = model.targetFiles.get(path);
                        if (source.size !== target.size) contentEquality.set(path, false);
                        else {
                            const equal = await FileAdapter.compareContent(source, target, (current) => {
                                updateProgress(completedBytes + current, totalBytes, path, 'bytes');
                            }, () => model.abortRequested);
                            contentEquality.set(path, equal);
                            completedBytes += source.size * 2;
                        }
                    }
                }
                const planOptions = { source: model.sourceFiles, target: model.targetFiles, manifest: model.profile.manifest, sourceDirectories: model.sourceDirectories, targetDirectories: model.targetDirectories, directoryManifest: model.profile.directoryManifest, trustedManifest: model.trustedProfile, direction: elements.direction.value, conflictPolicy: elements.policy.value, contentEquality, stamp: runStamp() };
                const initialPlan = SyncPlanner.plan(planOptions);
                const renameMatches = await FileAdapter.verifyRenameMatches(initialPlan.actions, { source: model.sourceFiles, target: model.targetFiles }, () => model.abortRequested);
                model.plan = renameMatches.size ? SyncPlanner.plan({ ...planOptions, renameMatches }) : initialPlan;
                renderRows();
                setPhase(model.plan.actions.length ? 'planned' : 'ready');
                setStatus(t(model.plan.actions.length ? 'compareDone' : 'compareNone', { count: model.plan.actions.length }), model.plan.summary.conflicts ? 'warning' : 'success', model.plan.summary.conflicts ? 'alert' : 'check');
                addLog(t(model.plan.actions.length ? 'compareDone' : 'compareNone', { count: model.plan.actions.length }));
            } catch (error) {
                model.plan = null;
                if (error?.name === 'AbortError' && model.abortRequested) {
                    elements.progress.dataset.visible = 'false'; setPhase('ready'); setStatus(t('compareStopped'), 'warning', 'stop'); addLog(t('compareStopped'));
                } else {
                    setPhase('error'); setStatus(t('compareFailed', { message: safeMessage(error) }), 'danger', 'alert'); addLog(t('compareFailed', { message: safeMessage(error) }));
                }
            } finally { model.abortRequested = false; renderControls(); }
        };
        const sync = async () => {
            if (!model.plan?.actions.length || !model.profile) return;
            const plan = model.plan; model.abortRequested = false; setPhase('syncing'); setStatus(t('syncing', { current: 0, total: plan.actions.length }), 'info', 'sync'); updateProgress(0, plan.actions.length);
            try {
                const result = await SyncExecutor.run(plan, { handles: { source: model.source, target: model.target }, profile: model.profile, state: model.state, direction: elements.direction.value });
                await RunLogStore.put(result.runLog);
                const excludes = normalizeExcludes(elements.excludes.value);
                const [sourceScan, targetScan] = await Promise.all([
                    FileAdapter.scan(model.source, excludes),
                    FileAdapter.scan(model.target, excludes),
                ]);
                applyScans(sourceScan, targetScan);
                model.profile.manifest = buildManifest(model.sourceFiles, model.targetFiles);
                model.profile.directoryManifest = buildDirectoryManifest(model.sourceDirectories, model.targetDirectories);
                if (result.status !== 'failed') delete model.profile.lastCheckpoint;
                const history = { time: new Date(result.runLog.startedAt).toLocaleString(language()), logId: result.runLog.id, startedAt: result.runLog.startedAt, endedAt: result.runLog.endedAt, durationMs: result.runLog.durationMs, direction: result.runLog.direction, filesCount: result.completed, totalFiles: result.total, status: result.status };
                model.profile.history.unshift(history); model.profile.history = model.profile.history.slice(0, MAX_PROFILE_HISTORY); model.state.globalHistory.unshift(history); model.state.globalHistory = model.state.globalHistory.slice(0, MAX_GLOBAL_HISTORY); StateStore.save(model.state);
                await RunLogStore.prune(model.state.globalHistory.map((item) => item.logId).filter(Boolean));
                model.plan = null; renderHistory(); renderRows();
                if (result.status === 'aborted') { setPhase('aborted'); setStatus(t('syncAborted', { count: result.completed }), 'warning', 'stop'); }
                else if (result.status === 'failed') { setPhase('error'); setStatus(t('syncFailed', { message: result.errors[0] || 'Unknown error' }), 'danger', 'alert'); }
                else { setPhase('success'); setStatus(t('syncDone', { count: result.completed }), 'success', 'check'); }
                addLog(elements.statusText.textContent);
            } catch (error) {
                setPhase('error'); setStatus(t('syncFailed', { message: safeMessage(error) }), 'danger', 'alert'); addLog(t('syncFailed', { message: safeMessage(error) }));
            } finally { model.abortRequested = false; renderControls(); }
        };
        const abort = () => {
            if (model.phase === 'comparing') { model.abortRequested = true; setStatus(t('compareStopping'), 'warning', 'stop'); renderControls(); }
            else if (model.phase === 'syncing') { model.abortRequested = true; setPhase('aborting'); setStatus(t('aborting'), 'warning', 'stop'); }
        };
        const importState = async (file) => {
            try {
                if (file.size > MAX_IMPORT_BYTES) throw new Error('JSON file exceeds 5MB');
                model.state = StateStore.importText(await file.text()); model.source = model.target = model.profile = null; model.trustedProfile = false; model.plan = null; StateStore.save(model.state); setPhase('idle'); renderStaticText(); setStatus(t('importDone'), 'success', 'check'); addLog(t('importDone'));
            } catch (error) { setPhase('error'); setStatus(t('importFailed', { message: safeMessage(error) }), 'danger', 'alert'); }
        };
        return Object.freeze({ abort, bindPair: appOperation(bindPair), compare: appOperation(compare), connectStoredProfile: appOperation(connectStoredProfile), importState: appOperation(importState), invalidatePlan, pick: appOperation(pick), saveConfig, selectProfile: appOperation(selectProfile), swapFolders: appOperation(swapFolders), sync: appOperation(sync), toggleBookmark });
    })();

    const downloadBlob = (blob, name) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const downloadText = (content, name, type) => downloadBlob(new Blob([content], { type }), name);
    const downloadJson = (data, name) => downloadText(JSON.stringify(data, null, 2), name, 'application/json');
    const VersionManager = (() => {
        const dialog = $('#versionDialog');
        const restoreDialog = $('#restoreDialog');
        const comparisonDialog = $('#comparisonDialog');
        let session = null;
        const current = (owner) => session === owner && dialog.open && owner.roots.source === model.source && owner.roots.target === model.target;
        const comparisonCurrent = (owner, child) => current(owner) && owner.comparison === child && comparisonDialog.open;
        const rootLabel = (owner, side) => `${t(side === 'source' ? 'sourceTitle' : 'targetTitle')} · ${owner.names[side]}`;
        const directionLabel = (owner) => t(owner.direction === 'unidirectional' ? 'directionOne' : owner.direction === 'reverse' ? 'directionReverse' : 'directionBoth');
        const node = (tag, text, className) => {
            const element = document.createElement(tag);
            element.textContent = text;
            if (className) element.className = className;
            return element;
        };
        const controls = () => {
            const owner = session;
            if (!owner) return;
            const busy = owner.reading || owner.writing;
            const childOpen = Boolean(owner.comparison);
            $('#btnVersionRefresh').disabled = busy || restoreDialog.open || childOpen;
            $('#btnVersionPrevious').disabled = busy || childOpen || owner.page === 0;
            $('#btnVersionNext').disabled = busy || childOpen || (owner.page + 1) * 100 >= owner.rows.length;
            $('#btnCloseVersions').disabled = owner.writing;
            $('#btnConfirmRestore').disabled = owner.writing || childOpen || !owner.selection;
            $('#btnCancelRestore').disabled = owner.writing;
            dialog.querySelectorAll('[data-version-action]').forEach(button => { button.disabled = busy || childOpen; });
            renderControls();
        };
        const render = () => {
            const owner = session;
            if (!owner) return;
            const body = $('#versionBody');
            body.replaceChildren();
            for (const row of owner.rows.slice(owner.page * 100, (owner.page + 1) * 100)) {
                const tr = document.createElement('tr');
                const values = [rootLabel(owner, row.side), row.record.originalPath, new Date(row.record.capturedAt).toLocaleString(language()), `${row.record.size} B`, t(row.record.reason === 'before-restore' ? 'beforeRestore' : 'beforeOverwrite')];
                const labels = ['owningRoot', 'pathHead', 'capturedAt', 'sizeHead', 'versionReason'];
                values.forEach((value, i) => {
                    const td = node('td', ''); td.dataset.label = t(labels[i]);
                    const content = node('span', value);
                    if (i === 1) content.append(node('span', row.record.id, 'version-id'));
                    td.append(content); tr.append(td);
                });
                const actions = node('td', ''); actions.dataset.label = t('actionHead');
                const buttons = node('div', '', 'version-row-actions');
                for (const action of ['compare', 'download', 'restore']) {
                    const labels = { compare: 'versionCompare', download: 'versionDownload', restore: 'versionRestore' };
                    const button = node('button', t(labels[action]), 'button-ghost');
                    button.type = 'button'; button.dataset.versionAction = action;
                    button.setAttribute('aria-label', `${button.textContent} · ${row.record.originalPath} · ${rootLabel(owner, row.side)}`);
                    button.addEventListener('click', () => select(row, action, button)); buttons.append(button);
                }
                actions.append(buttons); tr.append(actions); body.append(tr);
            }
            $('#versionPageStatus').textContent = `${owner.page + 1} / ${Math.max(1, Math.ceil(owner.rows.length / 100))}`;
            $('#versionDirection').textContent = t('versionDirection', { direction: directionLabel(owner) });
            $('#versionStatus').textContent = [owner.message, ...owner.errors, !owner.rows.length && !owner.reading ? t('versionsEmpty') : ''].filter(Boolean).join('\n');
            controls();
        };
        const refresh = async (keepMessage = false) => {
            const owner = session;
            if (!owner || owner.reading || owner.writing || owner.comparison || restoreDialog.open) return;
            owner.reading = true;
            if (!keepMessage) owner.message = t('versionsLoading');
            render();
            try {
                const sides = ['source', 'target'];
                const results = await Promise.allSettled(sides.map(side => VersionStore.list(owner.roots[side])));
                if (!current(owner)) return;
                owner.rows = []; owner.errors = []; owner.page = 0;
                results.forEach((result, i) => {
                    const side = sides[i];
                    if (result.status === 'fulfilled') owner.rows.push(...result.value.map(record => ({ side, root: owner.roots[side], record })));
                    else owner.errors.push(`${rootLabel(owner, side)}: ${safeMessage(result.reason)}`);
                });
                owner.rows.sort((a, b) => Date.parse(b.record.capturedAt) - Date.parse(a.record.capturedAt) || a.side.localeCompare(b.side) || a.record.id.localeCompare(b.record.id));
                if (!keepMessage) owner.message = '';
            } finally {
                if (current(owner)) { owner.reading = false; render(); }
            }
        };
        const summary = (owner, row, prepared) => {
            const container = $('#restoreSummary'); container.replaceChildren();
            container.append(node('p', t(prepared.currentFile ? 'restoreReplace' : 'restoreCreate')));
            container.append(node('p', t('versionDirection', { direction: directionLabel(owner) })));
            for (const selected of [true, false]) {
                const section = node('section', '');
                section.append(node('h3', t(selected ? 'selectedVersion' : 'currentFile')));
                const file = selected ? prepared.versionFile : prepared.currentFile;
                const fields = [['owningRoot', rootLabel(owner, row.side)], ['pathHead', row.record.originalPath]];
                if (file) fields.push(['sizeHead', `${file.size} B`], ['dateHead', new Date(selected ? row.record.lastModified : file.lastModified).toLocaleString(language())]);
                if (selected) fields.push(['capturedAt', new Date(row.record.capturedAt).toLocaleString(language())], ['versionIdHead', row.record.id]);
                const dl = node('dl', '');
                for (const [label, value] of fields) dl.append(node('dt', t(label)), node('dd', value));
                section.append(dl); container.append(section);
            }
        };
        const clearComparisonOutput = (owner, child) => {
            if (!comparisonCurrent(owner, child)) return;
            child.result = null; child.metadata = null; child.resultPage = 0;
            $('#comparisonBody').replaceChildren();
            $('#comparisonSummary').replaceChildren(node('p', `${t('comparisonLeft')} · ${t('selectedVersion')} · ${rootLabel(owner, child.row.side)} · ${child.row.record.originalPath} · ${child.row.record.id}`));
            $('#comparisonPageStatus').textContent = '1 / 1';
        };
        const comparisonMetadata = (snapshot) => {
            const value = { path: snapshot.path };
            for (const key of ['left', 'right']) {
                const { kind, record, file, readAt } = snapshot[key];
                value[key] = { kind, record, readAt,
                    file: file ? { size: file.size, type: file.type, lastModified: file.lastModified } : null };
            }
            return value;
        };
        const comparisonControls = (owner, child) => {
            if (!comparisonCurrent(owner, child)) return;
            const busy = Boolean(child.run);
            $('#comparisonTarget').disabled = busy;
            $('#btnRunComparison').disabled = busy || child.counterpart === undefined;
            $('#btnRunComparison').textContent = t(child.attempted ? 'comparisonAgain' : 'comparisonRun');
            $('#btnStopComparison').disabled = !busy || child.run.cancelled || child.run.loading;
            $('#btnComparisonTargetPrevious').disabled = busy || child.choicePage === 0;
            $('#btnComparisonTargetNext').disabled = busy || (child.choicePage + 1) * 100 >= child.choices.length;
            $('#btnComparisonPrevious').disabled = busy || child.resultPage === 0;
            $('#btnComparisonNext').disabled = busy || (child.resultPage + 1) * 200 >= (child.result?.rows.length || 0);
            $('#comparisonStatus').textContent = child.message;
            controls();
        };
        const renderComparisonChoices = (owner, child) => {
            if (!comparisonCurrent(owner, child)) return;
            const select = $('#comparisonTarget'); select.replaceChildren();
            for (const [value, label] of [['', t('comparisonChoose')], ['current', t('currentFile')]]) {
                const option = node('option', label); option.value = value; select.append(option);
            }
            for (const record of child.choices.slice(child.choicePage * 100, (child.choicePage + 1) * 100)) {
                const option = node('option', `${new Date(record.capturedAt).toLocaleString(language())} · ${record.id}`);
                option.value = `version:${record.id}`; select.append(option);
            }
            select.value = child.counterpart === undefined ? '' : child.counterpart === null ? 'current' : `version:${child.counterpart.id}`;
            $('#comparisonTargetPageStatus').textContent = `${child.choicePage + 1} / ${Math.max(1, Math.ceil(child.choices.length / 100))}`;
            comparisonControls(owner, child);
        };
        const renderComparisonOutput = async (owner, child) => {
            if (!comparisonCurrent(owner, child) || !child.result || !child.metadata) return;
            const generation = child.generation, result = child.result, metadata = child.metadata;
            const stale = () => !comparisonCurrent(owner, child) || child.generation !== generation;
            const summary = document.createDocumentFragment();
            summary.append(node('p', t('comparisonSnapshot')));
            summary.append(node('p', t('versionDirection', { direction: directionLabel(owner) })));
            const reasons = { size: 'comparisonSize', encoding: 'comparisonEncoding', control: 'comparisonControl',
                'line-count': 'comparisonLineCount', 'line-length': 'comparisonLineLength', 'work-limit': 'comparisonWorkLimit' };
            if (result.reason) summary.append(node('p', t(reasons[result.reason])));
            if (result.lineContentEqual) summary.append(node('p', t('comparisonLineEqual')));
            if (result.kind === 'text' && !result.lineContentEqual) summary.append(node('p', t('comparisonCounts', result)));
            for (const key of ['left', 'right']) {
                const side = metadata[key], file = side.file, record = side.record;
                const section = node('section', '');
                section.append(node('h3', `${t(key === 'left' ? 'comparisonLeft' : 'comparisonRight')} · ${t(side.kind === 'current' ? 'currentFile' : 'selectedVersion')}`));
                const fields = [['owningRoot', rootLabel(owner, child.row.side)], ['pathHead', metadata.path],
                    ['comparisonPresence', t(file ? 'comparisonPresent' : 'comparisonAbsent')],
                    ['comparisonReadAt', new Date(side.readAt).toLocaleString(language())]];
                const absent = t('comparisonUnavailable');
                fields.push(['sizeHead', file ? `${file.size} B` : absent], ['comparisonType', file?.type || absent],
                    ['dateHead', file ? new Date(record ? record.lastModified : file.lastModified).toLocaleString(language()) : absent]);
                if (record) fields.push(['versionIdHead', record.id], ['capturedAt', new Date(record.capturedAt).toLocaleString(language())]);
                const dl = node('dl', '');
                for (const [label, value] of fields) dl.append(node('dt', t(label)), node('dd', value));
                const hash = result.hashes[key];
                const hashKeys = { 'too-large': 'comparisonHashLarge', unavailable: 'comparisonHashUnavailable', missing: 'comparisonHashMissing' };
                dl.append(node('dt', 'SHA-256'), node('dd', hash.status === 'ok' ? hash.value : t(hashKeys[hash.status])));
                section.append(dl);
                const fileFormat = result.formats[key];
                if (fileFormat) section.append(node('p', t('comparisonFormat', { ...fileFormat,
                    bom: t(fileFormat.bom ? 'comparisonYes' : 'comparisonNo'), final: t(fileFormat.finalNewline ? 'comparisonYes' : 'comparisonNo') })));
                summary.append(section);
            }
            const body = document.createDocumentFragment();
            const rows = result.rows.slice(child.resultPage * 200, (child.resultPage + 1) * 200);
            for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index], li = node('li', ''); li.dataset.diffKind = row.kind;
                if (row.kind === 'gap') li.textContent = t('comparisonGap', { count: row.count,
                    left: `${row.leftLine}–${row.leftLine + row.count - 1}`, right: `${row.rightLine}–${row.rightLine + row.count - 1}` });
                else li.append(node('span', row.leftLine ?? ''), node('span', row.rightLine ?? ''),
                    node('span', { context: '=', remove: '−', add: '+' }[row.kind]), node('code', row.text));
                body.append(li);
                if (index % 50 === 49) { await new Promise(resolve => setTimeout(resolve, 0)); if (stale()) return; }
            }
            if (stale()) return;
            $('#comparisonSummary').replaceChildren(summary); $('#comparisonBody').replaceChildren(body);
            $('#comparisonPageStatus').textContent = `${child.resultPage + 1} / ${Math.max(1, Math.ceil(result.rows.length / 200))}`;
            comparisonControls(owner, child);
        };
        const openComparison = async (owner, row, trigger) => {
            if (!current(owner) || owner.reading || owner.writing || owner.comparison || restoreDialog.open) return;
            const child = { row, trigger, choices: [], choicePage: 0, counterpart: null,
                result: null, metadata: null, resultPage: 0, generation: 1, run: null,
                message: t('comparisonLoading'), attempted: false };
            const run = { cancelled: false, generation: child.generation, loading: true };
            child.run = run; owner.comparison = child; owner.reading = true;
            comparisonDialog.showModal();
            $('#comparisonProgress').hidden = true;
            $('#comparisonProgress').setAttribute('aria-label', t('comparisonTitle'));
            clearComparisonOutput(owner, child);
            renderComparisonChoices(owner, child); $('#btnCloseComparison').focus();
            const isCancelled = () => run.cancelled || !comparisonCurrent(owner, child) || child.generation !== run.generation;
            try {
                const choices = await VersionStore.comparisonChoices(row.root, row.record, { isCancelled });
                if (isCancelled()) return;
                child.choices = choices; child.message = t('comparisonReady');
            } catch (error) {
                if (!isCancelled()) { child.counterpart = undefined; child.message = t('comparisonFailed', { message: safeMessage(error) }); }
            } finally {
                if (comparisonCurrent(owner, child) && child.run === run) {
                    child.run = null; owner.reading = false; renderComparisonChoices(owner, child);
                }
            }
        };
        const startComparison = async () => {
            const owner = session, child = owner?.comparison;
            if (!child || !comparisonCurrent(owner, child) || child.run || owner.reading || owner.writing
                || restoreDialog.open || child.counterpart === undefined) return;
            const run = { cancelled: false, generation: ++child.generation };
            const focusWasStart = document.activeElement === $('#btnRunComparison');
            child.run = run; child.attempted = true; clearComparisonOutput(owner, child);
            child.message = t('comparisonLoading'); owner.reading = true;
            $('#comparisonProgress').hidden = true;
            const isCancelled = () => run.cancelled || !comparisonCurrent(owner, child) || child.generation !== run.generation;
            comparisonControls(owner, child);
            if (focusWasStart) $('#btnStopComparison').focus();
            try {
                const snapshot = await VersionStore.prepareComparison(child.row.root, child.row.record, child.counterpart, { isCancelled });
                if (isCancelled()) return;
                const result = await VersionComparison.analyze(snapshot.left.file, snapshot.right.file, {
                    isCancelled, onProgress: ({ stage, done, total }) => {
                        if (isCancelled()) return;
                        const keys = { bytes: 'comparisonBytes', text: 'comparisonText', hash: 'comparisonHash' };
                        child.message = t('comparisonWorking', { stage: t(keys[stage]), done, total });
                        $('#comparisonStatus').textContent = child.message;
                        const progress = $('#comparisonProgress'); progress.hidden = false;
                        progress.max = Math.max(1, total); progress.value = done;
                    },
                });
                if (isCancelled()) return;
                await VersionStore.validateComparison(snapshot, { isCancelled });
                if (isCancelled()) return;
                child.metadata = comparisonMetadata(snapshot); child.result = result;
                child.message = t(result.kind === 'missing' ? 'comparisonMissing' : result.equal ? 'comparisonIdentical' : 'comparisonDifferent');
                await renderComparisonOutput(owner, child);
                if (isCancelled()) return;
            } catch (error) {
                if (!isCancelled()) {
                    clearComparisonOutput(owner, child);
                    child.message = t('comparisonFailed', { message: safeMessage(error) });
                }
            } finally {
                if (comparisonCurrent(owner, child) && child.run === run) {
                    const focusWasStop = document.activeElement === $('#btnStopComparison');
                    child.run = null; owner.reading = false;
                    if (run.cancelled) child.message = t('comparisonStopped');
                    $('#comparisonProgress').hidden = true;
                    comparisonControls(owner, child);
                    if (focusWasStop) $('#btnRunComparison').focus();
                }
            }
        };
        const stopComparison = () => {
            const owner = session, child = owner?.comparison;
            if (!child || !comparisonCurrent(owner, child) || !child.run || child.run.loading) return;
            const focusWasStop = document.activeElement === $('#btnStopComparison');
            child.run.cancelled = true; child.generation += 1;
            clearComparisonOutput(owner, child); $('#comparisonProgress').hidden = true;
            child.message = t('comparisonStopping'); comparisonControls(owner, child);
            if (focusWasStop) $('#btnCloseComparison').focus();
        };
        const closeComparison = (returnFocus = true) => {
            const owner = session, child = owner?.comparison;
            if (!child) return;
            if (child.run) child.run.cancelled = true;
            child.generation += 1; child.metadata = null; child.result = null; child.choices = [];
            owner.comparison = null; owner.reading = false;
            $('#comparisonBody').replaceChildren(); $('#comparisonSummary').replaceChildren();
            $('#comparisonProgress').hidden = true;
            if (comparisonDialog.open) comparisonDialog.close();
            controls();
            if (returnFocus && current(owner)) {
                (child.trigger?.isConnected ? child.trigger : $('#btnCloseVersions')).focus();
            }
        };
        const select = async (row, action, trigger) => {
            const owner = session;
            if (!owner || !current(owner) || owner.reading || owner.writing || owner.comparison || restoreDialog.open) return;
            if (action === 'compare') { await openComparison(owner, row, trigger); return; }
            const returnFocus = document.activeElement === trigger;
            owner.reading = true; owner.message = t('versionsLoading'); controls();
            $('#versionStatus').textContent = owner.message;
            try {
                if (action === 'download') {
                    const file = await VersionStore.read(row.root, row.record);
                    if (!current(owner)) return;
                    downloadBlob(file, row.record.originalPath.split('/').at(-1));
                } else if (action === 'restore') {
                    const prepared = await VersionStore.prepareRestore(row.root, row.record);
                    if (!current(owner)) return;
                    owner.selection = { row, prepared }; owner.trigger = trigger;
                    summary(owner, row, prepared); $('#restoreStatus').textContent = '';
                    restoreDialog.showModal(); $('#btnCancelRestore').focus();
                }
                owner.message = '';
            } catch (error) {
                if (current(owner)) owner.message = t('versionFailed', { message: safeMessage(error) });
            } finally {
                if (current(owner)) {
                    owner.reading = false;
                    $('#versionStatus').textContent = [owner.message, ...owner.errors].filter(Boolean).join('\n');
                    controls();
                    if (returnFocus && !restoreDialog.open && trigger.isConnected && document.activeElement === document.body) trigger.focus();
                }
            }
        };
        const confirm = async () => {
            const owner = session;
            if (!owner || !current(owner) || owner.comparison || !owner.selection || owner.writing || !restoreDialog.open) return;
            const { row, prepared } = owner.selection;
            owner.writing = true; controls();
            $('#restoreStatus').textContent = t('restoreWriting');
            let message;
            try {
                // Start permission from this click, before any asynchronous validation.
                const permission = await row.root.requestPermission({ mode: 'readwrite' });
                if (permission !== 'granted') throw new Error(t('permissionDenied'));
                if (!current(owner)) throw new Error(t('storedHandleUnavailable'));
                const result = await VersionStore.restore(prepared, { side: row.side, direction: owner.direction, runId: uid() });
                message = t('restoreDone');
                if (result.backup) message += `\n${t('retainedBackup', { id: result.backup.id, path: result.backup.storedPath })}`;
            } catch (error) {
                message = t('restoreFailed', { message: safeMessage(error) });
                if (error.backup) message += `\n${t('retainedBackup', { id: error.backup.id, path: error.backup.storedPath })}`;
            } finally {
                owner.selection = null; owner.writing = false; owner.message = message;
                model.sourceFiles = new Map(); model.targetFiles = new Map();
                model.sourceDirectories = new Set(); model.targetDirectories = new Set();
                Controller.invalidatePlan(); elements.progress.dataset.visible = 'false';
                addLog(message); setStatus(message, 'info', 'info');
                restoreDialog.close();
                controls();
                await refresh(true);
                if (current(owner)) $('#btnVersionRefresh').focus();
            }
        };
        const close = () => {
            if (!session || session.writing) return;
            closeComparison(false);
            if (restoreDialog.open) restoreDialog.close();
            dialog.close();
        };
        const open = () => {
            if (operationBlocked() || !model.source || !model.target || !model.profile || !model.trustedProfile) return;
            session = { roots: { source: model.source, target: model.target }, names: { source: model.source.name, target: model.target.name }, direction: model.state.config.direction, rows: [], errors: [], page: 0, reading: false, writing: false, selection: null, comparison: null, message: '' };
            model.versionBusy = true;
            dialog.showModal(); $('#btnCloseVersions').focus(); refresh();
        };
        $('#btnVersions').addEventListener('click', open);
        $('#btnCloseVersions').addEventListener('click', close);
        $('#btnVersionRefresh').addEventListener('click', () => refresh());
        $('#btnVersionPrevious').addEventListener('click', () => { if (session && !session.reading && !session.comparison && session.page > 0) { session.page--; render(); } });
        $('#btnVersionNext').addEventListener('click', () => { if (session && !session.reading && !session.comparison && (session.page + 1) * 100 < session.rows.length) { session.page++; render(); } });
        $('#btnConfirmRestore').addEventListener('click', confirm);
        $('#btnCancelRestore').addEventListener('click', () => { if (!session?.writing) restoreDialog.close(); });
        $('#btnRunComparison').addEventListener('click', startComparison);
        $('#btnStopComparison').addEventListener('click', stopComparison);
        $('#btnCloseComparison').addEventListener('click', () => closeComparison());
        $('#comparisonTarget').addEventListener('change', event => {
            const owner = session, child = owner?.comparison;
            if (!child || !comparisonCurrent(owner, child)) return;
            if (child.run) { renderComparisonChoices(owner, child); return; }
            const value = event.target.value;
            const visible = child.choices.slice(child.choicePage * 100, (child.choicePage + 1) * 100);
            child.counterpart = value === 'current' ? null : visible.find(record => `version:${record.id}` === value);
            child.generation += 1; clearComparisonOutput(owner, child);
            child.message = t('comparisonReady'); comparisonControls(owner, child);
        });
        for (const [id, delta] of [['btnComparisonTargetPrevious', -1], ['btnComparisonTargetNext', 1]]) {
            $(`#${id}`).addEventListener('click', () => {
                const owner = session, child = owner?.comparison;
                if (!child || !comparisonCurrent(owner, child) || child.run) return;
                const next = child.choicePage + delta;
                if (next < 0 || next >= Math.max(1, Math.ceil(child.choices.length / 100))) return;
                child.choicePage = next;
                if (child.counterpart !== null) child.counterpart = undefined;
                child.generation += 1; clearComparisonOutput(owner, child);
                child.message = t('comparisonReady'); renderComparisonChoices(owner, child);
            });
        }
        for (const [id, delta] of [['btnComparisonPrevious', -1], ['btnComparisonNext', 1]]) {
            $(`#${id}`).addEventListener('click', async () => {
                const owner = session, child = owner?.comparison;
                if (!child || !comparisonCurrent(owner, child) || child.run || !child.result) return;
                const next = child.resultPage + delta;
                if (next < 0 || next >= Math.max(1, Math.ceil(child.result.rows.length / 200))) return;
                child.resultPage = next; child.generation += 1;
                $('#comparisonBody').replaceChildren(); comparisonControls(owner, child);
                await renderComparisonOutput(owner, child);
            });
        }
        dialog.addEventListener('cancel', event => { if (session?.writing) event.preventDefault(); });
        comparisonDialog.addEventListener('cancel', event => { event.preventDefault(); closeComparison(); });
        comparisonDialog.addEventListener('close', () => { if (!comparisonDialog.open) closeComparison(); });
        restoreDialog.addEventListener('cancel', event => { if (session?.writing) event.preventDefault(); });
        restoreDialog.addEventListener('close', () => {
            if (!session) return;
            if (session.writing) { restoreDialog.showModal(); return; }
            session.selection = null; controls();
            if (session.trigger?.isConnected && !session.reading) session.trigger.focus();
        });
        dialog.addEventListener('close', () => {
            if (session?.writing) { dialog.showModal(); return; }
            closeComparison(false);
            session = null; model.versionBusy = false; renderControls(); $('#btnVersions').focus();
        });
        return Object.freeze({ open });
    })();
    const csvCell = (value) => {
        let cell = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
        return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
    };
    const runLogCsv = (run) => {
        const columns = ['sequence', 'action', 'path', 'sourcePath', 'destinationPath', 'fromSide', 'toSide', 'versionId', 'versionPath', 'durationMs', 'status', 'error'];
        const rows = run.entries.map((entry) => columns.map((column) => csvCell(entry[column])).join(','));
        return `\uFEFF${[columns.join(','), ...rows].join('\r\n')}`;
    };
    const closeRunDetails = () => {
        if (elements.runDetailDialog.open) elements.runDetailDialog.close();
    };
    const openQuickGuide = () => {
        if (!elements.quickGuideDialog.open) elements.quickGuideDialog.showModal();
        elements.btnCloseQuickGuide.focus();
    };
    const closeQuickGuide = () => {
        if (elements.quickGuideDialog.open) elements.quickGuideDialog.close();
    };

    elements.btnQuickGuide.addEventListener('click', openQuickGuide);
    elements.btnCloseQuickGuide.addEventListener('click', closeQuickGuide);
    elements.quickGuideDialog.addEventListener('close', () => elements.btnQuickGuide.focus());
    elements.btnSrc.addEventListener('click', () => Controller.pick('source'));
    elements.btnTgt.addEventListener('click', () => Controller.pick('target'));
    elements.btnSwap.addEventListener('click', Controller.swapFolders);
    elements.btnBookmark?.addEventListener('click', Controller.toggleBookmark);
    elements.advancedToggle.addEventListener('click', () => {
        model.advancedExpanded = !model.advancedExpanded;
        model.state.ui = { advancedExpanded: model.advancedExpanded };
        StateStore.save(model.state);
        renderAdvancedControls();
    });
    elements.btnCompare.addEventListener('click', Controller.compare);
    elements.btnSync.addEventListener('click', Controller.sync);
    elements.btnAbort.addEventListener('click', Controller.abort);
    elements.btnCloseRunDetail.addEventListener('click', closeRunDetails);
    elements.btnRunPreviousPage.addEventListener('click', () => { model.runDetailPage -= 1; renderRunDetails(); });
    elements.btnRunNextPage.addEventListener('click', () => { model.runDetailPage += 1; renderRunDetails(); });
    elements.btnDownloadRunJson.addEventListener('click', () => { if (model.selectedRun) downloadJson(model.selectedRun, `file-nally-run-${model.selectedRun.id}.json`); });
    elements.btnDownloadRunCsv.addEventListener('click', () => { if (model.selectedRun) downloadText(runLogCsv(model.selectedRun), `file-nally-run-${model.selectedRun.id}.csv`, 'text/csv;charset=utf-8'); });
    elements.runDetailDialog.addEventListener('close', () => {
        const trigger = model.runDetailTrigger;
        model.selectedRun = null;
        model.runDetailPage = 0;
        model.runDetailTrigger = null;
        if (trigger?.isConnected) trigger.focus();
    });
    elements.changedOnly.addEventListener('change', () => { model.showChangedOnly = elements.changedOnly.checked; sessionStorage.setItem(SHOW_CHANGED_ONLY_KEY, String(model.showChangedOnly)); renderRows(); });
    [elements.direction, elements.policy, elements.comparison, elements.excludes].forEach((control) => control.addEventListener('change', () => { if (operationBlocked()) { renderStaticText(); return; } Controller.saveConfig(); Controller.invalidatePlan(); renderAdvancedControls(); }));
    [elements.dirBoth, elements.dirOne, elements.dirReverse].forEach((btn) => {
        btn?.addEventListener('click', () => {
            if (operationBlocked()) return;
            model.state.config.direction = btn.dataset.value;
            elements.direction.value = btn.dataset.value;
            renderDirectionToggle();
            Controller.saveConfig();
            Controller.invalidatePlan();
            renderAdvancedControls();
        });
    });
    elements.excludes.addEventListener('input', () => { if (operationBlocked()) { elements.excludes.value = model.state.config.excludeDirs.join(', '); return; } model.state.config.excludeDirs = normalizeExcludes(elements.excludes.value); StateStore.save(model.state); Controller.invalidatePlan(); });
    $('#btnLangKo').addEventListener('click', () => { if (operationBlocked()) return; model.state.config.lang = 'ko'; StateStore.save(model.state); renderStaticText(); });
    $('#btnLangEn').addEventListener('click', () => { if (operationBlocked()) return; model.state.config.lang = 'en'; StateStore.save(model.state); renderStaticText(); });
    $('#btnGenDefault').addEventListener('click', () => { downloadJson(StateStore.createDefault(), 'file-nally-default.json'); setStatus(t('defaultDone'), 'success', 'check'); });
    $('#btnExport').addEventListener('click', () => { downloadJson(StateStore.export(model.state), `file-nally-backup-${new Date().toISOString().slice(0, 10)}.json`); setStatus(t('exportDone'), 'success', 'check'); });
    $('#btnImport').addEventListener('click', () => { if (!operationBlocked()) $('#fileImporter').click(); });
    $('#fileImporter').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (file) await Controller.importState(file); event.target.value = ''; });
    $('#btnClearHistory').addEventListener('click', async () => {
        if (!confirm(t('confirmClear'))) return;
        model.state.globalHistory = []; if (model.profile) model.profile.history = []; StateStore.save(model.state); await RunLogStore.clear(); renderHistory(); setStatus(t('historyCleared'), 'success', 'check');
    });

    const initialize = async () => {
        await HandleStore.warm();
        const activeProfileId = model.state.activeProfileId;
        if (activeProfileId) await Controller.connectStoredProfile(activeProfileId, { requestPermission: false });
        await RunLogStore.hydrate(model.state.globalHistory.map((item) => item.logId).filter(Boolean));
        renderStaticText(); renderRows(); renderHistory(); renderControls();
        if (!activeProfileId) addLog(t('waiting'));
    };

    window.FileNallyTest = Object.freeze({
        Controller,
        PermissionGate,
        RunLogStore,
        StateStore,
        SyncPlanner,
        VersionComparison,
        VersionStore,
        connectStoredProfile: (profileId, requestPermission) => Controller.connectStoredProfile(profileId, { requestPermission }),
        executeCurrentPlan: () => Controller.sync(),
        getModel: () => ({ phase: model.phase, versionBusy: model.versionBusy, appOperation: model.appOperation, trustedProfile: model.trustedProfile, profileId: model.profile?.id || null, profileConnectionPending: model.profileConnectionPending, plan: model.plan ? cloneJson({ id: model.plan.id, actions: model.plan.actions, summary: model.plan.summary }) : null }),
    });

    initialize().catch((error) => {
        setPhase('error');
        setStatus(t('pickFailed', { message: safeMessage(error) }), 'danger', 'alert');
        addLog(safeMessage(error));
    });
})();
