import {
    state,
    type EntityType,
    type CsvItem,
    type WikiData,
    type HistoryEntry,
    getEntityApiConfig,
    normalizeBaseUrl,
    DEFAULT_API_BASE,
    DEFAULT_BGM_BASE,
} from './core';
import {
    hideProgressBar,
    showProgressBar,
    updateProgressBar,
    showStatusMessage,
    hideLoadingOverlay,
} from './ui';
import {
    getFieldUpdates,
    getFullInfobox,
    getTagUpdates,
    getSeriesUpdate,
    updateInfobox,
    applyTagUpdates,
    generateCommitMessage,
    updateConfirmButtonState,
    getResolvedTheme,
} from './diff';
import { getDoc, setDiffContent, WCODE_CONTAINER_ID, TAGS_CONTAINER_ID } from './cm-diff';
import { paintStaticIcons, setLockIcon } from './morph';
import { isRecentUpdate, resetProcessingState, escapeHtml, CONFIRM_SHORTCUT_HINT, CONFIRM_SHORTCUT_TITLE, IS_APPLE_PLATFORM, SKIP_SHORTCUT_HINT, SKIP_SHORTCUT_TITLE, RETRY_SHORTCUT_TITLE, START_SHORTCUT_TITLE } from './utils';
import { handleFileUpload, handlePasteCSV } from './csv';

export function switchToSetupView(): void {
    state.currentView = 'setup';
    state.processing = false;
    state.paused = true;
    resetProcessingState();
    hideLoadingOverlay();
    const coreContent = document.getElementById('core-content');
    const buttonsContainer = document.getElementById('static-buttons-container');

    document.getElementById('edit-regions')!.style.display = 'none';
    hideProgressBar();

    if (coreContent) {
        coreContent.innerHTML = `
            <div>
                <h3 class="section-title">基本设置</h3>
                <div class="setup-columns">
                    <div class="setup-column">
                        <div class="form-group">
                            <label>提交方式选择</label>
                            <div class="method-option-group">
                                <input type="radio" id="method-patch" name="submit-method" value="patch" ${state.submitMethod === 'patch' ? 'checked' : ''}>
                                <label for="method-patch">Private API</label>
                                <input type="radio" id="method-post" name="submit-method" value="post" ${state.submitMethod === 'post' ? 'checked' : ''}>
                                <label for="method-post">旧 API</label>
                            </div>
                        </div>

                        <div id="patch-method-options" class="form-group ${state.submitMethod === 'patch' ? '' : 'hidden'}">
                            <label for="setup-access-token">Access Token</label>
                            <input type="password" id="setup-access-token" value="${state.accessToken}">
                            <p class="field-hint">
                                在<a id="access-token-link" href="${state.apiBase}/demo/access-token" target="_blank">个人令牌页</a>获取 Access Token<br>
                                限速严重可切换为旧 API
                            </p>
                        </div>

                        <div id="post-method-options" class="form-group ${state.submitMethod === 'post' ? '' : 'hidden'}">
                            <label for="setup-formhash">Formhash</label>
                            <div class="row-flex">
                                <input type="text" id="setup-formhash" value="${state.formhash}">
                                <button type="button" class="secondary" id="setup-fetch-formhash"><morph-icon data-icon="wand" size="16"></morph-icon> 自动获取</button>
                            </div>
                            <p class="field-hint">
                                如何获取formhash：<br>
                                1. 打开条目编辑页面（如 <a id="formhash-edit-link" href="${state.bgmBase}/subject/354667/edit_detail" target="_blank">${state.bgmBase}/subject/354667/edit_detail</a>）<br>
                                2. 在浏览器控制台执行：<code>document.querySelector('[name=formhash]').value</code><br>
                                3. 将返回的值复制到上方输入框<br>
                                <strong>自动获取</strong>：通过后台请求编辑页面自动提取 formhash（需已登录）
                            </p>
                        </div>
                    </div>
                    <div class="setup-column">
                        <div class="form-group">
                            <label for="setup-csv-file">CSV文件 (包含ID列、要更新的字段列、tags列或series列)</label>
                            <div class="file-upload-group">
                                <button type="button" class="secondary" id="setup-csv-btn">
                                    <morph-icon data-icon="upload" size="16"></morph-icon> 选择 CSV 文件
                                </button>
                                <button type="button" class="secondary" id="setup-paste-csv-btn">
                                    <morph-icon data-icon="paste" size="16"></morph-icon> 从剪贴板粘贴
                                </button>
                                <span class="file-upload-name" id="setup-csv-file-name"></span>
                            </div>
                            <input type="file" id="setup-csv-file" accept=".csv" class="file-upload-input">
                            ${state.csvData ? `<div class="csv-loaded-info">已加载CSV: ${state.csvData.length} 条记录</div>` : ''}
                            <p class="field-hint">
                                必备ID列，条目id，人物person_id，角色character_id<br>
                                tags列使用空格分隔标签，前缀带"-"的标签表示删除该标签<br>
                                series列使用true或false表示是否标记为系列<br>
                                infobox列将整体替换Wiki文本（其余列仍按字段名逐项更新）<br>
                                可使用 <a href="https://github.com/inchei/bangumi-wiki-tools/tree/main/bgq" target="_blank">Bangumi Query</a> 辅助生成（<a href="https://bgq.iccci.cc.cd" target="_blank">demo</a>）<br>
                                可参考 <a href="https://inchei.github.io/bangumi-wiki-tools" target="_blank">每周自动生成任务</a>
                            </p>
                        </div>
                        ${state.csvData ? `
                        <div class="form-group">
                            <label for="setup-progress-range">处理进度</label>
                            <div class="row-flex progress-edit-row">
                                <input type="range" id="setup-progress-range" min="0" max="${state.csvData.length}" step="1" value="${state.currentIndex}">
                                <input type="number" id="setup-progress-input" min="0" max="${state.csvData.length}" step="1" value="${state.currentIndex}">
                                <span class="progress-total">/ ${state.csvData.length}</span>
                                <button type="button" id="setup-progress-restore" class="secondary progress-restore-btn">上次进度</button>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                <h3 class="section-title">地址配置</h3>
                <div class="address-config">
                    <div class="form-group">
                        <label for="setup-api-base">API 地址</label>
                        <input type="text" id="setup-api-base" value="${escapeHtml(state.apiBase)}" placeholder="${DEFAULT_API_BASE}">
                        <p class="field-hint">
                            Private API 基地址<br>
                            默认 <a href="${DEFAULT_API_BASE}" target="_blank">${DEFAULT_API_BASE}</a>
                        </p>
                    </div>
                    <div class="form-group">
                        <label for="setup-bgm-base">Bangumi 地址</label>
                        <input type="text" id="setup-bgm-base" value="${escapeHtml(state.bgmBase)}" placeholder="${DEFAULT_BGM_BASE}">
                        <p class="field-hint">
                            用于提交更新与跳转的 bgm.tv 站点基地址<br>
                            默认 <a href="${DEFAULT_BGM_BASE}" target="_blank">${DEFAULT_BGM_BASE}</a>
                        </p>
                    </div>
                </div>
                <div class="sync-section">
                    <h3 class="section-title">跨设备同步</h3>
                    <div class="sync-status" id="sync-status">未同步</div>
                    <div class="row-flex">
                        <button type="button" class="secondary" id="sync-auth-btn">
                            <morph-icon data-icon="key" size="16"></morph-icon> 授权 GitHub
                        </button>
                        <button type="button" class="secondary" id="sync-upload-btn">
                            <morph-icon data-icon="upload" size="16"></morph-icon> 上传进度
                        </button>
                        <button type="button" class="secondary" id="sync-download-btn">
                            <morph-icon data-icon="download" size="16"></morph-icon> 下载进度
                        </button>
                        <button type="button" class="secondary" id="sync-clear-btn">
                            <morph-icon data-icon="trash" size="16"></morph-icon> 清除授权
                        </button>
                    </div>

                </div>
                <div class="setup-footer">
                    <a href="https://github.com/inchei/bangumi-wiki-tools/tree/main/wikiBatch" target="_blank">
                        <morph-icon data-icon="github" size="16"></morph-icon> GitHub
                    </a>
                </div>
            </div>
        `;
    }

    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="setup-start-processing" class="primary" title="${START_SHORTCUT_TITLE}" aria-label="开始处理，快捷键 ${IS_APPLE_PLATFORM ? 'Command 回车' : 'Ctrl 回车'}">开始处理<kbd class="kbd-hint" aria-hidden="true">${CONFIRM_SHORTCUT_HINT}</kbd></button>
        `;
    }

    const accessTokenInput = document.getElementById('setup-access-token') as HTMLInputElement | null;
    if (accessTokenInput) {
        accessTokenInput.addEventListener('input', (e) => {
            state.accessToken = (e.target as HTMLInputElement).value;
            GM_setValue('bgmAccessToken', state.accessToken);
        });
    }

    bindBaseInput('setup-api-base', DEFAULT_API_BASE, (value) => {
        state.apiBase = value;
        GM_setValue('bgmApiBase', state.apiBase);
        const link = document.getElementById('access-token-link') as HTMLAnchorElement | null;
        if (link) link.href = `${value}/demo/access-token`;
    });
    bindBaseInput('setup-bgm-base', DEFAULT_BGM_BASE, (value) => {
        state.bgmBase = value;
        GM_setValue('bgmBgmBase', state.bgmBase);
        const link = document.getElementById('formhash-edit-link') as HTMLAnchorElement | null;
        if (link) {
            const url = `${value}/subject/354667/edit_detail`;
            link.href = url;
            link.textContent = url;
        }
    });

    const formhashInput = document.getElementById('setup-formhash') as HTMLInputElement | null;
    if (formhashInput) {
        formhashInput.addEventListener('input', (e) => {
            state.formhash = (e.target as HTMLInputElement).value;
            GM_setValue('bgmFormhash', state.formhash);
        });
    }

    const fetchBtn = document.getElementById('setup-fetch-formhash') as HTMLButtonElement | null;
    if (fetchBtn) {
        fetchBtn.addEventListener('click', () => {
            if (!formhashInput) return;
            fetchBtn.disabled = true;
            fetchBtn.innerHTML = '<morph-icon data-icon="loader" size="16" class="spin"></morph-icon> 获取中...';
            paintStaticIcons(fetchBtn);
            GM.xmlHttpRequest({
                method: 'GET',
                url: `${state.bgmBase}/subject/1/edit_detail`,
                onload: (resp) => {
                    try {
                        const match = resp.responseText.match(/<input[^>]*name="formhash"[^>]*value="([^"]+)"/);
                        if (match && match[1]) {
                            state.formhash = match[1];
                            GM_setValue('bgmFormhash', state.formhash);
                            formhashInput.value = match[1];
                        } else {
                            alert('无法从页面提取 formhash，请确保已登录 Bangumi');
                        }
                    } catch {
                        alert('解析编辑页面失败');
                    } finally {
                        fetchBtn.disabled = false;
                        fetchBtn.innerHTML = '<morph-icon data-icon="wand" size="16"></morph-icon> 自动获取';
                        paintStaticIcons(fetchBtn);
                    }
                },
                onerror: () => {
                        alert('网络请求失败，请手动获取 formhash');
                        fetchBtn.disabled = false;
                        fetchBtn.innerHTML = '<morph-icon data-icon="wand" size="16"></morph-icon> 自动获取';
                        paintStaticIcons(fetchBtn);
                    },
            });
        });
    }

    const methodRadios = document.querySelectorAll('input[name="submit-method"]');
    methodRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.submitMethod = (e.target as HTMLInputElement).value as 'patch' | 'post';
            GM_setValue('bgmSubmitMethod', state.submitMethod);

            const patchOptions = document.getElementById('patch-method-options');
            const postOptions = document.getElementById('post-method-options');
            if (patchOptions) patchOptions.classList.toggle('hidden', state.submitMethod !== 'patch');
            if (postOptions) postOptions.classList.toggle('hidden', state.submitMethod !== 'post');
        });
    });

    const csvFileInput = document.getElementById('setup-csv-file') as HTMLInputElement | null;
    if (csvFileInput) {
        csvFileInput.addEventListener('change', handleFileUpload);
        csvFileInput.addEventListener('change', () => {
            const name = csvFileInput.files?.[0]?.name || '';
            const nameEl = document.getElementById('setup-csv-file-name');
            if (nameEl) nameEl.textContent = name;
        });
    }

    const csvBtn = document.getElementById('setup-csv-btn') as HTMLButtonElement | null;
    if (csvBtn && csvFileInput) {
        csvBtn.addEventListener('click', (e) => {
            e.preventDefault();
            csvFileInput.click();
        });
    }

    const pasteCsvBtn = document.getElementById('setup-paste-csv-btn') as HTMLButtonElement | null;
    if (pasteCsvBtn) {
        pasteCsvBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (!text || !text.trim()) {
                    showStatusMessage('剪贴板内容不是有效的CSV');
                    return;
                }
                const nameEl = document.getElementById('setup-csv-file-name');
                if (nameEl) nameEl.textContent = '已从剪贴板粘贴';
                handlePasteCSV(text);
            } catch (err) {
                showStatusMessage('读取剪贴板失败: ' + (err as Error).message);
            }
        });
    }

    const progressRange = document.getElementById('setup-progress-range') as HTMLInputElement | null;
    const progressInput = document.getElementById('setup-progress-input') as HTMLInputElement | null;
    const progressRestore = document.getElementById('setup-progress-restore') as HTMLButtonElement | null;
    if (progressRange && progressInput && state.csvData) {
        const max = state.csvData.length;
        const remembered = state.currentIndex;
        const applyValue = (value: number): number => {
            const clamped = Math.min(Math.max(Number.isNaN(value) ? 0 : value, 0), max);
            state.currentIndex = clamped;
            localStorage.setItem('bgmCurrentIndex', clamped.toString());
            if (progressRestore) progressRestore.disabled = clamped === remembered;
            return clamped;
        };
        progressRange.addEventListener('input', () => {
            progressInput.value = applyValue(parseInt(progressRange.value, 10)).toString();
        });
        progressInput.addEventListener('input', () => {
            const raw = parseInt(progressInput.value, 10);
            if (Number.isNaN(raw)) return;
            progressRange.value = applyValue(raw).toString();
        });
        progressInput.addEventListener('change', () => {
            const raw = parseInt(progressInput.value, 10);
            progressInput.value = applyValue(Number.isNaN(raw) ? 0 : raw).toString();
        });
        if (progressRestore) {
            progressRestore.disabled = true;
            progressRestore.addEventListener('click', () => {
                progressRange.value = applyValue(remembered).toString();
                progressInput.value = remembered.toString();
            });
        }
    }

    const statusEl = document.getElementById('sync-status');
    if (statusEl) {
        const token = GM_getValue('bgmGistToken', '');
        if (token) {
            const gistId = GM_getValue('bgmGistId', '');
            statusEl.textContent = gistId ? '已同步 (Gist: ' + gistId.slice(0, 8) + '…)' : '已授权 GitHub';
        } else {
            statusEl.textContent = '未同步';
        }
    }
    paintStaticIcons();
}

export function switchToProcessingView(itemData: {
    currentItem: CsvItem;
    wikiData: WikiData;
    historyData: HistoryEntry[];
}): void {
    state.currentView = 'processing';
    const { currentItem, wikiData, historyData } = itemData;
    state.currentSubjectData = wikiData;
    state.currentItemId = currentItem.id;

    const entityType = state.entityType || 'subject';

    state.currentWcode = null;
    state.currentTags = null;
    state.currentSeries = null;
    state.currentCommitMessage = null;

    const coreContent = document.getElementById('core-content');
    const buttonsContainer = document.getElementById('static-buttons-container');
    const editRegions = document.getElementById('edit-regions');

    if (editRegions) editRegions.style.display = 'block';
    showProgressBar();
    updateProgressBar(state.currentIndex, state.totalItems);

    const itemName = wikiData.name || '未知名称';
    const oldInfobox = wikiData.infobox || '';
    const oldTags = entityType === 'subject' ? (wikiData.metaTags || []) : [];
    const oldSeries = entityType === 'subject' ? (wikiData.series || false) : false;
    const fieldUpdates = getFieldUpdates(currentItem, oldInfobox);
    const fullInfobox = getFullInfobox(currentItem);
    const tagUpdates = getTagUpdates(currentItem, oldTags);
    const seriesUpdate = getSeriesUpdate(currentItem, oldSeries);
    state.currentFieldUpdates = fieldUpdates;
    state.currentTagUpdates = tagUpdates;
    state.currentSeriesUpdate = seriesUpdate;

    const TYPE_LABELS: Record<EntityType, string> = {
        subject: '条目',
        character: '角色',
        person: '人物',
    };

    const lastUpdateEl = document.getElementById('static-last-update');
    const lastUpdateTime: number | undefined = historyData[0]?.createdAt;
    const lastUpdateDate = lastUpdateTime ? new Date(lastUpdateTime * 1000) : null;
    const lastCreator: string = historyData[0]?.creator?.username || '';
    const lastCommitMessage2: string = historyData[0]?.commitMessage || '';
    const shouldWarn = isRecentUpdate(lastUpdateTime);

    if (lastUpdateDate && lastUpdateEl) {
        const { editPagePath } = getEntityApiConfig(entityType, currentItem.id);
        lastUpdateEl.innerHTML = `
            <a href="${editPagePath}" target="_blank">
                最后更新: ${lastUpdateDate.toLocaleString()} ${lastCreator} ${lastCommitMessage2}
            </a>
        `;
        lastUpdateEl.style.color = shouldWarn ? '#d9534f' : '';
        lastUpdateEl.style.display = 'block';
    } else if (lastUpdateEl) {
        lastUpdateEl.style.display = 'none';
    }

    const prevLinkEl = document.getElementById('prev-item-link');
    if (prevLinkEl && state.previousItem && state.currentIndex > 0) {
        const prevType = state.previousItem.type as EntityType;
        const { editPagePath: prevEditPath } = getEntityApiConfig(prevType, state.previousItem.id);
        prevLinkEl.innerHTML = `
            <morph-icon data-icon="arrow-left" size="14"></morph-icon> 上一个:
            <a href="${prevEditPath}" target="_blank">
                ${state.previousItem.name}（${state.previousItem.id}）
            </a>
        `;
        paintStaticIcons(prevLinkEl);
        prevLinkEl.style.display = 'block';
    } else if (prevLinkEl) {
        prevLinkEl.style.display = 'none';
    }

    const commitInput = document.getElementById('static-commit-input') as HTMLInputElement;

    const defaultCommitMsg = generateCommitMessage(fieldUpdates, tagUpdates, seriesUpdate, entityType);
    if (state.isCommitMessageLocked) {
        commitInput.value = state.lockedCommitMessage;
    } else if (state.isCommitMessageAuto || !commitInput.value.trim()) {
        state.currentCommitMessage = defaultCommitMsg;
        commitInput.value = defaultCommitMsg;
    }
    setLockIcon(state.isCommitMessageLocked, false);

    const autoCommitCheckbox = document.getElementById('static-auto-commit') as HTMLInputElement | null;
    if (autoCommitCheckbox) {
        autoCommitCheckbox.checked = state.isCommitMessageAuto;
        autoCommitCheckbox.disabled = state.isCommitMessageLocked;
    }

    const newInfobox = updateInfobox(fullInfobox ?? oldInfobox, fieldUpdates);
    setDiffContent(WCODE_CONTAINER_ID, oldInfobox, newInfobox, getResolvedTheme() === 'dark', () => {
        if (state.currentView === 'processing' && state.currentSubjectData) {
            state.currentWcode = getDoc(WCODE_CONTAINER_ID);
            updateConfirmButtonState();
        }
    }, true);

    const tagsArea = document.getElementById('static-tags-area');
    if (entityType === 'subject') {
        const newTags = applyTagUpdates(oldTags, tagUpdates);
        setDiffContent(TAGS_CONTAINER_ID, oldTags.join(' '), newTags.join(' '), getResolvedTheme() === 'dark', () => {
            if (state.currentView === 'processing' && state.currentSubjectData) {
                state.currentTags = getDoc(TAGS_CONTAINER_ID);
                updateConfirmButtonState();
            }
        });
        if (tagsArea) tagsArea.style.display = 'block';
    } else {
        if (tagsArea) tagsArea.style.display = 'none';
    }

    const seriesArea = document.getElementById('static-series-area');
    if (entityType === 'subject') {
        const seriesCheckbox = document.getElementById('static-series-checkbox') as HTMLInputElement;
        const finalSeriesValue = seriesUpdate.hasUpdate ? seriesUpdate.newValue! : oldSeries;
        seriesCheckbox.checked = finalSeriesValue;
        state.currentSeries = finalSeriesValue;
        if (seriesArea) seriesArea.style.display = 'block';
    } else if (seriesArea) {
        seriesArea.style.display = 'none';
    }

    const browsePath = getEntityApiConfig(entityType, currentItem.id).editPagePath.replace('/edit', '');
    const typeLabel = TYPE_LABELS[entityType] || '条目';

    if (coreContent) {
        coreContent.innerHTML = `
            <div>
                <div class="item-info">
                    当前${typeLabel}：<a href="${browsePath}" target="_blank">${itemName}</a>（${currentItem.id}）[${typeLabel}]
                </div>
            </div>
        `;
    }

    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="process-skip-update" class="secondary" title="${SKIP_SHORTCUT_TITLE}" aria-label="跳过，快捷键 Shift 回车">跳过<kbd class="kbd-hint" aria-hidden="true">${SKIP_SHORTCUT_HINT}</kbd></button>
            <button id="process-confirm-update" class="primary" title="${CONFIRM_SHORTCUT_TITLE}" aria-label="确认更新，快捷键 ${IS_APPLE_PLATFORM ? 'Command 回车' : 'Ctrl 回车'}"><span class="confirm-label">确认更新</span><kbd class="kbd-hint" aria-hidden="true">${CONFIRM_SHORTCUT_HINT}</kbd></button>
        `;
    }

    paintStaticIcons();
    updateConfirmButtonState();
}

export function switchToProcessingErrorView(currentItem: CsvItem, errorMsg: string): void {
    state.currentView = 'processing';
    const coreContent = document.getElementById('core-content');
    const buttonsContainer = document.getElementById('static-buttons-container');
    const editRegions = document.getElementById('edit-regions');

    if (editRegions) editRegions.style.display = 'none';
    showProgressBar();
    updateProgressBar(state.currentIndex, state.totalItems);

    const itemId = currentItem.id;
    const TYPE_LABELS: Record<string, string> = { subject: '条目', character: '角色', person: '人物' };
    const typeLabel = TYPE_LABELS[state.entityType] || '条目';

    const currentRetryCount = (state.retryCount[itemId] || 0) + 1;
    state.retryCount[itemId] = currentRetryCount;

    if (coreContent) {
        coreContent.innerHTML = `
            <div>
                <div class="item-info">
                    当前${typeLabel}：<a href="${state.bgmBase}/${state.entityType}/${itemId}" target="_blank">查看${typeLabel}</a>（${itemId}）
                </div>
                <div class="status-box error">
                    无法获取${typeLabel}信息: ${errorMsg}
                    ${currentRetryCount > 1 ? `<br>已重试 ${currentRetryCount - 1} 次` : ''}
                </div>
                <p>是否继续处理？</p>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${(state.currentIndex / state.totalItems) * 100}%"></div>
                </div>
            </div>
        `;
    }

    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="process-skip-error" class="secondary" title="${SKIP_SHORTCUT_TITLE}" aria-label="跳过，快捷键 Shift 回车">跳过<kbd class="kbd-hint" aria-hidden="true">${SKIP_SHORTCUT_HINT}</kbd></button>
            <button id="process-retry-error" class="primary" title="${RETRY_SHORTCUT_TITLE}" aria-label="重试，快捷键 ${IS_APPLE_PLATFORM ? 'Command 回车' : 'Ctrl 回车'}">重试<kbd class="kbd-hint" aria-hidden="true">${CONFIRM_SHORTCUT_HINT}</kbd></button>
        `;
    }
}

export function switchToUpdateErrorView(errorMsg: string): void {
    state.currentView = 'processing';
    const coreContent = document.getElementById('core-content');
    const buttonsContainer = document.getElementById('static-buttons-container');
    const editRegions = document.getElementById('edit-regions');

    if (editRegions) editRegions.style.display = 'none';
    showProgressBar();
    updateProgressBar(state.currentIndex, state.totalItems);

    const itemId = state.currentItemId || '';
    const currentRetryCount = (state.retryCount[itemId] || 0) + 1;
    state.retryCount[itemId] = currentRetryCount;

    const subjectData = state.currentSubjectData;
    const itemName = subjectData?.name || '未知名称';

    const TYPE_LABELS: Record<string, string> = { subject: '条目', character: '角色', person: '人物' };
    const typeLabel = TYPE_LABELS[state.entityType] || '条目';

    if (coreContent) {
        coreContent.innerHTML = `
            <div>
                <div class="item-info">
                    当前${typeLabel}：<a href="${state.bgmBase}/${state.entityType}/${itemId}" target="_blank">${itemName}</a>（${itemId}）
                </div>
                <div class="status-box error">
                    提交更新失败: ${errorMsg}
                </div>
                <p>是否重试更新？</p>
            </div>
        `;
    }

    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="process-skip-update-fail" class="secondary" title="${SKIP_SHORTCUT_TITLE}" aria-label="跳过，快捷键 Shift 回车">跳过<kbd class="kbd-hint" aria-hidden="true">${SKIP_SHORTCUT_HINT}</kbd></button>
            <button id="process-retry-update" class="primary" title="${RETRY_SHORTCUT_TITLE}" aria-label="重试，快捷键 ${IS_APPLE_PLATFORM ? 'Command 回车' : 'Ctrl 回车'}">重试<kbd class="kbd-hint" aria-hidden="true">${CONFIRM_SHORTCUT_HINT}</kbd></button>
        `;
    }
}

function bindBaseInput(id: string, fallback: string, set: (value: string) => void): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    input.addEventListener('input', () => {
        set(normalizeBaseUrl(input.value) || fallback);
    });
    input.addEventListener('blur', () => {
        const value = normalizeBaseUrl(input.value) || fallback;
        set(value);
        input.value = value;
    });
}

export function switchToCompletedView(): void {
    state.currentView = 'completed';
    const coreContent = document.getElementById('core-content');
    const buttonsContainer = document.getElementById('static-buttons-container');
    const editRegions = document.getElementById('edit-regions');

    if (editRegions) editRegions.style.display = 'none';
    showProgressBar();
    updateProgressBar(state.totalItems, state.totalItems);

    if (coreContent) {
        coreContent.innerHTML = `
            <div>
                <h3 class="section-title">处理完成</h3>
                <div class="status-box info">所有条目处理完毕</div>
                <div class="stats-container">
                    <div class="stats-item">
                        <span class="stats-label">总条目</span>
                        <span class="stats-value">${state.totalItems}</span>
                    </div>
                </div>
            </div>
        `;
    }

    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button id="completed-back-to-setup" class="primary">返回设置</button>
        `;
    }
}
