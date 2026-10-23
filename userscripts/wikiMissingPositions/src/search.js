let _searchError = false;

export function lastSearchFailed() {
  return _searchError;
}

const createFetch = (method) => async (url, body) => {
  const options = method === 'POST' ? { method, body: JSON.stringify(body) } : { method };
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    _searchError = false;
    return await response.json();
  } catch (e) {
    console.error(e);
    _searchError = true;
    return null;
  }
};

const fetchPost = createFetch('POST');

const postSearch = async (cat, keyword, filter, limit = 1) => {
  const url = `https://api.bgm.tv/v0/search/${cat}?limit=${limit}`;
  const body = { keyword, filter };
  const result = await fetchPost(url, body);
  return result?.data;
};

export const searchPrsn = (keyword) => postSearch('persons', keyword);
export const searchPrsnAll = (keyword) => postSearch('persons', keyword, undefined, 5);

// Source must be UTF-8; NFKC handles halfwidth katakana (U+FF66-FF9D)
// -> fullwidth katakana and fullwidth alphanumerics (U+FF21-FF5A) -> ASCII.
// Requires font covering CJK Unified/Compatibility Ideographs (e.g. 﨑 U+FA11).
export function normalize(name) {
  return name
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replaceAll('-', '')
    .replace(/[\u30A1-\u30F6]/g, function (match) {
      return String.fromCharCode(match.charCodeAt(0) - 0x60);
    })
    .toLowerCase();
}
