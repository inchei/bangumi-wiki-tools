import { get } from "svelte/store";
import { getFiltersForAPI } from "@/logic-tree.js";
import { collectRegexErrors } from "@/regex-check.js";
import { highlightPatterns, deriveHighlightPatterns } from "@/highlight.js";
import { runQuery } from "@/api.js";
import {
  queryTarget,
  lastResult,
  lastQueryTarget,
  queryLoading,
  outputColumns,
  sortRules,
  sortState,
  resultLimit,
  assocLimit,
  announce,
} from "@/stores.js";

export async function executeQuery(setLoading) {
  const filters = getFiltersForAPI();
  const sort = get(sortRules).filter((r) => r.field);
  if (filters.length === 0 && sort.length === 0) {
    lastResult.set({ error: "请先添加筛选条件或排序" });
    announce("请先添加筛选条件或排序");
    return;
  }
  try {
    const regexIssues = await collectRegexErrors(filters);
    if (regexIssues.length) {
      const issue = regexIssues[0];
      const error = `正则错误：${JSON.stringify(issue.pattern)}：${issue.message}`;
      lastResult.set({ error });
      announce(`查询失败，${error}`);
      return;
    }
  } catch (e) {
    const error = `正则校验失败：${e.message}`;
    lastResult.set({ error });
    announce(`查询失败，${error}`);
    return;
  }
  setLoading(true);
  queryLoading.set(true);
  lastResult.set(null);
  announce("查询中");
  const cols =
    get(outputColumns)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) || [];
  const limit = Number(get(resultLimit));
  const al = Number(get(assocLimit));
  try {
    const savedTarget = get(queryTarget);
    const data = await runQuery(
      filters,
      cols,
      savedTarget,
      limit,
      sort.length > 0 ? sort : undefined,
      al,
    );
    lastQueryTarget.set(savedTarget);
    lastResult.set(data);
    highlightPatterns.set(deriveHighlightPatterns(filters));
    // Sync sort state to match the first sort rule if its field is in the result
    // columns (also matching group-column sub-fields like 导演.生日+ ↔
    // 导演.{name|生日|id}+).
    if (sort.length > 0 && data?.columns) {
      const f = sort[0].field;
      let colIdx = data.columns.indexOf(f);
      let field = "";
      if (colIdx < 0) {
        // "导演.生日" ↔ 导演.{name|生日|id}；"CV.s.date" 的子字段名带 s. 前缀
        const m =
          f.match(/^(.+)\.s\.([^.{}]+)$/) || f.match(/^(.+)\.([^.{}]+)$/);
        if (m) {
          const prefix = m[1];
          const sub = f.includes(".s.") ? "s." + m[2] : m[2];
          colIdx = data.columns.findIndex((c) => {
            const gm = c.match(/^(.+)\.\{([^}]+)\}$/);
            if (!gm || gm[1] !== prefix) return false;
            return gm[2]
              .split("|")
              .map((s) => s.trim())
              .includes(sub);
          });
          if (colIdx >= 0) field = sub;
        }
      }
      if (colIdx >= 0) {
        sortState.set({
          col: colIdx,
          asc: sort[0].direction === "asc",
          field,
        });
      }
    }
  } catch (e) {
    lastResult.set({ error: e.message });
    announce(`查询失败，${e.message}`);
  } finally {
    setLoading(false);
    queryLoading.set(false);
  }
}
