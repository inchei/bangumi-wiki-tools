import { state, type EntityType, type TagUpdates, type SeriesUpdate, type CsvItem } from './core';
import { sanitizeRegExp, arraysEqual } from './utils';
import { getDoc, refreshEditorTheme, TAGS_CONTAINER_ID } from './cm-diff';
import { setConfirmButtonText } from './morph';
import { INFOBOX_FIELD_ORDER, INFOBOX_HEADER_MAP } from './infobox-field-order';

export function getResolvedTheme(): 'light' | 'dark' {
    if (state.theme === 'dark') return 'dark';
    if (state.theme === 'light') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getCurrentEntityType(): EntityType {
    return state.entityType || 'subject';
}

const BOOK_TYPE_ID = 1;

export function isSeriesApplicable(): boolean {
    return (
        getCurrentEntityType() === 'subject' &&
        Number(state.currentSubjectData?.typeID) === BOOK_TYPE_ID
    );
}

export function checkForUpdates(): boolean {
    if (!state.currentSubjectData) return false;

    const entityType = getCurrentEntityType();
    const currentWcode = getDoc('static-cm-diff');
    const normalizedCurrentWcode = currentWcode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const originalWcode = state.currentSubjectData.infobox || '';
    const normalizedOriginalWcode = originalWcode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const wcodeChanged = normalizedCurrentWcode !== normalizedOriginalWcode;

    if (entityType === 'subject') {
        const currentTags = getDoc(TAGS_CONTAINER_ID).split(' ').filter(t => t);
        const currentSeries = (document.getElementById('static-series-checkbox') as HTMLInputElement).checked;
        const originalTags = state.currentSubjectData.metaTags || [];
        const originalSeries = state.currentSubjectData.series || false;
        const tagsChanged = !arraysEqual(currentTags, originalTags);
        const seriesChanged = isSeriesApplicable() && currentSeries !== originalSeries;
        return wcodeChanged || tagsChanged || seriesChanged;
    }

    return wcodeChanged;
}

export function updateConfirmButtonState(): void {
    const confirmBtn = document.querySelector(
        '#static-buttons-container button#process-confirm-update',
    ) as HTMLButtonElement | null;
    if (!confirmBtn) return;

    const hasUpdates = checkForUpdates();

    if (hasUpdates) {
        setConfirmButtonText(confirmBtn, '确认更新');
        confirmBtn.disabled = false;
    } else {
        setConfirmButtonText(confirmBtn, '确认更新（无实质修改）');
        confirmBtn.disabled = false;
    }
}

export function generateCommitMessage(
    fieldUpdates: Record<string, string> | null,
    tagUpdates: TagUpdates | null,
    seriesUpdate: SeriesUpdate | null,
    entityType: EntityType | undefined,
): string {
    const updatedFields = Object.keys(fieldUpdates || {});
    const messages: string[] = [];

    if (updatedFields.length) messages.push(`更新${updatedFields.join('、')}`);

    if (entityType === 'subject' || !entityType) {
        if (tagUpdates?.add.length) messages.push(`添加标签${tagUpdates.add.join('、')}`);
        if (tagUpdates?.remove.length) messages.push(`删除标签${tagUpdates.remove.join('、')}`);
        if (seriesUpdate?.hasUpdate) {
            messages.push(seriesUpdate.newValue ? '标记为系列' : '取消系列标记');
        }
    }

    return messages.filter(s => s).join('；') || '更新条目信息';
}

export function refreshDiffDisplays(): void {
    const subjectData = state.currentSubjectData;
    if (!subjectData) return;

    refreshEditorTheme(getResolvedTheme() === 'dark');
}

export function getFieldUpdates(csvItem: CsvItem, _oldInfobox: string): Record<string, string> {
    const updates: Record<string, string> = {};
    Object.keys(csvItem).forEach(key => {
        if (!['id', 'tags', 'series', 'type', 'infobox'].includes(key.toLowerCase())) {
            const val = csvItem[key];
            if (val !== undefined) {
                updates[key] = val;
            }
        }
    });
    return updates;
}

export function getFullInfobox(csvItem: CsvItem): string | null {
    const key = Object.keys(csvItem).find(k => k.toLowerCase() === 'infobox');
    if (!key) return null;
    const val = csvItem[key]?.replaceAll('\\n', '\n');
    if (!val || !val.trim()) return null;
    return val;
}

export function getTagUpdates(csvItem: CsvItem, _oldTags: string[]): TagUpdates {
    if (state.entityType !== 'subject') {
        return { add: [], remove: [] };
    }

    const tagsStr = csvItem.tags || '';
    const tags = tagsStr.split(' ').filter(t => t);

    const add: string[] = [];
    const remove: string[] = [];

    tags.forEach(tag => {
        if (tag.startsWith('-')) {
            remove.push(tag.slice(1));
        } else {
            add.push(tag);
        }
    });

    return { add, remove };
}

export function getSeriesUpdate(csvItem: CsvItem, oldSeries: boolean): SeriesUpdate {
    if (!isSeriesApplicable()) {
        return { hasUpdate: false };
    }

    if (csvItem.series === undefined || csvItem.series === null || csvItem.series === '') {
        return { hasUpdate: false };
    }

    const seriesValue = csvItem.series.trim().toLowerCase();
    const newValue = seriesValue === 'true' || seriesValue === '1' || seriesValue === 'yes';

    return {
        hasUpdate: newValue !== oldSeries,
        newValue: newValue,
    };
}

function getTemplateName(infobox: string): string | null {
    const m = infobox.match(/{{Infobox\s+(.+?)$/m);
    if (!m) return null;
    return INFOBOX_HEADER_MAP[m[1]] || null;
}

function findInsertIndex(lines: string[], fieldOrder: string[], fieldIdx: number): number {
    for (let i = 1; i < lines.length; i++) {
        const m = lines[i].match(/^\|([^|=]+?)\s*=/);
        if (m && fieldOrder.indexOf(m[1]) > fieldIdx) {
            return i;
        }
    }
    return lines.length - 1;
}

function formatFieldLine(field: string, value: string): string {
    const v = value.replace(/^\s+/, '');
    return v.startsWith('{') ? `|${field}=${v}` : `|${field}= ${v}`;
}

export function updateInfobox(oldInfobox: string, fieldUpdates: Record<string, string>): string {
    const templateName = getTemplateName(oldInfobox);
    const fieldOrder = templateName ? INFOBOX_FIELD_ORDER[templateName] : null;

    let newInfobox = oldInfobox;
    const pendingAdd: Array<{ field: string; value: string; fieldIdx: number }> = [];

    Object.entries(fieldUpdates).forEach(([field, value]) => {
        value = value.replaceAll('\\n', '\n');
        const escaped = sanitizeRegExp(field);
        const regex = new RegExp(`\\|${escaped}\\s*=[\\s\\S]*?(?=\\r?\\n\\s*\\|[^|=\\r\\n]+?\\s*=|\\r?\\n\\s*\\}\\}|\\s*$)`, 'i');
        if (regex.test(newInfobox)) {
            newInfobox = newInfobox.replace(regex, formatFieldLine(field, value));
        } else {
            pendingAdd.push({
                field,
                value,
                fieldIdx: fieldOrder ? fieldOrder.indexOf(field) : -1,
            });
        }
    });

    if (pendingAdd.length > 0) {
        if (fieldOrder) {
            pendingAdd.sort((a, b) => {
                if (a.fieldIdx === -1 && b.fieldIdx === -1) return 0;
                if (a.fieldIdx === -1) return 1;
                if (b.fieldIdx === -1) return -1;
                return a.fieldIdx - b.fieldIdx;
            });
        }

        const lines = newInfobox.split('\n');
        for (let i = pendingAdd.length - 1; i >= 0; i--) {
            const f = pendingAdd[i];
            if (fieldOrder && f.fieldIdx >= 0) {
                lines.splice(findInsertIndex(lines, fieldOrder, f.fieldIdx), 0, formatFieldLine(f.field, f.value));
            } else {
                lines.splice(-1, 0, formatFieldLine(f.field, f.value));
            }
        }
        newInfobox = lines.join('\n');
    }

    return newInfobox;
}

export function applyTagUpdates(oldTags: string[], tagUpdates: TagUpdates): string[] {
    const newTagsSet = new Set(oldTags);
    tagUpdates.add.forEach(tag => newTagsSet.add(tag));
    tagUpdates.remove.forEach(tag => newTagsSet.delete(tag));
    return [...newTagsSet];
}
