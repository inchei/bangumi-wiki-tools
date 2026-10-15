import { state, type PreviousItem } from './core';
import { startProcessing, processNextItem, submitUpdate } from './api';
import { checkForUpdates, generateCommitMessage, isSeriesApplicable } from './diff';
import { showLoadingOverlay, hideLoadingOverlay } from './ui';
import { switchToSetupView, switchToUpdateErrorView } from './views';
import { resetProcessingState } from './utils';
import { saveState } from './core';
import { getDoc, TAGS_CONTAINER_ID, WCODE_CONTAINER_ID } from './cm-diff';
import { authorizeWithGitHub, uploadToGist, downloadFromGist, clearGistAuth } from './gist-sync';

export function handleSetupViewButtons(btnId: string): void {
    switch (btnId) {
        case 'setup-start-processing':
            startProcessing();
            break;
        case 'sync-auth-btn':
            handleSyncAuth();
            break;
        case 'sync-upload-btn':
            handleSyncUpload();
            break;
        case 'sync-download-btn':
            handleSyncDownload();
            break;
        case 'sync-clear-btn':
            clearGistAuth();
            switchToSetupView();
            break;
    }
}

async function handleSyncAuth(): Promise<void> {
    const statusEl = document.getElementById('sync-status')
    if (!statusEl) return
    const btn = document.getElementById('sync-auth-btn') as HTMLButtonElement
    if (btn) btn.disabled = true
    await authorizeWithGitHub(statusEl)
    if (btn) btn.disabled = false
    switchToSetupView()
}

async function handleSyncUpload(): Promise<void> {
    const statusEl = document.getElementById('sync-status')
    if (!statusEl) return
    saveState()
    statusEl.textContent = '正在上传...'
    try {
        await uploadToGist()
        statusEl.textContent = '上传成功: ' + new Date().toLocaleString()
    } catch (e) {
        statusEl.textContent = '上传失败: ' + (e as Error).message
    }
}

async function handleSyncDownload(): Promise<void> {
    const statusEl = document.getElementById('sync-status')
    if (!statusEl) return
    statusEl.textContent = '正在下载...'
    try {
        await downloadFromGist()
        // Reload state from localStorage
        state.csvData = JSON.parse(localStorage.getItem('bgmCsvData') || 'null')
        state.currentIndex = parseInt(localStorage.getItem('bgmCurrentIndex') || '0')
        state.entityType = (localStorage.getItem('bgmEntityType') as any) || 'subject'
        state.totalItems = parseInt(localStorage.getItem('bgmTotalItems') || '0')
        state.retryCount = JSON.parse(GM_getValue('bgmRetryCount', '{}'))
        state.previousItem = JSON.parse(localStorage.getItem('bgmPreviousItem') || 'null')
        statusEl.textContent = '下载成功: ' + new Date().toLocaleString()
        switchToSetupView()
    } catch (e) {
        statusEl.textContent = '下载失败: ' + (e as Error).message
    }
}

export function handleProcessingViewButtons(btnId: string): void {
    if (!state.csvData) return;
    const currentItem = state.csvData[state.currentIndex];
    const subjectData = state.currentSubjectData;
    const itemId = currentItem?.id || state.currentItemId || '';
    const itemName = subjectData?.name || '未知名称';
    const entityType = state.entityType || 'subject';

    function makePreviousItem(): PreviousItem {
        return { id: itemId, name: itemName, type: entityType };
    }

    switch (btnId) {
        case 'process-confirm-update': {
            const finalWcode = getDoc(WCODE_CONTAINER_ID);

            const finalTags = entityType === 'subject'
                ? getDoc(TAGS_CONTAINER_ID).split(' ').filter(t => t)
                : [];
            const finalSeries = isSeriesApplicable()
                ? (document.getElementById('static-series-checkbox') as HTMLInputElement).checked
                : (subjectData?.series || false);

            const commitMessage = (document.getElementById('static-commit-input') as HTMLInputElement).value ||
                generateCommitMessage(state.currentFieldUpdates, state.currentTagUpdates, state.currentSeriesUpdate, entityType);

            const hasUpdates = checkForUpdates();

            if (!hasUpdates) {
                state.previousItem = makePreviousItem();
                state.currentIndex++;
                resetProcessingState();
                saveState();
                processNextItem();
                return;
            }

            document.querySelectorAll('#static-buttons-container button').forEach(btn => {
                (btn as HTMLButtonElement).disabled = true;
            });
            showLoadingOverlay('正在提交更新...');

            submitUpdate(
                itemId,
                finalWcode,
                finalTags,
                finalSeries,
                itemName,
                currentItem,
                commitMessage,
                () => {
                    state.previousItem = makePreviousItem();
                    state.currentIndex++;
                    resetProcessingState();
                    saveState();
                    processNextItem();
                },
                (error: Error) => {
                    hideLoadingOverlay();
                    document.querySelectorAll('#static-buttons-container button').forEach(btn => {
                        (btn as HTMLButtonElement).disabled = false;
                    });
                    switchToUpdateErrorView(error.message);
                },
            );
            break;
        }

        case 'process-skip-update':
            state.previousItem = makePreviousItem();
            state.currentIndex++;
            resetProcessingState();
            saveState();
            processNextItem();
            break;

        case 'process-confirm-continue':
            state.previousItem = makePreviousItem();
            state.currentIndex++;
            resetProcessingState();
            saveState();
            processNextItem();
            break;

        case 'process-skip-error':
            state.currentIndex++;
            resetProcessingState();
            saveState();
            processNextItem();
            break;

        case 'process-retry-error':
            processNextItem();
            break;

        case 'process-skip-update-fail':
            state.previousItem = makePreviousItem();
            state.currentIndex++;
            resetProcessingState();
            saveState();
            processNextItem();
            break;

        case 'process-retry-update':
            processNextItem(true);
            break;
    }
}

export function handleCompletedViewButtons(btnId: string): void {
    switch (btnId) {
        case 'completed-back-to-setup':
            switchToSetupView();
            hideProgressBar();
            break;
    }
}

function hideProgressBar(): void {
    const el = document.getElementById('bgm-tool-progress');
    if (el) el.style.display = 'none';
}
