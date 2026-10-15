import GM_fetch from '@trim21/gm-fetch';
import {
    state,
    type WikiData,
    type HistoryEntry,
    type CsvItem,
    getEntityApiConfig,
} from './core';
import {
    switchToCompletedView,
    switchToProcessingView,
    switchToProcessingErrorView,
} from './views';
import {
    showLoadingOverlay,
    hideLoadingOverlay,
    updateProgressBar,
} from './ui';

let fetchLock = false;

export function startProcessing(): void {
    if (state.submitMethod === 'patch' && !state.accessToken) {
        alert('请输入Access Token');
        return;
    }

    if (state.submitMethod === 'post' && !state.formhash) {
        alert('请输入Formhash');
        return;
    }

    if (!state.csvData || state.csvData.length === 0) {
        alert('请上传有效的CSV文件');
        return;
    }

    state.totalItems = state.csvData.length;
    state.processing = true;
    state.paused = false;
    fetchLock = false;

    const coreContent = document.getElementById('core-content');
    if (coreContent) {
        coreContent.innerHTML = `
            <div>
                <div class="item-info">准备处理第一个条目...</div>
            </div>
        `;
    }

    processNextItem();
}

export function processNextItem(isRetry: boolean = false): void {
    if (state.paused || !state.processing || fetchLock) return;

    if (state.currentIndex >= state.totalItems) {
        switchToCompletedView();
        return;
    }

    const currentItem = state.csvData![state.currentIndex];
    const entityType = state.entityType || 'subject';

    if (!isRetry) {
        updateProgressBar(state.currentIndex, state.totalItems);
    }

    document.querySelectorAll('#static-buttons-container button').forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
    });
    showLoadingOverlay('正在获取条目信息...');

    const { wikiPath, historyPath } = getEntityApiConfig(entityType, currentItem.id);

    const headers: Record<string, string> = state.submitMethod === 'patch' ? {
        'Authorization': `Bearer ${state.accessToken}`,
        'Accept': 'application/json',
    } : {
        'Accept': 'application/json',
    };

    fetchLock = true;
    Promise.all([
        GM_fetch(wikiPath, { headers }),
        GM_fetch(historyPath, { headers }),
    ])
        .then(async ([wikiResponse, historyResponse]) => {
            if (!wikiResponse.ok) throw new Error(`HTTP ${wikiResponse.status}`);
            if (!historyResponse.ok) throw new Error(`HTTP ${historyResponse.status}`);

            const wikiData: WikiData = await wikiResponse.json();
            const historyData: HistoryEntry[] = await historyResponse.json();
            return { currentItem, wikiData, historyData };
        })
        .then((itemData) => {
            if (!state.processing) return;
            state.retryCount[itemData.currentItem.id] = 0;
            hideLoadingOverlay();
            document.querySelectorAll('#static-buttons-container button').forEach(btn => {
                (btn as HTMLButtonElement).disabled = false;
            });
            fetchLock = false;

            switchToProcessingView(itemData);
        })
        .catch((error: Error) => {
            if (!state.processing) return;
            hideLoadingOverlay();
            document.querySelectorAll('#static-buttons-container button').forEach(btn => {
                (btn as HTMLButtonElement).disabled = false;
            });
            fetchLock = false;

            switchToProcessingErrorView(currentItem, error.message);
        });
}

export function submitUpdate(
    itemId: string,
    newWcode: string,
    newTags: string[],
    newSeries: boolean,
    itemName: string,
    currentItem: CsvItem,
    commitMessage: string,
    onSuccess: () => void,
    onError: (error: Error) => void,
): void {
    const entityType = state.entityType || 'subject';

    if (state.submitMethod === 'patch') {
        const { wikiPath, patchBodyKey } = getEntityApiConfig(entityType, itemId);
        const patchBody: Record<string, unknown> = {
            commitMessage: commitMessage,
        };

        if (entityType === 'subject') {
            patchBody.subject = {
                infobox: newWcode,
                metaTags: newTags,
                series: newSeries,
            };
        } else {
            patchBody[patchBodyKey] = {
                infobox: newWcode,
            };
        }

        GM_fetch(wikiPath, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${state.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(patchBody),
        })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`HTTP ${response.status} - ${text || '更新失败'}`);
                    });
                }
                return response;
            })
            .then(() => {
                hideLoadingOverlay();
                onSuccess();
            })
            .catch(error => {
                onError(error instanceof Error ? error : new Error(String(error)));
            });
    } else {
        const formattedInfobox = newWcode.replace(/\n/g, '\r\n');

        const formData = new FormData();
        formData.append('formhash', state.formhash);
        formData.append('editSummary', commitMessage);

        if (entityType === 'subject') {
            formData.append('subject_title', state.currentSubjectData?.name || '');
            formData.append('platform', state.currentSubjectData?.platform || '');
            formData.append('subject_infobox', formattedInfobox);
            formData.append('subject_summary', state.currentSubjectData?.summary || '');
            formData.append('subject_meta_tags', newTags.join(' '));
            formData.append('series', newSeries ? '1' : '0');
            formData.append('submit', '提交');
        } else if (entityType === 'person') {
            formData.append('crt_name', state.currentSubjectData?.name || '');
            formData.append('crt_infobox', formattedInfobox);
            formData.append('crt_summary', state.currentSubjectData?.summary || '');
            const profession = state.currentSubjectData?.profession;
            if (profession) {
                for (const [key, val] of Object.entries(profession)) {
                    if (val) formData.append(`prsn_pro[${key}]`, '1');
                }
            }
            formData.append('picfile', '');
            formData.append('submit', '改好了');
        } else {
            formData.append('crt_name', state.currentSubjectData?.name || '');
            formData.append('crt_infobox', formattedInfobox);
            formData.append('crt_summary', state.currentSubjectData?.summary || '');
            formData.append('picfile', '');
            formData.append('submit', '改好了');
        }

        const formParams = new URLSearchParams();
        formData.forEach((value, key) => {
            formParams.append(key, value as string);
        });

        const postUrl = entityType === 'subject'
            ? `${state.bgmBase}/subject/${itemId}/new_revision`
            : `${state.bgmBase}/${entityType}/${itemId}/edit`;

        GM.xmlHttpRequest({
            method: 'POST',
            url: postUrl,
            data: formParams.toString(),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            onload: function (response) {
                hideLoadingOverlay();

                if (response.finalUrl === postUrl) {
                    onError(new Error('更新失败，可能是formhash无效或权限不足'));
                } else {
                    onSuccess();
                }
            },
            onerror: function (error) {
                hideLoadingOverlay();
                onError(new Error(`网络错误: ${error.message}`));
            },
            onabort: function () {
                hideLoadingOverlay();
                onError(new Error('请求已中止'));
            },
            ontimeout: function () {
                hideLoadingOverlay();
                onError(new Error('请求超时'));
            },
        });
    }
}
