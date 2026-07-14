(() => {
    'use strict';

    const STORAGE_KEY = 'smart_sync_state';
    const STATE_VERSION = 2;
    const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
    const MAX_PROFILES = 100;
    const MAX_MANIFEST_ENTRIES = 100000;
    const MAX_PROFILE_HISTORY = 30;
    const MAX_GLOBAL_HISTORY = 100;
    const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const DEFAULT_EXCLUDES = ['node_modules', '.git', 'dist', 'temp', '.trash'];

    const TEXT = {
        ko: {
            desc: '두 로컬 폴더를 비교한 뒤 변경 계획을 검토하고 안전하게 동기화합니다.', controlTitle: '동기화 제어', selectSource: '원본 폴더 선택', selectTarget: '대상 폴더 선택', notSelected: '선택되지 않음', languageLabel: '언어', progressLabel: '동기화 진행률', workspaceLabel: '폴더 비교 결과', activityLabel: '동기화 기록',
            profileNone: '선택된 동기화 프로필이 없습니다.', profileUnverified: '폴더 쌍 미확인', profileVerified: '폴더 쌍 확인됨', profileLabel: '{source} ⇄ {target}',
            directionLabel: '동기화 방향', directionBoth: '양방향 (원본 ⇄ 대상)', directionOne: '단방향 (원본 → 대상)', policyLabel: '충돌 해결 정책', policyLatest: '최신 파일 유지', policySource: '원본 우선 덮어쓰기', policySkip: '기존 파일 건너뛰기', policyRename: '이름을 바꿔 두 버전 보존', excludeLabel: '제외할 하위 폴더명',
            defaultJson: '기본 JSON', exportJson: 'JSON 백업', importJson: 'JSON 복원', compare: '변경사항 비교', sync: '동기화 실행', abort: '안전하게 중지', waiting: '폴더를 선택해 주세요.', preparing: '준비 중',
            sourceTitle: '원본 폴더', targetTitle: '대상 폴더', pathHead: '파일명과 경로', sizeHead: '크기', dateHead: '수정일', stateHead: '상태', logTitle: '실시간 로그', idle: '대기', historyTitle: '동기화 이력', clearHistory: '이력 초기화', timeHead: '실행 시간', directionHead: '방향', processedHead: '처리',
            disclaimer: '중요한 데이터는 동기화 전에 별도로 백업하세요. 브라우저와 운영체제의 파일 권한 또는 예기치 않은 중단으로 인한 손실 가능성이 있습니다.',
            emptyFiles: '표시할 파일이 없습니다.', emptyHistory: '기록된 동기화 이력이 없습니다.', selected: '{name} 선택됨', pairReady: '폴더 쌍이 확인되었습니다. 변경사항을 비교할 수 있습니다.', sameFolder: '같은 폴더를 원본과 대상으로 사용할 수 없습니다.', nestedFolder: '한 폴더가 다른 폴더 안에 있습니다. 중첩 폴더는 동기화할 수 없습니다.', pickCancelled: '폴더 선택이 취소되었습니다.', pickFailed: '폴더를 선택하지 못했습니다: {message}',
            comparing: '폴더를 검사하고 변경 계획을 계산하는 중입니다.', compareDone: '비교 완료 · 실행할 작업 {count}건', compareNone: '비교 완료 · 실행할 변경사항이 없습니다.', compareFailed: '비교 중 오류가 발생했습니다: {message}',
            syncing: '동기화 실행 중 · {current}/{total}', syncDone: '동기화 완료 · {count}건 처리', syncAborted: '동기화가 안전하게 중단되었습니다. {count}건 처리됨', syncFailed: '동기화 중 오류가 발생했습니다: {message}', aborting: '현재 파일 작업을 마친 뒤 중단합니다.',
            importDone: 'JSON 데이터를 복원했습니다.', importFailed: 'JSON을 복원하지 못했습니다: {message}', exportDone: 'JSON 백업을 생성했습니다.', defaultDone: '기본 JSON을 생성했습니다.', historyCleared: '동기화 이력을 초기화했습니다.', confirmClear: '현재 프로필과 전체 동기화 이력을 초기화할까요?',
            statusUnchanged: '변경 없음', statusBaseline: '기준 저장', statusCopyOut: '보내기', statusCopyIn: '받기', statusTrash: '휴지통 이동', statusConflict: '충돌 · 확인 필요', statusSkipped: '정책에 따라 건너뜀', statusProtected: '단방향 보호', statusNew: '신규',
            phaseReady: '준비', phaseComparing: '비교', phasePlanned: '계획됨', phaseSyncing: '실행', phaseSuccess: '완료', phaseError: '오류', phaseAborted: '중단', directionBothShort: '양방향', directionOneShort: '단방향', success: '성공', failed: '실패', aborted: '중단',
        },
        en: {
            desc: 'Compare two local folders, review the change plan, and synchronize them safely.', controlTitle: 'Synchronization controls', selectSource: 'Select source folder', selectTarget: 'Select target folder', notSelected: 'Not selected', languageLabel: 'Language', progressLabel: 'Synchronization progress', workspaceLabel: 'Folder comparison results', activityLabel: 'Synchronization activity',
            profileNone: 'No synchronization profile is selected.', profileUnverified: 'Folder pair unverified', profileVerified: 'Folder pair verified', profileLabel: '{source} ⇄ {target}',
            directionLabel: 'Synchronization direction', directionBoth: 'Bidirectional (Source ⇄ Target)', directionOne: 'One-way (Source → Target)', policyLabel: 'Conflict policy', policyLatest: 'Keep the latest file', policySource: 'Source wins conflicts', policySkip: 'Skip existing files', policyRename: 'Rename and preserve both versions', excludeLabel: 'Excluded directory names',
            defaultJson: 'Default JSON', exportJson: 'Back up JSON', importJson: 'Restore JSON', compare: 'Compare changes', sync: 'Run synchronization', abort: 'Stop safely', waiting: 'Select both folders to begin.', preparing: 'Preparing',
            sourceTitle: 'Source folder', targetTitle: 'Target folder', pathHead: 'File and path', sizeHead: 'Size', dateHead: 'Modified', stateHead: 'Status', logTitle: 'Live log', idle: 'Idle', historyTitle: 'Synchronization history', clearHistory: 'Clear history', timeHead: 'Run time', directionHead: 'Direction', processedHead: 'Processed',
            disclaimer: 'Back up important data before synchronization. Browser or operating-system permissions and unexpected interruption can still cause data loss.',
            emptyFiles: 'No files to display.', emptyHistory: 'No synchronization history recorded.', selected: '{name} selected', pairReady: 'Folder pair verified. You can compare changes now.', sameFolder: 'The same folder cannot be both source and target.', nestedFolder: 'One selected folder is inside the other. Nested pairs are not supported.', pickCancelled: 'Folder selection was cancelled.', pickFailed: 'Could not select the folder: {message}',
            comparing: 'Scanning folders and calculating the change plan.', compareDone: 'Compare Complete · {count} queued actions', compareNone: 'Compare Complete · no changes to apply', compareFailed: 'Comparison failed: {message}',
            syncing: 'Synchronizing · {current}/{total}', syncDone: 'Synchronization Complete · {count} actions processed', syncAborted: 'Synchronization stopped safely after {count} actions', syncFailed: 'Synchronization failed: {message}', aborting: 'Stopping after the current file operation finishes.',
            importDone: 'JSON data restored.', importFailed: 'Could not restore JSON: {message}', exportDone: 'JSON backup created.', defaultDone: 'Default JSON created.', historyCleared: 'Synchronization history cleared.', confirmClear: 'Clear the active profile and global synchronization history?',
            statusUnchanged: 'No change', statusBaseline: 'Save baseline', statusCopyOut: 'Send', statusCopyIn: 'Receive', statusTrash: 'Move to trash', statusConflict: 'Conflict · review', statusSkipped: 'Skipped by policy', statusProtected: 'Protected by one-way mode', statusNew: 'New',
            phaseReady: 'Ready', phaseComparing: 'Comparing', phasePlanned: 'Planned', phaseSyncing: 'Running', phaseSuccess: 'Complete', phaseError: 'Error', phaseAborted: 'Stopped', directionBothShort: 'Bidirectional', directionOneShort: 'One-way', success: 'Success', failed: 'Failed', aborted: 'Stopped',
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
        normalized.push('.trash');
        return [...new Set(normalized)].slice(0, 100);
    };
    const format = (template, values = {}) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
    const safeMessage = (error) => error instanceof Error || error instanceof DOMException ? error.message : String(error || 'Unknown error');
    const safeSegments = (path) => {
        const parts = String(path).split('/');
        if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe relative path: ${path}`);
        return parts;
    };

    const StateStore = (() => {
        const createDefault = () => ({
            schemaVersion: STATE_VERSION,
            config: { direction: 'bidirectional', conflictPolicy: 'latest', excludeDirs: [...DEFAULT_EXCLUDES], lang: navigator.language?.startsWith('ko') ? 'ko' : 'en' },
            activeProfileId: null,
            profiles: {},
            globalHistory: [],
        });

        const rejectForbidden = (value, seen = new Set()) => {
            if (!value || typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            for (const key of Object.keys(value)) {
                if (FORBIDDEN_KEYS.has(key)) throw new Error(`Forbidden JSON key: ${key}`);
                rejectForbidden(value[key], seen);
            }
        };

        const cleanConfig = (raw = {}) => ({
            direction: raw.direction === 'unidirectional' ? 'unidirectional' : 'bidirectional',
            conflictPolicy: ['latest', 'source-overwrite', 'skip', 'rename'].includes(raw.conflictPolicy) ? raw.conflictPolicy : raw.conflictPolicy === 'overwrite' ? 'source-overwrite' : 'latest',
            excludeDirs: normalizeExcludes(raw.excludeDirs || DEFAULT_EXCLUDES),
            lang: raw.lang === 'en' ? 'en' : 'ko',
        });

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

        const cleanHistory = (raw, limit) => Array.isArray(raw) ? raw.slice(0, limit).map((entry) => {
            const filesCount = Number(entry?.filesCount || 0);
            return {
                time: String(entry?.time || ''),
                direction: entry?.direction === 'unidirectional' ? 'unidirectional' : 'bidirectional',
                filesCount: Number.isFinite(filesCount) ? Math.max(0, filesCount) : 0,
                status: ['success', 'failed', 'aborted', '성공'].includes(entry?.status) ? entry.status === '성공' ? 'success' : entry.status : 'failed',
            };
        }) : [];

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
                state.profiles[id] = { id, sourceName: '', targetName: '', bindingStatus: 'unverified', createdAt: nowIso(), lastUsedAt: nowIso(), manifest, history };
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
                const request = indexedDB.open('file-nally-handles', 1);
                request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('pairs')) request.result.createObjectStore('pairs', { keyPath: 'profileId' }); };
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
                for (const item of stored) if (!values.some((value) => value.profileId === item.profileId)) values.push(item);
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
        const get = async (profileId) => (await list()).find((record) => record.profileId === profileId) || null;
        return Object.freeze({ findMatching, get, open, put });
    })();

    const validateFolderPair = async (sourceHandle, targetHandle) => {
        if (await sourceHandle.isSameEntry(targetHandle)) return 'same';
        if (typeof sourceHandle.resolve === 'function' && (await sourceHandle.resolve(targetHandle))?.length) return 'nested';
        if (typeof targetHandle.resolve === 'function' && (await targetHandle.resolve(sourceHandle))?.length) return 'nested';
        return null;
    };

    const SyncPlanner = (() => {
        const asMap = (value) => value instanceof Map ? value : new Map(Object.entries(value || {}));
        const snapshot = (file) => file ? { size: Number(file.size), lastModified: Number(file.lastModified) } : null;
        const sameSnapshot = (file, previous) => Boolean(file && previous && Number(file.size) === Number(previous.size) && Number(file.lastModified) === Number(previous.lastModified));
        const conflictName = (path, side, stamp) => {
            const parts = safeSegments(path);
            const file = parts.pop();
            const dot = file.lastIndexOf('.');
            const stem = dot > 0 ? file.slice(0, dot) : file;
            const ext = dot > 0 ? file.slice(dot) : '';
            return [...parts, `${stem}.conflict-${side}-${stamp}${ext}`].join('/');
        };

        const plan = ({ source, target, manifest = {}, trustedManifest = false, direction = 'bidirectional', conflictPolicy = 'latest', stamp = runStamp() }) => {
            const src = asMap(source);
            const tgt = asMap(target);
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
                    const sourceEqualsTarget = sourceFile.size === targetFile.size && sourceFile.lastModified === targetFile.lastModified;
                    if (!previous) {
                        if (sourceEqualsTarget) { actions.push({ type: 'baseline', path }); sourceStatus = targetStatus = 'baseline'; }
                        else if (direction === 'unidirectional') {
                            if (conflictPolicy === 'skip') sourceStatus = targetStatus = 'skipped';
                            else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                        } else ({ sourceStatus, targetStatus } = resolveConflict(path, sourceFile, targetFile));
                    } else {
                        const sourceChanged = !sameSnapshot(sourceFile, previous.source);
                        const targetChanged = !sameSnapshot(targetFile, previous.target);
                        if (!sourceChanged && !targetChanged) { sourceStatus = targetStatus = 'unchanged'; }
                        else if (direction === 'unidirectional') {
                            if (conflictPolicy === 'skip') sourceStatus = targetStatus = 'skipped';
                            else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                        } else if (sourceChanged && !targetChanged) { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; targetStatus = 'copy-in'; }
                        else if (!sourceChanged && targetChanged) { pushCopy(path, 'target', 'source'); sourceStatus = 'copy-in'; targetStatus = 'copy-out'; }
                        else ({ sourceStatus, targetStatus } = resolveConflict(path, sourceFile, targetFile));
                    }
                } else if (sourceFile) {
                    if (previous?.source && previous?.target) {
                        if (sameSnapshot(sourceFile, previous.source)) { actions.push({ type: 'trash', path, side: 'source' }); sourceStatus = 'trash'; }
                        else { sourceStatus = 'conflict'; conflicts += 1; }
                    } else { pushCopy(path, 'source', 'target'); sourceStatus = 'copy-out'; }
                } else if (targetFile) {
                    if (previous?.source && previous?.target) {
                        if (sameSnapshot(targetFile, previous.target)) { actions.push({ type: 'trash', path, side: 'target' }); targetStatus = 'trash'; }
                        else { targetStatus = 'conflict'; conflicts += 1; }
                    } else if (direction === 'bidirectional') { pushCopy(path, 'target', 'source'); targetStatus = 'copy-out'; }
                    else targetStatus = 'protected';
                } else if (previous) actions.push({ type: 'forget', path });

                if (sourceFile || targetFile) rows.push({ path, source: sourceFile, target: targetFile, sourceStatus, targetStatus });
            }
            return { id: uid(), stamp, actions, rows, summary: { actions: actions.length, conflicts } };
        };
        return Object.freeze({ plan, snapshot });
    })();

    const FileAdapter = (() => {
        const scan = async (directory, excludes, currentPath = '') => {
            const files = new Map();
            for await (const entry of directory.values()) {
                const path = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                safeSegments(path);
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    files.set(path, { name: entry.name, path, size: file.size, lastModified: file.lastModified, handle: entry });
                } else if (!excludes.includes(entry.name)) {
                    const nested = await scan(entry, excludes, path);
                    for (const [key, value] of nested) files.set(key, value);
                }
            }
            return files;
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
        return Object.freeze({ copy, moveToTrash, scan });
    })();

    const elements = {
        btnSrc: $('#btnSrc'), btnTgt: $('#btnTgt'), pathSrc: $('#pathSrc'), pathTgt: $('#pathTgt'), profileText: $('#profileText'), profileBadge: $('#profileBadge'),
        direction: $('#syncDirection'), policy: $('#conflictPolicy'), excludes: $('#excludeDirs'), btnCompare: $('#btnCompare'), btnSync: $('#btnSync'), btnAbort: $('#btnAbort'),
        status: $('#syncStatus'), statusText: $('#syncStatusText'), phaseLabel: $('#phaseLabel'), progress: $('#progressContainer'), progressText: $('#currentFileText'), progressPercent: $('#progressPercentText'), progressBar: $('#progressBar'), progressFill: $('#progressBar .progress-bar'),
        srcBody: $('#srcFileBody'), tgtBody: $('#tgtFileBody'), srcCount: $('#srcCount'), tgtCount: $('#tgtCount'), log: $('#logBox'), history: $('#historyBody'),
    };

    const model = {
        state: StateStore.load(), source: null, target: null, profile: null, trustedProfile: false, sourceFiles: new Map(), targetFiles: new Map(), plan: null, phase: 'idle', abortRequested: false, logs: [],
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
        elements.direction.disabled = busy; elements.policy.disabled = busy; elements.excludes.disabled = busy;
        elements.btnCompare.disabled = busy || !paired;
        elements.btnSync.disabled = model.phase !== 'planned' || !model.plan?.actions.length;
        elements.btnAbort.disabled = !['syncing'].includes(model.phase);
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
            return;
        }
        elements.profileText.textContent = t('profileLabel', { source: model.profile.sourceName, target: model.profile.targetName });
        elements.profileBadge.dataset.verified = String(model.trustedProfile);
        elements.profileBadge.querySelector('span').textContent = t(model.trustedProfile ? 'profileVerified' : 'profileUnverified');
    };
    const statusPresentation = (code) => ({
        unchanged: ['statusUnchanged', 'neutral'], baseline: ['statusBaseline', 'info'], 'copy-out': ['statusCopyOut', 'success'], 'copy-in': ['statusCopyIn', 'info'], trash: ['statusTrash', 'danger'], conflict: ['statusConflict', 'warning'], skipped: ['statusSkipped', 'warning'], protected: ['statusProtected', 'neutral'], missing: ['statusNew', 'neutral'],
    }[code] || ['statusUnchanged', 'neutral']);
    const appendEmptyRow = (body, text) => { body.replaceChildren(); const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = 'empty-cell'; cell.textContent = text; };
    const appendFileRow = (body, file, path, status) => {
        const row = body.insertRow();
        const nameCell = row.insertCell();
        const name = document.createElement('div'); name.className = 'file-name'; name.textContent = file.name;
        const pathText = document.createElement('div'); pathText.className = 'file-path'; pathText.textContent = path;
        nameCell.append(name, pathText);
        row.insertCell().textContent = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`;
        row.insertCell().textContent = new Date(file.lastModified).toLocaleString(language());
        const statusCell = row.insertCell(); const [key, tone] = statusPresentation(status); const badge = document.createElement('span'); badge.className = `badge badge-${tone}`; badge.textContent = t(key); statusCell.append(badge);
    };
    const renderRows = () => {
        elements.srcBody.replaceChildren(); elements.tgtBody.replaceChildren();
        const rows = model.plan?.rows || [...new Set([...model.sourceFiles.keys(), ...model.targetFiles.keys()])].map((path) => ({
            path,
            source: model.sourceFiles.get(path) || null,
            target: model.targetFiles.get(path) || null,
            sourceStatus: 'unchanged',
            targetStatus: 'unchanged',
        }));
        for (const row of rows) {
            if (row.source) appendFileRow(elements.srcBody, row.source, row.path, row.sourceStatus);
            if (row.target) appendFileRow(elements.tgtBody, row.target, row.path, row.targetStatus);
        }
        if (!elements.srcBody.children.length) appendEmptyRow(elements.srcBody, t('emptyFiles'));
        if (!elements.tgtBody.children.length) appendEmptyRow(elements.tgtBody, t('emptyFiles'));
        elements.srcCount.textContent = String(model.sourceFiles.size || 0);
        elements.tgtCount.textContent = String(model.targetFiles.size || 0);
    };
    const renderHistory = () => {
        elements.history.replaceChildren();
        const history = model.profile?.history || model.state.globalHistory || [];
        if (!history.length) { const row = elements.history.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = 'empty-cell'; cell.textContent = t('emptyHistory'); return; }
        for (const item of history.slice(0, MAX_PROFILE_HISTORY)) {
            const row = elements.history.insertRow();
            row.insertCell().textContent = item.time;
            row.insertCell().textContent = t(item.direction === 'unidirectional' ? 'directionOneShort' : 'directionBothShort');
            row.insertCell().textContent = String(item.filesCount);
            const status = row.insertCell(); status.textContent = t(item.status === 'success' ? 'success' : item.status === 'aborted' ? 'aborted' : 'failed');
        }
    };
    const updateProgress = (current, total, path = '') => {
        const percent = total ? Math.round((current / total) * 100) : 0;
        elements.progress.dataset.visible = 'true'; elements.progressText.textContent = path || t('preparing'); elements.progressPercent.textContent = `${percent}% (${current}/${total})`;
        elements.progressFill.style.width = `${percent}%`; elements.progressBar.setAttribute('aria-valuenow', String(percent));
    };

    const buildManifest = (sourceFiles, targetFiles) => {
        const manifest = {};
        const allPaths = new Set([...sourceFiles.keys(), ...targetFiles.keys()]);
        for (const path of allPaths) manifest[path] = { source: SyncPlanner.snapshot(sourceFiles.get(path)), target: SyncPlanner.snapshot(targetFiles.get(path)) };
        return manifest;
    };

    const SyncExecutor = (() => {
        const run = async (plan, context) => {
            let completed = 0;
            for (const action of plan.actions) {
                if (model.abortRequested) return { status: 'aborted', completed, total: plan.actions.length, errors: [] };
                updateProgress(completed, plan.actions.length, action.path);
                try {
                    if (action.type === 'copy') await FileAdapter.copy(action, context.handles);
                    else if (action.type === 'trash') await FileAdapter.moveToTrash(action, context.handles, plan.stamp);
                } catch (error) {
                    return { status: 'failed', completed, total: plan.actions.length, errors: [safeMessage(error)] };
                }
                completed += 1;
                context.profile.lastCheckpoint = { planId: plan.id, completed, total: plan.actions.length, updatedAt: nowIso() };
                StateStore.save(context.state);
            }
            updateProgress(completed, plan.actions.length, '');
            return { status: 'success', completed, total: plan.actions.length, errors: [] };
        };
        return Object.freeze({ run });
    })();

    const Controller = (() => {
        const saveConfig = () => {
            model.state.config = { direction: elements.direction.value, conflictPolicy: elements.policy.value, excludeDirs: normalizeExcludes(elements.excludes.value), lang: language() };
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
                profile = { id, sourceName: model.source.name, targetName: model.target.name, bindingStatus: 'verified', createdAt: nowIso(), lastUsedAt: nowIso(), manifest: {}, history: [] };
                model.state.profiles[id] = profile;
            }
            profile.sourceName = model.source.name; profile.targetName = model.target.name; profile.bindingStatus = 'verified'; profile.lastUsedAt = nowIso();
            model.state.activeProfileId = profile.id; model.profile = profile; model.trustedProfile = true;
            await HandleStore.put(profile.id, model.source, model.target); StateStore.save(model.state);
            setPhase('ready'); setStatus(t('pairReady'), 'success', 'check'); renderProfile(); renderHistory();
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
            setPhase('comparing'); setStatus(t('comparing'), 'info', 'compare'); elements.progress.dataset.visible = 'false';
            try {
                const excludes = normalizeExcludes(elements.excludes.value);
                [model.sourceFiles, model.targetFiles] = await Promise.all([FileAdapter.scan(model.source, excludes), FileAdapter.scan(model.target, excludes)]);
                model.plan = SyncPlanner.plan({ source: model.sourceFiles, target: model.targetFiles, manifest: model.profile.manifest, trustedManifest: model.trustedProfile, direction: elements.direction.value, conflictPolicy: elements.policy.value });
                renderRows();
                setPhase(model.plan.actions.length ? 'planned' : 'ready');
                setStatus(t(model.plan.actions.length ? 'compareDone' : 'compareNone', { count: model.plan.actions.length }), model.plan.summary.conflicts ? 'warning' : 'success', model.plan.summary.conflicts ? 'alert' : 'check');
                addLog(t(model.plan.actions.length ? 'compareDone' : 'compareNone', { count: model.plan.actions.length }));
            } catch (error) {
                model.plan = null; setPhase('error'); setStatus(t('compareFailed', { message: safeMessage(error) }), 'danger', 'alert'); addLog(t('compareFailed', { message: safeMessage(error) }));
            } finally { renderControls(); }
        };
        const sync = async () => {
            if (!model.plan?.actions.length || !model.profile) return;
            const plan = model.plan; model.abortRequested = false; setPhase('syncing'); setStatus(t('syncing', { current: 0, total: plan.actions.length }), 'info', 'sync'); updateProgress(0, plan.actions.length);
            try {
                const result = await SyncExecutor.run(plan, { handles: { source: model.source, target: model.target }, profile: model.profile, state: model.state });
                const excludes = normalizeExcludes(elements.excludes.value);
                [model.sourceFiles, model.targetFiles] = await Promise.all([FileAdapter.scan(model.source, excludes), FileAdapter.scan(model.target, excludes)]);
                model.profile.manifest = buildManifest(model.sourceFiles, model.targetFiles);
                if (result.status !== 'failed') delete model.profile.lastCheckpoint;
                const history = { time: new Date().toLocaleString(language()), direction: elements.direction.value, filesCount: result.completed, status: result.status };
                model.profile.history.unshift(history); model.profile.history = model.profile.history.slice(0, MAX_PROFILE_HISTORY); model.state.globalHistory.unshift(history); model.state.globalHistory = model.state.globalHistory.slice(0, MAX_GLOBAL_HISTORY); StateStore.save(model.state);
                model.plan = null; renderHistory(); renderRows();
                if (result.status === 'aborted') { setPhase('aborted'); setStatus(t('syncAborted', { count: result.completed }), 'warning', 'stop'); }
                else if (result.status === 'failed') { setPhase('error'); setStatus(t('syncFailed', { message: result.errors[0] || 'Unknown error' }), 'danger', 'alert'); }
                else { setPhase('success'); setStatus(t('syncDone', { count: result.completed }), 'success', 'check'); }
                addLog(elements.statusText.textContent);
            } catch (error) {
                setPhase('error'); setStatus(t('syncFailed', { message: safeMessage(error) }), 'danger', 'alert'); addLog(t('syncFailed', { message: safeMessage(error) }));
            } finally { model.abortRequested = false; renderControls(); }
        };
        const abort = () => { if (model.phase === 'syncing') { model.abortRequested = true; setPhase('aborting'); setStatus(t('aborting'), 'warning', 'stop'); } };
        const importState = async (file) => {
            try {
                if (file.size > MAX_IMPORT_BYTES) throw new Error('JSON file exceeds 5MB');
                model.state = StateStore.importText(await file.text()); model.source = model.target = model.profile = null; model.trustedProfile = false; model.plan = null; StateStore.save(model.state); setPhase('idle'); renderStaticText(); setStatus(t('importDone'), 'success', 'check'); addLog(t('importDone'));
            } catch (error) { setPhase('error'); setStatus(t('importFailed', { message: safeMessage(error) }), 'danger', 'alert'); }
        };
        return Object.freeze({ abort, bindPair, compare, importState, invalidatePlan, pick, saveConfig, sync });
    })();

    const downloadJson = (data, name) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    elements.btnSrc.addEventListener('click', () => Controller.pick('source'));
    elements.btnTgt.addEventListener('click', () => Controller.pick('target'));
    elements.btnCompare.addEventListener('click', Controller.compare);
    elements.btnSync.addEventListener('click', Controller.sync);
    elements.btnAbort.addEventListener('click', Controller.abort);
    [elements.direction, elements.policy, elements.excludes].forEach((control) => control.addEventListener('change', () => { Controller.saveConfig(); Controller.invalidatePlan(); }));
    elements.excludes.addEventListener('input', () => { model.state.config.excludeDirs = normalizeExcludes(elements.excludes.value); StateStore.save(model.state); Controller.invalidatePlan(); });
    $('#btnLangKo').addEventListener('click', () => { model.state.config.lang = 'ko'; StateStore.save(model.state); renderStaticText(); });
    $('#btnLangEn').addEventListener('click', () => { model.state.config.lang = 'en'; StateStore.save(model.state); renderStaticText(); });
    $('#btnGenDefault').addEventListener('click', () => { downloadJson(StateStore.createDefault(), 'file-nally-default.json'); setStatus(t('defaultDone'), 'success', 'check'); });
    $('#btnExport').addEventListener('click', () => { downloadJson(StateStore.export(model.state), `file-nally-backup-${new Date().toISOString().slice(0, 10)}.json`); setStatus(t('exportDone'), 'success', 'check'); });
    $('#btnImport').addEventListener('click', () => $('#fileImporter').click());
    $('#fileImporter').addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (file) await Controller.importState(file); event.target.value = ''; });
    $('#btnClearHistory').addEventListener('click', () => {
        if (!confirm(t('confirmClear'))) return;
        model.state.globalHistory = []; if (model.profile) model.profile.history = []; StateStore.save(model.state); renderHistory(); setStatus(t('historyCleared'), 'success', 'check');
    });

    const initialize = async () => {
        model.profile = model.state.activeProfileId ? model.state.profiles[model.state.activeProfileId] || null : null;
        if (model.profile) {
            const record = await HandleStore.get(model.profile.id);
            if (record) {
                try {
                    const sourcePermission = await record.sourceHandle.queryPermission({ mode: 'readwrite' });
                    const targetPermission = await record.targetHandle.queryPermission({ mode: 'readwrite' });
                    if (sourcePermission === 'granted' && targetPermission === 'granted') {
                        model.source = record.sourceHandle; model.target = record.targetHandle; model.trustedProfile = model.profile.bindingStatus === 'verified';
                        elements.pathSrc.textContent = model.source.name; elements.pathSrc.title = model.source.name; elements.pathTgt.textContent = model.target.name; elements.pathTgt.title = model.target.name; setPhase('ready'); setStatus(t('pairReady'), 'success', 'check');
                    }
                } catch { model.trustedProfile = false; }
            }
        }
        renderStaticText(); renderRows(); renderHistory(); renderControls(); addLog(t('waiting'));
    };

    window.FileNallyTest = Object.freeze({
        StateStore,
        SyncPlanner,
        executeCurrentPlan: () => Controller.sync(),
        getModel: () => ({ phase: model.phase, trustedProfile: model.trustedProfile, profileId: model.profile?.id || null, plan: model.plan ? cloneJson({ id: model.plan.id, actions: model.plan.actions, summary: model.plan.summary }) : null }),
    });

    initialize().catch((error) => {
        setPhase('error');
        setStatus(t('pickFailed', { message: safeMessage(error) }), 'danger', 'alert');
        addLog(safeMessage(error));
    });
})();
