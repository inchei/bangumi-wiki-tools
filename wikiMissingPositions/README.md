# wiki-missing-positions

预创建人物 / 人物页一键补完已填写未关联条目。像 AniDB 一样，无需等待维基人即可查看人物关联；维基人可一键补完已填写未关联条目或剧集。

## 功能

- **条目页高亮**：在条目页高亮 infobox 中已填写但未关联 STAFF 的姓名，点击弹出补完弹窗
- **关联页自动填充**：在人物添加关联页面（`/person/*/add_related/*`）自动查询并预填缺失的条目/剧集
- **API 后端**：需要配合本仓库的 `bgq serve` 使用

## 安装

### 油猴脚本

需要先安装脚本管理器（Tampermonkey / Violentmonkey）。

[安装链接](https://raw.githubusercontent.com/inchei/bangumi-wiki-tools/main/wikiMissingPositions/dist/wikiMissingPositions.user.js)

### 组件

在 bangumi 上启用[该组件](https://bgm.tv/dev/app/6476)

## 开发

```bash
pnpm lint         # ESLint
pnpm lint:css     # Stylelint
pnpm format       # Prettier
pnpm build        # 构建（输出 dist/wikiMissingPositions.user.js）

cd bgq && go generate ./internal/model/ # `src/position-ids.js` 由 bangumi/common 的 STAFF 职位定义自动生成
```

## 配置

默认 API 地址：`https://bgq.iccci.cc.cd`
可通过组件设置面板或直接修改 `src/config.js` 中的 `DEFAULT_API` 来更改。
