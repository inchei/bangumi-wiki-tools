import {
    LanguageSupport,
    HighlightStyle,
    syntaxHighlighting,
    StreamLanguage,
} from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import type { EditorView } from '@codemirror/view';
import type { Diagnostic } from '@codemirror/lint';

type WikiStateName = 'start' | 'infobox' | 'array' | 'array_item';

interface WikiState {
    state: WikiStateName;
}

type Rule = [RegExp, string, WikiStateName?];

const RULES: Record<WikiStateName, Rule[]> = {
    start: [
        [/^{{\s*Infobox\s*\S*/, 'keyword', 'infobox'],
        [/^./, 'invalid'],
    ],
    infobox: [
        [/^}}\s*$/, 'keyword', 'start'],
        [/^\s*\|\s*[^=]+/, 'propertyName'],
        [/^=/, 'operator'],
        [/^\{/, 'string', 'array'],
        [/^[^|}]+/, 'string'],
    ],
    array: [
        [/^}\s*$/, 'string', 'infobox'],
        [/^\[/, 'variableName', 'array_item'],
    ],
    array_item: [
        [/^\]/, 'variable', 'array'],
        [/^\|/, 'escape'],
        [/^./, 'string'],
    ],
};

const wikiLanguage = StreamLanguage.define<WikiState>({
    name: 'bangumi-infobox',
    startState: () => ({ state: 'start' }),
    token(stream, st) {
        if (st.state === 'infobox' && !stream.sol() && stream.peek() === '|') {
            stream.next();
            return 'string';
        }
        for (const [re, tok, next] of RULES[st.state]) {
            if (stream.match(re)) {
                if (next) st.state = next;
                return tok;
            }
        }
        stream.next();
        return null;
    },
});

const wikiStyle = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--accent-strong)', fontWeight: 'bold' },
    { tag: tags.invalid, color: '#f56c6c', textDecoration: 'underline wavy #f56c6c' },
    { tag: tags.propertyName, color: 'var(--link)' },
    { tag: tags.operator, color: 'var(--text-secondary)' },
    { tag: tags.string, color: 'var(--text)' },
    { tag: tags.variableName, color: 'var(--text)' },
    { tag: tags.escape, color: 'var(--accent-strong)' },
]);

export const wikiHighlight = [
    new LanguageSupport(wikiLanguage),
    syntaxHighlighting(wikiStyle),
];

interface WikiNote {
    row: number;
    from: number;
    to: number;
    text: string;
    type: 'warning' | 'error';
}

export function collectWikiNotes(text: string): WikiNote[] {
    const lines: string[] = [];
    const starts: number[] = [];
    let start = 0;
    while (true) {
        const nl = text.indexOf('\n', start);
        if (nl < 0) {
            lines.push(text.slice(start));
            starts.push(start);
            break;
        }
        let end = nl;
        if (end > start && text[end - 1] === '\r') end--;
        lines.push(text.slice(start, end));
        starts.push(start);
        start = nl + 1;
    }
    const at = (row: number) => ({ from: starts[row], to: starts[row] + lines[row].length });

    const notes: WikiNote[] = [];
    let cnt = 0;
    let superblock: { row: number } | null = null;
    let array: { row: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*$/.test(line)) continue;
        const row = i;

        if (/^\s*{{\s*Infobox(?:\s+\S+)?\s*$/.test(line)) {
            if (!superblock) {
                superblock = { row };
                if (!/{{\s*Infobox\s+\S+/.test(line)) notes.push({ row, ...at(row), text: '没有类型', type: 'warning' });
                cnt++;
                if (cnt > 1) notes.push({ row, ...at(row), text: "只允许一个 '{{Infobox'", type: 'error' });
            } else {
                notes.push({ row, ...at(row), text: "意外的 '{{Infobox'，上一个未关闭", type: 'error' });
            }
            continue;
        }
        if (/^\s*}}\s*$/.test(line)) {
            if (!superblock) notes.push({ row, ...at(row), text: "多余的 '}}'", type: 'error' });
            else superblock = null;
            continue;
        }
        if (/^\s*\|/.test(line)) {
            if (!/^(?:\s*\|\s*)(?:[^=]+?)?(?:\s*=\s*)(?:.+?)?\s*$/.test(line)) {
                notes.push({ row, ...at(row), text: '错误的字段格式', type: 'error' });
            }
            if (array) {
                const a = at(array.row);
                notes.push({ row: array.row, from: a.from, to: a.to, text: "缺少匹配的 '}'", type: 'error' });
                array = null;
            }
            if (line.trim().endsWith('{')) array = { row };
            continue;
        }
        if (/^\s*}\s*$/.test(line)) {
            if (!array) notes.push({ row, ...at(row), text: "多余的 '}'", type: 'error' });
            else array = null;
            continue;
        }
        const item = /^(?<start>\s*)(?<open>\[)?(?<content>.*?)(?<close>\])?\s*$/.exec(line);
        if (item?.groups) {
            if (!array) notes.push({ row, ...at(row), text: '意外的数组项', type: 'error' });
            if (!item.groups.open) notes.push({ row, ...at(row), text: "缺少 '['", type: 'error' });
            if (!item.groups.close) notes.push({ row, ...at(row), text: "缺少 ']'", type: 'error' });
            continue;
        }
        notes.push({ row, ...at(row), text: '未知内容', type: 'error' });
    }
    if (superblock) {
        const s = at(superblock.row);
        notes.push({ row: superblock.row, from: s.from, to: s.to, text: "缺少匹配的 '}}'", type: 'error' });
    }

    return notes;
}

export function validateWikiText(text: string): Diagnostic[] {
    return collectWikiNotes(text).map((n) => ({
        from: n.from,
        to: n.to,
        severity: n.type,
        message: n.text,
    }));
}

function wikiLinter(view: EditorView): Diagnostic[] {
    return validateWikiText(view.state.doc.toString());
}

export const wikiLint = [linter(wikiLinter), lintGutter()];
