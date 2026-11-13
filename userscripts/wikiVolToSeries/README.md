# 由单行本创建系列 (wikiVolToSeries)

在单行本第一卷的条目页注入 `/ 创建对应系列` 入口：跳转 `new_subject/1` 自动创建系列条目
（标题去卷号、infobox 从页面推算、简介/平台/标签默认填好），创建后回到原卷并自动关联。

- 不发出任何网络请求：infobox 由单行本页 `.infobox_container` 的 DOM 反推为 wikitext；
  封面通过主域名同域路径 fetch 转 dataURL 后交给 [wikiUploadPic] 上传。
- infobox 模板（首行 header、字段顺序、空字段补完）与书籍平台映射由 `go generate`
  从 bangumi/common 的 `wiki_template.yml` 与 `subject_platforms.yml` 生成到
  `src/wiki-template.generated.js`（见 `bgq/cmd/gen-model/main.go`）。
- 页数 / ISBN / 价格 等单卷专用字段（含版本组内的）不会进入系列条目。

## 命令

```bash
pnpm lint           # eslint src/
pnpm format         # prettier
pnpm build          # esbuild -> dist/wikiVolToSeries.user.js
```

构建产物依赖 `go generate` 生成的模板数据；改动模板相关逻辑后请在
`bgq/cmd/gen-model` 下重跑 `go run . --no-meta-tags`。

[wikiUploadPic]: https://github.com/bangumi/scripts/blob/master/inchei/wikiUploadPic.user.js
