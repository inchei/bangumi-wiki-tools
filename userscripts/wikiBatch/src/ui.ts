export function showProgressBar(): void {
    const el = document.getElementById('bgm-tool-progress');
    if (el) el.style.display = 'block';
}

export function updateProgressBar(current: number, total: number): void {
    const textEl = document.getElementById('progress-text');
    const barEl = document.getElementById('progress-bar');
    if (textEl) {
        const width = String(total).length;
        const padded = String(current).padStart(width, '\u2007');
        textEl.textContent = `处理进度: ${padded}/${total}`;
    }
    const percentage = total > 0 ? (current / total) * 100 : 0;
    if (barEl) barEl.style.width = `${percentage}%`;
}

export function hideProgressBar(): void {
    const el = document.getElementById('bgm-tool-progress');
    if (el) el.style.display = 'none';
}

export function showLoadingOverlay(text: string): void {
    const overlay = document.getElementById('bgm-loading-overlay');
    const textElement = document.getElementById('loading-text');
    if (textElement) textElement.textContent = text;
    if (overlay) overlay.classList.add('active');
}

export function hideLoadingOverlay(): void {
    const overlay = document.getElementById('bgm-loading-overlay');
    if (overlay) overlay.classList.remove('active');
}
