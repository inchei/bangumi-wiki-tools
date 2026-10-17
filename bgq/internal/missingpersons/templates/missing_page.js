function normalize(s) {
  return s.replace(/[\s-]/g, '')
    .replace(/[\u30A1-\u30F6]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60))
    .replace(/[\uFF21-\uFF5A]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

let _openccConverters = null;

function getConverters() {
  if (!_openccConverters && typeof OpenCC !== 'undefined') {
    _openccConverters = {
      jp2t: OpenCC.Converter({ from: 'jp', to: 'tw' }),
      t2s: OpenCC.Converter({ from: 'tw', to: 'cn' }),
      tw2s: OpenCC.Converter({ from: 'tw', to: 'cn' }),
      hk2s: OpenCC.Converter({ from: 'hk', to: 'cn' }),
      t2jp: OpenCC.Converter({ from: 'tw', to: 'jp' }),
    };
  }
  return _openccConverters;
}

let _openccWaiters = null;

function waitOpenCC() {
  if (typeof OpenCC !== 'undefined' && typeof openccCN !== 'undefined') {
    return Promise.resolve();
  }
  if (!_openccWaiters) {
    _openccWaiters = new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (typeof OpenCC !== 'undefined' && typeof openccCN !== 'undefined') {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 8000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }
  return _openccWaiters;
}

// refinedSame reports whether two names normalize to the same simplified-Chinese
// form: exact-normalized match, or both convert identically through refinedToCN
// (OpenCC jp→cn pipeline + variant tables, e.g. 髙橋 → 高橋).
function refinedSame(a, b) {
  if (normalize(a) === normalize(b)) return true;
  const conv = getConverters();
  if (!conv || typeof openccCN === 'undefined') return false;
  return openccCN.refinedToCN(a, conv) === openccCN.refinedToCN(b, conv);
}

function renderSubjects(idx, container) {
  const data = _pendingData[idx];
  if (!data || !data.subjectsData) return;
  const ul = document.createElement('ul');
  const entries = Object.entries(data.subjectsData).sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 0; i < entries.length; i++) {
    const parts = entries[i][0].split(':');
    const stype = parseInt(parts[0], 10);
    const sid = parts[1];
    const entry = entries[i][1];
    const li = document.createElement('li');
    const bgm = typeof mpGetBgm === 'function' ? mpGetBgm() : 'https://bgm.tv';
    const posText = entry.positions.map((p) => _posNames[p] || p).join('、');
    li.innerHTML = `<span class="type">[${_typeNames[stype] || stype}]</span> `
      + `<a href="${bgm}/subject/${sid}" target="_blank">${escHtml(entry.name)}</a> `
      + `<span class="pos">[${escHtml(posText)}]</span>`;
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

document.addEventListener('toggle', (e) => {
  const det = e.target;
  if (!det.matches || !det.matches('details.person')) return;
  if (!det.open || det.querySelector('ul')) return;
  renderSubjects(parseInt(det.dataset.idx, 10), det);
}, true);

function showResult(btn, html, className) {
  let sr = btn.parentElement.querySelector('.sr');
  if (!sr) {
    sr = document.createElement('div');
    sr.className = 'sr';
    btn.parentElement.insertBefore(sr, btn.nextSibling);
  }
  sr.className = 'sr ' + className;
  sr.innerHTML = html;
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'bgm_mp_request' && _bgmMpPending) {
    e.source.postMessage({ type: 'bgm_mp_data', data: _bgmMpPending }, '*');
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-create');
  if (!btn) return;
  const frag = (btn.getAttribute('href') || '').startsWith('#');
  if (!frag) e.preventDefault();
  e.stopPropagation();
  const idx = parseInt(btn.dataset.idx, 10);
  const name = btn.dataset.name;
  _bgmMpPending = JSON.stringify(_pendingData[idx]);
  showResult(btn, '搜索中…', 'sr-loading');

  const apiBase = typeof mpGetApi === 'function' ? mpGetApi() : 'https://api.bgm.tv';
  const bgmBase = typeof mpGetBgm === 'function' ? mpGetBgm() : 'https://bgm.tv';

  waitOpenCC()
    .then(() => fetch(`${apiBase}/v0/search/persons?limit=5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: name }),
    }))
    .then((r) => r.json())
    .then((data) => {
      const results = (data.data || []).filter((p) => normalize(p.name) === normalize(name) || refinedSame(p.name, name));
      if (results.length) {
        _bgmMpPending = null;
        const links = results.map((p) =>
          `<a href="${bgmBase}/person/${p.id}" target="_blank">${escHtml(p.name)} (ID:${p.id})</a>`
          + `<a class="btn btn-relate" href="#relate-${p.id}" data-idx="${idx}" data-id="${p.id}">关联</a>`
        ).join(' ');
        showResult(btn, `✅ ${links} <a class="btn btn-create-still" href="${bgmBase}/person/new?name=${encodeURIComponent(name)}&bgm_mp=1" target="_blank">仍然创建</a>`, 'sr-found');
        return;
      }
      showResult(btn, '➖ 未创建', 'sr-missing');
      window.open(`${bgmBase}/person/new?name=${encodeURIComponent(name)}&bgm_mp=1`, '_blank');
    })
    .catch(() => {
      showResult(btn, '搜索失败', 'sr-loading');
    });
});

// 关联 button (search results)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-relate');
  if (!btn) return;
  const frag = (btn.getAttribute('href') || '').startsWith('#');
  if (!frag) e.preventDefault();
  e.stopPropagation();
  const idx = parseInt(btn.dataset.idx, 10);
  const personId = parseInt(btn.dataset.id, 10);
  openRelate(personId, _pendingData[idx]);
});
