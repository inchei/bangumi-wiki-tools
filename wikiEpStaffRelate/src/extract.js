import { regexes_per, regexes_role_per, regexes_role, regex_sym } from './regexes.js';

/**
 * 从动画章节简介中提取制作人员信息
 * @param {Record<string, string>} epDescs - 章节数据，键为集数名（如 "1"），值为简介文本
 * @returns {[
 *   Record<string, Record<string, string[]>>,
 *   string[]
 * ]} [制作人员信息：{ 人物名称: { 职位名称: [对应集数名数组] } }, 未匹配到任何人员的集数名数组]
 */
export function extractStaffInfo(epDescs) {
  const result = {};
  const noStaffEps = [];

  for (const [epLabel, desc] of Object.entries(epDescs)) {
    let processedDesc = desc.replaceAll('\r', '').replaceAll(regex_sym, '、');

    // 按正则表达式位置排序，确保先匹配长的职位名称
    const regexes = Object.entries(regexes_per).sort((a, b) => {
      const posA = processedDesc.search(a[1]);
      const posB = processedDesc.search(b[1]);
      return posA < 0 ? 1 : posB < 0 ? -1 : posA - posB;
    });

    const episodeStaff = {};
    regexes.forEach(([role, regex]) => {
      const matches = processedDesc.match(regex);

      // 清理之前已匹配的人员名称中的职位前缀
      for (const existingRole in episodeStaff) {
        episodeStaff[existingRole] = episodeStaff[existingRole].map((name) => {
          const replaced = trimCommas(name.replaceAll(regexes_role_per[role], ''));
          if (replaced[0] !== name[0]) {
            return trimCommas(name.replaceAll(regexes_role[role], ''));
          } else {
            return replaced;
          }
        });
      }

      episodeStaff[role] = [];
      if (matches) {
        episodeStaff[role] = matches.map((name) => trimCommas(name));
      }
    });

    regexes.forEach(([role]) => {
      for (const existingRole in episodeStaff) {
        episodeStaff[existingRole] = episodeStaff[existingRole].map((name) => {
          const replaced = trimCommas(name.replaceAll(regexes_role_per[role], ''));
          if (replaced[0] !== name[0]) {
            return trimCommas(name.replaceAll(regexes_role[role], ''));
          } else {
            return replaced;
          }
        });
      }
    });

    for (const role in episodeStaff) {
      const seenNames = new Set();
      const newStaffList = [];

      for (const name of episodeStaff[role]) {
        if (!name || name.trim() === '') continue;

        // 定义三类分隔符
        const separatorGroups = [
          ['、', ',', '，', '､'], // 第一类：始终作为分隔符
          ['・', '•', '·', '･'], // 第二类：前后不都是preservedchar时作为分隔符
          ['　', ' '], // 第三类：空格
        ];

        let currentNames = [name.trim()];

        // 按优先级处理三类分隔符
        for (let groupIndex = 0; groupIndex < separatorGroups.length; groupIndex++) {
          const separators = separatorGroups[groupIndex];
          const newNames = [];

          for (const currentName of currentNames) {
            // 如果当前名称已经被分割过（不是原始名称），且不是第一组分隔符，则跳过
            if (groupIndex > 0 && currentNames.length > 1) {
              newNames.push(currentName);
              continue;
            }

            // 对于空格分隔符，检查长度条件
            if (groupIndex === 2) {
              const japaneseRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]/;
              const hasJapaneseCharacters = japaneseRegex.test(currentName);
              const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(currentName);

              // 检查是否满足空格分割的长度条件
              const shouldSplitBySpace =
                hasJapaneseCharacters &&
                (hasKana ? currentName.length > 10 : currentName.length > 7);

              if (!shouldSplitBySpace) {
                newNames.push(currentName);
                continue;
              }
            }

            let tempName = '';
            const splitResult = [];
            let hasValidSeparator = false; // 标记是否有不满足跳过条件的分隔符

            for (let i = 0; i < currentName.length; i++) {
              const char = currentName[i];
              const prevChar = i > 0 ? currentName[i - 1] : '';
              const nextChar = i < currentName.length - 1 ? currentName[i + 1] : '';

              const isSeparator = separators.includes(char);

              if (isSeparator) {
                // 对于第一组分隔符，始终分割
                if (groupIndex === 0) {
                  if (tempName.trim()) {
                    splitResult.push(trimCommas(tempName));
                  }
                  tempName = '';
                  hasValidSeparator = true;
                } else if (groupIndex === 1) {
                  // 对于第二组分隔符，检查上下文
                  const isEnglishContext =
                    (isPreservedChar(prevChar) || !prevChar) &&
                    (isPreservedChar(nextChar) || !nextChar);

                  if (!isEnglishContext) {
                    // 非英文上下文，进行分割
                    if (tempName.trim()) {
                      splitResult.push(trimCommas(tempName));
                    }
                    tempName = '';
                    hasValidSeparator = true; // 标记有不满足跳过条件的分隔符
                  } else {
                    // 英文上下文，保留分隔符
                    tempName += char;
                  }
                } else if (groupIndex === 2) {
                  // 对于第三组分隔符（空格），检查上下文
                  const isEnglishContext = isPreservedChar(prevChar) && isPreservedChar(nextChar);

                  if (!isEnglishContext) {
                    // 非英文上下文，进行分割
                    if (tempName.trim()) {
                      splitResult.push(trimCommas(tempName));
                    }
                    tempName = '';
                  } else {
                    // 英文上下文，保留空格
                    tempName += char;
                  }
                }
              } else {
                tempName += char;
              }
            }

            // 添加最后一个名称片段
            if (tempName.trim()) {
              splitResult.push(trimCommas(tempName));
            }

            // 如果没有被分割，保持原样
            if (splitResult.length === 0) {
              newNames.push(currentName);
            } else {
              // 空格拆分后，合并被空格拆散的汉字姓名（如 赵 小玲 → 赵小玲，梅田 香 → 梅田香）
              if (groupIndex === 2) {
                const cjk1 = (t) => t.length === 1 && /[\u4e00-\u9fff]/.test(t);
                const han = (t) => /^[\u4e00-\u9fff]+$/.test(t);
                const sc = splitResult.filter((t) => cjk1(t));
                if (sc.length) {
                  const merged = [];
                  for (let i = 0; i < splitResult.length; i++) {
                    const c = splitResult[i];
                    const n = splitResult[i + 1];
                    if (cjk1(c) && n && han(n) && n.length >= 2) {
                      // 1+2: 单汉字姓 + 多字名 → 向前合并
                      merged.push(c + n);
                      i++;
                    } else if (n && cjk1(n) && c.length >= 2 && han(c)) {
                      // 2+1: 多字姓 + 单汉字名 → 向后合并（仅纯汉字）
                      merged.push(c + n);
                      i++;
                    } else if (cjk1(c) && n && cjk1(n)) {
                      // 1+1: 两单汉字 → 合并为一个双字名
                      merged.push(c + n);
                      i++;
                    } else {
                      merged.push(c);
                    }
                  }
                  newNames.push(...merged);
                } else {
                  newNames.push(...splitResult);
                }
              } else {
                newNames.push(...splitResult);
              }

              // 对于第二类分隔符，如果有不满足跳过条件的分隔符，则重新处理所有片段
              if (groupIndex === 1 && hasValidSeparator) {
                // 移除当前名称的所有片段
                newNames.splice(newNames.length - splitResult.length, splitResult.length);

                // 重新处理当前名称，忽略跳过条件
                const reSplitResult = [];
                let reTempName = '';

                for (let i = 0; i < currentName.length; i++) {
                  const char = currentName[i];
                  const isSeparator = separators.includes(char);

                  if (isSeparator) {
                    if (reTempName.trim()) {
                      reSplitResult.push(trimCommas(reTempName));
                    }
                    reTempName = '';
                  } else {
                    reTempName += char;
                  }
                }

                // 添加最后一个名称片段
                if (reTempName.trim()) {
                  reSplitResult.push(trimCommas(reTempName));
                }

                // 添加重新分割的结果
                newNames.push(...reSplitResult.filter((n) => n && n.trim() !== ''));
              }
            }
          }

          currentNames = newNames.filter((n) => n && n.trim() !== '');
        }

        // 添加到最终结果
        currentNames.forEach((singleName) => {
          if (singleName && singleName.trim() !== '') {
            newStaffList.push(singleName.trim());
          }
        });
      }

      // 去重处理
      episodeStaff[role] = newStaffList.filter((name) => {
        if (seenNames.has(name) || !name || name.trim() === '') {
          return false;
        }
        seenNames.add(name);
        return true;
      });
    }

    let hasStaff = false;
    for (const [role, staffList] of Object.entries(episodeStaff)) {
      for (const name of staffList) {
        const staffName = name.replace(
          // eslint-disable-next-line no-irregular-whitespace
          /^([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]{1,4})[ 　]+([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]{1,4})$/g,
          '$1$2',
        );
        result[staffName] ||= {};
        result[staffName][role] ||= [];
        if (!result[staffName][role].includes(epLabel)) {
          result[staffName][role].push(epLabel);
          hasStaff = true;
        }
      }
    }

    if (!hasStaff) noStaffEps.push(epLabel);
  }

  // 返回结果和没有匹配到人员的集数数组
  return [result, noStaffEps];
}

function isPreservedChar(char) {
  return /[a-zA-Z\u30a0-\u30ff\u3005\u30fc]/.test(char);
}

// 辅助函数
function trimCommas(x) {
  if (typeof x === 'string') {
    x = x.trim();
    while (x.startsWith('、')) {
      x = x.replace('、', '').trimStart();
    }
    while (x.endsWith('、')) {
      x = x.split('').reverse().join('').replace('、', '').trimStart().split('').reverse().join('');
    }
  }
  return x;
}
