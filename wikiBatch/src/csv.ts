import Papa from 'papaparse';
import { state, persistCsvData, type CsvItem } from './core';
import { showLoadingOverlay, hideLoadingOverlay } from './ui';
import { switchToSetupView } from './views';


function loadCSVContent(csvContent: string): void {
    try {
        state.csvData = parseCSV(csvContent);
        state.currentIndex = 0;
        state.retryCount = {};
        state.previousItem = null;
        state.csvPersistDenied = false;
        const persisted = persistCsvData();
        localStorage.setItem('bgmCurrentIndex', '0');
        switchToSetupView();
        if (!persisted) {
            alert('CSV保存失败（可能超出浏览器本地存储容量），刷新页面后需重新加载');
        }
    } catch (error: unknown) {
        alert('CSV解析错误: ' + (error as Error).message);
        console.error(error);
    } finally {
        hideLoadingOverlay();
        document.querySelectorAll('#static-buttons-container button').forEach(btn => {
            (btn as HTMLButtonElement).disabled = false;
        });
    }
}

export function handleFileUpload(this: HTMLInputElement, e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    document.querySelectorAll('#static-buttons-container button').forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
    });
    showLoadingOverlay('正在解析CSV文件...');

    const reader = new FileReader();
    reader.onload = function (event: ProgressEvent<FileReader>) {
        const csvContent = (event.target as FileReader).result as string;
        loadCSVContent(csvContent);
    };
    reader.readAsText(file);
}

export function handlePasteCSV(csvContent: string): void {
    document.querySelectorAll('#static-buttons-container button').forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
    });
    showLoadingOverlay('正在解析粘贴的CSV...');
    loadCSVContent(csvContent);
}

function parseCSV(csvContent: string): CsvItem[] {
    const result = Papa.parse<Record<string, string>>(csvContent, {
        header: true,
        skipEmptyLines: true,
        transform: (value: string) => value.trim(),
    });

    if (result.errors.length) {
        const firstErr = result.errors[0];
        throw new Error(`第${firstErr.row !== undefined ? firstErr.row + 1 : '?'}行: ${firstErr.message}`);
    }

    const headers = result.meta.fields;
    if (!headers || headers.length === 0) {
        throw new Error('CSV文件为空或格式错误');
    }

    const idHeader = headers.find(h => /^(person_id|character_id|id)$/i.test(h));
    if (!idHeader) {
        throw new Error('CSV必须包含"id"、"person_id"或"character_id"列');
    }

    state.entityType = 'subject';
    if (/^person_id$/i.test(idHeader)) state.entityType = 'person';
    else if (/^character_id$/i.test(idHeader)) state.entityType = 'character';

    const fieldNames = headers.filter(h => h !== idHeader);

    const data: CsvItem[] = [];

    for (const row of result.data) {
        const id = row[idHeader]?.trim();
        if (!id) continue;

        const item: CsvItem = { id };

        for (const fieldName of fieldNames) {
            const val = row[fieldName];
            if (val !== undefined) {
                item[fieldName] = val.trim();
            }
        }

        data.push(item);
    }

    if (data.length === 0) {
        throw new Error('未找到有效的数据行');
    }

    return data;
}
