import { roleIdMap } from './state.js';
import { POSITION_IDS } from '../../wikiMissingPositions/src/position-ids.js';

// DOM 处理沿用 bangumi-auto-relate-infobox 的规则（childNodes[0] 为职位 tip、
// childNodes[1] 为名单正文）；职位表沿用 wikiMissingPositions 的 POSITION_IDS
// 权威数据
const SPLIT_RULE = /[()[\]{}（）<>《》「」『』【】+×·→/／、,，;；:：&＆\\]/;
const FILTER_WORDS = ['CV:', 'CV\\.', 'feat\\.', '\\*'];
// 跳过集数标记类条目：纯数字、数字区间（1-12）、OP/ED/SP（可带数字）
const EP_MARKER_RE = /^\d+$|^\d+\s*-\s*\d+$|^(?:OP|ED|SP)(?:\d+)?$/i;

const positionNames = new Set(Object.values(POSITION_IDS[2] || {}));

/**
 * infobox 值文本拆成人名列表
 * @param {string} staffs
 * @returns {string[]}
 */
function splitStaffs(staffs) {
  return Array.from(
    new Set(
      staffs
        .replace(new RegExp(FILTER_WORDS.join('|'), 'g'), ',')
        .split(SPLIT_RULE)
        .map((staff) => staff.trim())
        .filter(Boolean)
        .filter((staff) => !EP_MARKER_RE.test(staff)),
    ),
  );
}

function fetchInfobox() {
  const subjectId = location.pathname.split('/')[2];
  return fetch(`/subject/${subjectId}`)
    .then((res) => res.text())
    .then((html) => new DOMParser().parseFromString(html, 'text/html').querySelector('#infobox'));
}

/**
 * 解析条目 infobox 的制作人员行，转成通用 JSON 格式：
 * { 人物: { 职位: [] } }，空集数数组表示只关联、不填写参与
 * @returns {Promise<{
 *   staffInfo: Record<string, Record<string, string[]>>,
 *   unknownRoles: string[],
 * }>}
 */
export async function getInfoboxStaffInfo() {
  const infobox = document.querySelector('#infobox') || (await fetchInfobox());
  if (!infobox) throw new Error('未找到infobox');

  const staffInfo = {};
  const unknownRoles = new Set();

  for (const li of infobox.querySelectorAll('li')) {
    if (li.classList.contains('sub_container')) continue;
    const job = li.childNodes[0]?.textContent.replace(':', '').trim();
    const staffs = li.childNodes[1]?.textContent.trim();
    if (!job || !staffs || !staffs.trim()) continue;

    // 职位表以 POSITION_IDS 为准（精确简体名）；确属权威职位但页面职位下拉
    // 缺失时才提示，普通字段静默跳过
    if (!positionNames.has(job)) continue;
    if (!roleIdMap[job]) {
      unknownRoles.add(job);
      continue;
    }

    for (const name of splitStaffs(staffs.trim())) {
      (staffInfo[name] ||= {})[job] = [];
    }
  }

  return { staffInfo, unknownRoles: [...unknownRoles] };
}
