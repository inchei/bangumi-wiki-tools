import { BOOK_PLATFORMS, INFOBOX_TEMPLATES } from './wiki-template.generated.js';

const PLATFORM_TYPES = Object.fromEntries(
  Object.entries(BOOK_PLATFORMS).map(([cn, p]) => [p.id, cn]),
);

(function () {
  'use strict';

  const pathname = location.pathname;

  const exposeEntry = () => {
    const a = document.createElement('a');
    a.classList.add('l');
    a.textContent = '/ 创建对应系列';
    a.href = '/new_subject/1';
    const br = document.createElement('br');
    document.querySelector('.modifyTool .tip_i p:nth-of-type(2)').append(br, a);
  };

  if (pathname.match(/^\/subject\/\d+$/)) {
    // 条目页
    if (document.querySelector('.focus.chl').href.split('/').pop() !== 'book') return;
    if (document.querySelector('.nameSingle .grey').nextElementSibling) {
      // 系列
      const info = sessionStorage.getItem('seriesVolumeInfo');
      if (document.referrer !== `${location.origin}/new_subject/1` || !info) return;
      location.href += '/add_related/subject/book';
    } else {
      exposeEntry();
      const title = document.querySelector('.nameSingle a');
      sessionStorage.setItem(
        'seriesVolumeInfo',
        `${title.textContent}"""${title.href.split('/').pop()}`,
      );
      sessionStorage.setItem('seriesVolumeCover', document.querySelector('.cover')?.href || '');
      sessionStorage.setItem('seriesVolumeWiki', JSON.stringify(dumpVolumeWiki()));
    }
  } else if (pathname === '/new_subject/1') {
    // 创建条目页
    const referrer = document.referrer;
    const sbjId = referrer.match(/subject\/(\d+)/)?.[1];
    const info = sessionStorage.getItem('seriesVolumeInfo');
    const cover = sessionStorage.getItem('seriesVolumeCover');
    const wiki = JSON.parse(sessionStorage.getItem('seriesVolumeWiki') || 'null');
    if (sbjId !== info?.split('"""')?.[1] || (!cover && cover !== '') || !wiki) return;

    const inputBtns = document.querySelectorAll(':not(.canvas-btn-container) .inputBtn');
    const trimmedTitle = wiki.name
      .replace(/\s(上|下|\d+|[\u0030-\u0039\uFF10-\uFF19]+)|[（(].+?[）)]$/, '')
      .trim();
    const titleInput = document.querySelector('input[name="subject_title"]');
    titleInput.addEventListener('input', () => {
      inputBtns.forEach((inputBtn) => {
        if (titleInput.value !== wiki.name) {
          inputBtn.style.pointerEvents = 'auto';
          inputBtn.value = '提交';
        } else {
          inputBtn.style.pointerEvents = 'none';
          inputBtn.value = '与来源单行本重名，请更改书名';
        }
      });
    });
    titleInput.value = trimmedTitle;
    titleInput.dispatchEvent(new Event('input'));
    document.querySelector('#subjectSeries').click();
    document.querySelector(`[value="${wiki.platform}"]`)?.click();
    document.querySelector('#subject_summary').value = wiki.summary;
    document.querySelector('#tags').value = `${PLATFORM_TYPES[wiki.platform] || ''} 系列`;
    setInfobox(wiki.infobox);

    if (cover) {
      coverToDataURL(cover)
        .then((coverDataURL) => deliverCover(coverDataURL))
        .catch((e) => console.error('封面转换失败：', e));
    }
  } else if (pathname.endsWith('/add_related/subject/book')) {
    const sbjId = document.referrer.match(/subject\/(\d+)/)?.[1];
    const info = sessionStorage.getItem('seriesVolumeInfo');
    if (
      !sbjId ||
      !info ||
      document.querySelector('.focus.chl').href.split('/').pop() !== 'book' ||
      !document.querySelector('.nameSingle .grey').nextElementSibling
    )
      return;
    const [volName, volId] = info.split('"""');

    let cancelled = false;
    document.addEventListener(
      'click',
      () => {
        cancelled = true;
      },
      { capture: true, once: true },
    );

    const run = () => {
      if (cancelled) return;
      const ul = document.querySelector('#crtRelateSubjects');
      const searchInput = document.querySelector('#subjectName');
      if (!ul || !searchInput) throw new Error('关联列表未就绪');
      if (document.querySelector(`#crtRelateSubjects li a[href="/subject/${volId}"]`)) {
        sessionStorage.removeItem('seriesVolumeInfo');
        sessionStorage.removeItem('seriesVolumeCover');
        sessionStorage.removeItem('seriesVolumeWiki');
        return;
      }
      subjectList = [{ id: volId, type_id: '1', name: volName, name_cn: '', url_mod: 'subject' }];
      addRelateSubject(0, 'submitForm');
      searchInput.value = document.querySelector('.nameSingle a').textContent;
      findSubjectFunc();
      $('#crtRelateSubjects a.h').click(rmParent);
      waitForElement('#id_start', (e) => {
        e.value = volId;
        document.querySelector('#id_end').value = volId;
      });
    };
    const attempt = () => {
      try {
        run();
      } catch {
        setTimeout(attempt, 200);
      }
    };
    attempt();
  }

  /**
   * 从单行本条目页 DOM 推算系列条目数据（无网络请求）
   * @returns {{name: string, infobox: string, summary: string, platform: number}}
   */
  function dumpVolumeWiki() {
    const grey = (document.querySelector('.nameSingle .grey')?.textContent || '').trim();
    const platformInfo = BOOK_PLATFORMS[grey];
    const template = INFOBOX_TEMPLATES[platformInfo?.template] || INFOBOX_TEMPLATES.Book;

    const values = {}; // 字段 -> 完整 wikitext 行（别名等为整块）
    const groups = []; // 版本组块，按页面出现顺序
    const rowLine = (li) => {
      const tip = li.querySelector(':scope > span.tip');
      const key = tip ? tip.textContent.replace(/[:：]\s*$/u, '').trim() : '';
      const value = tip
        ? li.textContent.slice(tip.textContent.length).trim()
        : li.textContent.trim();
      return key && value && !key.includes('ISBN') ? `[${key}|${value}]` : '';
    };
    let groupTags = null;
    let groupIndex = 0;

    const ul = document.querySelector('.infobox_container ul#infobox');
    if (ul) {
      // 在 li 的克隆副本上解析，不动页面 DOM
      for (const node of [...ul.children].filter((el) => el.tagName === 'LI')) {
        const li = node.cloneNode(true);
        if (li.classList.contains('sub_group')) {
          // 版本组标签页
          groupTags = [...li.querySelectorAll('span.tag.group_tag:not(.more)')];
          groupIndex = 0;
          continue;
        }
        if (li.classList.contains('sub_container')) {
          if (li.querySelector(':scope > ul > li.sub_section')) {
            // 别名
            const lines = [...li.querySelectorAll(':scope > ul > li.sub')].map((sub) => {
              const tip = sub.querySelector(':scope > span.tip');
              const unofficial = tip && tip.textContent.trim() === '非官方';
              const value = tip
                ? sub.textContent.slice(tip.textContent.length).trim()
                : sub.textContent.trim();
              return value ? (unofficial ? `[非官方|${value}]` : `[${value}]`) : '';
            });
            if (lines.length) values['别名'] = `|别名={\n${lines.filter(Boolean).join('\n')}\n}`;
            continue;
          }
          const tag = groupTags?.[groupIndex++];
          if (tag) {
            const gname =
              li.querySelector('li.group_section')?.textContent.trim() || tag.textContent.trim();
            const gkey = li.getAttribute('attr-info-group') || '版本';
            const lines = [...li.querySelectorAll(':scope > ul > li')]
              .filter((member) => !member.classList.contains('group_section'))
              .map(rowLine)
              .filter(Boolean);
            if (lines.length) groups.push(`|${gkey}:${gname}={\n${lines.join('\n')}\n}`);
          }
          continue;
        }
        const tip = li.querySelector(':scope > span.tip');
        if (!tip) continue;
        const key = tip.textContent.replace(/[:：]\s*$/u, '').trim();
        const value = li.textContent.slice(tip.textContent.length).trim();
        if (!value || key === '页数' || key === '价格' || key.includes('ISBN')) continue; // 单卷专用
        values[key] = `|${key}= ${value}`;
      }
    }

    const templateFields = new Set(template.fields);
    const body = [];
    for (const field of template.fields) {
      // 按模板顺序补完空字段；单卷专用的页数/ISBN/价格不进入系列条目
      if (field === '页数' || field === 'ISBN' || field === '价格') continue;
      body.push(
        values[field] ??
          (field === '别名' || field === '链接' ? `|${field}= {\n\n}` : `|${field}= `),
      );
    }
    for (const [key, piece] of Object.entries(values)) {
      if (!templateFields.has(key)) body.push(piece); // 模板外自定义字段
    }
    body.push(...groups);

    return {
      name: document.querySelector('.nameSingle a')?.textContent || '',
      infobox: `{{Infobox ${template.header}\n${body.join('\n')}\n}}`,
      summary: (document.querySelector('#subject_summary')?.textContent || '').trim(),
      platform: platformInfo?.id,
    };
  }

  /**
   * 同域封面链接转 dataURL（封面资源在主域名有同域路径，无额外跨域请求）
   * @param {string} coverUrl lain 域封面链接（//lain.bgm.tv/pic/cover/...）
   * @returns {Promise<string>} DataURL 字符串
   */
  async function coverToDataURL(coverUrl) {
    const path = new URL(coverUrl.replace(/^\/\//, `${location.protocol}//`)).pathname;
    const blob = await fetch(path).then((response) => {
      if (!response.ok) throw new Error(`获取封面失败，状态码：${response.status}`);
      return response.blob();
    });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 富文本模式下同步 wiki 编辑器内容
   * @param {string} text infobox wikitext
   */
  function setInfobox(text) {
    if (!text) return;
    const box = document.querySelector('#subject_infobox');
    const isNormal = typeof nowmode !== 'undefined' && nowmode === 'normal';
    if (isNormal) {
      if (typeof NormaltoWCODE !== 'function') return;
      NormaltoWCODE();
    }
    box.value = text;
    if (isNormal) {
      if (typeof WCODEtoNormal !== 'function') return;
      WCODEtoNormal();
    }
  }

  // 封面投递：wikiUploadPic 消费隐藏的 data-bgm-import-cover img；
  // 若没装 wikiUploadPic，兜底给 bangumi-new-wiki-helper 的 img.preview
  function deliverCover(dataUrl) {
    if (!dataUrl) return;
    const cover = document.createElement('img');
    cover.setAttribute('data-bgm-import-cover', '');
    cover.style.display = 'none';
    cover.src = dataUrl;
    document.body.appendChild(cover);
    waitForElement('img.preview', (img) => {
      img.src = dataUrl;
    });
  }

  function waitForElement(selector, callback) {
    const element = document.querySelector(selector);
    if (element) {
      callback(element);
      return;
    }

    // 使用MutationObserver等待元素出现
    const observer = new MutationObserver(() => {
      const elem = document.querySelector(selector);
      if (elem) {
        observer.disconnect();
        callback(elem);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
