export const DEFAULT_API_BASE = 'https://next.bgm.tv';
export const DEFAULT_BGM_BASE = 'https://bgm.tv';
export const DEFAULT_SCRIPT_BASE = 'https://next.bgm.tv';

export function normalizeBaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

export interface CsvItem {
  id: string;
  tags?: string;
  series?: string;
  [field: string]: string | undefined;
}

export interface EntityConfig {
  wikiPath: string;
  historyPath: string;
  patchBodyKey: string;
  editPagePath: string;
}

export type EntityType = 'subject' | 'character' | 'person';

export interface TagUpdates {
  add: string[];
  remove: string[];
}

export interface SeriesUpdate {
  hasUpdate: boolean;
  newValue?: boolean;
}

export interface WikiData {
  name?: string;
  typeID?: number;
  infobox?: string;
  metaTags?: string[];
  series?: boolean;
  platform?: string | number;
  summary?: string;
  profession?: Record<string, boolean>;
}

export interface HistoryEntry {
  createdAt?: number;
  creator?: { username?: string };
  commitMessage?: string;
}

export type ViewName = 'setup' | 'processing' | 'completed';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface PreviousItem {
  id: string;
  name: string;
  type: string;
}

export interface State {
  accessToken: string;
  formhash: string;
  submitMethod: 'patch' | 'post';
  apiBase: string;
  bgmBase: string;
  scriptBase: string;
  entityType: EntityType;
  csvData: CsvItem[] | null;
  csvPersistDenied: boolean;
  currentIndex: number;
  totalItems: number;
  processing: boolean;
  paused: boolean;
  currentView: ViewName;
  currentSubjectData: WikiData | null;
  currentFieldUpdates: Record<string, string> | null;
  currentTagUpdates: TagUpdates | null;
  currentSeriesUpdate: SeriesUpdate | null;
  currentWcode: string | null;
  currentTags: string | null;
  currentSeries: boolean | null;
  currentCommitMessage: string | null;
  isCommitMessageLocked: boolean;
  lockedCommitMessage: string;
  isCommitMessageAuto: boolean;
  retryCount: Record<string, number>;
  currentItemId: string | null;
  previousItem: PreviousItem | null;
    theme: ThemeMode;
}

export const state: State = {
    accessToken: GM_getValue('bgmAccessToken') || '',
    formhash: GM_getValue('bgmFormhash') || '',
    submitMethod: (GM_getValue('bgmSubmitMethod') as 'patch' | 'post') || 'patch',
    apiBase: normalizeBaseUrl(GM_getValue('bgmApiBase') || '') || DEFAULT_API_BASE,
    bgmBase: normalizeBaseUrl(GM_getValue('bgmBgmBase') || '') || DEFAULT_BGM_BASE,
    scriptBase: normalizeBaseUrl(GM_getValue('bgmScriptBase') || '') || DEFAULT_SCRIPT_BASE,
    entityType: (localStorage.getItem('bgmEntityType') as EntityType) || 'subject',
    csvData: JSON.parse(localStorage.getItem('bgmCsvData') || 'null'),
    csvPersistDenied: false,
    currentIndex: parseInt(localStorage.getItem('bgmCurrentIndex') || '0'),
    totalItems: parseInt(localStorage.getItem('bgmTotalItems') || '0'),
    processing: false,
    paused: false,
    currentView: 'setup',
    currentSubjectData: null,
    currentFieldUpdates: null,
    currentTagUpdates: null,
    currentSeriesUpdate: null,
    currentWcode: null,
    currentTags: null,
    currentSeries: null,
    currentCommitMessage: null,
    isCommitMessageLocked: localStorage.getItem('bgmIsCommitMessageLocked') === 'true' || false,
    lockedCommitMessage: localStorage.getItem('bgmLockedCommitMessage') || '',
    isCommitMessageAuto: localStorage.getItem('bgmIsCommitMessageAuto') === 'true' || false,
    retryCount: JSON.parse(GM_getValue('bgmRetryCount', '{}')),
    currentItemId: null,
    previousItem: JSON.parse(localStorage.getItem('bgmPreviousItem') || 'null'),
    theme: (localStorage.getItem('bgmTheme') as ThemeMode) || 'system',
};

export function saveState(): void {
    GM_setValue('bgmAccessToken', state.accessToken);
    GM_setValue('bgmFormhash', state.formhash);
    GM_setValue('bgmSubmitMethod', state.submitMethod);
    GM_setValue('bgmApiBase', state.apiBase);
    GM_setValue('bgmBgmBase', state.bgmBase);
    GM_setValue('bgmScriptBase', state.scriptBase);
    localStorage.setItem('bgmEntityType', state.entityType);
    persistCsvData();
    localStorage.setItem('bgmCurrentIndex', state.currentIndex.toString());
    localStorage.setItem('bgmTotalItems', state.totalItems.toString());
    GM_setValue('bgmRetryCount', JSON.stringify(state.retryCount));
    localStorage.setItem('bgmIsCommitMessageLocked', state.isCommitMessageLocked.toString());
    localStorage.setItem('bgmLockedCommitMessage', state.lockedCommitMessage);
    localStorage.setItem('bgmIsCommitMessageAuto', state.isCommitMessageAuto.toString());
    if (state.previousItem) {
        localStorage.setItem('bgmPreviousItem', JSON.stringify(state.previousItem));
    }
    localStorage.setItem('bgmTheme', state.theme);
}

export function persistCsvData(): boolean {
    if (state.csvPersistDenied) return false;
    try {
        localStorage.setItem('bgmCsvData', JSON.stringify(state.csvData));
        return true;
    } catch {
        state.csvPersistDenied = true;
        return false;
    }
}

export function getEntityApiConfig(type: EntityType, id: string): EntityConfig {
    const apiBase = state.apiBase;
    const bgmBase = state.bgmBase;
    const configs: Record<EntityType, EntityConfig> = {
        subject: {
            wikiPath: `${apiBase}/p1/wiki/subjects/${id}`,
            historyPath: `${apiBase}/p1/wiki/subjects/${id}/history-summary`,
            patchBodyKey: 'subject',
            editPagePath: `${bgmBase}/subject/${id}/edit`,
        },
        character: {
            wikiPath: `${apiBase}/p1/wiki/characters/${id}`,
            historyPath: `${apiBase}/p1/wiki/characters/${id}/history-summary`,
            patchBodyKey: 'character',
            editPagePath: `${bgmBase}/character/${id}/edit`,
        },
        person: {
            wikiPath: `${apiBase}/p1/wiki/persons/${id}`,
            historyPath: `${apiBase}/p1/wiki/persons/${id}/history-summary`,
            patchBodyKey: 'person',
            editPagePath: `${bgmBase}/person/${id}/edit`,
        },
    };
    return configs[type] || configs.subject;
}
