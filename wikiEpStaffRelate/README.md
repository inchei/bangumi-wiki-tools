# wiki-ep-staff-relate

根据章节简介关联制作人员参与：从章节页或人物关联页解析章节简介里的制作人员，一键填入参与集数并补建人物关联。

原为 [bangumi/scripts](https://github.com/bangumi/scripts) `inchei/` 下的单文件脚本，现迁移至此并拆分模块；`src/positions.generated.js` 由 `bgq/cmd/gen-model`（`go generate`）从 bangumi/common 的 `subject_staffs.yml` 自动生成手写职位表未覆盖的官方职位兜底 pattern。

## 功能

- **章节页**：在 `/ep/{id}` 页面生成「关联制作人员参与」入口，把本集简介解析出的参与带到关联页
- **关联页**：在 `/subject/{id}/add_related/person`（动画）页面一键获取全部章节简介，解析职位与人员：
  - 匹配已有行 → 补写参与集数（支持 `1-3,5` 区间语法）
  - 未匹配 → 自动搜索人物并新建关联行（疑似缺失时走 bgq 别名与繁简转换候选）
  - 输出可拖动的结果面板（新增 / 已有 / 未匹配、职位缺失集数、各集详情）
- **infobox 参与**：「根据infobox关联」同时解析行内手写参与（`分镜: 某人 (1, 3-5)`），展开为集数并合并填入对应关联行，格式存疑的段在结果面板标记复查（移植自 hyary 的 extract.user.js）；infobox 中将被解析的人名显示为绿色，点击划掉后识别跳过该名字
- **新建人物页**：`/person/new?name=xxx` 自动填入人物名

## 安装

### 油猴脚本

[安装链接](https://raw.githubusercontent.com/inchei/bangumi-wiki-tools/main/wikiEpStaffRelate/dist/wikiEpStaffRelate.user.js)

### 组件

在 bangumi 上启用[该组件](https://bgm.tv/dev/app/4948)

## 相关

- [GreasyFork](https://greasyfork.org/zh-CN/scripts/552493) · [Bangumi 讨论](https://bgm.tv/group/topic/439326)
- 未匹配人员的别名回退与职位缺失检查基于 [bgq serve](../bgq/README.md) 提供的 API
- 手写职位表（`src/positions.js`）与手写消歧 pattern 的匹配优先级按数组顺序，自动生成的兜底条目排在末位

## 开发

```bash
pnpm lint         # ESLint
pnpm format       # Prettier
pnpm build        # 构建（输出 dist/wikiEpStaffRelate.user.js）

cd bgq && go generate ./internal/model/   # src/positions.generated.js 由 subject_staffs.yml 自动生成
```
