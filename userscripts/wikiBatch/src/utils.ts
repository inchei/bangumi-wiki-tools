import { state, normalizeBaseUrl, DEFAULT_SCRIPT_BASE } from './core';

export const IS_APPLE_PLATFORM = /mac|iphone|ipad|ipod/i.test(
    (navigator as any).userAgentData?.platform ||
        navigator.platform ||
        navigator.userAgent ||
        '',
);
export const CONFIRM_SHORTCUT_HINT = IS_APPLE_PLATFORM ? '⌘↵' : 'Ctrl↵';
export const CONFIRM_SHORTCUT_TITLE = `焦点在批量更新面板时按 ${CONFIRM_SHORTCUT_HINT} 直接确认更新`;
export const SKIP_SHORTCUT_HINT = 'Shift↵';
export const SKIP_SHORTCUT_TITLE = `焦点在批量更新面板时按 ${SKIP_SHORTCUT_HINT} 直接跳过`;
export const RETRY_SHORTCUT_TITLE = `焦点在批量更新面板时按 ${CONFIRM_SHORTCUT_HINT} 直接重试`;
export const START_SHORTCUT_TITLE = `焦点在批量更新面板时按 ${CONFIRM_SHORTCUT_HINT} 直接开始处理`;

export function sanitizeRegExp(str: string): string {
    const regexSpecialChars = /[.*+?^${}()|[\]\\]/g;
    return str.replace(regexSpecialChars, '\\$&');
}

export function escapeHtml(str: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return str.replace(/[&<>"']/g, (ch) => map[ch]);
}

export function isScriptTarget(): boolean {
    const target = normalizeBaseUrl(state.scriptBase) || DEFAULT_SCRIPT_BASE;
    try {
        return location.origin === new URL(target).origin;
    } catch {
        return true;
    }
}

export function registerScriptMenuCommand(): void {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('设置脚本作用地址', () => {
        const input = prompt('脚本作用地址（留空恢复默认）', state.scriptBase);
        if (input === null) return;
        const value = normalizeBaseUrl(input) || DEFAULT_SCRIPT_BASE;
        state.scriptBase = value;
        GM_setValue('bgmScriptBase', value);
        alert(`脚本作用地址已设置为 ${value}，刷新页面后生效`);
    });
}

export function arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function isRecentUpdate(timestamp: number | null | undefined): boolean {
    if (!timestamp) return false;
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    return timestamp * 1000 > twentyFourHoursAgo;
}

export function resetProcessingState(): void {
    const s = state;
    s.currentSubjectData = null;
    s.currentItemId = null;
    s.currentWcode = null;
    s.currentTags = null;
    s.currentSeries = null;
    s.currentCommitMessage = null;
    s.currentFieldUpdates = null;
    s.currentTagUpdates = null;
    s.currentSeriesUpdate = null;
}
