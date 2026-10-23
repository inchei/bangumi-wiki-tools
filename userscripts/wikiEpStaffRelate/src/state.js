// 职位数据直接取页面全局 crtTypeList（{cn, jp, en, id}）——职位下拉
// genPrsnStaffList 的生成源，option 文本即 “cn / jp(en)”，语义一致。不依赖
// DOM 读取（已关联为空时页面一行都不渲染，#prsnPos_* 不存在）。
// 同名重复职位（助理制片人 23/53、制作助理 24/62）：已关联判断二者皆可；
// 新增选常规项，23 助理制片人（待合并）跳过。
const roleOptions = (typeof crtTypeList === 'undefined' ? [] : crtTypeList)
  .filter((position) => position.cn && position.id)
  .map((position) => ({ value: String(position.id), label: position.cn }));

export const roleValues = roleOptions.reduce((map, { value, label }) => {
  (map[label] ||= []).push(value);
  return map;
}, {});

const MERGE_PENDING = 23;

export const roleIdMap = roleOptions.reduce((map, { value, label }) => {
  if (value == MERGE_PENDING) return map;
  map[label] ??= value;
  return map;
}, {});

// Duplicate labels with more than one regular option (制作助理): which option
// is the target is a guess, default to the first one and warn in the tip box.
export const ambiguousRoleLabels = new Set(
  Object.entries(roleValues)
    .filter(([, values]) => values.filter((v) => v != MERGE_PENDING).length > 1)
    .map(([label]) => label),
);

export const staffSet = new Set(),
  repeatSet = new Set();
// name-role pairs newly related under an ambiguous duplicate label (制作助理):
// the linked option may not be the target one, warn in the tip box.
export const ambiguousRoleSet = new Set();
export const bgmIdMap = {
  KADOKAWA: 19306,
  斉藤壮馬: 14604,
  週刊ビッグコミックスピリッツ: 7620,
  あきやまえんま: 30863,
  しづ: 12529,
  タチ: 12008,
  優: 18233,
  ホリ: 46769,
  Koi: 13864,
  KEI: 8295,
  tomomi: 45315,
  はらだ: 16346,
  LAM: 40914,
  lack: 30250,
  Ruki: 90718,
  ヒロユキ: 3404,
  かわく: 90716,
  あきやま: 30863,
  さと: 14236,
  かおり: 14760,
  NON: 10778,
  うめ: 8559,
  すか: 16242,
  フライ: 28795,
};
export const failedRequests = new Map();
export const failedKeywords = new Set();
export const unmatchedKeywords = new Set();
export const RETRY_INTERVAL = 500;
export const MAX_RETRIES = 3;
