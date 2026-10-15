import { state, saveState, type ThemeMode } from './core';
import { switchToSetupView } from './views';
import {
    updateConfirmButtonState,
    generateCommitMessage,
    refreshDiffDisplays,
    getResolvedTheme,
} from './diff';
import {
    handleSetupViewButtons,
    handleProcessingViewButtons,
    handleCompletedViewButtons,
} from './handlers';

import { paintStaticIcons, setLockIcon, setThemeIcon } from './morph';
import { refreshDiffLayout } from './cm-diff';
import { spriteDataUrl } from './sprite';

const spriteCols = 7;
const spriteW = 40;
let logoCol = Math.floor(Math.random() * spriteCols);

const TOOL_ID = 'bgm-tool-container';
const FLOAT_ID = 'bgm-float-button';
let hiddenElements: Array<{ el: Element; origDisplay: string }> | null = null;
let shortcutBound = false;

function handleProcessShortcut(e: KeyboardEvent): void {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return;
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
    const view = state.currentView;
    if (view !== 'processing' && view !== 'setup') return;
    const container = document.getElementById(TOOL_ID);
    if (!container || container.style.display === 'none') return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !container.contains(active)) return;
    let btn: HTMLButtonElement | null;
    if (view === 'setup') {
        if (!e.ctrlKey && !e.metaKey) return;
        btn = document.querySelector(
            '#static-buttons-container button#setup-start-processing',
        ) as HTMLButtonElement | null;
    } else {
        const ids = (e.ctrlKey || e.metaKey)
            ? ['process-confirm-update', 'process-retry-error', 'process-retry-update']
            : ['process-skip-update', 'process-skip-error', 'process-skip-update-fail'];
        btn = document.querySelector(
            ids.map((id) => `#static-buttons-container button#${id}`).join(','),
        ) as HTMLButtonElement | null;
    }
    if (!btn || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    btn.click();
}

function bindProcessShortcut(): void {
    if (shortcutBound) return;
    shortcutBound = true;
    document.addEventListener('keydown', handleProcessShortcut, true);
}

function hidePageContent(): void {
    if (hiddenElements) return;
    hiddenElements = [];
    const children = Array.from(document.body.children);
    for (const child of children) {
        const id = (child as HTMLElement).id;
        if (id === TOOL_ID || id === FLOAT_ID) continue;
        if (child.tagName === 'SCRIPT') continue;
        hiddenElements.push({
            el: child,
            origDisplay: (child as HTMLElement).style.display || '',
        });
        (child as HTMLElement).style.display = 'none';
    }
}

function restorePageContent(): void {
    if (!hiddenElements) return;
    for (const { el, origDisplay } of hiddenElements) {
        (el as HTMLElement).style.display = origDisplay;
    }
    hiddenElements = null;
}

function cycleLogo(): void {
    logoCol = (logoCol + 1) % spriteCols;
    const el = document.getElementById('bgm-tool-logo-sprite');
    if (el) el.style.backgroundPosition = `${-logoCol * spriteW}px 0`;
}

function applyTheme(mode: ThemeMode): void {
    const container = document.getElementById('bgm-tool-container');
    if (!container) return;
    container.classList.add('no-transitions');
    const isDark =
        mode === 'dark' ||
        (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
        container.setAttribute('data-theme', 'dark');
    } else {
        container.removeAttribute('data-theme');
    }
    void container.offsetWidth;
    container.classList.remove('no-transitions');
}

function systemTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function oppositeTheme(mode: 'light' | 'dark'): 'light' | 'dark' {
    return mode === 'dark' ? 'light' : 'dark';
}

function cycleTheme(): void {
    if (state.theme === 'system') {
        // Following the system theme: toggle to the opposite of what's visible
        // and store the literal value.
        state.theme = oppositeTheme(systemTheme());
        localStorage.setItem('bgmTheme', state.theme);
    } else {
        // Explicit override: toggle to the opposite. If that happens to match
        // the system default, go back to system and remove the stored value.
        const next = oppositeTheme(state.theme);
        if (next === systemTheme()) {
            state.theme = 'system';
            localStorage.removeItem('bgmTheme');
        } else {
            state.theme = next;
            localStorage.setItem('bgmTheme', state.theme);
        }
    }
    applyTheme(state.theme);
    updateThemeButton(true);
    if (state.currentView === 'processing') {
        refreshDiffDisplays();
    }
}

function updateThemeButton(animate = false): void {
    const btn = document.getElementById('bgm-tool-theme');
    if (!btn) return;
    setThemeIcon(getResolvedTheme() === 'dark', animate);
}

function createFloatButton(): HTMLElement {
    let floatBtn = document.getElementById('bgm-float-button');
    if (!floatBtn) {
        floatBtn = document.createElement('div');
        floatBtn.id = 'bgm-float-button';
        floatBtn.innerHTML = '<morph-icon data-icon="wrench" size="20"></morph-icon>';
        document.body.appendChild(floatBtn);
        paintStaticIcons(floatBtn);

        floatBtn.addEventListener('click', () => {
            const container = document.getElementById(TOOL_ID);
            if (container) {
                container.style.display = 'flex';
                hidePageContent();
                if (floatBtn) floatBtn.style.display = 'none';
            }
        });
    }
    return floatBtn;
}

export function createStaticDOM(): void {
    const floatBtn = createFloatButton();
    floatBtn.style.display = 'none';

    if (document.getElementById(TOOL_ID)) {
        document.getElementById(TOOL_ID)!.style.display = 'flex';
        hidePageContent();
        return;
    }

    const container = document.createElement('div');
    container.id = 'bgm-tool-container';
    container.innerHTML = `
        <div id="bgm-tool-header">
            <div id="bgm-tool-header-logo">
                <div id="bgm-tool-logo-sprite" style="background-image: url(${spriteDataUrl}); background-position: ${-logoCol * spriteW}px 0;"></div>
                <span>批量更新</span>
            </div>
            <span class="header-spacer"></span>
            <div id="bgm-tool-header-actions">
                <button id="bgm-tool-theme" class="btn btn-default" title="主题" tabindex="0"><morph-icon size="16" reduced-motion="user"></morph-icon></button>
                <button id="bgm-tool-settings" class="btn btn-default" title="设置" tabindex="0"><morph-icon data-icon="settings" size="16"></morph-icon></button>
                <button id="bgm-tool-close" class="btn btn-default" title="关闭" tabindex="0"><morph-icon data-icon="logout" size="16"></morph-icon></button>
            </div>
        </div>
        <div id="bgm-tool-progress">
            <div id="progress-inner">
                <span id="progress-text">处理进度: 0/0</span>
                <div id="progress-bar-container">
                    <div id="progress-bar"></div>
                </div>
            </div>
        </div>
        <div class="loading-container">
            <div id="bgm-tool-body">
                <div id="core-content"></div>
                <div id="edit-regions">
                    <div class="prev-item-link" id="prev-item-link"></div>

                    <div class="last-update-info" id="static-last-update"></div>
                    <div class="commit-message-area" id="static-commit-area">
                        <label for="static-commit-input">编辑摘要</label>
                        <div class="row-flex">
                            <input type="text" id="static-commit-input" placeholder="请输入编辑摘要">
                            <button id="static-lock-commit" class="secondary" title="${state.isCommitMessageLocked ? '解锁编辑摘要' : '固定编辑摘要'}">
                                <morph-icon size="16" reduced-motion="user"></morph-icon>
                            </button>
                            <label class="toggle-switch" title="自动生成编辑摘要">
                                <input type="checkbox" id="static-auto-commit" ${state.isCommitMessageAuto ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                            <label for="static-auto-commit" title="自动生成编辑摘要">自动</label>
                        </div>
                    </div>
                    <div class="edit-rows">
                        <div class="edit-row">
                            <div class="edit-area" id="static-wcode-area">
                                <label>Wcode</label>
                                <div id="static-cm-diff"></div>
                            </div>
                            <div class="wcode-diff-col" style="display: none;">
                                <div class="diff-section-label">Wcode 变更</div>
                                <div class="diff-section wcode-diff-section">
                                    <div id="static-content-diff-container" class="diff-container"></div>
                                </div>
                            </div>
                        </div>
                        <div class="edit-row">
                            <div class="edit-area" id="static-tags-area">
                                <label>标签（空格分隔）</label>
                                <div id="static-tags-cm-diff"></div>
                            </div>
                        </div>
                        <div class="edit-row" id="static-series-area">
                            <label class="toggle-switch">
                                <input type="checkbox" id="static-series-checkbox">
                                <span class="toggle-slider"></span>
                            </label>
                            <label for="static-series-checkbox">标记为系列</label>
                        </div>
                    </div>
                    <div id="diff-error"></div>
                    <div id="status-container" class="status-box"></div>
                </div>
            </div>
            <div class="buttons-container" id="static-buttons-container"></div>
            <div id="bgm-loading-overlay">
                <div class="bouncy" role="status" aria-label="加载中">
                    <div class="bouncy-cube"><div class="bouncy-cube-inner"></div></div>
                    <div class="bouncy-cube"><div class="bouncy-cube-inner"></div></div>
                    <div class="bouncy-cube"><div class="bouncy-cube-inner"></div></div>
                </div>
                <div id="loading-text"></div>
            </div>
        </div>
    `;
    document.body.appendChild(container);
    hidePageContent();

    bindEventDelegation();
    bindProcessShortcut();

    const closeBtn = document.getElementById('bgm-tool-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            container.style.display = 'none';
            restorePageContent();
            const fb = createFloatButton();
            fb.style.display = 'flex';
            saveState();
        });
    }

    const settingsBtn = document.getElementById('bgm-tool-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            switchToSetupView();
        });
    }

    const themeBtn = document.getElementById('bgm-tool-theme');
    if (themeBtn) {
        themeBtn.addEventListener('click', cycleTheme);
    }

    const logo = document.getElementById('bgm-tool-header-logo');
    if (logo) {
        logo.addEventListener('click', cycleLogo);
    }

    applyTheme(state.theme);
    updateThemeButton();
    paintStaticIcons();
    window
        .matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', () => {
            if (state.theme === 'system') {
                applyTheme('system');
                if (state.currentView === 'processing') {
                    refreshDiffDisplays();
                }
            }
        });

    bindEditRegionEvents();

    switchToSetupView();
}

function delegateClick(container: HTMLElement): void {
    container.addEventListener('click', (e) => {
        const targetBtn = (e.target as HTMLElement).closest('button');
        if (!targetBtn) return;

        const btnId = targetBtn.id;
        const currentView = state.currentView;

        switch (currentView) {
            case 'setup':
                handleSetupViewButtons(btnId);
                break;
            case 'processing':
                handleProcessingViewButtons(btnId);
                break;
            case 'completed':
                handleCompletedViewButtons(btnId);
                break;
        }
    });
}

function bindEventDelegation(): void {
    const buttonsContainer = document.getElementById('static-buttons-container');
    if (buttonsContainer) delegateClick(buttonsContainer);
    const coreContent = document.getElementById('core-content');
    if (coreContent) delegateClick(coreContent);
}

function bindEditRegionEvents(): void {
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
            if (state.currentView === 'processing') {
                refreshDiffLayout(getResolvedTheme() === 'dark');
            }
        }, 200);
    });
    for (const id of ['static-cm-diff', 'static-tags-cm-diff']) {
        const el = document.getElementById(id);
        if (el) ro.observe(el);
    }

    const commitInput = document.getElementById('static-commit-input') as HTMLInputElement;
    commitInput.addEventListener('input', (e) => {
        if (state.currentView === 'processing' && state.currentSubjectData) {
            state.currentCommitMessage = (e.target as HTMLInputElement).value;
            updateConfirmButtonState();
        }
    });

    const lockCommitBtn = document.getElementById('static-lock-commit') as HTMLButtonElement;
    lockCommitBtn.addEventListener('click', () => {
        if (state.currentView !== 'processing' || !state.currentSubjectData) return;

        state.isCommitMessageLocked = !state.isCommitMessageLocked;
        const commitInput2 = document.getElementById('static-commit-input') as HTMLInputElement;

        if (state.isCommitMessageLocked) {
            state.lockedCommitMessage = commitInput2.value;
            setLockIcon(true, true);
        } else {
            setLockIcon(false, true);
        }
        const autoCommitCheckbox2 = document.getElementById('static-auto-commit') as HTMLInputElement;
        autoCommitCheckbox2.disabled = state.isCommitMessageLocked;
        saveState();
        updateConfirmButtonState();
    });

    const autoCommitCheckbox = document.getElementById('static-auto-commit') as HTMLInputElement;
    autoCommitCheckbox.disabled = state.isCommitMessageLocked;
    autoCommitCheckbox.addEventListener('change', (e) => {
        state.isCommitMessageAuto = (e.target as HTMLInputElement).checked;
        saveState();
        if (!state.isCommitMessageAuto) return;
        if (state.currentView !== 'processing' || !state.currentSubjectData) return;
        if (state.isCommitMessageLocked) return;

        state.currentCommitMessage = generateCommitMessage(
            state.currentFieldUpdates,
            state.currentTagUpdates,
            state.currentSeriesUpdate,
            state.entityType,
        );
        (document.getElementById('static-commit-input') as HTMLInputElement).value = state.currentCommitMessage;
        updateConfirmButtonState();
    });

    const seriesCheckbox = document.getElementById('static-series-checkbox') as HTMLInputElement;
    seriesCheckbox.addEventListener('change', (e) => {
        if (state.currentView === 'processing' && state.currentSubjectData) {
            state.currentSeries = (e.target as HTMLInputElement).checked;
            updateConfirmButtonState();
        }
    });

    setLockIcon(state.isCommitMessageLocked, false);
}
