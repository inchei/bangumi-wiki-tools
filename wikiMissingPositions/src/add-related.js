import { POSITION_IDS } from './position-ids.js';
import { getProvider } from './api.js';
import { genAppearEps, parseAppearEps, sortAppearEps } from './appear-eps.js';
import { showPendingEps } from './popup.js';
import { ourApiErrorText } from './errors.js';

let select, type, nameInput, epNameInput, epBtn, personId, statusBox;

let _retryCancel = false;
document.addEventListener(
  'click',
  (e) => {
    if (
      e.target.closest(
        'button, .bgm-mp-btn, input[type="submit"], input[type="button"], input.inputBtn',
      )
    ) {
      _retryCancel = true;
    }
  },
  { capture: true },
);

function retry(op, interval = 200) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (_retryCancel) {
        reject(new Error('操作已取消'));
        return;
      }
      try {
        resolve(op());
      } catch (e) {
        setTimeout(attempt, interval);
      }
    };
    attempt();
  });
}

function setStatusBox(html) {
  if (!statusBox) return;
  statusBox.innerHTML = html || '';
  statusBox.classList.toggle('show', Boolean(html));
}

function findSubjectLi(sid, posId) {
  return [...document.querySelectorAll(`#crtRelateSubjects li:has([href="/subject/${sid}"])`)].find(
    (li) => String(li.querySelector('select[name$="[prsnPos]"]')?.value) === String(posId),
  );
}

function findNewSubjectLi(sid) {
  return [...document.querySelectorAll(`#crtRelateSubjects li:has([href="/subject/${sid}"])`)].find(
    (li) => !li.classList.contains('old'),
  );
}

function addOrFindSubjectLi(sid, posId, name) {
  const existing = findSubjectLi(sid, posId);
  if (existing) return { li: existing, added: false };
  subjectList = [{ id: Number(sid), type_id: type, name, name_cn: '', url_mod: 'subject' }];
  addRelateSubject(0, 'submitForm');
  const added = findNewSubjectLi(sid);
  added.querySelector('select[name$="[prsnPos]"]').value = posId;
  return { li: added, added: true };
}

export function addSubjectLi(sid, posId, name) {
  return addOrFindSubjectLi(sid, posId, name).li;
}

async function processEpisodesData(data, queryName) {
  let none = true;
  for (const [sid, entry] of Object.entries(data.matched || {})) {
    for (const [posId, labels] of Object.entries(entry.episodes || {})) {
      const li = addSubjectLi(sid, posId, entry.name);
      const epInput = li.querySelector('[name$="[appear_eps]"]');
      if (epInput) {
        const currentSet = parseAppearEps(epInput.value);
        const hasAll = labels.every((l) => currentSet.has(l));
        if (!hasAll) {
          none = false;
          epInput.value = genAppearEps(labels);
          if (li.classList.contains('old')) {
            li.style.background =
              document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'rgba(255, 248, 165, 0.08)'
                : 'rgba(255, 248, 165, 0.2)';
          }
        }
      }
    }
  }
  const allUnmatched = [];
  for (const [sid, entry] of Object.entries(data.unmatched || {})) {
    none = false;
    allUnmatched.push({ sid, entry });
  }
  if (allUnmatched.length) showPendingEps(allUnmatched, queryName, type);
  return none;
}

function resolveTarget(name) {
  if (!name || !personId) return '';
  return `&target=${personId}`;
}

export async function runEpisodeCheck() {
  const alias = epNameInput.value.trim();
  const queryName = alias || document.querySelector('.nameSingle').textContent.trim();
  epBtn.disabled = true;
  setStatusBox('获取中……');

  const targetParam = await resolveTarget(alias);

  const pending = getPendingData();
  if (
    pending &&
    pending.episodesData &&
    (Object.keys(pending.episodesData.matched || {}).length ||
      Object.keys(pending.episodesData.unmatched || {}).length)
  ) {
    const none = await processEpisodesData(pending.episodesData, queryName);
    setStatusBox(none ? '未查找到任何已填写剧集' : '剧集关联完成！');
    epBtn.disabled = false;
    return;
  }

  const provider = getProvider();
  try {
    const url = `${provider}/api/persons/${encodeURIComponent(queryName)}/missing-episodes${targetParam ? '?' + targetParam.slice(1) : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    const none = await processEpisodesData(data, queryName);
    setStatusBox(none ? '未查找到任何已填写剧集' : '剧集关联完成！');
  } catch (e) {
    console.error(e);
    setStatusBox(ourApiErrorText(queryName));
  } finally {
    epBtn.disabled = false;
  }
}

export function initAddRelated() {
  const personName = document.querySelector('.nameSingle')?.textContent.trim();
  if (!personName) return;
  const pidMatch = location.pathname.match(/\/person\/(\d+)/);
  personId = pidMatch ? pidMatch[1] : '';

  // 类型直接取自路径，避免依赖页面上的 .cat .selected
  const typeName = {
    anime: 2,
    book: 1,
    music: 3,
    game: 4,
    real: 6,
  }[location.pathname.split('/').pop()];
  if (!typeName) return;
  type = typeName;

  select = document.createElement('select');
  select.className = 'bgm-mp-select';
  let posOpts = '<option value="">所有职位</option>';
  Object.keys(POSITION_IDS[type] || {})
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    })
    .forEach(function (id) {
      posOpts += `<option value="${id}">${POSITION_IDS[type][id]}</option>`;
    });
  select.innerHTML = posOpts;

  const container = document.createElement('div');
  container.id = 'bgm-mp-container';

  const group1 = document.createElement('div');
  group1.className = 'bgm-mp-group';

  nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'bgm-mp-input';
  nameInput.placeholder = '别名（可选）';

  const btn = document.createElement('button');
  btn.textContent = '关联已填写条目';
  btn.id = 'missingPositions';
  btn.className = 'bgm-mp-btn';
  btn.addEventListener('click', async () => {
    const position = select.value;

    const pending = getPendingData();
    if (pending && pending.subjectsData && Object.keys(pending.subjectsData).length) {
      const resEntries = Object.entries(pending.subjectsData);
      let none = true;
      for (const [key, entry] of resEntries) {
        if ((entry._type || 0) !== type) continue;
        const sid = key.split(':').pop();
        for (const pos of entry.positions || []) {
          if (position && String(pos) !== position) continue;
          const { added } = addOrFindSubjectLi(sid, pos, entry.name);
          if (added) none = false;
        }
      }
      setStatusBox(none ? '未查找到任何已填写条目' : '关联完成！');
      return;
    }

    const provider = getProvider();
    try {
      btn.disabled = true;
      setStatusBox('获取中……');
      const alias = nameInput.value.trim();
      const targetParam = await resolveTarget(alias);
      const res = await fetch(
        `${provider}/api/persons/${encodeURIComponent(alias || personName)}/missing-subjects?type=${type}&position=${position}${targetParam}`,
      );
      const data = await res.json();
      const resEntries = Object.entries(data);
      let none = true;
      for (const [id, entry] of resEntries) {
        for (const pos of entry.positions) {
          const { added } = addOrFindSubjectLi(id, pos, entry.name);
          if (added) none = false;
        }
      }
      setStatusBox(none ? '未查找到任何已填写条目' : '关联完成！');
    } catch (e) {
      console.error(e);
      setStatusBox(ourApiErrorText(personName));
    } finally {
      btn.disabled = false;
    }
  });

  const group2 = document.createElement('div');
  group2.className = 'bgm-mp-group';

  if (type === 2) {
    epNameInput = document.createElement('input');
    epNameInput.type = 'text';
    epNameInput.className = 'bgm-mp-input';
    epNameInput.placeholder = '别名（可选）';
    epBtn = document.createElement('button');
    epBtn.textContent = '关联已填写剧集';
    epBtn.id = 'missingEpisodes';
    epBtn.className = 'bgm-mp-btn';
    epBtn.addEventListener('click', runEpisodeCheck);
    group2.append(epNameInput, epBtn);
  }

  group1.append(nameInput, select, btn);
  statusBox = document.createElement('div');
  statusBox.className = 'bgm-mp-status-box';
  container.append(group1, group2, statusBox);
  document.querySelector('#indexCatBox').after(container);

  processPendingData();
}

let _pendingData = null;
let _relateBackdoor = false;
export function getPendingData() {
  return _pendingData;
}

export async function processPendingData() {
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.has('bgm_mp_relate') && window.opener && !_relateBackdoor) {
    const handler = (e) => {
      if (e.data && e.data.type === 'bgm_mp_relate_data' && e.data.data) {
        window.removeEventListener('message', handler);
        _relateBackdoor = true;
        localStorage.setItem('bgm-mp-pending', e.data.data);
        processPendingData();
      }
    };
    window.addEventListener('message', handler);
    window.opener.postMessage({ type: 'bgm_mp_relate_request' }, '*');
    return;
  }

  const raw = localStorage.getItem('bgm-mp-pending');
  if (!raw) return;

  const referrer = document.referrer;
  if (!_relateBackdoor && !referrer.includes('/person/new') && !referrer.match(/\/person\/(\d+)/))
    return;

  try {
    const data = JSON.parse(raw);
    _pendingData = data;
    if (!data.subjectsData) {
      localStorage.removeItem('bgm-mp-pending');
      return;
    }
    // pending 已绑定到某个人物，且当前页不是该人物时直接忽略
    if (data.personId != null && String(data.personId) !== personId) return;

    const typeMap = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
    const pageType = typeMap[location.pathname.split('/').pop()] || 0;
    if (pageType === 0) return;

    const matching = {};
    const remaining = {};
    let hasRemaining = false;
    for (const [key, entry] of Object.entries(data.subjectsData)) {
      if ((entry._type || 0) === pageType) {
        matching[key] = entry;
      } else {
        remaining[key] = entry;
        hasRemaining = true;
      }
    }

    let consumed = true;
    let hasExisting = false;
    _retryCancel = false;
    try {
      for (const [key, entry] of Object.entries(matching)) {
        for (const posId of entry.positions || []) {
          const li = await retry(() =>
            addSubjectLi(Number(key.split(':').pop()), posId, entry.name),
          );
          if (li && !li.classList.contains('old')) {
            consumed = false;
          }
          if (li && li.classList.contains('old')) {
            hasExisting = true;
            li.style.background =
              document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'rgba(255, 248, 165, 0.08)'
                : 'rgba(255, 248, 165, 0.2)';
          }
        }
      }

      if (pageType === 2 && data.episodesData?.matched) {
        for (const [sid, entry] of Object.entries(data.episodesData.matched)) {
          for (const [posId, labels] of Object.entries(entry.episodes || {})) {
            const li = await retry(() => addSubjectLi(Number(sid), Number(posId), entry.name));
            const epInput = li.querySelector('[name$="[appear_eps]"]');
            if (epInput) {
              epInput.value = genAppearEps(labels);
              if (li.classList.contains('old')) {
                hasExisting = true;
                li.style.background =
                  document.documentElement.getAttribute('data-theme') === 'dark'
                    ? 'rgba(255, 248, 165, 0.08)'
                    : 'rgba(255, 248, 165, 0.2)';
              }
            }
          }
        }
      }
    } catch (e) {
      if (e.message === '操作已取消') {
        setStatusBox('');
        return;
      }
      throw e;
    }

    if (pageType === 2 && Object.keys(data.episodesData?.unmatched || {}).length) {
      const allUnmatched = Object.entries(data.episodesData.unmatched).map(([sid, entry]) => ({
        sid,
        entry,
      }));
      showPendingEps(allUnmatched, data.personName, 2);
    }

    if (hasRemaining) {
      localStorage.setItem(
        'bgm-mp-pending',
        JSON.stringify({
          personName: data.personName,
          subjectsData: remaining,
          episodesData: null,
          personId: data.personId,
        }),
      );
    } else {
      localStorage.removeItem('bgm-mp-pending');
    }

    markRemainingTypes(remaining);

    setStatusBox(hasExisting ? '关联完成！部分关联已存在' : '关联完成！');

    if (hasRemaining && consumed) {
      const typeExts = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
      const nextType = [
        ...new Set(
          Object.values(remaining)
            .map((e) => e._type)
            .filter(Boolean),
        ),
      ][0];
      if (nextType) {
        const personIdMatch = location.pathname.match(/\/person\/(\d+)/);
        if (personIdMatch)
          location.href = `/person/${personIdMatch[1]}/add_related/${typeExts[nextType]}`;
      }
    }
  } catch (e) {
    localStorage.removeItem('bgm-mp-pending');
  }
}

function markRemainingTypes(remaining) {
  const cat = document.querySelector('ul.cat');
  if (!cat) return;
  const types = new Set(
    Object.values(remaining)
      .map((e) => e._type)
      .filter(Boolean),
  );
  const typeExts = { 1: 'book', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
  cat.querySelectorAll('a').forEach((a) => {
    a.classList.remove('bgm-mp-has-remaining');
    const href = a.getAttribute('href') || '';
    for (const [t, ext] of Object.entries(typeExts)) {
      if (types.has(Number(t)) && href.endsWith('/' + ext)) {
        a.classList.add('bgm-mp-has-remaining');
        return;
      }
    }
  });
}
