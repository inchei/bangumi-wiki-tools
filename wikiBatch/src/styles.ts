import appCss from './styles.css';

let injected = false;

export function injectStyles(): void {
    if (injected) return;
    injected = true;
    GM_addStyle(appCss);
}
