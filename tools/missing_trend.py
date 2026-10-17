#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "matplotlib",
# ]
# ///
"""缺失人物剩余工作量 weekly 折线图（xkcd 手绘风格 PNG）

历史数据仅存为 JSON（时间-数量对列表），存在 actions cache 中，
每周合并最新统计后绘图。下载 Archive 由 CI 另行负责，本脚本不做
任何下载。输出两张 PNG（light / dark 各一张，仅 missing / related 两线，
全拉丁文），dark 版按系统 prefers-color-scheme 由 HTML <picture> 切换，
挂到 GH Pages 展示。

注：chart-xkcd（PyPI）只能输出 HTML（JS 渲染），无法导出 PNG，
故用 matplotlib 内置 xkcd 风格实现同等手绘效果。

用法:
  # CI 主流程：missing-persons 全量 run 已带 --stats-json sidecar，直接合并（不重跑）
  uv run tools/missing_trend.py --history trend-history.json --stats /tmp/missing-stats.json --out _site/missing-trend.png
  # 仅用历史绘图（测试用）
  uv run tools/missing_trend.py --history trend.json --out missing-trend.png --plot-only
"""

import argparse
import datetime
import json
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_BIN = "bgq/bin/missing-persons"
DEFAULT_HISTORY = "trend.json"


def run_stats(bin_path, archive_dir=None, db=None, aliases_file=None):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        tmp = tf.name
    try:
        cmd = [bin_path, "--stats-only", "--stats-json", tmp]
        if db:
            cmd += ["--db", db]
        if archive_dir:
            cmd += ["--archive-dir", archive_dir]
        if aliases_file:
            cmd += ["--aliases-file", aliases_file]
        print(f"$ {' '.join(cmd)}", flush=True)
        result = subprocess.run(cmd, timeout=600)
        if result.returncode != 0:
            print(f"missing-persons stats 失败 rc={result.returncode}", file=sys.stderr)
            sys.exit(1)
        return json.loads(Path(tmp).read_text())
    finally:
        try:
            Path(tmp).unlink()
        except OSError:
            pass


def load_history(path: Path):
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict) and x.get("date")]
        if isinstance(data, dict) and data.get("date"):
            return [data]
        return []
    except (json.JSONDecodeError, OSError):
        return []


THEMES = {
    "light": {
        "missing": "#1f77b4",
        "related": "#ff7f0e",
        "bg": None,
        "text": None,
        "edge": None,
    },
    "dark": {
        "missing": "#58a6ff",
        "related": "#ffa657",
        "bg": "#0d1117",
        "text": "#c9d1d9",
        "edge": "#30363d",
    },
}


def render_png(trend, out: Path, title="MISSING PERSONS BACKLOG", theme="light"):
    """xkcd Script 手绘风格 PNG，仅 missing / related 两线，全大写拉丁文。"""
    import logging
    import matplotlib
    matplotlib.use("Agg")
    # 降噪：xkcd 字体链中不存在的后备字体（Comic Sans MS）只打 ERROR
    logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
    import matplotlib.pyplot as plt

    colors = THEMES.get(theme, THEMES["light"])
    trend = sorted(trend, key=lambda x: x.get("date", ""))
    dates = [(x.get("date", "")[5:] or x.get("date", "")) for x in trend]
    missing = [x.get("totalMissing", 0) or 0 for x in trend]
    related = [x.get("totalRelated", 0) or 0 for x in trend]

    with plt.xkcd():
        # 强制使用 xkcd Script（链中排第二，默认会被 xkcd 抢掉）
        plt.rcParams["font.family"] = "xkcd Script"
        if colors["bg"]:
            rc_overrides = {
                "figure.facecolor": colors["bg"],
                "axes.facecolor": colors["bg"],
                "text.color": colors["text"],
                "axes.edgecolor": colors["edge"],
                "axes.labelcolor": colors["text"],
                "xtick.color": colors["text"],
                "ytick.color": colors["text"],
                # xkcd 默认给文字/线条加白描边，深色底上刺眼，去掉
                "path.effects": [],
            }
            for key, val in rc_overrides.items():
                plt.rcParams[key] = val
        fig, ax1 = plt.subplots(figsize=(10, 5))
        # 双纵轴：missing 走左轴，related 走右轴，各自截断下方空白
        l1, = ax1.plot(dates, missing, marker="o", color=colors["missing"], label="MISSING")
        ax1.set_ylabel("MISSING PERSONS", color=colors["missing"])
        ax1.tick_params(axis="y", labelcolor=colors["missing"])
        span1 = max(max(missing) - min(missing), 1)
        ax1.set_ylim(min(missing) - span1 * 0.4, max(missing) + span1 * 0.4)

        ax2 = ax1.twinx()
        l2, = ax2.plot(dates, related, marker="o", color=colors["related"], label="RELATED")
        ax2.set_ylabel("RELATED PERSONS", color=colors["related"])
        ax2.tick_params(axis="y", labelcolor=colors["related"])
        span2 = max(max(related) - min(related), 1)
        ax2.set_ylim(min(related) - span2 * 0.4, max(related) + span2 * 0.4)

        ax1.set_title(title.upper())
        ax1.set_xlabel("DATE")
        legend_kw = {}
        if colors["bg"]:
            legend_kw = {"labelcolor": colors["text"], "facecolor": colors["bg"], "edgecolor": colors["edge"]}
        ax1.legend(handles=[l1, l2], loc="upper left", framealpha=0.9, **legend_kw)
        fig.autofmt_xdate(rotation=20)
        out.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out, dpi=120, bbox_inches="tight", facecolor=fig.get_facecolor())
        plt.close(fig)
    print(f"图表已保存 {out}", flush=True)


def main():
    ap = argparse.ArgumentParser(description="缺失人物 weekly 趋势（历史 JSON + 最新统计，只生成图片）")
    ap.add_argument("--history", default=DEFAULT_HISTORY, help="历史 JSON 路径，每周增量更新")
    ap.add_argument("--out", default="missing-trend.png", help="输出 PNG 图片路径")
    ap.add_argument("--bin", default=DEFAULT_BIN, help="missing-persons 二进制路径")
    ap.add_argument("--archive-dir", help="归档目录（默认自动探测）")
    ap.add_argument("--db", help="数据库路径（默认自动探测）")
    ap.add_argument("--aliases-file", help="别名文件")
    ap.add_argument("--stats", help="已算好的 stats JSON（missing-persons 全量 run 的 --stats-json sidecar），有则直接合并，不重跑")
    ap.add_argument("--plot-only", action="store_true", help="仅用历史 JSON 绘图，不跑 missing-persons")
    args = ap.parse_args()

    history_path = Path(args.history)
    trend = load_history(history_path)
    print(f"历史记录 {len(trend)} 点来自 {history_path}", flush=True)

    if args.stats:
        stats = json.loads(Path(args.stats).read_text())
    elif not args.plot_only:
        stats = run_stats(args.bin, args.archive_dir, args.db, args.aliases_file)
    else:
        stats = None

    if stats is not None:
        date = stats.get("date") or datetime.date.today().isoformat()
        existing = {x.get("date"): i for i, x in enumerate(trend)}
        if date in existing:
            trend[existing[date]] = stats
            print(f"更新 {date}: remaining={stats.get('remaining')}", flush=True)
        else:
            trend.append(stats)
            print(f"新增 {date}: remaining={stats.get('remaining')} missing={stats.get('totalMissing')} related={stats.get('totalRelated')} bare={stats.get('totalBare')}", flush=True)
        trend = sorted(trend, key=lambda x: x.get("date", ""))
        history_path.parent.mkdir(parents=True, exist_ok=True)
        history_path.write_text(json.dumps(trend, indent=2, ensure_ascii=False) + "\n")
        print(f"历史已更新 {history_path} 共 {len(trend)} 点", flush=True)

    if not trend:
        print("无可用数据，未生成图表", file=sys.stderr)
        sys.exit(1)

    out = Path(args.out)
    title = f"Missing persons {trend[0].get('date','')} ~ {trend[-1].get('date','')}"
    render_png(trend, out, title, "light")
    render_png(trend, out.with_name(out.stem + "-dark" + out.suffix), title, "dark")


if __name__ == "__main__":
    main()
