export let epsCache;
export const setEpsCache = (v) => {
  epsCache = v;
};

export async function getEps(subjectId, offset = 0) {
  const response = await fetch(
    `https://api.bgm.tv/v0/episodes?subject_id=${subjectId}&offset=${offset}`,
  );
  if (!response.ok) throw new Error(`API请求失败：HTTP ${response.status}`);
  const data = await response.json();
  return data.data || [];
}

export function parseEpLabel(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/^([a-zA-Z]+)\.(\d+(\.\d+)?)/);
  if (!match) return trimmed;

  const [, type, number] = match;
  return type.toLowerCase() === 'ep' ? number : `${type}${number}`;
}
