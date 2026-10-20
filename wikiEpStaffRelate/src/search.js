import {
  roleIdMap,
  roleValues,
  ambiguousRoleLabels,
  bgmIdMap,
  failedRequests,
  failedKeywords,
  unmatchedKeywords,
  staffSet,
  repeatSet,
  ambiguousRoleSet,
  RETRY_INTERVAL,
  MAX_RETRIES,
} from './state.js';
import { personAliasFallback } from './aliases.js';

/**
 * 自动搜索人物并关联到条目
 * @param {string} name - 要搜索的人物名称
 * @param {number} role - 职位ID
 * @returns { { ids: [], name: string } | void }
 */
export async function autoSearchAndRelate(name, role) {
  try {
    const bgmIdMap = getLastestMap();
    const searchResult = await searchPerson(name);
    let ids = new Set();
    let displayName;

    if (!searchResult) {
      failedKeywords.add(name);
      return;
    }

    if (Object.keys(searchResult).length) {
      for (let id in searchResult) {
        const resultName = searchResult[id].name;
        if (
          normalize(name) === normalize(resultName) ||
          bgmIdMap[name] == id ||
          (await personAliasFallback(name)).some((a) => a.id == id)
        ) {
          await addPersonToRelate(role, normalize(name), id, searchResult[id]);
          ids.add(id);
          displayName ||= resultName;
        } else {
          unmatchedKeywords.add(name);
        }
      }
    }

    if (!displayName) return;
    return { ids: [...ids], name: displayName };
  } catch (error) {
    console.error('autoSearchAndRelate failed:', error);
  }
}

export function normalize(name) {
  return name
    .replace(/\s/g, '')
    .replaceAll('-', '')
    .replace(/々/g, function (m, offset, str) {
      return offset > 0 ? str[offset - 1] : '';
    })
    .replace(/[\u30A1-\u30F6]/g, function (match) {
      return String.fromCharCode(match.charCodeAt(0) - 0x60);
    })
    .replace(/[\uFF21-\uFF5A]/g, function (match) {
      return String.fromCharCode(match.charCodeAt(0) - 0xfee0);
    })
    .toLowerCase();
}

function getLastestMap() {
  let json = localStorage.getItem('localPrsnMap');
  let mergedMap = { ...bgmIdMap };

  try {
    if (json) {
      let obj = JSON.parse(json);
      mergedMap = { ...mergedMap, ...obj };
    }
  } catch (e) {
    console.warn('Failed to parse localPrsnMap:', e);
  }

  return mergedMap;
}

function searchPerson(query) {
  return new Promise((resolve) => {
    const q = trans(query);
    const key = q;

    const execute = () => {
      $.ajax({
        type: 'GET',
        url: `/json/search-person/${encodeURIComponent(q)}`,
        dataType: 'json',
        success: (res) => {
          failedRequests.delete(key);
          resolve(res || {});
        },
        error: (xhr, status, error) => {
          const retries = (failedRequests.get(key) || 0) + 1;

          if (retries > MAX_RETRIES) {
            console.error('请求错误:', error, '查询:', query);
            failedRequests.delete(key);
            resolve(null);
            return;
          }

          failedRequests.set(key, retries);
          console.log(`"${query}" 将于 ${RETRY_INTERVAL}ms 后重试(${retries}/${MAX_RETRIES})`);
          setTimeout(execute, RETRY_INTERVAL);
        },
      });
    };

    execute();
  });
}

function trans(staff) {
  let id = bgmIdMap[staff];
  return id ? 'bgm_id=' + id : staff;
}

async function addPersonToRelate(role, name, personId, personData) {
  const roleId = roleIdMap[role];
  const roleIdList = roleValues[role] || [roleId];
  if (!staffSet.has(roleId + '/' + personId)) {
    const existing = [...document.querySelectorAll('#crtRelateSubjects li')].some(
      (li) =>
        li.querySelector('.title a').href.split('/').pop() == personId &&
        roleIdList.includes(li.querySelector('select').value),
    );
    if (existing) return false;

    staffSet.add(roleId + '/' + personId);
    staffSet.has(roleId + name) ? repeatSet.add(name + '-' + role) : staffSet.add(roleId + name);
    if (ambiguousRoleLabels.has(role)) ambiguousRoleSet.add(name + '-' + role);

    subjectList[personId] = personData;
    addRelateSubject(personId, 'searchResult');
    $('#crtRelateSubjects select').eq(0).val(roleId);
    addSbjListener();
    recolorRepeatRows();
    return true;
  }
  return false;
}

/**
 * 全量重算重名行高亮：按行 id（staff-<名>-<职位>）分组，组内 ≥2 行统一加
 * .staff-repeat-li（叠加在别名行上即 styles.css 的斑马纹）。
 * 每次都先清空全部旧标记、再按当前 DOM 重涂，因此新增行、删除行之后各调
 * 一次即可；无 id 的行（老行/手自行）退回按标题+职位算键。
 * @returns {Map<string, HTMLElement[]>} 分组结果，供删行处判断剩余组大小
 */
export function recolorRepeatRows() {
  const groups = new Map();

  for (const li of document.querySelectorAll('#crtRelateSubjects li')) {
    li.classList.remove('staff-repeat-li');
  }

  for (const li of document.querySelectorAll('#crtRelateSubjects li.clearit')) {
    // 脚本关联的行带 staff-<名>-<职位> 形式的 id，同一「匹配名+职位」的
    // 行 id 相同（别名行尤其如此），直接用它分组；无此 id 的行（老行/
    // 手自行）退回按标题+职位算键
    const key =
      li.id ||
      `${normalize(li.querySelector('.title a')?.textContent ?? '')}-${normalize(
        li.querySelector('option:checked')?.textContent.split(' /')[0] ?? '',
      )}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(li);
  }

  for (const lis of groups.values()) {
    if (lis.length < 2) continue;
    for (const li of lis) li.classList.add('staff-repeat-li');
  }

  return groups;
}

function addSbjListener() {
  $('#crtRelateSubjects .rr')
    .off('click')
    .on('click', function () {
      const $li = $(this).parents('li.clearit');
      const job = $li.find('option:checked').text().split(' /')[0];
      const staff = $li.find('.title a').text();
      const key = `${normalize(staff)}-${normalize(job)}`;

      $li.remove();
      const groups = recolorRepeatRows();
      // 删行后该「人物-职位」不再成对，撤销这条重名警告
      if ((groups.get(key) || []).length < 2) repeatSet.delete(key);
    });
}
