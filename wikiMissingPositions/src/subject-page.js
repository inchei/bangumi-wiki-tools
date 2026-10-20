import { POSITION_IDS } from './position-ids.js';
import { getProvider, getShow } from './api.js';
import { genAppearEps } from './appear-eps.js';
import { checkExistingPerson } from './person.js';
import { BANGUMI_ERROR_TEXT, ourApiErrorText } from './errors.js';
import { createNotifyPopup } from './popup.js';

function errSection(html) {
  return `<div class="staff-error-section">${html}</div>`;
}

const cacheKey = (name, t, target) => `mp:${name}:${t}:${target}`;

const LOADING_MSGS = [
  '坐和放宽',
  '正在准备数据<br>请勿\u2122关闭计算机',
  '好东西就要来了！',
  () => `你已完成${10 * (2 + Math.floor(Math.random() * 7))}%`,
  '正在处理一些事情',
  '你正在成功！',
  '不巧的是，它花费的时间比通常要长',
  '再等一下下就好了',
  '这通常不会太久',
  '我们正在帮你搞定一切',
];

function randomMsg() {
  const m = LOADING_MSGS[Math.floor(Math.random() * LOADING_MSGS.length)];
  return typeof m === 'function' ? m() : m;
}

export function initSubjectPage() {
  if (getShow() === 'off') return;

  const href = document.querySelector('.focus').href.split('/').pop();
  const typeCode = { anime: 2, book: 1, music: 3, game: 4, real: 6 }[href] || 0;
  if (!typeCode) return;

  const posNames = new Set(Object.values(POSITION_IDS[typeCode] || {}));

  const infobox = document.querySelector('#infobox');
  if (!infobox) return;

  const DELIM_RE = /[()[\]{}（）<>《》「」『』【】+×·→/／、,，;；：&＆\\等]+/;
  // 跳过集数标记类条目：纯数字、数字区间（1-12）、OP/ED/SP（可带数字）
  const EP_MARKER_RE = /^\d+$|^\d+\s*-\s*\d+$|^(?:OP|ED|SP)(?:\d+)?$/i;

  infobox.querySelectorAll('li:not(.sub_container):not(.sub_group)').forEach((li) => {
    const tip = li.querySelector('.tip');
    if (!tip) return;
    const fieldName = tip.textContent.replace(/[:：]\s*$/, '').trim();
    if (!posNames.has(fieldName)) return;

    const linked = new Set();
    li.querySelectorAll('a').forEach((a) => linked.add(a.textContent.trim()));

    const clone = li.cloneNode(true);
    clone.querySelectorAll('a, .tip').forEach((el) => el.remove());
    const text = clone.textContent;
    const names = text
      .split(DELIM_RE)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((n) => !EP_MARKER_RE.test(n));
    names.sort((a, b) => b.length - a.length);

    let tipHTML = '';
    if (tip) {
      tipHTML = tip.outerHTML;
      tip.remove();
    }

    const unlinked = names.filter((n) => !linked.has(n));
    if (unlinked.length) {
      const nameRE = new RegExp(
        `(?<=^|[^<\\w])(${unlinked.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^<\\w]|$)`,
        'g',
      );
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement.closest('a, .tip')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const tNodes = [];
      while (walker.nextNode()) tNodes.push(walker.currentNode);
      for (const node of tNodes) {
        const html = node.textContent.replace(
          nameRE,
          (_, name, p3) =>
            `<a class="bgm-mp-name bgm-mp-name-link" data-name="${name}">${name}</a>${p3}`,
        );
        if (html !== node.textContent) {
          const span = document.createElement('span');
          span.innerHTML = html;
          node.replaceWith(...span.childNodes);
        }
      }
    }

    if (tipHTML) li.insertAdjacentHTML('afterbegin', tipHTML);
  });

  document.querySelectorAll('.bgm-mp-name').forEach((a) => {
    a.addEventListener('click', () => openSubjectPopup(a.dataset.name, typeCode));
  });
}

let _abortController = null;

export function openSubjectPopup(personName, typeCode) {
  if (_abortController) _abortController.abort();
  _abortController = new AbortController();
  const signal = _abortController.signal;

  const existing = document.querySelector('.bgm-mp-subject-popup');
  if (existing) existing.remove();

  const provider = getProvider();

  const typeNames = { 1: '书', 2: '动', 3: '乐', 4: '游', 6: '实' };
  const typeChecks = [1, 2, 3, 4, 6]
    .map(
      (t) =>
        `<label class="bgm-mp-popup-type"><input type="checkbox" class="bgm-mp-type-check" value="${t}"${t === typeCode ? ' checked' : ''}>${typeNames[t]}</label>`,
    )
    .join('');

  const { popup, content } = createNotifyPopup({
    className: 'bgm-mp-subject-popup',
    handleHTML: `<strong>${personName}</strong><span class="bgm-mp-popup-types">${typeChecks}</span><button class="bgm-mp-notify-close">&times;</button>`,
    onClose: () => _abortController.abort(),
    dragExclude: '.bgm-mp-popup-type, .bgm-mp-popup-types',
  });
  content.innerHTML = `<div class="bgm-mp-loading-wrap"><div class="bgm-mp-spinner"></div><div class="bgm-mp-loading-text">${randomMsg()}</div></div>`;

  const errs = { bangumi: false, ours: false };

  const doMultiFetch = (existing, targetParam) => {
    if (!_ready) return;
    const checked = [...popup.querySelectorAll('.bgm-mp-type-check:checked')].map((c) =>
      Number(c.value),
    );
    const targetId = (existing?.aliased?.id || existing?.directMatches?.[0]?.id || 0).toString();
    const encoded = encodeURIComponent(personName);

    let uncached = [];
    let cached = {};
    for (const t of checked) {
      const key = cacheKey(encoded, t, targetId);
      const cachedData = sessionStorage.getItem(key);
      if (cachedData) {
        try {
          cached[t] = JSON.parse(cachedData);
        } catch {
          uncached.push(t);
        }
      } else {
        uncached.push(t);
      }
    }

    if (uncached.length === 0) {
      renderResults(content, cached, null, encoded, personName, errs);
      return;
    }

    _abortController.abort();
    _abortController = new AbortController();
    const sig = _abortController.signal;
    content.innerHTML = `<div class="bgm-mp-loading-wrap"><div class="bgm-mp-spinner"></div><div class="bgm-mp-loading-text">${randomMsg()}</div></div>`;
    fetchMultiType(
      personName,
      provider,
      sig,
      content,
      targetParam,
      uncached,
      cached,
      targetId,
      errs,
    );
  };

  popup.querySelectorAll('.bgm-mp-type-check').forEach((cb) => {
    cb.addEventListener('change', () => doMultiFetch(_existing, _targetParam));
  });

  // Fetch data
  let _existing = null,
    _targetParam = '',
    _ready = false;
  (async () => {
    const existing = await checkExistingPerson(personName);
    _existing = existing;
    let targetParam = '';
    if (existing.aliased) targetParam = `&target=${existing.aliased.id}`;
    else if (existing.directMatches) targetParam = `&target=${existing.directMatches[0].id}`;
    _targetParam = targetParam;
    _ready = true;

    errs.bangumi = existing.bangumiError;
    errs.ours = existing.aliasesError;

    const hasExisting = existing.aliased || existing.directMatches;

    if (hasExisting) {
      let warningHtml = '';
      if (existing.bangumiError) warningHtml += errSection(BANGUMI_ERROR_TEXT);
      if (existing.aliasesError) warningHtml += errSection(ourApiErrorText(personName));
      if (existing.aliased) {
        if (existing.aliasedMulti && existing.aliasedMulti.length > 1) {
          warningHtml += `<div class="staff-warning-section"><div class="staff-warning-title">别名为「${personName}」匹配到多个人物，已取第一个：</div>`;
          for (const p of existing.aliasedMulti) {
            warningHtml += `<a class="l" href="/person/${p.id}" target="_blank">${p.name}</a> `;
          }
          warningHtml += '</div>';
        } else {
          warningHtml += `<div class="staff-warning-section"><div class="staff-warning-title">别名为「${personName}」的人物已存在：</div><a class="l" href="/person/${existing.aliased.id}" target="_blank">${existing.aliased.name}</a></div>`;
        }
      }
      if (existing.directMatches) {
        warningHtml +=
          '<div class="staff-warning-section"><div class="staff-warning-title">同名人物已存在：</div>';
        for (const p of existing.directMatches) {
          warningHtml += `<a class="l" href="/person/${p.id}" target="_blank">${p.display || p.name}</a> `;
        }
        warningHtml += '</div>';
      }
      warningHtml += '<div class="staff-confirm-section" id="bgm-mp-confirm-btn">仍然加载</div>';
      content.innerHTML = warningHtml;

      document.querySelector('#bgm-mp-confirm-btn').onclick = () => {
        document.querySelector('#bgm-mp-confirm-btn').remove();
        doMultiFetch(existing, targetParam);
      };
    } else {
      doMultiFetch(existing, targetParam);
    }
  })();
}

async function fetchMultiType(
  personName,
  provider,
  signal,
  content,
  targetParam,
  types,
  cached,
  targetId,
  errs,
) {
  const encodedName = encodeURIComponent(personName);

  let subjectsByType = { ...cached },
    episodesData = null;

  const fetches = types.map((t) =>
    fetch(`${provider}/api/persons/${encodedName}/missing-subjects?type=${t}${targetParam}`, {
      signal,
    })
      .then((res) => {
        if (!res.ok) {
          errs.ours = true;
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data && Object.keys(data).length) {
          sessionStorage.setItem(cacheKey(encodedName, t, targetId), JSON.stringify(data));
        }
        return { type: t, data };
      })
      .catch((e) => {
        if (e.name === 'AbortError') throw e;
        console.error(`missing-subjects type=${t} failed:`, e);
        errs.ours = true;
        return { type: t, data: null };
      }),
  );

  try {
    const results = await Promise.all(fetches);
    for (const r of results) {
      if (r.data && Object.keys(r.data).length) {
        subjectsByType[r.type] = r.data;
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
    return;
  }

  if (types.includes(2)) {
    try {
      const epQuery = targetParam ? '?' + targetParam.slice(1) : '';
      const epRes = await fetch(
        `${provider}/api/persons/${encodedName}/missing-episodes${epQuery}`,
        { signal },
      );
      if (epRes.ok) episodesData = await epRes.json();
      else errs.ours = true;
    } catch (e) {
      if (e.name === 'AbortError') return;
      errs.ours = true;
    }
  }

  renderResults(content, subjectsByType, episodesData, encodedName, personName, errs);
}

function renderResults(content, subjectsByType, episodesData, encodedName, personName, errs) {
  const typeNamesFull = { 1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' };
  const totalEntries = Object.values(subjectsByType).reduce((c, d) => c + Object.keys(d).length, 0);
  const hasData =
    totalEntries ||
    (episodesData &&
      (Object.keys(episodesData.matched || {}).length ||
        Object.keys(episodesData.unmatched || {}).length));

  let html = '';

  if (errs?.bangumi) html += errSection(BANGUMI_ERROR_TEXT);
  // 已有可展示结果（含缓存）时，不提示土豆，避免与结果自相矛盾
  if (!hasData && errs?.ours) html += errSection(ourApiErrorText(personName));

  if (totalEntries) {
    html += '<div class="bgm-mp-result-list">';
    html += '<div class="bgm-mp-section-title">缺失条目关联：</div>';
    for (const t of [2, 1, 3, 4, 6]) {
      const data = subjectsByType[t];
      if (!data) continue;
      html += `<div class="bgm-mp-type-section"><div class="bgm-mp-type-title">${typeNamesFull[t]}</div>`;
      for (const [sid, entry] of Object.entries(data)) {
        const posNames = (entry.positions || [])
          .map((pid) => POSITION_IDS[t]?.[pid] || pid)
          .join('、');
        html += `<div><strong><a class="l" href="/subject/${sid}" target="_blank">${entry.name || '#' + sid}</a></strong> - ${posNames}</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }

  if (episodesData) {
    const matched = Object.entries(episodesData.matched || {});
    const unmatched = Object.entries(episodesData.unmatched || {});
    if (matched.length) {
      html += '<div class="bgm-mp-result-list">';
      html += '<div class="bgm-mp-section-title">缺失剧集关联：</div>';
      for (const [sid, entry] of matched) {
        const parts = Object.entries(entry.episodes || {}).map(
          ([pid, labels]) => `${POSITION_IDS[2]?.[pid] || pid}：${genAppearEps(labels)}`,
        );
        html += `<div><strong><a class="l" href="/subject/${sid}" target="_blank">${entry.name || '#' + sid}</a></strong> ${parts.join('，')}</div>`;
      }
      html += '</div>';
    }
    if (unmatched.length) {
      html += '<div class="bgm-mp-result-list">';
      html += '<div class="bgm-mp-section-title">疑似缺失剧集关联：</div>';
      for (const [sid, entry] of unmatched) {
        html += `<div><strong><a class="l" href="/subject/${sid}" target="_blank">${entry.name || '#' + sid}</a></strong> - ${(
          entry.episodes || []
        )
          .map(
            (ep) =>
              `<a class="l" href="/ep/${ep.episode_id}#:~:text=${encodedName}" target="_blank">${ep.label}</a>`,
          )
          .join(', ')}</div>`;
      }
      html += '</div>';
    }
  }

  if (!hasData && !errs?.bangumi && !errs?.ours) {
    html = '<div class="bgm-mp-empty-hint">未找到缺失关联</div>';
  }

  html += `<div class="bgm-mp-popup-actions">
      <button class="bgm-mp-btn" id="bgm-mp-create-btn"${hasData ? '' : ' disabled style="opacity:0.5"'}>创建人物</button>
    </div>`;

  content.innerHTML = html;

  document.querySelector('#bgm-mp-create-btn').onclick = () => {
    if (!hasData) return;
    const allSubjects = {};
    for (const [t, data] of Object.entries(subjectsByType)) {
      for (const [sid, entry] of Object.entries(data)) {
        allSubjects[`${t}:${sid}`] = { ...entry, _type: Number(t) };
      }
    }
    localStorage.setItem(
      'bgm-mp-pending',
      JSON.stringify({
        personName: personName,
        subjectsData: allSubjects,
        episodesData,
      }),
    );
    window.open('/person/new');
  };
}

export async function initPersonNewPage() {
  const params = new URLSearchParams(location.search);

  // bgm_mp 参数存在时优先从 opener 的 HTML 页面获取最新 pending（可能已刷新为新人物）
  let raw = null;
  if (params.has('bgm_mp') && window.opener) {
    raw = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      const handler = (e) => {
        if (e.data && e.data.type === 'bgm_mp_data' && e.data.data) {
          clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };
      window.addEventListener('message', handler);
      window.opener.postMessage({ type: 'bgm_mp_request' }, '*');
    });
  }

  // Fallback to localStorage
  if (!raw) {
    raw = localStorage.getItem('bgm-mp-pending');
  }

  // Fallback to window.name
  if (!raw) {
    raw = window.name && window.name.startsWith('{') ? window.name : null;
  }

  if (!raw) {
    const nameParam = params.get('name');
    if (nameParam) {
      const input = document.querySelector('#crt_name');
      if (input) input.value = nameParam;
    }
    return;
  }
  try {
    const data = JSON.parse(raw);
    const input = document.querySelector('#crt_name');
    if (!input || !data.personName) {
      localStorage.removeItem('bgm-mp-pending');
      window.name = '';
      return;
    }
    input.value = data.personName;
    localStorage.setItem('bgm-mp-pending', raw);
    window.name = '';
    if (params.has('bgm_mp')) {
      params.delete('bgm_mp');
      const qs = params.toString();
      history.replaceState(null, '', qs ? location.pathname + '?' + qs : location.pathname);
    }
  } catch (_e) {
    localStorage.removeItem('bgm-mp-pending');
    /* ignore */
  }
}

function addAliasLine(value, aliasName) {
  const aliasLine = `[${aliasName}]`;
  const lines = value.split('\n');
  const aliasIdx = lines.findIndex((l) => /^\|别名=\{$/.test(l.trim()));
  if (aliasIdx >= 0) {
    if (lines.slice(aliasIdx + 1).some((l) => l.trim() === aliasLine)) return value;
    lines.splice(aliasIdx + 1, 0, aliasLine);
    return lines.join('\n');
  }
  const cnIdx = lines.findIndex((l) => /^\|简体中文名=/.test(l.trim()));
  const insertIdx = cnIdx >= 0 ? cnIdx + 1 : 1;
  lines.splice(insertIdx, 0, '|别名={', aliasLine, '}');
  return lines.join('\n');
}

export async function initPersonEditPage() {
  const params = new URLSearchParams(location.search);
  let raw = null;
  if (params.has('bgm_mp_alias') && window.opener) {
    raw = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3000);
      const handler = (e) => {
        if (e.data && e.data.type === 'bgm_mp_alias_data' && e.data.data) {
          clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve(e.data.data);
        }
      };
      window.addEventListener('message', handler);
      window.opener.postMessage({ type: 'bgm_mp_alias_request' }, '*');
    });
  }
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    const variantName = data.personName;
    if (!variantName) return;

    const infoboxInput = document.querySelector('#subject_infobox');

    const isNormal = typeof nowmode !== 'undefined' && nowmode === 'normal';
    if (isNormal) {
      if (typeof NormaltoWCODE !== 'function') return;
      NormaltoWCODE();
    }

    if (!infoboxInput) return;

    infoboxInput.value = addAliasLine(infoboxInput.value, variantName);

    if (isNormal) {
      if (typeof WCODEtoNormal !== 'function') return;
      WCODEtoNormal();
    }

    infoboxInput.scrollIntoView({ block: 'center' });
    infoboxInput.style.outline = '2px solid #ffb300';
    setTimeout(() => {
      infoboxInput.style.outline = '';
    }, 4000);
  } catch (_e) {
    /* ignore */
  }
}

export function initPersonPage() {
  const raw = localStorage.getItem('bgm-mp-pending');
  if (!raw) return;
  const personId = location.pathname.match(/\/person\/(\d+)/)?.[1];
  if (!personId) return;
  try {
    const data = JSON.parse(raw);
    if (!data.subjectsData) return;

    // 已绑定目标人物：只在该人物页跳转关联，其他人物页直接忽略
    if (data.personId != null) {
      if (String(data.personId) !== personId) return;
    } else if (!document.referrer.includes('/person/new')) {
      // 未绑定且非刚从 /person/new 创建完成，不自动跳转
      return;
    }

    const typeExts = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
    const types = [
      ...new Set(
        Object.values(data.subjectsData)
          .map((e) => e._type)
          .filter(Boolean),
      ),
    ];
    if (types.length >= 1) {
      const ext = typeExts[types[0]];
      if (ext) {
        if (data.personId == null) {
          data.personId = Number(personId);
        }
        localStorage.setItem('bgm-mp-pending', JSON.stringify(data));
        location.href = `/person/${personId}/add_related/${ext}`;
      }
    }
  } catch (e) {
    console.error('initPersonPage failed:', e);
  }
}
