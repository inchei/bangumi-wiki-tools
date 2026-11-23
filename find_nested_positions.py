#!/usr/bin/env python3
"""统计 Archive 动画职位字段中以「；其他职位：值」填写的内容。"""

import argparse
from collections import Counter
import csv
import json
import re
import sys
from pathlib import Path


FIELD = re.compile(r'^\|\s*([^=\r\n]+?)\s*=\s*(.*)$')
NESTED = re.compile(r'；([^；：:=\r\n]{1,40})[：:]([^；\r\n]+)')
POSITION_MAP = re.compile(r'var (\w+StaffPositions) = map\[int\]string\{(.*?)\n\}', re.S)
POSITION = re.compile(r'^\s*\d+:\s*"([^"]+)"', re.M)
DEFAULT_POSITIONS = Path(__file__).resolve().parent / 'bgq/internal/model/staff_data.go'


def find_nested_positions(infobox):
    for line in infobox.splitlines():
        field = FIELD.match(line)
        if not field:
            continue
        source, cell = field.group(1).strip(), field.group(2)
        for match in NESTED.finditer(cell):
            key = match.group(1)
            if key == key.strip() and key != source and match.group(2).strip():
                yield source, key, match.group(2).strip(), cell


def load_positions(path):
    text = Path(path).read_text(encoding='utf-8')
    for name, body in POSITION_MAP.findall(text):
        if name == 'animeStaffPositions':
            positions = set(POSITION.findall(body))
            if positions:
                return positions
    raise ValueError(f'无法从 {path} 读取动画职位表')


def count_positions(subjects, positions):
    counts = Counter()
    for subject in subjects:
        if subject.get('type') != 2:
            continue
        for source, key, _, _ in find_nested_positions(subject.get('infobox') or ''):
            if source not in positions:
                continue
            group = (source, key, key in positions)
            counts[group] += 1
    return counts


def main():
    parser = argparse.ArgumentParser(description='统计动画职位字段中「；其他职位：值」的出现次数')
    parser.add_argument('archive', nargs='?', default='bangumi_archive/subject.jsonlines', help='Archive subject.jsonlines 路径')
    parser.add_argument('--positions', type=Path, default=DEFAULT_POSITIONS, help='bgq 生成的 staff_data.go 路径')
    parser.add_argument('--out', default='anime_nested_positions_stats.csv', help='输出 CSV 路径（默认 anime_nested_positions_stats.csv）')
    args = parser.parse_args()

    positions = load_positions(args.positions)
    with open(args.archive, encoding='utf-8') as source:
        counts = count_positions((json.loads(line) for line in source), positions)

    with open(args.out, 'w', encoding='utf-8-sig', newline='') as output:
        writer = csv.writer(output)
        writer.writerow(['position', 'nested_position', 'is_real_nested_position', 'times'])
        for (source, key, exists), count in sorted(
            counts.items(), key=lambda item: (-item[1], item[0][:2])
        ):
            writer.writerow([source, key, str(exists).lower(), count])
    real = sum(count for group, count in counts.items() if group[2])
    total = sum(counts.values())
    print(f'共 {total} 处、{len(counts)} 组；真实职位 {real} 处，非真实职位 {total - real} 处 → {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
