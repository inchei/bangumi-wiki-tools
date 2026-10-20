const regions = ['cn', 'tw', 'hk', 'jp'];
let converters = {},
  loading;
// #endregion

function refinedToCN(str) {
  // Keep ノ (U+30CE) as-is for match-friendly candidates: stash it out of the
  // pipeline (the library maps ノ→之, which hurts matching against the page's
  // original 東ノ助 spelling), then restore after conversion.
  const KEEP = '\uE000';
  const stashed = str.includes('ノ') ? str.replace(/ノ/g, KEEP) : str;
  const out = openccCN.refinedToCN(stashed, {
    jp2t: converters['jp-tw'] || OpenCC.Converter({ from: 'jp', to: 'tw' }),
    t2s: converters['tw-cn'] || OpenCC.Converter({ from: 'tw', to: 'cn' }),
    tw2s: converters['tw-cn'] || OpenCC.Converter({ from: 'tw', to: 'cn' }),
    hk2s: converters['hk-cn'] || OpenCC.Converter({ from: 'hk', to: 'cn' }),
    t2jp: converters['tw-jp'] || OpenCC.Converter({ from: 'tw', to: 'jp' }),
  });
  return str.includes('ノ') ? out.replace(new RegExp(KEEP, 'g'), 'ノ') : out;
}

export async function getConvertedNames(str) {
  if (!loading && !Object.keys(converters).length) {
    loading = new Promise((resolve) => {
      const srcs = [
        'https://cdn.jsdmirror.com/npm/opencc-js@1.0.5/dist/umd/full.js',
        'https://cdn.jsdmirror.com/npm/opencc-cn-name/dist/umd/opencc-cn-name.js',
      ];
      let remaining = srcs.length;
      let ok = true;
      srcs.forEach((src) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
          if (--remaining === 0) {
            if (ok && typeof OpenCC !== 'undefined') {
              regions.forEach((from) =>
                regions.forEach((to) => {
                  if (from !== to) converters[`${from}-${to}`] = OpenCC.Converter({ from, to });
                }),
              );
            }
            resolve(ok);
          }
        };
        script.onerror = () => {
          ok = false;
          if (--remaining === 0) resolve(false);
        };
        document.head.appendChild(script);
      });
    });
  }
  const success = await loading;
  if (!success || typeof openccCN === 'undefined') return [];

  const converted = new Set();
  regions.forEach((from) =>
    regions.forEach((to) => {
      if (from !== to) converted.add(converters[`${from}-${to}`](str));
    }),
  );
  // refined JP→CN conversion (handles variant/obsolete chars OpenCC misses)
  const refined = refinedToCN(str);
  if (refined !== str) converted.add(refined);
  return Array.from(converted);
}
