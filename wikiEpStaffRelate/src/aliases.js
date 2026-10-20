export const getProvider = () =>
  localStorage.getItem('wikiMissingPositionsProvider') || 'https://bgq.iccci.cc.cd';

const aliasMemo = new Map();

async function fetchAliases(name) {
  try {
    const res = await fetch(`${getProvider()}/api/aliases/${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {
    console.error('personAliasFallback API error:', e);
  }
  const all = await window.personAliasQueryAll?.(name);
  if (all && all.length > 0) return all;
  if (all !== undefined) return [];
  const single = await window.personAliasQuery?.(name);
  if (single) return [single];
  return [];
}

export function personAliasFallback(name) {
  if (!aliasMemo.has(name)) aliasMemo.set(name, fetchAliases(name));
  return aliasMemo.get(name);
}

export async function personAliasFallbackBatch(names) {
  const unique = [...new Set(names)];
  const result = {};
  const missing = [];
  for (const name of unique) {
    if (aliasMemo.has(name)) result[name] = await aliasMemo.get(name);
    else missing.push(name);
  }
  if (missing.length) {
    try {
      const query = missing.map((n) => `names=${encodeURIComponent(n)}`).join('&');
      const res = await fetch(`${getProvider()}/api/aliases?${query}`);
      if (res.ok) {
        const data = await res.json();
        for (const name of missing) {
          const entries = data?.names?.[name];
          if (Array.isArray(entries)) {
            result[name] = entries;
            aliasMemo.set(name, Promise.resolve(entries));
          }
        }
      }
    } catch (e) {
      console.error('personAliasFallbackBatch API error:', e);
    }
    for (const name of missing) {
      if (!(name in result)) result[name] = await personAliasFallback(name);
    }
  }
  return result;
}
