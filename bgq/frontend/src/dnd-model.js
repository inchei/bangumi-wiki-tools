import {
  ctxFieldConfigs,
  CTX_EPISODE,
  CTX_SUBJECT,
  CTX_STAFF_PERSON,
  CTX_CHARACTER,
  EPISODE_FIELDS,
  EPISODE_FIELD_LABELS,
  isPersonCtx,
} from "./stores.js";

const COND_KINDS = [
  "field",
  "tag",
  "meta_tag",
  "global",
  "type",
  "relation",
  "person_relation",
  "character_relation",
  "person_character",
  "person_cast_subject",
  "subject_cast",
  "character_person",
  "character",
  "staff",
  "episode",
];

export function getConditionKind(item) {
  for (const k of COND_KINDS) if (item?.[k]) return k;
  return null;
}

export function getConditionTypeOptions(ctx, qTarget) {
  const opts = [];
  if (ctx === CTX_EPISODE) {
    for (const f of EPISODE_FIELDS)
      opts.push({ value: "ep_" + f, label: EPISODE_FIELD_LABELS[f] });
  } else if (ctx === CTX_CHARACTER) {
    opts.push({ value: "field", label: "字段" });
    opts.push({ value: "global", label: "全局" });
    const cfc = ctxFieldConfigs(ctx);
    for (const k in cfc) opts.push({ value: k, label: cfc[k].label });
    if (qTarget === "character") {
      opts.push({ value: "character_relation", label: "角色关系" });
      opts.push({ value: "character_person", label: "人物" });
      opts.push({ value: "character", label: "条目" });
    }
  } else if (isPersonCtx(ctx)) {
    opts.push({ value: "field", label: "字段" });
    opts.push({ value: "global", label: "全局" });
    const pfc = ctxFieldConfigs(ctx);
    for (const k in pfc) opts.push({ value: k, label: pfc[k].label });
    if (ctx === CTX_STAFF_PERSON) {
      opts.push({ value: "appear_eps", label: "参与" });
    }
    if (qTarget === "person") {
      opts.push({ value: "person_relation", label: "人物关系" });
      opts.push({ value: "person_character", label: "角色" });
      opts.push({ value: "person_cast_subject", label: "出演作品" });
    }
    opts.push({ value: "staff", label: "条目" });
  } else {
    opts.push({ value: "field", label: "字段" });
    const fc = ctxFieldConfigs(ctx);
    for (const k in fc) opts.push({ value: k, label: fc[k].label });
    opts.push({ value: "tag", label: "标签" });
    opts.push({ value: "meta_tag", label: "公共标签" });
    opts.push({ value: "global", label: "全局" });
    if (qTarget === "subject") {
      opts.push({ value: "relation", label: "条目关系" });
      opts.push({ value: "character", label: "角色" });
      opts.push({ value: "episode", label: "剧集" });
      opts.push({ value: "subject_cast", label: "出演" });
    }
    opts.push({
      value: "staff",
      label: qTarget === "person" ? "条目" : "人物",
    });
  }
  return opts;
}

export function isConditionAllowedInGroup(item, ctx, qTarget) {
  if (!item || typeof item !== "object" || item._pendingDelete) return false;
  if (item.logic) {
    const kids = (item.logic.items || []).filter((c) => !c._pendingDelete);
    return kids.every((c) => isConditionAllowedInGroup(c, ctx, qTarget));
  }
  const kind = getConditionKind(item);
  if (!kind) return false;
  if (ctx === CTX_EPISODE) {
    return kind === "field" && EPISODE_FIELDS.includes(item.field?.field);
  }
  if (kind === "field" || kind === "type") return true;
  return getConditionTypeOptions(ctx, qTarget).some((o) => o.value === kind);
}

function fieldDesc(item, ctx) {
  const f = item.field?.field;
  if (!f) return "字段条件";
  if (ctx === CTX_EPISODE) {
    return `字段 ${EPISODE_FIELD_LABELS[f] || f}`;
  }
  const fc = ctxFieldConfigs(ctx || CTX_SUBJECT)?.[f];
  return fc ? `${fc.label}条件` : `字段 ${f}`;
}

const KIND_DESC = {
  tag: (item) => `标签${item.tag?.value ? `「${item.tag.value}」` : ""}`,
  meta_tag: (item) =>
    `公共标签${item.meta_tag?.value ? `「${item.meta_tag.value}」` : ""}`,
  global: (item) =>
    `全局${item.global?.value ? `「${item.global.value}」` : ""}`,
  type: () => "分类",
  relation: () => "条目关系",
  person_relation: () => "人物关系",
  character_relation: () => "角色关系",
  person_character: () => "角色",
  person_cast_subject: () => "出演作品",
  subject_cast: () => "出演",
  character_person: () => "人物",
  character: () => "角色",
  staff: () => "人物",
  episode: () => "剧集",
};

export function describeItem(item, ctx) {
  if (!item || typeof item !== "object") return "条件";
  if (item.logic) {
    const op = (item.logic.op || "and").toUpperCase();
    return `${op} 条件组`;
  }
  const kind = getConditionKind(item);
  if (kind === "field") return fieldDesc(item, ctx);
  return KIND_DESC[kind]?.(item) || "条件";
}
