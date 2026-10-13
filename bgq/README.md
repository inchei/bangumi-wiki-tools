# Bangumi Query

基于 DuckDB 的 [Bangumi Archive](https://github.com/bangumi/Archive) 条目筛选工具，支持 YAML 配置文件和 Web 界面两种使用方式。

## 演示

<p align="center">
  <img alt="demo" src="https://lsky.ry.mk/i/2026/06/27/06f793ffe6c91.webp">
</p>

<p align="center">
  <a href="https://bgq.iccci.cc.cd">https://bgq.iccci.cc.cd</a><br>
  <a href="https://goscreenapi.com/is-bgq.iccci.cc.cd-down"><img alt="bgq.iccci.cc.cd uptime" src="https://goscreenapi.com/badge/uptime/bgq.iccci.cc.cd.svg"></a>
  <a href="https://goscreenapi.com/is-bgq.iccci.cc.cd-down"><img alt="bgq.iccci.cc.cd status" src="https://goscreenapi.com/badge/status/bgq.iccci.cc.cd.svg"></a>
</p>

## 快速开始

1. 从 [GitHub Releases](https://github.com/inchei/bangumi-wiki-tools/releases/latest) 下载对应平台压缩包
2. 安装 DuckDB CLI，参见[官网](https://duckdb.org/install/?environment=cli)
3. 从 https://github.com/bangumi/Archive/releases/tag/archive 下载最新数据并解压到上述文件夹内
4. 在上述文件夹打开终端模拟器，运行 `./bgq serve --data-dir ./bangumi_archive` （Windows 将 `./bgq` 替换为 `bgq.exe`）

## 准备数据

```bash
chmod +x download-archive.sh
./download-archive.sh ./bangumi_archive
```

或从 https://github.com/bangumi/Archive/releases/tag/archive 手动下载。

**实际部署强烈建议 `bgq ingest` 建库并以 `--db` 模式运行：更快，且查询自动关闭 DuckDB 外部文件/网络访问，参考[使用数据库加速查询](#使用数据库加速查询)。**

## 数据更新

### 前提

若使用 GitHub Releases 二进制包，设置 cron 前还需满足以下条件：

```bash
# download-archive.sh
curl -O https://raw.githubusercontent.com/inchei/bangumi-wiki-tools/main/bgq/download-archive.sh
chmod +x download-archive.sh
```

如需更新别名（见[下文](#人物别名查询)），还需以下条件：

```bash
# person_alias.py
curl -O https://raw.githubusercontent.com/inchei/bangumi-wiki-tools/main/person_alias.py

# uv
curl -LsSf https://astral.sh/uv/install.sh | sh
```

自编译请注意 `person_alias.py` 默认路径为项目根目录而非 `bgq` 下。

### cron 配置

仅更新 Archive 数据：

```bash
(crontab -l 2>/dev/null; echo "0 3 * * 1 cd $(pwd) && bash download-archive.sh ./bangumi_archive") | crontab -
```

更新数据 + 重建数据库：
```bash
(crontab -l 2>/dev/null; echo "0 3 * * 1 cd $(pwd) && bash download-archive.sh ./bangumi_archive && ./bin/bgq ingest --data-dir ./bangumi_archive --db ./bangumi.db.tmp && mv ./bangumi.db.tmp ./bangumi.db") | crontab -
```

更新数据 + 重建数据库 + 更新别名：

```bash
(crontab -l 2>/dev/null; echo "0 3 * * 1 cd $(pwd) && bash download-archive.sh ./bangumi_archive && ./bin/bgq ingest --data-dir ./bangumi_archive --db ./bangumi.db.tmp && mv ./bangumi.db.tmp ./bangumi.db && uv run person_alias.py") | crontab -
```

### Docker

容器内已包含更新脚本，无需重启即可更新数据：

```bash
(crontab -l 2>/dev/null; echo "0 3 * * 1 docker compose -f $(pwd)/docker-compose.yml exec bgq /update-data.sh") | crontab -
```

## 安装

### 前提

bgq 运行时依赖 [DuckDB CLI](https://duckdb.org/) 执行 SQL，须自行安装至 `PATH` 或通过 `DUCKDB_PATH` 环境变量指定。

安装方式参见[官网](https://duckdb.org/install/?environment=cli)。

> 仅测试 DuckDB v1.2.0 和 v1.5.4，其他版本可能存在问题。

### 从 GitHub Releases 安装

下载对应平台压缩包，解压后即可使用（需自行安装 DuckDB CLI）。

### 从源码编译

```bash
cd bgq

# 编译前端（产物嵌入 Go 二进制）
cd frontend && pnpm build && cd ..
cp -r frontend/dist internal/server/dist

# 编译 Go 二进制
go build -o bin/bgq ./cmd/bgq/
```

> 依赖在仓库根目录统一安装（单一 pnpm workspace + 单一 `pnpm-lock.yaml`）：`pnpm install`（一次装全部 4 个项目）。在 `bgq/frontend` 内运行 `pnpm build` 即可。

## Docker 部署

```bash
cd bgq
cp .env.example .env   # 按需编辑
docker-compose up -d --build
```

默认访问 `http://localhost:7860`。首次运行自动下载数据到卷中，后续数据更新可参考[数据更新](#数据更新)。

`.env` 支持以下变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `/data/bangumi_archive` | 数据目录 |
| `PORT` | `7860` | 监听端口 |
| `DB_PATH` | 空 | DuckDB 数据库路径（为空则直接用 JSONLines 查询） |
| `ALLOWED_ORIGINS` | 空（使用内置默认列表） | 允许的跨域来源域名，逗号分隔 |

## 使用

### 命令行查询

```bash
./bin/bgq query --config query.yaml
```

| 参数 | 缩写 | 说明 |
|------|------|------|
| `--config` | `-c` | YAML 配置文件路径（必需） |
| `--data-dir` | `-d` | 数据目录（覆盖配置中的 data_dir） |
| `--output` | `-o` | 输出文件路径 |
| `--format` | `-f` | 输出格式：table / csv / json |
| `--verbose` | `-v` | 显示生成的 SQL |

YAML 格式说明见 [YAML 筛选条件参考](docs/yaml-guide.md)。

### Web 界面

```bash
./bin/bgq serve --data-dir ./bangumi_archive
```

提供可视化筛选器、实时查询、CSV 导出、YAML 编辑器。

| 参数 | 缩写 | 说明 |
|------|------|------|
| `--data-dir` | `-d` | 数据目录（默认 `bangumi_archive`） |
| `--listen` | `-l` | 监听地址（默认 `:8080`） |
| `--db` | | DuckDB 数据库路径（未指定时自动检测） |
| `--aliases-file` | | 人物别名 JSON 路径（未指定时自动检测） |
| `--allowed-origins` | | 允许的跨域来源域名，逗号分隔（默认 `bgm.tv,bangumi.tv,chii.in` 及部分镜像站，可传空字符串禁用所有来源） |
| `--dev` | | 开发模式（Air 热重载） |

### 使用数据库加速查询

将 JSONLines 导入 DuckDB 数据库，建立索引，加速重复查询：

```bash
./bin/bgq ingest --data-dir ./bangumi_archive --db ./bangumi.db
```

命令行查询时在配置文件中用 `database` 替代 `data_dir`：

```yaml
database: "./bangumi.db"
filters:
  - field: { field: "出版社", operator: "contains", value: "角川" }
```

Web 界面使用 `--db` 参数：

```bash
./bin/bgq serve --data-dir ./bangumi_archive --db ./bangumi.db
```

Docker 部署在 `.env` 中设置 `DB_PATH`。

## AI Agent Skill

bgq 提供 AI Agent skill，支持用自然语言查询 Bangumi 数据。

安装（Hermes Agent）：

```bash
cp -r skills/bgq-query ~/.hermes/skills/data-science/
```

或通过 `npx skills add`（适用于支持 skills CLI 的 agent）。

使用方式：直接用自然语言描述查询需求，agent 会自动生成 YAML 并执行。例如：

- "找评分8分以上的动画，按评分降序"
- "找出角川出版的已完结轻小说"
- "导演过高分动画的年轻导演有哪些"
- "排名最高的漫画中哪些还没改编成动画"

详细用法见 [skills/bgq-query/SKILL.md](skills/bgq-query/SKILL.md)。

## 附加功能

基于同数据库的便利查询，serve 后可提供相关 API。

### 检查缺失条目关联

检查某人是否在相关条目中缺少 staff 职位关联：

```bash
# 检查"川原砾"在书籍(1)类型中缺失的 staff 条目
./bin/bgq missing subjects "川原砾" --type 1 --db ./bangumi.db

# 限制仅检查特定职位
./bin/bgq missing subjects "川原砾" --type 1 --db ./bangumi.db --position 1
```

| 参数 | 说明 |
|------|------|
| `--type` | 条目类型：1(书籍) 2(动画) 3(音乐) 4(游戏) 6(三次元)（必需） |
| `--db` | DuckDB 数据库路径（默认查找 `./bangumi.db`） |
| `--position` | 限制仅检查指定职位 ID |

HTTP 接口（serve 后）：

```bash
curl "http://localhost:8080/api/persons/川原砾/missing-subjects?type=1"
```

```json
// 返回按 subject_id 聚合的缺失职位信息
{
  "324": {
    "name": "アクセル・ワールド",
    "positions": [1, 5]   // 缺失的职位 ID
  }
}
```

| 参数 | 说明 |
|------|------|
| `type` | 条目类型（必填） |
| `position` | 仅检查指定职位 ID（可选） |

Referrer 限制：仅允许来自允许列表内域名（默认 `bgm.tv`、`bangumi.tv`、`chii.in` 及部分镜像站）的请求，可通过 `--allowed-origins` 参数或 Docker 环境变量 `ALLOWED_ORIGINS` 自定义（逗号分隔）；直接访问（新标签页、curl 无 referrer）不受限。

### 检查缺失剧集标注

检查某人在剧集描述中出现但缺少对应 staff 关联的剧集：

```bash
./bin/bgq missing episodes "川原砾" --db ./bangumi.db
```

HTTP 接口（serve 后）：

```bash
curl "http://localhost:8080/api/persons/川原砾/missing-episodes"
```

```json
// 返回匹配结果，按 subject 分组
{
  "matched": {
    "12": { "name": "アクセル・ワールド", "episodes": { "1": ["1", "2"] } }
  },
  "unmatched": {
    "12": { "name": "アクセル・ワールド", "episodes": [{"episode_id": 3, "label": "3"}] }
  }
}
```

### 人物别名查询

根据名称（别名、中文名）查找对应的人物 ID，配合 wikiMissingPositions 等脚本使用。

HTTP 接口（serve 后）：

```bash
# 启动时加载别名数据
./bin/bgq serve --db ./bangumi.db --aliases-file ./person_alias.json

curl "http://localhost:8080/api/aliases/斧谷稔"
```

```json
[
  { "name": "富野由悠季", "id": 613 }
]
```

别名数据由 `../person_alias.py` 生成（需 `uv`）：

```bash
uv run person_alias.py
```

`serve` 从 `bgq/` 启动时自动检测 `../person_alias.json` 和 `./person_alias.json`。

## 开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

与原项目相同。
