export const BANGUMI_ERROR_TEXT =
  '网络出错了，请检查网络或<a href="https://bgm-status.ry.mk" class="l" target="_blank">查看班娘情况</a>';

export function ourApiErrorText(name) {
  const q = encodeURIComponent(name || '');
  return `网络出错了，请检查网络或<a href="https://inchei.github.io/bangumi-wiki-tools/missing-persons/search.html?q=${q}" class="l" target="_blank">看看有没有已经存储的结果</a>`;
}
