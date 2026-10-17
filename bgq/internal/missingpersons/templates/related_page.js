function renderSubjects(idx, container) {
  const data = _relatedData[idx];
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

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'bgm_mp_request' && _bgmMpPending) {
    e.source.postMessage({ type: 'bgm_mp_data', data: _bgmMpPending }, '*');
  }
});

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'bgm_mp_alias_request' && _bgmMpAliasData) {
    e.source.postMessage({ type: 'bgm_mp_alias_data', data: _bgmMpAliasData }, '*');
  }
});

// 创建 button
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-create');
  if (!btn || btn.dataset.force !== '1') return;
  const frag = (btn.getAttribute('href') || '').startsWith('#');
  if (!frag) e.preventDefault();
  e.stopPropagation();
  const idx = parseInt(btn.dataset.idx, 10);
  const name = btn.dataset.name;
  const data = _relatedData[idx];
  if (!data) return;
  _bgmMpPending = JSON.stringify({
    personName: data.personName,
    subjectsData: data.subjectsData,
    episodesData: data.episodesData,
  });
  const bgm = typeof mpGetBgm === 'function' ? mpGetBgm() : 'https://bgm.tv';
  window.open(`${bgm}/person/new?name=${encodeURIComponent(name)}&bgm_mp=1`, '_blank');
});

// 关联 button
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-relate');
  if (!btn) return;
  const frag = (btn.getAttribute('href') || '').startsWith('#');
  if (!frag) e.preventDefault();
  e.stopPropagation();
  const idx = parseInt(btn.dataset.idx, 10);
  const data = _relatedData[idx];
  if (!data) return;

  const wrap = btn.parentElement;
  const sel = wrap.querySelector('.relate-select');
  const personId = sel ? parseInt(sel.value, 10) : (data.relatedPersonIds && data.relatedPersonIds.length ? data.relatedPersonIds[0].id : 0);
  openRelate(personId, data);
});

// 添加别名 button
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-alias');
  if (!btn) return;
  const frag = (btn.getAttribute('href') || '').startsWith('#');
  if (!frag) e.preventDefault();
  e.stopPropagation();
  const idx = parseInt(btn.dataset.idx, 10);
  const data = _relatedData[idx];
  if (!data) return;

  const wrap = btn.parentElement;
  const sel = wrap.querySelector('.relate-select');
  const personId = sel ? parseInt(sel.value, 10) : (data.relatedPersonIds && data.relatedPersonIds.length ? data.relatedPersonIds[0].id : 0);
  if (!personId) return;

  _bgmMpAliasData = JSON.stringify({
    personName: data.personName,
    personId,
  });
  const bgm = typeof mpGetBgm === 'function' ? mpGetBgm() : 'https://bgm.tv';
  window.open(`${bgm}/person/${personId}/edit?bgm_mp_alias=1`, '_blank');
});

// Sync link href when select changes
document.addEventListener('change', (e) => {
  const sel = e.target.closest('.relate-select');
  if (!sel) return;
  const wrap = sel.parentElement;
  const link = wrap.querySelector('.relate-link');
  if (link) {
    const bgm = typeof mpGetBgm === 'function' ? mpGetBgm() : 'https://bgm.tv';
    link.href = `${bgm}/person/${sel.value}`;
  }
});

// 页面加载时根据配置重写静态关联链接
document.addEventListener('DOMContentLoaded', () => {
  const bgm = typeof mpGetBgm === 'function' ? mpGetBgm() : 'https://bgm.tv';
  document.querySelectorAll('.relate-link[href^="https://bgm.tv/person/"]').forEach((a) => {
    try {
      const url = new URL(a.href);
      a.href = bgm + url.pathname + url.search + url.hash;
    } catch {}
  });
});
