declare function GM_addStyle(css: string): void;

declare function GM_setValue(key: string, value: string): void;

declare function GM_getValue(key: string, defaultValue?: string): string;

declare function GM_deleteValue(key: string): void;

declare function GM_openInTab(url: string): void;

declare function GM_registerMenuCommand(name: string, fn: () => void): void;

declare namespace GM {
  function xmlHttpRequest(details: {
    method: string;
    url: string;
    data?: string;
    headers?: Record<string, string>;
    onload?: (response: { responseText: string; status: number; finalUrl: string }) => void;
    onerror?: (response: { message?: string }) => void;
    onabort?: () => void;
    ontimeout?: () => void;
  }): void;
}

declare module '*.css' {
  const content: string;
  export default content;
}
