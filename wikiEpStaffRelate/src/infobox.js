import { roleIdMap } from './state.js';
import { POSITION_IDS } from '../../wikiMissingPositions/src/position-ids.js';
import { parseAppearEps } from './appear-eps.js';

// DOM 处理沿用 bangumi-auto-relate-infobox 的规则（childNodes[0] 为职位 tip、
// childNodes[1] 为名单正文）；职位表沿用 wikiMissingPositions 的 POSITION_IDS
// 权威数据
const SPLIT_RULE = /[()[\]{}（）<>《》「」『』【】+×·→/／、,，;；:：&＆\\]/;
const FILTER_WORDS = ['CV:', 'CV\\.', 'feat\\.', '\\*'];
// 跳过集数标记类条目：纯数字、数字区间（1-12）、OP/ED/SP（可带数字）
const EP_MARKER_RE = /^\d+$|^\d+\s*-\s*\d+$|^(?:OP|ED|SP)(?:\d+)?$/i;
const TYPE_CODES = { anime: 2, book: 1, music: 3, game: 4, real: 6 };
// 行内手写参与：值文本含括号数字（如 `某人 (1, 3-5)`）才进入参与解析
const PARTS_ROW_RE = /\([^()]*\d[^()]*\)/;
const TRAILING_PARTS_RE = /\s*\(([^()]*)\)\s*$/;
const EP_LABEL_ONLY_RE = /^(?:OP|ED|SP)\d*(?:,(?:OP|ED|SP)\d*)*$/i;
// 格式存疑的参与照填，登记 partIssues 复查
const PARTS_FORMAT_RE = /^(\d+[,-])*\d+$/;

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

/**
 * 解析条目 infobox 的制作人员行，转成通用 JSON 格式：
 * { 人物: { 职位: [集数] } }，空集数数组表示只关联、不填写参与；
 * 行内 `某人 (1, 3-5)` 形式的手写参与解析为集数数组
 * @returns {Promise<{
 *   staffInfo: Record<string, Record<string, string[]>>,
 *   unknownRoles: string[],
 *   skippedRoles: string[],
 *   allRows: { job: string, names: string[] }[],
 *   typeLabel: string,
 *   partIssues: { job: string, text: string, reason: string }[],
 *   partsCount: number,
 *   nameVariants: Record<string, string[]>,
 * }>}
 */
export async function getInfoboxStaffInfo() {
  const infobox = document.querySelector('#infobox');
  if (!infobox) throw new Error('未找到infobox');

  const typeSel = document.querySelector('.focus.chl')?.href.split('/').pop();
  const typeCode = TYPE_CODES[typeSel] || 2;
  const typeLabel = TYPE_CODES[typeSel] ? typeSel : 'anime';
  const positionNames = new Set(Object.values(POSITION_IDS[typeCode] || {}));

  const staffInfo = {};
  const unknownRoles = new Set();
  const skippedRoles = [];
  const allRows = [];
  const partIssues = [];
  const nameVariants = {};

  for (const li of infobox.querySelectorAll('li')) {
    if (li.classList.contains('sub_container')) continue;
    const job = li.childNodes[0]?.textContent.replace(':', '').trim();
    const staffs = li.childNodes[1]?.textContent.trim();
    if (!job || !staffs || !staffs.trim()) continue;

    const names = splitStaffs(staffs.trim());
    allRows.push({ job, names });

    if (!positionNames.has(job)) {
      skippedRoles.push(job);
      continue;
    }
    if (!roleIdMap[job]) {
      unknownRoles.add(job);
      continue;
    }

    for (const name of names) {
      (staffInfo[name] ||= {})[job] ||= [];
    }
    if (PARTS_ROW_RE.test(staffs)) {
      parseParticipations(staffs.trim(), job, staffInfo, nameVariants, partIssues);
    }
  }

  const partsCount = Object.values(staffInfo).reduce(
    (sum, roles) => sum + Object.values(roles).filter((eps) => eps.length).length,
    0,
  );

  return {
    staffInfo,
    unknownRoles: [...unknownRoles],
    skippedRoles,
    allRows,
    typeLabel,
    partIssues,
    partsCount,
    nameVariants,
  };
}

/**
 * 逐段解析段尾 `某人 (1, 3-5)` 形式的手写参与，覆盖基线的空数组，
 * 无参与段维持只关联；`credited[本名]` 方括号别名剥为候选拼写
 */
function parseParticipations(text, job, staffInfo, nameVariants, issues) {
  for (const seg of text.split('、')) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    const m = TRAILING_PARTS_RE.exec(trimmed);
    if (!m) continue;
    const isEpLabel = EP_LABEL_ONLY_RE.test(m[1].trim());
    if (!/\d/.test(m[1]) && !isEpLabel) continue;

    let name = trimmed.slice(0, m.index).trim();
    const variants = [];
    while (/\([^()]*\)$/.test(name)) {
      name = name.replace(/\([^()]*\)$/, '').trim();
    }
    while (/\[[^[\]]*\]$/.test(name)) {
      const alias = name.match(/\[([^[\]]*)\]$/)[1].trim();
      name = name.replace(/\[[^[\]]*\]$/, '').trim();
      if (alias && !EP_MARKER_RE.test(alias)) variants.unshift(alias);
    }
    if (!name && variants.length) name = variants.shift();
    if (!name) {
      issues.push({ job, text: trimmed, reason: '未解析到人名' });
      continue;
    }

    const parts = m[1].replaceAll('/', ',').replaceAll('，', ',').replaceAll(' ', '');
    if (!PARTS_FORMAT_RE.test(parts) && !isEpLabel) {
      issues.push({ job, text: trimmed, reason: '参与格式可能不符，需复查' });
    }
    const eps = parseAppearEps(parts);
    if (!eps.length) {
      issues.push({ job, text: trimmed, reason: '未解析到集数' });
      continue;
    }

    (staffInfo[name] ||= {})[job] ||= [];
    for (const ep of eps) {
      if (!staffInfo[name][job].includes(ep)) staffInfo[name][job].push(ep);
    }
    if (variants.length) {
      const known = (nameVariants[name] ||= []);
      for (const variant of variants) {
        if (!known.includes(variant)) known.push(variant);
      }
    }
  }
}
