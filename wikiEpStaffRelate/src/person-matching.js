import { roleIdMap, roleValues } from './state.js';
import { personAliasFallbackBatch } from './aliases.js';
import { getConvertedNames } from './opencc.js';
import { normalize, autoSearchAndRelate, recolorRepeatRows } from './search.js';
import { epsCache } from './ep.js';
import { parseAppearEps, genAppearEps } from './appear-eps.js';
import { createDraggableTipBox } from './tip-box.js';

export async function updAppearEps(
  staffInfo,
  noStaffEps,
  {
    summary,
    progress = '解析参与中',
    indicatorId = 'epDescStaff',
    skipRoleMissing = false,
    infoboxIssues = [],
    nameVariants = {},
  } = {},
) {
  const groupedRecords = {
    new: {}, // 本次新增的参与记录
    existing: {}, // 已存在的参与记录
    unmatched: {}, // 未匹配记录
  };
  const oldLis = [...document.querySelectorAll('#crtRelateSubjects li')];

  const allEpLabels = new Set();
  const roleEpMap = {};

  const indicator = document.querySelector(`#${indicatorId}`);
  const staffInfoEntries = Object.entries(staffInfo);
  const total = staffInfoEntries.length;
  let i = 0;
  for (const [originalName, roles] of staffInfoEntries) {
    i++;
    indicator.textContent = `${progress}（${i}/${total}）……`;
    for (const [role, epLabels] of Object.entries(roles)) {
      epLabels.forEach((ep) => allEpLabels.add(ep));
      if (!roleEpMap[role]) roleEpMap[role] = new Set();
      epLabels.forEach((ep) => roleEpMap[role].add(ep));

      const roleId = roleIdMap[role];
      if (!roleId) continue;

      let aliased = false;
      const roleIdList = roleValues[role] || [roleId];
      const sameRole = (li) => roleIdList.includes(li.querySelector('select').value);
      const sameName = (name) => (li) => {
        const liName = li.querySelector('.title a').textContent;
        return normalize(liName) === normalize(name);
      };
      const similarName = (name) => (li) => {
        const liName = li.querySelector('.title a').textContent;
        return isSimilarOrContained(normalize(name), normalize(liName));
      };
      const sameId = (id) => (li) => {
        const liId = li.querySelector('.title a').href.split('/').pop();
        return liId == id;
      };
      const matchOldLi = (name) => oldLis.find((li) => sameName(name)(li) && sameRole(li));

      let matchedLiFuzzy;
      const memOldLiFuzzy = (name) =>
        (matchedLiFuzzy ||= oldLis.find((li) => similarName(name)(li) && sameRole(li)));
      let matchedLi,
        name = originalName;

      async function* candidateNames() {
        const yielded = new Set([originalName]);
        const yieldUnique = (v) => {
          if (yielded.has(v)) return false;
          yielded.add(v);
          return true;
        };

        yield originalName;
        aliased = true;

        // infobox 手写变体（`credited[本名]`）先于别名库与繁简转换尝试
        for (const variant of nameVariants[originalName] || []) {
          if (yieldUnique(variant)) yield variant;
        }

        const variants = await getConvertedNames(originalName);
        const aliasMap = await personAliasFallbackBatch([originalName, ...variants]);

        for (const a of aliasMap[originalName] || []) {
          if (yieldUnique(a.name)) yield a.name;
        }

        for (const name of variants) {
          if (yieldUnique(name)) yield name;
        }
        for (const name of variants) {
          for (const a of aliasMap[name] || []) {
            if (yieldUnique(a.name)) yield a.name;
          }
        }
      }

      for await (const candidate of candidateNames()) {
        matchedLi = matchOldLi(candidate);
        if (!matchedLi) {
          memOldLiFuzzy(candidate);
          continue;
        }
        name = candidate;
        break;
      }
      if (!matchedLi) {
        if (matchedLiFuzzy) {
          matchedLi = matchedLiFuzzy;
          name = matchedLi.querySelector('.title a').textContent;
          aliased = true;
        }
      }

      let matchedLis;
      if (!matchedLi) {
        aliased = false;
        for await (const candidate of candidateNames()) {
          const searchResult = await autoSearchAndRelate(candidate, role);
          if (!searchResult) continue;
          const { ids, name: resultName } = searchResult;
          const newLiList = [...document.querySelectorAll('#crtRelateSubjects li:not(.old)')];

          if (ids.length === 1) {
            matchedLi = newLiList.find((li) => sameId(ids[0])(li) && sameRole(li));
          } else {
            matchedLis = newLiList.filter((li) => ids.some((id) => sameId(id)(li)) && sameRole(li));
          }

          if (name !== resultName) aliased = true;
          name = resultName;
          break;
        }
      }
      // 面板记录按「normalize 后的源名 + 职位」合并：同一条源名经多轮
      // 解析落到的行归入同一条记录，[] 前可把用到的别名一并列出
      let groupKey = `${normalize(originalName)}-${role}`;
      // liId 以 originalName 为准：同一条源信息（描述/infobox 那行）是稳定
      // 值，别名解析出的行、落到不同 bgm 人物的重名行共用同一 id，重名涂色
      // 靠它分组；tryReSplit 内部按拆分 token 另行赋值，拆出的不同人不并组
      let liId = `staff-${originalName.replace(/\s/g, '')}-${role.replace(/\s/g, '')}`;

      if (matchedLi) {
        handleMatched(matchedLi);
      } else if (matchedLis) {
        matchedLis.forEach(handleMatched);
      } else if (await tryReSplit()) {
        // handled by tryReSplit
      } else {
        groupedRecords.unmatched[groupKey] ||= {
          name: originalName,
          role,
          epLabels: new Set(epLabels),
        };
      }

      async function tryReSplit() {
        const trySearch = async (token) => {
          const sr = await autoSearchAndRelate(token, role);
          if (!sr) return null;
          const { ids, name: resultName } = sr;
          const allLis = [...document.querySelectorAll('#crtRelateSubjects li')];
          const li = allLis.find((l) => ids.some((id) => sameId(id)(l)) && sameRole(l));
          return li ? { name: resultName, li } : null;
        };

        // 1. 按空格重新拆分（仅对含 CJK/假名的 token，排除纯英文）
        // eslint-disable-next-line no-irregular-whitespace
        if (/[ 　]/.test(originalName)) {
          // eslint-disable-next-line no-irregular-whitespace
          const tokens = originalName.split(/[ 　]+/).filter(Boolean);
          const cjkTokens = tokens.filter((t) =>
            /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]/.test(t),
          );
          if (cjkTokens.length > 1) {
            const matched = [];
            for (const token of cjkTokens) {
              let li = matchOldLi(token);
              if (li) {
                matched.push({ name: token, li, token });
                continue;
              }
              const sr = await trySearch(token);
              if (sr) {
                matched.push({ name: sr.name, li: sr.li, token });
              }
            }
            if (matched.length) {
              for (const m of matched) {
                name = m.name;
                groupKey = `${normalize(m.name)}-${role}`;
                liId = `staff-${m.name.replace(/\s/g, '')}-${role.replace(/\s/g, '')}`;
                handleMatched(m.li);
              }
              const matchedSet = new Set(matched.map((m) => m.token));
              const rest = cjkTokens.filter((t) => !matchedSet.has(t));
              if (rest.length) {
                const restName = rest.join(' ');
                groupedRecords.unmatched[`${restName}-${role}`] ||= {
                  name: restName,
                  role,
                  epLabels: new Set(epLabels),
                };
              }
              return true;
            }
          }
        }
        // 2. 按软分隔符重新拆分（原始拆分可能因英文上下文而保留）
        if (/[・•·･]/.test(originalName)) {
          const tokens = originalName.split(/[・•·･]+/).filter(Boolean);
          const matched = [];
          for (const token of tokens) {
            let li = matchOldLi(token);
            if (li) {
              matched.push({ name: token, li, token });
              continue;
            }
            const sr = await trySearch(token);
            if (sr) {
              matched.push({ name: sr.name, li: sr.li, token });
            }
          }
          if (matched.length) {
            for (const m of matched) {
              name = m.name;
              groupKey = `${m.name}-${role}`;
              liId = `staff-${m.name.replace(/\s/g, '')}-${role.replace(/\s/g, '')}`;
              handleMatched(m.li);
            }
            const matchedSet = new Set(matched.map((m) => m.token));
            const rest = tokens.filter((t) => !matchedSet.has(t));
            if (rest.length) {
              const restName = rest.join('・');
              groupedRecords.unmatched[`${restName}-${role}`] ||= {
                name: restName,
                role,
                epLabels: new Set(epLabels),
              };
            }
            return true;
          }
        }
        // 3. 从原文复原空格边界后拆分（extractStaffInfo 末尾合并了 CJK 姓名间的空格）
        {
          const desc = epsCache?.[epLabels[0]]?.desc || '';
          if (desc) {
            const esc = originalName
              .split('')
              .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('\\s*');
            const m = desc.match(new RegExp(esc));
            if (m && /\s/.test(m[0])) {
              const parts = m[0].split(/\s+/).filter(Boolean);
              // 若有段落是单个汉字（如拆出了姓），说明是中文姓名内空格，不应拆分
              if (
                parts.length > 1 &&
                !parts.some((p) => p.length === 1 && /[\u4e00-\u9fff]/.test(p))
              ) {
                const matched = [];
                for (const part of parts) {
                  let li = matchOldLi(part);
                  if (!li) {
                    const sr = await trySearch(part);
                    if (sr) li = sr.li;
                  }
                  if (li) matched.push({ name: part, li });
                }
                if (matched.length) {
                  aliased = false;
                  for (const m2 of matched) {
                    name = m2.name;
                    groupKey = `${normalize(m2.name)}-${role}`;
                    liId = `staff-${m2.name.replace(/\s/g, '')}-${role.replace(/\s/g, '')}`;
                    handleMatched(m2.li);
                  }
                  const matchedSet = new Set(matched.map((m2) => m2.name));
                  const rest = parts.filter((p) => !matchedSet.has(p));
                  if (rest.length) {
                    const restName = rest.join(' ');
                    groupedRecords.unmatched[`${restName}-${role}`] ||= {
                      name: restName,
                      role,
                      epLabels: new Set(epLabels),
                    };
                  }
                  return true;
                }
              }
            }
          }
        }
        return false;
      }

      function handleMatched(matchedLi) {
        // 行 id 首次盖章后复用：同一行被不同源名（原名/别名拼写）先后匹配时，
        // 不能让后来者覆盖 id，否则早建的记录锚点会漂到错误位置
        matchedLi.id ||= liId;

        // 以别名匹配到的新增关联行加淡蓝色背景，便于核对非原名条目
        if (aliased && !matchedLi.classList.contains('old')) {
          matchedLi.classList.add('staff-alias-li');
        }

        // 来源原名记到行上，供行侧「定位面板」按钮的 tooltip 展示
        if (aliased) {
          const names = matchedLi.dataset.aliasOrigin
            ? matchedLi.dataset.aliasOrigin.split('\n')
            : [];
          if (!names.includes(originalName)) names.push(originalName);
          matchedLi.dataset.aliasOrigin = names.join('\n');
        }

        // 不填写参与的关联（如 infobox 生成的通用 JSON）：只记录，不动 appear_eps
        if (!epLabels.length) {
          const targetGroup = matchedLi.classList.contains('old') ? 'existing' : 'new';
          const record = (groupedRecords[targetGroup][groupKey] ||= {
            name,
            names: [],
            role,
            epLabels: new Set(),
            aliases: {},
            liId,
            personIds: [],
            sourceNorms: [],
          });
          // 匹配名以行为准（行标题即 bgm 规范名），多次命中去重并列
          const canonicalName = matchedLi.querySelector('.title a').textContent;
          if (!record.names.includes(canonicalName)) record.names.push(canonicalName);
          const personId = matchedLi.querySelector('.title a').href.split('/').pop();
          if (!record.personIds.includes(personId)) record.personIds.push(personId);
          const sourceNorm = normalize(originalName);
          if (!record.sourceNorms.includes(sourceNorm)) record.sourceNorms.push(sourceNorm);
          // [] 里登记别名方式解出的源名（originalName）；纯原名匹配不进括号
          if (aliased) record.aliases[originalName] ||= [];
          return;
        }

        const input = matchedLi.querySelector('[name$="[appear_eps]"]');
        const existingSet = new Set(parseAppearEps(input.value));

        const labelsToAdd = [];

        for (const epLabel of epLabels) {
          const wasExisting = existingSet.has(epLabel);

          if (!wasExisting) {
            labelsToAdd.push(epLabel);
            if (matchedLi.classList.contains('old')) {
              matchedLi.classList.add('staff-changed-li');
            }
          }

          const targetGroup = wasExisting ? 'existing' : 'new';
          const record = (groupedRecords[targetGroup][groupKey] ||= {
            name,
            names: [],
            role,
            epLabels: new Set(),
            aliases: {},
            liId,
            personIds: [],
            sourceNorms: [],
          });
          record.epLabels.add(epLabel);
          // 行身份：与人 id（同行合并线索）和 normalize 源名（同名合并线索）
          const personId = matchedLi.querySelector('.title a').href.split('/').pop();
          if (!record.personIds.includes(personId)) record.personIds.push(personId);
          const canonicalName = matchedLi.querySelector('.title a').textContent;
          if (!record.names.includes(canonicalName)) record.names.push(canonicalName);
          const sourceNorm = normalize(originalName);
          if (!record.sourceNorms.includes(sourceNorm)) record.sourceNorms.push(sourceNorm);
          // [] 里登记别名解出的源名；纯原名匹配的条目不进括号
          if (aliased) {
            record.aliases[originalName] ||= [];
            record.aliases[originalName].push(epLabel);
          }
        }

        if (labelsToAdd.length) {
          input.value = genAppearEps([...existingSet, ...labelsToAdd]);
        }
      }
    }
  }

  // infobox 参与不要求覆盖全季
  const roleMissingEps = {};
  if (!skipRoleMissing) {
    Object.entries(roleEpMap).forEach(([role, presentEps]) => {
      const missingEps = [];
      allEpLabels.forEach((ep) => {
        if (!presentEps.has(ep)) {
          missingEps.push(ep);
        }
      });
      if (missingEps.length && missingEps.length < allEpLabels.size) {
        roleMissingEps[role] = missingEps;
      }
    });
  }

  // handleMatched 只是给已存在/新建行补盖章（id、alias class），期间可能
  // 没有任何建行/删行事件，重名涂色不会随行落位自动触发，收尾统一重算
  recolorRepeatRows();

  createDraggableTipBox(
    formatRecords(groupedRecords.new),
    formatRecords(groupedRecords.existing),
    formatRecords(groupedRecords.unmatched),
    noStaffEps,
    roleMissingEps,
    infoboxIssues,
  );

  const editSummaryInput = document.querySelector('#editSummary');
  editSummaryInput.value =
    summary ?? `根据${new URLSearchParams(location.search).get('source') || ''}章节简介填写参与`;
}

// function addRelatedPerson({ id, name }, roleId) {
//     subjectList[id] = { id, name, url_mod: 'person' }
//     addRelateSubject(id, 'submitForm');
//     $('#crtRelateSubjects select').eq(0).val(roleId);
// }

// 渲染前合并同一身份的记录：共用 person id（原名与别名解到同一行）或
// 同一 normalize 源名（同一条源名解到多行）都归并成一条，
// 各源名的集数 tooltip、行身份线索随之并入。
// unmatched 分支的记录没有身份字段，全部按空数组兜底
function mergeRecords(records) {
  const merged = [];
  for (const item of Object.values(records)) {
    const itemPersonIds = item.personIds || [];
    const itemSourceNorms = item.sourceNorms || [];
    const target = merged.find(
      (m) =>
        m.role === item.role &&
        ((m.personIds || []).some((p) => itemPersonIds.includes(p)) ||
          (m.sourceNorms || []).some((n) => itemSourceNorms.includes(n))),
    );
    if (!target) {
      merged.push(item);
      continue;
    }
    target.personIds ||= [];
    target.sourceNorms ||= [];
    target.names ||= [];
    for (const p of itemPersonIds) if (!target.personIds.includes(p)) target.personIds.push(p);
    for (const n of itemSourceNorms)
      if (!target.sourceNorms.includes(n)) target.sourceNorms.push(n);
    for (const n of item.names || []) if (!target.names.includes(n)) target.names.push(n);
    item.epLabels.forEach((ep) => target.epLabels.add(ep));
    for (const [alias, eps] of Object.entries(item.aliases || {})) {
      target.aliases[alias] ||= [];
      target.aliases[alias].push(...eps);
    }
  }
  return merged;
}

function formatRecords(records) {
  const merged = mergeRecords(records);
  const processedRecords = merged.map((item) => ({
    ...item,
    epLabels: Array.from(item.epLabels).sort((a, b) => {
      const typeOrder = { '': 0, SP: 1, OP: 2, ED: 3 };
      const aType = a.match(/^(SP|OP|ED)/)?.[0] || '';
      const bType = b.match(/^(SP|OP|ED)/)?.[0] || '';
      if (aType !== bType) return typeOrder[aType] - typeOrder[bType];
      const aNum = parseFloat(a.replace(/[A-Za-z]/g, '')) || 0;
      const bNum = parseFloat(b.replace(/[A-Za-z]/g, '')) || 0;
      return aNum - bNum;
    }),
  }));

  return processedRecords.sort((a, b) => {
    if (a.role === undefined || a.role === null) return -1;
    if (b.role === undefined || b.role === null) return 1;
    return a.role.localeCompare(b.role);
  });
}

function isSimilarOrContained(str1, str2) {
  if (!str1 || !str2) return false;

  str1 = str1.trim();
  str2 = str2.trim();

  // 包含关系
  if (str2.includes(str1)) {
    return true;
  }

  // 长度差大于1，直接返回false
  if (Math.abs(str1.length - str2.length) > 1) {
    return false;
  }

  // 计算差异字符数
  let diff = 0;
  for (let i = 0, j = 0; i < str1.length && j < str2.length; i++, j++) {
    if (str1[i] !== str2[j]) {
      diff++;
      if (diff > 1) return false;
      if (str1.length > str2.length)
        j--; // str1更长，str2指针回退
      else if (str1.length < str2.length) i--; // str2更长，str1指针回退
    }
  }

  return diff <= 1;
}
