import { genAppearEps } from '@common/appear-eps.js';

function makeDraggable(popup, handle, excludeSelector) {
  let offX = 0,
    offY = 0;
  function cx(e) {
    return e.touches ? e.touches[0].clientX : e.clientX;
  }
  function cy(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
  }
  handle.onmousedown = handle.ontouchstart = (e) => {
    if (excludeSelector && e.target.closest(excludeSelector)) return;
    if (e.cancelable) e.preventDefault();
    const rect = popup.getBoundingClientRect();
    popup.style.transform = 'none';
    popup.style.left = rect.left + 'px';
    popup.style.top = rect.top + 'px';
    popup.style.right = 'auto';
    popup.style.bottom = 'auto';
    offX = cx(e) - rect.left;
    offY = cy(e) - rect.top;
    document.onmousemove = document.ontouchmove = (ev) => {
      if (ev.cancelable) ev.preventDefault();
      popup.style.left = cx(ev) - offX + 'px';
      popup.style.top = cy(ev) - offY + 'px';
    };
    document.onmouseup = document.ontouchend = () => {
      document.onmousemove = document.ontouchmove = null;
    };
  };
}

export function createNotifyPopup({ handleHTML, className = '', onClose, dragExclude = '' }) {
  const popup = document.createElement('div');
  popup.className = 'bgm-mp-notify' + (className ? ` ${className}` : '');

  const handle = document.createElement('div');
  handle.className = 'staff-tip-handle';
  handle.innerHTML = handleHTML;

  const content = document.createElement('div');
  content.className = 'staff-tip-content';

  popup.append(handle, content);
  document.body.appendChild(popup);

  popup.querySelector('.bgm-mp-notify-close').onclick = () => {
    onClose?.();
    popup.remove();
  };

  const exclude = ['.bgm-mp-notify-close', dragExclude].filter(Boolean).join(', ');
  makeDraggable(popup, handle, exclude);

  return { popup, handle, content };
}

export function showPendingEps(allUnmatched, personName, type) {
  const existing = document.querySelector('.bgm-mp-notify');
  if (existing) existing.remove();

  const sections = allUnmatched.map(({ sid, entry }) => {
    const eps = entry.episodes || [];
    const epLinks = eps
      .map(
        (ep) =>
          `<a class="l" href="https://bgm.tv/ep/${ep.episode_id}#:~:text=${encodeURIComponent(personName)}" target="_blank">${ep.label}</a>`,
      )
      .join(', ');
    return { sid, entry, eps, epLinks };
  });

  if (!sections.length) return;

  const { popup, content } = createNotifyPopup({
    handleHTML: '<strong>疑似匹配</strong><button class="bgm-mp-notify-close">&times;</button>',
  });

  let html = '<div class="bgm-mp-pending-header">以下剧集简介包含此名称但未定位到职位：</div>';
  for (const sec of sections) {
    html += `<div class="bgm-mp-pending-item">
        <strong><a href="/subject/${sec.sid}">${sec.entry.name || '#' + sec.sid}</a></strong> ${sec.epLinks}
        <button class="bgm-mp-btn bgm-mp-relate-btn" data-sid="${sec.sid}" href="javascript:">关联</button>
        <button class="bgm-mp-btn bgm-mp-copy-btn" data-sid="${sec.sid}" href="javascript:">复制</button>
        <button class="bgm-mp-btn bgm-mp-locate-btn" data-sid="${sec.sid}" href="javascript:">定位</button>
      </div>`;
  }
  content.innerHTML = html;

  popup.style.opacity = '0';
  const boxW = popup.offsetWidth;
  const boxH = popup.offsetHeight;
  const winW = window.innerWidth;
  const winH = window.innerHeight;

  let right = 50,
    bottom = 50;
  right = Math.min(right, winW - boxW);
  right = Math.max(right, 0);
  bottom = Math.min(bottom, winH - boxH);
  bottom = Math.max(bottom, 0);

  popup.style.bottom = `${bottom}px`;
  popup.style.right = `${right}px`;
  popup.style.opacity = '';

  popup.querySelectorAll('.bgm-mp-btn').forEach((btn) => {
    btn.onclick = () => {
      const sec = sections.find((s) => String(s.sid) === btn.dataset.sid);
      if (!sec) return;
      const epLabels = sec.eps.map((ep) => ep.label);
      if (!epLabels.length) return;
      subjectList = [
        {
          id: Number(sec.sid),
          type_id: type,
          name: sec.entry.name,
          name_cn: '',
          url_mod: 'subject',
        },
      ];
      addRelateSubject(0, 'submitForm');
    };
  });

  popup.querySelectorAll('.bgm-mp-copy-btn').forEach((btn) => {
    btn.onclick = () => {
      const sec = sections.find((s) => String(s.sid) === btn.dataset.sid);
      if (!sec) return;
      const epLabels = sec.eps.map((ep) => ep.label);
      if (!epLabels.length) return;
      navigator.clipboard.writeText(genAppearEps(epLabels));
      const orig = btn.textContent;
      btn.textContent = '复制成功';
      setTimeout(() => (btn.textContent = orig), 2000);
    };
  });

  popup.querySelectorAll('.bgm-mp-locate-btn').forEach((btn) => {
    btn.onclick = () => {
      document.querySelector('[data-group-mode="subject"]').click();
      const l = document.querySelector(`[href="/subject/${btn.dataset.sid}"]`);
      if (!l) return;
      window.location.href += `#:~:text=${l.textContent}`;
    };
  });
}
