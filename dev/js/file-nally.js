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
            detailsHead: '상세', details: '상세 보기', runDetailTitle: '실행 상세', runDetailDescription: '실행 중 처리한 모든 작업과 결과입니다.', close: '닫기', loadingDetails: '상세 기록을 불러오는 중입니다.', detailsUnavailable: '상세 기록을 찾을 수 없습니다.', durationHead: '소요 시간', sequenceHead: '순서', actionHead: '작업', errorHead: '오류', previousPage: '이전', nextPage: '다음', downloadCsv: 'CSV 다운로드', downloadRunJson: 'JSON 다운로드', entrySuccess: '성공', entryFailed: '실패', entryNotRun: '미실행', actionCopy: '복사', actionRename: '이름 변경', actionTrash: '휴지통 이동', actionBaseline: '기준 저장', actionCreateDirectory: '폴더 생성', actionBaselineDirectory: '폴더 기준 저장', actionTrashDirectory: '폴더 휴지통 이동', actionUnknown: '기타',
        },
        en: {
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
            detailsHead: 'Details', details: 'View details', runDetailTitle: 'Run details', runDetailDescription: 'Every action processed during this synchronization run.', close: 'Close', loadingDetails: 'Loading run details.', detailsUnavailable: 'Run details are unavailable.', durationHead: 'Duration', sequenceHead: 'Sequence', actionHead: 'Action', errorHead: 'Error', previousPage: 'Previous', nextPage: 'Next', downloadCsv: 'Download CSV', downloadRunJson: 'Download JSON', entrySuccess: 'Success', entryFailed: 'Failed', entryNotRun: 'Not run', actionCopy: 'Copy', actionRename: 'Rename', actionTrash: 'Move to trash', actionBaseline: 'Save baseline', actionCreateDirectory: 'Create folder', actionBaselineDirectory: 'Save folder baseline', actionTrashDirectory: 'Move folder to trash', actionUnknown: 'Other',
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
        const normalized = values.map((item) => String(item).trim()).filter(Boolean);
        normalized.push(...RESERVED_EXCLUDES);
        return [...new Set(normalized)].slice(0, 100);
    };
    const format = (template, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
    const safeMessage = (error) => error instanceof Error || error instanceof DOMException ? error.message : String(error || 'Unknown error');
    const safeSegments = (path) => {
        const parts = String(path).split('/');
        if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe relative path: ${path}`);
        return parts;
    };

    const rejectForbidden = (value, seen = new Set(), location = []) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        // Only directory-manifest keys are filesystem paths; their values remain checked.
        const directoryPaths = location.length === 3 && location[0] === 'profiles' && location[2] === 'directoryManifest';
        for (const key of Object.keys(value)) {
            if (!directoryPaths && FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden JSON key: ${key}`);
            rejectForbidden(value[key], seen, [...location, key]);
        }
        seen.delete(value);
    };

    const VersionStore = (() => {
        const emptyIndex = () => ({ schemaVersion: VERSION_INDEX_SCHEMA, versions: [] });
        const cleanRecord = (value) => {
            if (!isObject(value)
                || typeof value.id !== 'string' || !value.id
                || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))
                || typeof value.originalPath !== 'string'
                || typeof value.storedPath !== 'string'
                || !Number.isFinite(Number(value.size))
                || !Number.isFinite(Number(value.lastModified))
                || value.reason !== 'before-overwrite'
                || !['bidirectional', 'unidirectional', 'reverse'].includes(value.direction)
                || !['source', 'target'].includes(value.fromSide)
                || !['source', 'target'].includes(value.toSide)
                || value.fromSide === value.toSide) return null;
            safeSegments(value.originalPath);
            const expectedStoredPath = ['versions', value.id, ...safeSegments(value.originalPath)].join('/');
            if (value.storedPath !== expectedStoredPath) return null;
            return {
                id: value.id,
                capturedAt: value.capturedAt,
                originalPath: value.originalPath,
                storedPath: expectedStoredPath,
                size: Number(value.size),
                type: typeof value.type === 'string' ? value.type : '',
                lastModified: Number(value.lastModified),
                reason: 'before-overwrite',
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
            if (!isObject(raw) || raw.schemaVersion !== VERSION_INDEX_SCHEMA || !Array.isArray(raw.versions)) {
                throw new Error('Unsupported version index');
            }
            if (raw.versions.length > MAX_VERSION_RECORDS) throw new Error('Version index has too many records');
            const versions = raw.versions.map(cleanRecord);
            if (versions.some((record) => !record)) throw new Error('Malformed version record');
            return { schemaVersion: VERSION_INDEX_SCHEMA, versions };
        };
        return Object.freeze({ cleanRecord, emptyIndex, parseIndexText });
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
            rejectForbidden(raw);
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
            rejectForbidden(raw);
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
        const requestValue = (request) => new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
        const put = async (record) => {
            const stored = cloneJson(record);
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
                if (stored) memory.set(id, stored);
                return stored ? cloneJson(stored) : null;
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
            const totalBytes = sourceFile.size * 2;
            if (!totalBytes) { onProgress(0, 0); return true; }
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
        const directoryFor = async (root, parts, create) => {
            let directory = root;
            for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
            return directory;
        };
        const fileHandleFor = async (root, path) => {
            const parts = safeSegments(path);
            const name = parts.pop();
            const directory = await directoryFor(root, parts, false);
            return directory.getFileHandle(name);
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
        state: StateStore.load(), showChangedOnly: sessionStorage.getItem(SHOW_CHANGED_ONLY_KEY) === 'true', source: null, target: null, profile: null, trustedProfile: false, sourceFiles: new Map(), targetFiles: new Map(), sourceDirectories: new Set(), targetDirectories: new Set(), plan: null, phase: 'idle', abortRequested: false, profileConnectionPending: false, logs: [], advancedExpanded: null, selectedRun: null, runDetailPage: 0, runDetailTrigger: null,
    };
    model.advancedExpanded = typeof model.state.ui?.advancedExpanded === 'boolean'
        ? model.state.ui.advancedExpanded
        : !window.matchMedia('(max-width: 760px)').matches;

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
        const busy = ['comparing', 'syncing', 'aborting'].includes(model.phase);
        const paired = Boolean(model.source && model.target && model.profile && model.trustedProfile);
        elements.btnSrc.disabled = busy; elements.btnTgt.disabled = busy;
        elements.direction.disabled = busy; elements.policy.disabled = busy; elements.comparison.disabled = busy; elements.excludes.disabled = busy;
        if (elements.dirBoth) elements.dirBoth.disabled = busy;
        if (elements.dirOne) elements.dirOne.disabled = busy;
        if (elements.dirReverse) elements.dirReverse.disabled = busy;
        elements.btnSwap.disabled = busy || !paired;
        elements.btnCompare.disabled = busy || !paired;
        elements.btnSync.disabled = model.phase !== 'planned' || !model.plan?.actions.length;
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
            elements.btnBookmark.disabled = false;
        } else {
            elements.btnBookmark.dataset.bookmarked = 'false';
            elements.btnBookmark.disabled = true;
        }

        for (const b of bookmarks) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip chip-bookmark';
            chip.textContent = `★ ${b.sourceName || '?'} ⇄ ${b.targetName || '?'}`;
            chip.disabled = model.profileConnectionPending;
            chip.addEventListener('click', () => Controller.selectProfile(b.profileId));
            elements.bookmarkChips.append(chip);
        }

        for (const r of recents) {
            if (bookmarkedIds.has(r.profileId)) continue;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.textContent = `🕒 ${r.sourceName || '?'} ⇄ ${r.targetName || '?'}`;
            chip.disabled = model.profileConnectionPending;
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
            if (!model.profile) return;
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
        return Object.freeze({ abort, bindPair, compare, connectStoredProfile, importState, invalidatePlan, pick, saveConfig, selectProfile, swapFolders, sync, toggleBookmark });
    })();

    const downloadText = (content, name, type) => {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const downloadJson = (data, name) => downloadText(JSON.stringify(data, null, 2), name, 'application/json');
    const csvCell = (value) => {
        let cell = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
        return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
    };
    const runLogCsv = (run) => {
        const columns = ['sequence', 'action', 'path', 'sourcePath', 'destinationPath', 'fromSide', 'toSide', 'durationMs', 'status', 'error'];
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
    [elements.direction, elements.policy, elements.comparison, elements.excludes].forEach((control) => control.addEventListener('change', () => { Controller.saveConfig(); Controller.invalidatePlan(); renderAdvancedControls(); }));
    [elements.dirBoth, elements.dirOne, elements.dirReverse].forEach((btn) => {
        btn?.addEventListener('click', () => {
            model.state.config.direction = btn.dataset.value;
            elements.direction.value = btn.dataset.value;
            renderDirectionToggle();
            Controller.saveConfig();
            Controller.invalidatePlan();
            renderAdvancedControls();
        });
    });
    elements.excludes.addEventListener('input', () => { model.state.config.excludeDirs = normalizeExcludes(elements.excludes.value); StateStore.save(model.state); Controller.invalidatePlan(); });
    $('#btnLangKo').addEventListener('click', () => { model.state.config.lang = 'ko'; StateStore.save(model.state); renderStaticText(); });
    $('#btnLangEn').addEventListener('click', () => { model.state.config.lang = 'en'; StateStore.save(model.state); renderStaticText(); });
    $('#btnGenDefault').addEventListener('click', () => { downloadJson(StateStore.createDefault(), 'file-nally-default.json'); setStatus(t('defaultDone'), 'success', 'check'); });
    $('#btnExport').addEventListener('click', () => { downloadJson(StateStore.export(model.state), `file-nally-backup-${new Date().toISOString().slice(0, 10)}.json`); setStatus(t('exportDone'), 'success', 'check'); });
    $('#btnImport').addEventListener('click', () => $('#fileImporter').click());
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
        PermissionGate,
        RunLogStore,
        StateStore,
        SyncPlanner,
        VersionStore,
        connectStoredProfile: (profileId, requestPermission) => Controller.connectStoredProfile(profileId, { requestPermission }),
        executeCurrentPlan: () => Controller.sync(),
        getModel: () => ({ phase: model.phase, trustedProfile: model.trustedProfile, profileId: model.profile?.id || null, profileConnectionPending: model.profileConnectionPending, plan: model.plan ? cloneJson({ id: model.plan.id, actions: model.plan.actions, summary: model.plan.summary }) : null }),
    });

    initialize().catch((error) => {
        setPhase('error');
        setStatus(t('pickFailed', { message: safeMessage(error) }), 'danger', 'alert');
        addLog(safeMessage(error));
    });
})();
