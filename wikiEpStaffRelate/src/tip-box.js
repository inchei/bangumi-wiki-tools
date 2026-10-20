import { epsCache } from './ep.js';
import { repeatSet, ambiguousRoleSet, failedKeywords, unmatchedKeywords } from './state.js';

export function createDraggableTipBox(
  newRecords,
  existingRecords,
  unMatchedRecords,
  noStaffEps,
  roleMissingEps,
) {
  document.querySelector('.staff-tip-box')?.remove();

  const tipBox = document.createElement('div');
  tipBox.className = 'staff-tip-box';
  tipBox.id = 'wikiEpRelate';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'staff-tip-handle';
  const handleLabel = document.createElement('span');
  handleLabel.textContent = '制作人员参与填写结果';
  dragHandle.append(handleLabel);
  const contentBox = document.createElement('div');
  contentBox.className = 'staff-tip-content';
  tipBox.append(dragHandle, contentBox);

  contentBox.innerHTML = `
        ${
          noStaffEps?.length
            ? `<div class="staff-warning-section">
        <div class="staff-warning-title">以下${noStaffEps.length}个集数未匹配到任何制作人员信息：</div>
        ${noStaffEps.map((ep) => `<span title="${escapeAttr(epsCache?.[ep]?.desc || '')}"><a class="l" href="/ep/${epsCache?.[ep]?.id}" target="_blank">${ep}</a></span>`).join(',')}
        </div>`
            : ''
        }
        ${Object.entries(roleMissingEps)
          .map(
            ([role, missingEps]) => `
            <div class="staff-warning-section">
                <div class="staff-warning-title">职位「${role}」在以下${missingEps.length}个集数中未出现：</div>
                ${missingEps.map((ep) => `<span title="${escapeAttr(epsCache?.[ep]?.desc || '')}"><a class="l" href="/ep/${epsCache?.[ep]?.id}" target="_blank">${ep}</a></span>`).join(',')}
            </div>
        `,
          )
          .join('')}
        ${
          repeatSet.size
            ? `<div class="staff-warning-section">
            <div class="staff-warning-title">以下${repeatSet.size}个新关联的同名制作人员需要检查：</div>
            ${[...repeatSet].map((repeat) => `<a class="l" href="#staff-${repeat}">${repeat.replace(/-(.+)$/, '（$1）')}</a>`).join('、')}
            </div>`
            : ''
        }
        ${
          ambiguousRoleSet.size
            ? `<div class="staff-warning-section">
            <div class="staff-warning-title">以下${ambiguousRoleSet.size}个新关联使用的是同名职位中的第一个，关联到的项可能并非目标「制作助理」，请核对：</div>
            ${[...ambiguousRoleSet].map((pair) => `<a class="l" href="#staff-${pair}">${pair.replace(/-(.+)$/, '（$1）')}</a>`).join('、')}
            </div>`
            : ''
        }
        ${recordSection(newRecords, '新增参与（点击跳转）', 'new')}
        ${recordSection(existingRecords, '已有参与（点击跳转）', 'existing')}
        ${recordSection(unMatchedRecords, '未匹配', 'unmatched')}
        ${(() => {
          if (!epsCache) return '';
          const epCacheEntries = Object.entries(epsCache);
          return `<details><summary>各集详情</summary>${epCacheEntries
            .map(
              ([epLabel, { desc }]) => `
                <details><summary>${epLabel}</summary>${desc.replaceAll('\n', '<br>')}</details>`,
            )
            .join('')}</details>`;
        })()}`;
  contentBox.querySelectorAll(':scope .search-again').forEach((a) =>
    a.addEventListener('click', () => {
      document.querySelector('#subjectName').value = a.dataset.keyword;
      findSubjectFunc();
    }),
  );

  function recordSection(records, text, className) {
    if (!records.length) return '';
    const itemTag = className === 'unmatched' ? 'div' : 'a';
    return /* html */ `
        <div class="staff-record-list">
            <h4 class="staff-tip-title ${className}">${text}</h4>
            ${records
              .map(
                ({ name, names, role, epLabels, aliases, liId }) => `
                <${itemTag} class="staff-record-item ${className}" ${liId ? `href="#${escapeAttr(liId)}"` : ''}>
                    ${(() => {
                      // 平显列表 = 匹配到的 bgm 人物名（多个并列顿号连接，合并记录收集全部）；
                      // 尾部方括号 = 别名方式解出的源名（originalName，多个顿号并列）。
                      // 纯原名匹配的记录没有别名登记，平显匹配名即可
                      const matchedNames = (names?.length ? names : [name])
                        .map((n) => `<span class="staff-person-name">${n}</span>`)
                        .join('、');
                      const originalNames = (aliases && Object.keys(aliases)) || [];
                      const bracket = originalNames.length
                        ? `<span title="${escapeAttr(
                            Object.values(aliases)
                              .map((eps) => eps.join(','))
                              .join(','),
                          )}">[${originalNames.map(escapeAttr).join('、')}]</span>`
                        : '';
                      // 名字与 [原名] 之间留一格：原版模板字符串的缩进空白经浏览器折叠
                      // 即为一个空格
                      return bracket ? `${matchedNames} ${bracket}` : matchedNames;
                    })()}
                    （${role}）${epLabels.length ? ` - ${epLabels.map((ep) => `<span title="${escapeAttr(epsCache?.[ep]?.desc || '')}">${ep}</span>`).join(',')}` : ''}
                    ${
                      className === 'unmatched'
                        ? `→ <a class="l" href="/person/new?name=${escapeAttr(name)}" target="blank">创建</a>
                    ${failedKeywords.has(name) ? ` / 自动搜索失败，<a class="l search-again" data-keyword="${name}" href="javascript:">点击再次搜索</a>` : ''}
                    ${unmatchedKeywords.has(name) ? ` / <a class="l search-again" data-keyword="${name}" href="javascript:">查看搜索结果</a>` : ''}`
                        : ''
                    }
                </${itemTag}>`,
              )
              .join('')}
        </div>`;
  }

  tipBox.style.opacity = '0';
  document.body.appendChild(tipBox);

  // 给与面板记录对应的关联行加跳转小按钮：点击滚动到面板对应记录。
  // 在面板构建完成后再挂，保证点击时目标记录一定存在
  contentBox.querySelectorAll('a.staff-record-item').forEach((item) => {
    const rowId = item.getAttribute('href')?.slice(1);
    if (!rowId) return;
    for (const row of document.querySelectorAll('#crtRelateSubjects li')) {
      if (row.id !== rowId || row.querySelector('.staff-row-jump')) continue;
      const btn = document.createElement('button');
      btn.className = 'staff-row-jump';
      btn.type = 'button';
      btn.textContent = '⤷';
      btn.title =
        '定位到结果面板对应记录' +
        (row.dataset.aliasOrigin
          ? `\n来自原名：${row.dataset.aliasOrigin.replaceAll('\n', '、')}`
          : '');
      btn.addEventListener('click', () => {
        item.scrollIntoView({ block: 'center', behavior: 'smooth' });
        item.classList.add('staff-row-jump-flash');
        setTimeout(() => item.classList.remove('staff-row-jump-flash'), 1200);
      });
      row.querySelector('.title').append(btn);
    }
  });

  let isDragging = false;
  let startX, startY, offsetX, offsetY;

  const boxWidth = tipBox.offsetWidth;
  const boxHeight = tipBox.offsetHeight;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let targetRight = 50;
  let targetBottom = 50;

  const maxRight = windowWidth - boxWidth;
  targetRight = Math.min(targetRight, maxRight);
  targetRight = Math.max(targetRight, 0);

  const maxBottom = windowHeight - boxHeight;
  targetBottom = Math.min(targetBottom, maxBottom);
  targetBottom = Math.max(targetBottom, 0);

  tipBox.style.bottom = `${targetBottom}px`;
  tipBox.style.right = `${targetRight}px`;
  tipBox.style.opacity = '';

  function handleMove(clientX, clientY) {
    const moveX = clientX - startX;
    const moveY = clientY - startY;
    const newX = offsetX + moveX;
    const newY = offsetY + moveY;

    tipBox.style.left = `${newX}px`;
    tipBox.style.top = `${newY}px`;
    tipBox.style.right = 'auto';
    tipBox.style.bottom = 'auto';
  }

  // 鼠标事件
  dragHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    offsetX = tipBox.offsetLeft;
    offsetY = tipBox.offsetTop;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    handleMove(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) isDragging = false;
  });

  // 触摸屏事件
  dragHandle.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      offsetX = tipBox.offsetLeft;
      offsetY = tipBox.offsetTop;
    },
    { passive: false },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  document.addEventListener('touchend', () => {
    if (isDragging) isDragging = false;
  });
}

function escapeAttr(str) {
  return str
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
