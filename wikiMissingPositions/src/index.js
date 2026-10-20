import {
  initSubjectPage,
  initPersonNewPage,
  initPersonPage,
  initPersonEditPage,
} from './subject-page.js';
import { getProvider, getShow, saveProvider, saveShow, normalizeProvider } from './api.js';
import { DEFAULT_PROVIDER, PUBLIC_PROVIDERS } from './config.js';
import { initAddRelated } from './add-related.js';

const pathname = location.pathname;

(function route() {
  if (/^\/subject\/\d+$/.test(pathname)) {
    initSubjectPage();
    return;
  }
  if (pathname === '/person/new') {
    initPersonNewPage();
    return;
  }
  if (/^\/person\/\d+\/edit$/.test(pathname)) {
    initPersonEditPage();
    return;
  }
  if (/^\/person\/\d+$/.test(pathname)) {
    initPersonPage();
    return;
  }
  // Only person add-related pages reach here; 站内还有大量 subject/person
  // 子页（comments、works、collect 等）会漏进兜底路由，一律静默退出
  if (/^\/person\/\d+\/add_related\/(anime|book|music|game|real)$/.test(pathname)) {
    initAddRelated();
  }
})();

if (typeof chiiLib !== 'undefined' && chiiLib.ukagaka && chiiLib.ukagaka.addPanelTab) {
  chiiLib.ukagaka.addPanelTab({
    tab: 'wiki_missing_positions',
    label: '缺失职位',
    type: 'custom',
    customContent: function () {
      const provider = getProvider();
      const show = getShow();
      return /* html */ `
        <div class="bgm-mp-settings">
          <div class="bgm-mp-row">
            <label for="bgm-mp-provider">API 地址</label>
            <input type="text" id="bgm-mp-provider" value="${provider.replace(/"/g, '&quot;')}" placeholder="${DEFAULT_PROVIDER}">
            <button type="button" class="bgm-mp-btn" id="bgm-mp-save" disabled>保存</button>
          </div>
          <div class="bgm-mp-hint">可用公共部署地址：</div>
          <div class="bgm-mp-providers" id="bgm-mp-providers"></div>
          <div class="bgm-mp-row">
            <label for="bgm-mp-show">条目页显示未关联人物</label>
            <input type="checkbox" class="bgm-mp-toggle" id="bgm-mp-show"${show === 'on' ? ' checked' : ''}>
          </div>
        </div>`;
    },
    onInit: function (tabSelector, $tabContent) {
      const $provider = $tabContent.find('#bgm-mp-provider');
      const $save = $tabContent.find('#bgm-mp-save');
      let savedValue = $provider.val();
      let invalid = false;
      let saveTimer = null;

      function setSaveState(dirty, saving) {
        if (saving) {
          $save.text('保存中').prop('disabled', true);
        } else {
          $save.text('保存').prop('disabled', !dirty || invalid);
        }
      }

      function validate() {
        invalid = normalizeProvider($provider.val()) === null;
        $provider.toggleClass('bgm-mp-invalid', invalid);
        setSaveState($provider.val() !== savedValue, false);
      }

      function doSave() {
        const normalized = normalizeProvider($provider.val());
        if (normalized === null) {
          validate();
          return;
        }
        setSaveState(false, true);
        saveProvider(normalized).then(
          function () {
            savedValue = normalized;
            $provider.val(normalized);
            setSaveState(false, false);
          },
          function () {
            setSaveState(true, false);
          },
        );
      }

      $tabContent
        .off('input change', '#bgm-mp-provider')
        .on('input change', '#bgm-mp-provider', function () {
          clearTimeout(saveTimer);
          validate();
          saveTimer = setTimeout(doSave, 400);
        });
      $tabContent.off('click', '#bgm-mp-save').on('click', '#bgm-mp-save', function () {
        clearTimeout(saveTimer);
        doSave();
      });
      $tabContent.off('change', '#bgm-mp-show').on('change', '#bgm-mp-show', function () {
        saveShow(this.checked ? 'on' : 'off');
      });

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function renderProviders() {
        const rows = PUBLIC_PROVIDERS.map(function (item) {
          const name = item.home
            ? `<a class="l" href="${escapeHtml(item.home)}" target="_blank">${escapeHtml(item.name)}</a>`
            : `${escapeHtml(item.name)}`;
          return `<div class="bgm-mp-provider-row">
            <a class="l" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a> - ${name}
            <a class="l bgm-mp-fill" href="#" data-url="${escapeHtml(item.url)}">填入</a>
          </div>`;
        }).join('');
        $tabContent.find('#bgm-mp-providers').html(rows);
      }

      $tabContent
        .off('click', '#bgm-mp-providers .bgm-mp-fill')
        .on('click', '#bgm-mp-providers .bgm-mp-fill', function (e) {
          e.preventDefault();
          $provider.val(this.dataset.url);
          validate();
          clearTimeout(saveTimer);
          doSave();
        });

      validate();
      renderProviders();
    },
  });
}
