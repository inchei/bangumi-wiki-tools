# wikiBatch

批量更新 [Bangumi](https://bgm.tv/) 条目/角色/人物 Wiki 信息的用户脚本。支持编辑 Wcode（Infobox）、标签和系列状态，并提供提交前 diff 预览。

![demo](https://lsky.ry.mk/i/2026/07/30/cab358afbdbbb.webp)

## 安装

使用 Violentmonkey 等脚本管理器插件安装：<https://raw.githubusercontent.com/inchei/bangumi-wiki-tools/main/userscripts/wikiBatch/dist/wikiBatch.user.js>

脚本默认仅在 <https://next.bgm.tv/> 域名下激活，可退出显示原页面，此时页面右下角会出现浮动按钮再次唤起。

## 配置

设置页面的「地址配置」可自定义两个基地址，配置保存在脚本管理器（GM）存储中，跨站点共享：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| API 地址 | `https://next.bgm.tv` | Private API 基地址，用于读取/提交条目信息 |
| Bangumi 地址 | `https://bgm.tv` | 站点基地址，用于提交更新与各类跳转链接 |

脚本作用地址（默认 `https://next.bgm.tv`）在脚本管理器的脚本菜单中设置，修改后刷新页面生效。

## 开发

### 项目结构

```
wikiBatch/
├── build.js              # 构建脚本 (esbuild + esbuild-svelte)
├── header.js             # ==UserScript== 元数据头
├── dist/
│   └── wikiBatch.user.js # 构建输出
├── src/
│   ├── index.ts          # 入口文件
│   ├── core.ts           # 状态管理 + 类型定义
│   ├── utils.ts          # 工具函数
│   ├── ui.ts             # UI 辅助 (进度条、loading、状态消息)
│   ├── csv.ts            # CSV 解析 (papaparse)
│   ├── diff.ts           # Diff 生成 & 渲染 (@git-diff-view/svelte)
│   ├── api.ts            # API 调用 (获取条目、提交更新)
│   ├── views.ts          # 视图切换
│   ├── handlers.ts       # 按钮点击事件处理
│   ├── dom.ts            # DOM 创建 & 事件绑定
│   ├── styles.ts         # CSS 注入 (GM_addStyle)
│   ├── styles.css        # 应用样式
│   ├── stubs/
│   │   └── lowlight.ts   # @git-diff-view/lowlight 空桩（替代 lowlight 语法库，减包 1MB+）
│   └── globals.d.ts      # GM_* API 类型声明
├── tsconfig.json
├── eslint.config.mjs
├── .stylelintrc.json
├── package.json
└── README.md
```

### 构建与检查

```bash
pnpm build           # esbuild + esbuild-svelte 打包 → dist/wikiBatch.user.js
pnpm typecheck       # tsc --noEmit 类型检查
pnpm lint            # ESLint
pnpm lint:css        # Stylelint
```

主要依赖（通过 esbuild 打包进单文件）：
- **`@git-diff-view/svelte`** + **`svelte`** — GitHub 风格 diff 渲染（Svelte 5 编译为原生 DOM）
- **`@git-diff-view/file`** — diff 生成引擎
- **`papaparse`** — CSV 解析
- **`@trim21/gm-fetch`** — PATCH API 请求

构建时通过 esbuild alias 将 `@git-diff-view/lowlight` 替换为轻量桩文件（lowlight 包含所有语言语法高亮数据 ~1MB），仅对 `@git-diff-view/shiki` 标记 external 避免拉入 WASM。

## 许可

MIT
