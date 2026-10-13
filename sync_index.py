#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""将 CSV 同步到 Bangumi 目录（使用 next.bgm.tv 私有 API）。

用法:
    bgq query --config x.yaml --format csv | python sync_index.py --index 12345
    python sync_index.py --index 12345 --csv results.csv

列规则:
    - id 列自动识别：person_id → person, character_id → character, id → subject
    - 若存在 index_desc 列，用其值作为条目描述
    - 否则，非 ID 列以 "列名：值" 拼接为描述（排除 order 列）
    - 存在 order 列 → 目录条目按 order 值排序；无 order 列 → 不修改目录顺序

环境变量:
    BANGUMI_TOKEN  Bangumi API access token (必需)
"""

import argparse
import csv
import io
import json
import os
import random
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

REQUEST_DELAY = 21.0  # 默认请求间隔（秒），对应 ~3/min（留少量余量）

API_BASE = "https://next.bgm.tv/p1"

# 列名 → (cat, id列名)
ID_COL_MAP = {
    "person_id": (2, "person_id"),
    "character_id": (1, "character_id"),
}


def detect_id_column(columns: list[str]) -> tuple[int, str]:
    """从列名推断类型和 ID 列。返回 (cat, id_col)。"""
    for col, (cat, id_col) in ID_COL_MAP.items():
        if col in columns:
            return cat, id_col
    return 0, "id"


def api(method: str, path: str, token: str, body: dict | None = None) -> tuple[int, str]:
    """发送 HTTP 请求，返回 (status, body)。"""
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "bangumi-wiki-tools/sync_index",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req) as resp:
            return resp.status, resp.read().decode()
    except HTTPError as e:
        return e.code, e.read().decode()


def api_call(method: str, path: str, token: str, body: dict | None = None) -> tuple[int, str]:
    """带 429 退避重试。"""
    for attempt in range(5):
        if attempt > 0:
            wait = min(30 * 2 ** attempt, 300)
            print(f"限流，等待 {wait}s ...", file=sys.stderr, flush=True)
            time.sleep(wait)
        status, resp_body = api(method, path, token, body)
        if status != 429:
            return status, resp_body
    return status, resp_body


def get_existing(index_id: int, cat: int, token: str) -> dict[int, dict]:
    """获取目录现有条目，返回 {sid: {id(记录ID), order, comment}}。
    GET 不限流，无延迟。"""
    existing = {}
    offset = 0
    while True:
        status, body = api_call(
            "GET",
            f"/indexes/{index_id}/related?cat={cat}&limit=100&offset={offset}",
            token,
        )
        if status != 200:
            print(f"获取目录条目失败: {status} {body}", file=sys.stderr)
            sys.exit(1)
        data = json.loads(body)
        for item in data.get("data", []):
            existing[item["sid"]] = {
                "id": item["id"],
                "order": item.get("order", 0),
                "comment": item.get("comment", ""),
            }
        if len(data.get("data", [])) < 100:
            break
        offset += 100
    return existing


def build_desc(row: dict, columns: list[str], id_col: str, has_index_desc: bool) -> str:
    if has_index_desc:
        return row.get("index_desc", "")
    parts = []
    for col in columns:
        if col == id_col or col.endswith("_id") or col == "index_desc" or col == "order":
            continue
        val = row.get(col, "").strip()
        if val:
            parts.append(f"{col}：{val}")
    return "\n".join(parts)


def sync(
    index_id: int,
    cat: int,
    id_col: str,
    token: str,
    columns: list[str],
    rows: list[dict],
    dry_run: bool,
    delay: float = REQUEST_DELAY,
):
    has_index_desc = "index_desc" in columns
    has_order_col = "order" in columns

    operations = 0
    current_delay = delay

    def wait():
        nonlocal operations
        if operations > 0:
            t = current_delay + random.uniform(0, current_delay * 0.2)
            time.sleep(t)

    result_ids = []
    result_map = {}
    for i, row in enumerate(rows):
        sid = int(row[id_col])
        result_ids.append(sid)
        if has_order_col:
            order_val = int(row["order"])
        else:
            order_val = i + 1
        result_map[sid] = {
            "order": order_val,
            "desc": build_desc(row, columns, id_col, has_index_desc),
        }

    print(f"筛选结果: {len(result_ids)} 条", flush=True)

    existing = get_existing(index_id, cat, token)
    print(f"目录现有: {len(existing)} 条", flush=True)

    result_set = set(result_ids)
    to_add = [s for s in result_ids if s not in existing]

    # find_dup_person 组级跳过：同一 order 值的多人组（≥2 人），若全部已在目录
    # 且各自 order 互相一致，则保留原顺序，不因组序号移位而整体重排。
    skip_order_sids = set()
    if has_order_col:
        order_groups: dict[int, list[int]] = {}
        for sid in result_ids:
            order_groups.setdefault(result_map[sid]["order"], []).append(sid)
        for sids in order_groups.values():
            if len(sids) < 2:
                continue
            if all(s in existing for s in sids) and len({existing[s]["order"] for s in sids}) == 1:
                skip_order_sids.update(sids)

    if has_order_col:
        to_update = [
            s for s in result_ids if s in existing and (
                (s not in skip_order_sids and existing[s]["order"] != result_map[s]["order"])
                or existing[s]["comment"] != result_map[s]["desc"]
            )
        ]
    else:
        to_update = [
            s for s in result_ids if s in existing
            and existing[s]["comment"] != result_map[s]["desc"]
        ]
    to_remove_sid = [s for s in existing if s not in result_set]

    total_ops = len(to_add) + len(to_update) + len(to_remove_sid)
    print(f"添加: {len(to_add)}, 更新: {len(to_update)}, 移除: {len(to_remove_sid)}, "
          f"总计: {total_ops} 次 API 调用", flush=True)
    if total_ops > 0:
        eta = total_ops * current_delay
        print(f"预计耗时: {eta:.0f}s (~{eta / 60:.0f}min)", flush=True)

    if dry_run:
        print("[dry-run] 不执行")
        return

    ok = fail = 0

    for sid in to_add:
        wait()
        info = result_map[sid]
        body = {"cat": cat, "sid": sid, "order": info["order"], "comment": info["desc"]}
        if not has_order_col:
            body["order"] = 0
        print(f"  [{ok+fail+1}/{total_ops}] 添加 {sid} ...", flush=True, end=" ")
        status, resp_body = api_call(
            "PUT",
            f"/indexes/{index_id}/related",
            token,
            body,
        )
        if status == 200:
            ok += 1
            print("OK", flush=True)
        else:
            fail += 1
            print(f"失败: {status}", flush=True)
        operations += 1

    for sid in to_update:
        wait()
        info = result_map[sid]
        record_id = existing[sid]["id"]
        body = {"order": info["order"], "comment": info["desc"]}
        if not has_order_col or sid in skip_order_sids:
            body["order"] = existing[sid]["order"]
        print(f"  [{ok+fail+1}/{total_ops}] 更新 {sid} ...", flush=True, end=" ")
        status, resp_body = api_call(
            "PATCH",
            f"/indexes/{index_id}/related/{record_id}",
            token,
            body,
        )
        if status == 200:
            ok += 1
            print("OK", flush=True)
        else:
            fail += 1
            print(f"失败: {status}", flush=True)
        operations += 1

    for sid in to_remove_sid:
        wait()
        record_id = existing[sid]["id"]
        print(f"  [{ok+fail+1}/{total_ops}] 移除 {sid} ...", flush=True, end=" ")
        status, resp_body = api_call(
            "DELETE",
            f"/indexes/{index_id}/related/{record_id}",
            token,
        )
        if status == 200:
            ok += 1
            print("OK", flush=True)
        else:
            fail += 1
            print(f"失败: {status}", flush=True)
        operations += 1

    print(f"完成: {ok} 成功, {fail} 失败", flush=True)


def main():
    parser = argparse.ArgumentParser(description="将 CSV 同步到 Bangumi 目录")
    parser.add_argument("--index", type=int, required=True, help="Bangumi 目录 ID")
    parser.add_argument("--csv", help="CSV 文件路径（不指定则从 stdin 读取）")
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不执行")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY, help=f"请求间隔秒数（默认 {REQUEST_DELAY}s，限流 3/min 时建议 ≥20s）")
    args = parser.parse_args()

    token = os.environ.get("BANGUMI_TOKEN", "")
    if not token and not args.dry_run:
        print("错误: 未设置 BANGUMI_TOKEN 环境变量", file=sys.stderr)
        sys.exit(1)

    if args.csv:
        with open(args.csv, encoding="utf-8-sig") as f:
            content = f.read()
    else:
        content = sys.stdin.buffer.read().decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(content))
    columns = reader.fieldnames or []
    rows = list(reader)

    if not columns:
        print("错误: CSV 为空或缺少表头", file=sys.stderr)
        sys.exit(1)

    cat, id_col = detect_id_column(columns)
    if id_col not in columns:
        print(f"错误: CSV 缺少 ID 列（尝试: {id_col}）", file=sys.stderr)
        sys.exit(1)

    type_names = {0: "subject", 1: "character", 2: "person", 3: "episode"}
    print(f"类型: {type_names.get(cat, cat)} (cat={cat}, id={id_col})")
    print(f"列: {columns}")
    print(f"行数: {len(rows)}")

    sync(args.index, cat, id_col, token, columns, rows, args.dry_run, args.delay)


if __name__ == "__main__":
    main()
