#!/usr/bin/env python3
"""删除动画职位字段中以顿号分隔的重复纯人名，输出 wikiBatch CSV。"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

from find_nested_positions import DEFAULT_POSITIONS, load_positions


FIELD = re.compile(r'^(\|\s*([^=\r\n]+?)\s*=\s*)([^\r\n]*)(\r?\n?)$')


def plain_name(value):
    name = value.strip()
    return (2 <= len(name) <= 8
            and any(unicodedata.name(char, '').startswith('CJK UNIFIED IDEOGRAPH') for char in name)
            and all(unicodedata.category(char)[0] == 'L' or char.isspace() for char in name))


def dedupe_value(value):
    segments = []
    for segment in value.split('；'):
        parts = segment.split('、')
        seen = set()
        kept = []
        for part in parts:
            if plain_name(part):
                if part in seen:
                    continue
                seen.add(part)
            kept.append(part)
        segments.append('、'.join(kept))
    return '；'.join(segments)


def dedupe_infobox(infobox, positions):
    lines = []
    changed = False
    for line in infobox.splitlines(keepends=True):
        match = FIELD.match(line)
        if match and match.group(2).strip() in positions:
            value = dedupe_value(match.group(3))
            if value != match.group(3):
                line = match.group(1) + value + match.group(4)
                changed = True
        lines.append(line)
    return ''.join(lines) if changed else None


def main():
    parser = argparse.ArgumentParser(description='删除动画职位字段内以顿号分隔的重复纯人名，输出 id,infobox CSV')
    parser.add_argument('archive', nargs='?', default='bangumi_archive/subject.jsonlines', help='Archive subject.jsonlines 路径')
    parser.add_argument('--positions', type=Path, default=DEFAULT_POSITIONS, help='bgq 生成的 staff_data.go 路径')
    parser.add_argument('--out', default='duplicate_staff_names.csv', help='输出 CSV 路径')
    args = parser.parse_args()

    positions = load_positions(args.positions)
    count = 0
    with open(args.archive, encoding='utf-8') as source, open(args.out, 'w', encoding='utf-8', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(['id', 'infobox'])
        for line in source:
            subject = json.loads(line)
            if subject.get('type') != 2:
                continue
            updated = dedupe_infobox(subject.get('infobox') or '', positions)
            if updated is not None:
                writer.writerow([subject['id'], updated])
                count += 1
    print(f'修改 {count} 个动画条目 → {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
