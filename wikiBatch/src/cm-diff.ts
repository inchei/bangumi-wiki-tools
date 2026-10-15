import { Compartment, EditorState } from '@codemirror/state';
import {
    EditorView,
    drawSelection,
    highlightActiveLine,
    highlightSpecialChars,
    keymap,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, openSearchPanel } from '@codemirror/search';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { wikiHighlight, wikiLint } from './cm-wiki';

const NARROW_PX = 640;

const themeCompartment = new Compartment();

function themeSpec(fontSize: string) {
    return {
        '&': {
            backgroundColor: 'var(--white)',
            color: 'var(--text)',
            fontSize,
            border: '1px solid var(--border)',
            borderRadius: '6px',
        },
        '.cm-content': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.6',
            padding: '12px 0',
        },
        '.cm-gutters': {
            backgroundColor: 'transparent',
            border: 'none',
        },
        '&.cm-focused': {
            outline: 'none',
            borderColor: 'var(--accent-strong)',
            boxShadow: '0 0 0 2px rgb(240 145 153 / 15%)',
        },
    };
}

const cmLight = (fontSize: string) => EditorView.theme(themeSpec(fontSize));
const cmDark = (fontSize: string) => EditorView.theme(themeSpec(fontSize), { dark: true });

const zhCN = EditorState.phrases.of({
    '$ unchanged lines': '$ 行未变更',
    'Revert this chunk': '撤销此块',
    'Accept': '接受',
    'Reject': '撤销',
    'Find': '查找',
    'Replace': '替换',
    'next': '下一个',
    'previous': '上一个',
    'all': '全部',
    'match case': '区分大小写',
    'by word': '全字匹配',
    'regular expression': '正则表达式',
    'replace: $': '替换: $',
    'replace all: $': '替换全部: $',
    'close': '关闭',
    'current match': '当前匹配',
    'replaced $ matches': '已替换 $ 处匹配',
    'replaced $ match on $ line': '已在第 $ 行替换 $ 处匹配',
    'goto line: $': '跳转到行: $',
});

function baseExtensions(onChange: () => void, narrow: boolean, dark: boolean) {
    const fontSize = narrow ? '16px' : '13px';
    return [
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        zhCN,
        highlightSpecialChars(),
        EditorView.contentAttributes.of({ spellcheck: 'false' }),
        keymap.of([
            ...defaultKeymap,
            ...searchKeymap,
            { key: 'Mod-h', run: openSearchPanel, scope: 'editor search-panel', preventDefault: true },
            ...historyKeymap,
        ]),
        history(),
        themeCompartment.of(dark ? cmDark(fontSize) : cmLight(fontSize)),
        EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange();
        }),
    ];
}

const mergeConfig = {
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: { margin: 3, minSize: 4 },
    diffConfig: { scanLimit: 20000 },
};

export const WCODE_CONTAINER_ID = 'static-cm-diff';
export const TAGS_CONTAINER_ID = 'static-tags-cm-diff';

interface EditableHandle {
    view: MergeView | EditorView;
    narrow: boolean;
    oldText: string;
    onChange: () => void;
    wikiMode?: boolean;
}

const editableViews = new Map<string, EditableHandle>();

export function destroyDiffEditor(): void {
    for (const h of editableViews.values()) {
        h.view.destroy();
    }
    editableViews.clear();
}

export function getDoc(containerId: string): string {
    const h = editableViews.get(containerId);
    if (!h) return '';
    if (h.view instanceof MergeView) return h.view.b.state.doc.toString();
    return h.view.state.doc.toString();
}

export function refreshEditorTheme(dark: boolean): void {
    for (const h of editableViews.values()) {
        const fontSize = h.narrow ? '16px' : '13px';
        const t = dark ? cmDark(fontSize) : cmLight(fontSize);
        if (h.view instanceof MergeView) {
            h.view.a.dispatch({ effects: themeCompartment.reconfigure(t) });
            h.view.b.dispatch({ effects: themeCompartment.reconfigure(t) });
        } else {
            h.view.dispatch({ effects: themeCompartment.reconfigure(t) });
        }
    }
}

export function refreshDiffLayout(dark: boolean): void {
    for (const [containerId, h] of [...editableViews]) {
        const parent = document.getElementById(containerId);
        if (!parent) continue;
        const narrow = parent.clientWidth < NARROW_PX || window.innerWidth < NARROW_PX;
        if (narrow === h.narrow) continue;
        const current = getDoc(containerId);
        setDiffContent(containerId, h.oldText, current, dark, h.onChange, h.wikiMode ?? false);
    }
}

export function setDiffContent(
    containerId: string,
    oldText: string,
    newText: string,
    dark: boolean,
    onChange: () => void,
    wikiMode = false,
): void {
    const parent = document.getElementById(containerId);
    if (!parent) return;
    editableViews.get(containerId)?.view.destroy();
    editableViews.delete(containerId);
    parent.replaceChildren();
    const narrow = parent.clientWidth < NARROW_PX || window.innerWidth < NARROW_PX;
    const shared = (cb: () => void) => baseExtensions(cb, narrow, dark);
    const wiki = wikiMode ? [...wikiHighlight, highlightActiveLine()] : [];
    const wikiEdit = wikiMode ? [...wikiHighlight, wikiLint, highlightActiveLine()] : [];
    if (narrow) {
        const v = new EditorView({
            doc: newText,
            parent,
            extensions: [
                ...shared(onChange),
                ...wikiEdit,
                unifiedMergeView({
                    original: oldText,
                    mergeControls: false,
                    allowInlineDiffs: true,
                    ...mergeConfig,
                }),
            ],
        });
        editableViews.set(containerId, { view: v, narrow, oldText, onChange, wikiMode });
        return;
    }
    const v = new MergeView({
        a: {
            doc: oldText,
            extensions: [...shared(() => {}), ...wiki, EditorState.readOnly.of(true)],
        },
        b: { doc: newText, extensions: [...shared(onChange), ...wikiEdit] },
        parent,
        orientation: 'a-b',
        revertControls: 'a-to-b',
        ...mergeConfig,
    });
    editableViews.set(containerId, { view: v, narrow, oldText, onChange, wikiMode });
}
