# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "bgm-tv-wiki",
# ]
# ///
import json
import re
import unicodedata
from bgm_tv_wiki import parse

# 匹配括号及内容的正则表达式（支持中英文括号）
BRACKET_PATTERN = re.compile(r'([\(（])(.*?)([\)）])')

# 公司全名中的地名限定词（如 某某（北京）有限公司），不应作为别名
PLACE_NAMES = {
    '北京', '上海', '天津', '重庆', '宁德',
    '河北', '石家庄', '唐山', '山西', '太原', '内蒙古', '呼和浩特',
    '辽宁', '沈阳', '大连', '吉林', '长春', '黑龙江', '哈尔滨',
    '江苏', '南京', '苏州', '无锡', '浙江', '杭州', '宁波',
    '安徽', '合肥', '福建', '福州', '厦门', '江西', '南昌',
    '山东', '济南', '青岛', '河南', '郑州', '湖北', '武汉',
    '湖南', '长沙', '广东', '广州', '深圳', '广西', '南宁',
    '海南', '海口', '四川', '成都', '贵州', '贵阳', '云南', '昆明',
    '西藏', '拉萨', '陕西', '西安', '甘肃', '兰州', '青海', '西宁',
    '宁夏', '银川', '新疆', '乌鲁木齐', '香港', '澳门', '台湾', '台北',
}

# 人名括号里的通用限定词（如 りお（动画人）、龟山忠义（本名）），并非别名
GENERIC_QUALIFIERS = {
    '动画人', '动画师', '漫画家', '声优', '演员', '歌手',
    '作曲家', '作词家', '编剧', '脚本家', '演出家', '导演', '监督',
    '原画', '原画师', '音乐人', '制作人', '制片人', '画师', '插画家',
    '小说家', '作家', '偶像', '主播', '配音员', '旁白', '主持人',
    '艺人', '模特', '舞者',
    '本名', '全名', '旧芸名', '旧名', '曾用名', '前身', '误记', '误译',
    '同人社团', '微博', '港', '台', '?', '？',
}

def process_brackets(text, is_primary_name):
    """
    处理文本中的括号内容
    :param text: 原始文本
    :param is_primary_name: 是否为"简体中文名"来源
    :return: 处理后的主文本和括号内内容列表
    """
    if not text:
        return text, []

    brackets = []
    # 查找所有括号及内容
    matches = BRACKET_PATTERN.findall(text)
    if matches:
        for left, content, right in matches:
            content = content.strip()
            # 地名括号与通用限定词不作为别名
            if content and content not in PLACE_NAMES and content not in GENERIC_QUALIFIERS:
                brackets.append(content)
        # 移除所有括号及内容
        text = BRACKET_PATTERN.sub('', text).strip()

    # 如果是简体中文名来源，不返回括号内容作为新别名
    if is_primary_name:
        return text, []
    return text, brackets

NO_SLASH_SPLIT_ALIASES = {"Dios/シグナルP"}

def split_aliases(alias, is_exception_name):
    if alias.strip() in NO_SLASH_SPLIT_ALIASES:
        return [alias.strip()]
    parts = [p.strip() for p in re.split(r'\s*[／/]\s*', alias) if p.strip()]
    if not parts:
        return []
    if is_exception_name:
        return parts
    final_parts, kp = [], re.compile(r'[ァ-ヺ]')
    for part in parts:
        if "＝" not in part:
            final_parts.append(part)
            continue
        sub_parts, temp, i = part.split("＝"), [], 0
        while i < len(sub_parts):
            current = sub_parts[i].strip()
            if not current:
                i +=1
                continue
            if i < len(sub_parts)-1:
                next_part = sub_parts[i+1].strip()
                if next_part:
                    cl = current[-1] if current else ""
                    nf = next_part[0] if next_part else ""
                    if kp.match(cl) and kp.match(nf):
                        temp.append(f"{current}＝{next_part}")
                        i +=2
                        continue
            temp.append(current)
            i +=1
        final_parts.extend(temp)
    return final_parts

def parse_bangumi_person_jsonlines(file_path):
    persons = []  # 人物对象数组
    person_id_to_index = {}  # 人物ID到数组索引的映射
    aliases = {}  # 别名到人物索引的映射

    EXC_NAME = "2C＝がろあ"

    with open(file_path, 'r', encoding='utf-8') as f:
        for ln, line in enumerate(f, 1):
            try:
                jd = json.loads(line.strip())
                en = jd.get('name')
                person_id = jd.get('id')

                if not en or person_id is None:
                    continue

                # 处理人物信息
                if person_id not in person_id_to_index:
                    person_index = len(persons)
                    persons.append([en, person_id])  # 使用数组而不是对象
                    person_id_to_index[person_id] = person_index
                else:
                    person_index = person_id_to_index[person_id]

                is_exc = (en == EXC_NAME)
                ib = jd.get('infobox')
                if not ib:
                    continue

                pr = parse(ib)
                if not pr.fields:
                    continue

                qn = []
                for f in pr.fields:
                    # 处理简体中文名
                    if f.key == '简体中文名' and f.value:
                        cn = str(f.value).strip()
                        if cn:
                            # 处理括号，不将括号内容作为新别名
                            processed_cn, _ = process_brackets(cn, is_primary_name=True)
                            if processed_cn and processed_cn not in qn:
                                qn.append(processed_cn)

                    # 处理别名
                    elif f.key == '别名' and f.value:
                        ais = f.value if isinstance(f.value, tuple) else (f.value,)
                        for item in ais:
                            av = str(item.value).strip() if item.value else ""
                            if av:
                                split_als = split_aliases(av, is_exc)
                                for a in split_als:
                                    if a:
                                        # 处理括号，将括号内容作为新别名
                                        processed_a, bracket_contents = process_brackets(a, is_primary_name=False)
                                        # 添加处理后的主别名
                                        if processed_a and processed_a not in qn:
                                            qn.append(processed_a)
                                        # 添加括号内的内容作为新别名
                                        for bc in bracket_contents:
                                            if bc and bc not in qn:
                                                qn.append(bc)

                # 过滤空值和与原名相同的别名
                # NFKC handles halfwidth katakana (U+FF66-FF9D) -> fullwidth
                # katakana and fullwidth alphanumerics (U+FF21-FF5A) -> ASCII.
                # Source must be UTF-8; requires font covering CJK Unified and
                # Compatibility Ideographs (e.g. 﨑 U+FA11).
                kata_to_hira = str.maketrans({chr(c): chr(c - 0x60) for c in range(0x30A1, 0x30F7)})

                def _norm(s: str) -> str:
                    s = unicodedata.normalize('NFKC', s)
                    return re.sub(r'[\s-]', '', s).translate(kata_to_hira).lower()

                normalized_en = _norm(en)
                qn = [_norm(n) for n in qn if n and n != en and _norm(n) != normalized_en]

                # 将别名映射到人物索引（支持一对多）
                for alias in qn:
                    if alias not in aliases:
                        aliases[alias] = []
                    if person_index not in aliases[alias]:
                        aliases[alias].append(person_index)

            except Exception as e:
                print(f"Line {ln} error: {e}")
                continue

    return [persons, aliases]

if __name__ == "__main__":
    mapping = parse_bangumi_person_jsonlines("bangumi_archive/person.jsonlines")
    with open("person_alias.json", "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, separators=(',', ':'))  # 紧凑格式输出
    print(f"Generated {len(mapping[1])} alias to {len(mapping[0])} persons. Saved to person_alias.json")
