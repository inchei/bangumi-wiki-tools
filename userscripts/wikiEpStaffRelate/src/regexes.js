import { POSITIONS } from './positions.js';
import { FALLBACK_POSITIONS } from './positions.generated.js';

const SEP =
  '(?:\\uff1a|\\u003A|】|\\/|／|·|-、|・|･|、|=|＝|＆|\\u0026|•|♦|◆|■|◎|×|\\[|\\s?\\]|\\s(?![×\\]:：]))';

export const [regexes_per, regexes_role_per, regexes_role] = (() => {
  const per = {},
    rolePer = {},
    role = {};
  const tolerateIWS = (p) => {
    // 只在最后一个 (?: 之后（关键字部分）插入可选全角空格，不动 (?<!...) 等前置断言
    const i = p.lastIndexOf('(?:');
    return i < 0
      ? p
      : p.slice(0, i) +
          p
            .slice(i)
            .replace(/([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc])/g, '$1\\u3000?');
  };
  for (const { name, pattern } of [...POSITIONS, ...FALLBACK_POSITIONS]) {
    const tp = tolerateIWS(pattern);
    const kw = tp + '\\s*?' + SEP;
    const nameCapture = '(\\W|\\w)+?(?=\\n|$|\\s*\\|)';
    per[name] = new RegExp('(?<=[\\u3040-\\u9fa5]*?' + kw + ')' + nameCapture, 'g');
    rolePer[name] = new RegExp(kw + nameCapture, 'g');
    role[name] = new RegExp(kw, 'g');
  }
  return [per, rolePer, role];
})();
export const regex_sym = /[\uff1a\u003A【】（）()/／、、＆\u0026♦◆■=]/g;
