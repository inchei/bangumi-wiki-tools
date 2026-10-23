import { MorphIconElement, defineMorphIcon, type IconInput } from 'morphicons/element';
import {
    ArrowLeft,
    ClipboardPaste,
    Download,
    KeyRound,
    LoaderCircle,
    Lock,
    LockOpen,
    LogOut,
    Moon,
    Settings,
    Sun,
    Trash2,
    Upload,
    WandSparkles,
    Wrench,
} from 'lucide';

let defined = false;

export function initMorphIcons(): void {
    if (defined) return;
    defineMorphIcon();
    defined = true;
}

const STATIC_ICONS: Record<string, IconInput> = {
    'arrow-left': ArrowLeft,
    'download': Download,
    'github': 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
    'key': KeyRound,
    'loader': LoaderCircle,
    'logout': LogOut,
    'paste': ClipboardPaste,
    'settings': Settings,
    'trash': Trash2,
    'upload': Upload,
    'wand': WandSparkles,
    'wrench': Wrench,
};

export function paintStaticIcons(root: ParentNode = document): void {
    initMorphIcons();
    root.querySelectorAll('morph-icon[data-icon]').forEach((el) => {
        if (!(el instanceof MorphIconElement)) return;
        const icon = STATIC_ICONS[el.dataset.icon ?? ''];
        if (icon) el.set(icon);
    });
}

function morphEl(btn: HTMLElement): MorphIconElement | null {
    initMorphIcons();
    const el = btn.querySelector('morph-icon');
    return el instanceof MorphIconElement ? el : null;
}

export function setThemeIcon(dark: boolean, animate: boolean): void {
    const btn = document.getElementById('bgm-tool-theme');
    if (!btn) return;
    const el = morphEl(btn);
    if (!el) return;
    const icon = dark ? Moon : Sun;
    if (animate) el.morphTo(icon);
    else el.set(icon);
    btn.title = '主题: ' + (dark ? '深色' : '浅色');
}

export function setLockIcon(locked: boolean, animate: boolean): void {
    const btn = document.getElementById('static-lock-commit');
    if (!btn) return;
    const el = morphEl(btn);
    if (!el) return;
    const icon = locked ? Lock : LockOpen;
    if (animate) el.morphTo(icon);
    else el.set(icon);
    btn.title = locked ? '解锁编辑摘要' : '固定编辑摘要';
}

export function setConfirmButtonText(btn: HTMLButtonElement, text: string): void {
    const target = (btn.querySelector('.confirm-label') as HTMLElement | null) ?? btn;
    if (target.textContent !== text) target.textContent = text;
}
