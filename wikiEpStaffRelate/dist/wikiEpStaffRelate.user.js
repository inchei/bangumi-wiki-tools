// ==UserScript==
// @name         根据章节简介关联制作人员参与
// @namespace    wiki.ep.staff.replate
// @version      1.0.1
// @description  从章节页或人物关联页根据章节简介关联制作人员参与
// @author       you
// @icon         https://bgm.tv/img/favicon.ico
// @match        http*://bgm.tv/ep/*
// @match        http*://bgm.tv/subject/*/add_related/person*
// @match        http*://bgm.tv/person/new*
// @match        http*://bangumi.tv/ep/*
// @match        http*://bangumi.tv/subject/*/add_related/person*
// @match        http*://chii.in/ep/*
// @match        http*://chii.in/subject/*/add_related/person*
// @match        http*://bangumi.tv/person/new*
// @match        http*://chii.in/person/new*
// @grant        none
// @license      MIT
// @gf           https://greasyfork.org/zh-CN/scripts/552493
// @gadget       https://bgm.tv/dev/app/4948
// ==/UserScript==

(function () {
  'use strict';
  
const styleEl = document.createElement('style');
styleEl.textContent = `#crtRelateSubjects li:target {
  box-shadow: inset 0 0 0 3px oklch(0.62 0.1 255);
  scroll-margin-block-start: 60px;
}

/* 提示框容器样式 */
#wikiEpRelate.staff-tip-box {
  position: fixed;
  width: min(380px, 100vw);
  backdrop-filter: blur(10px);
  background: rgba(254, 254, 254, 0.8);
  color: #000;
  border-radius: 15px;
  background-clip: padding-box;
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 5px 30px 10px rgba(80, 80, 80, 0.5);
  z-index: 9999;
  overflow: hidden;
}

/* 警告提示样式 */
#wikiEpRelate .staff-warning-section {
  padding: 10px 12px;
  margin: 0 0 16px;
  background: rgba(255, 248, 225, 0.6);
  border: 1px solid rgba(255, 153, 0, 0.3);
  border-radius: 8px;
  color: #856404;
  overflow-wrap: break-word;
}
#wikiEpRelate .staff-warning-title {
  font-size: 14px;
  font-weight: 500;
}

/* 提示框拖动手柄 */
#wikiEpRelate .staff-tip-handle {
  height: 36px;
  line-height: 36px;
  padding: 0 16px;
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
  font-size: 14px;
  font-weight: 500;
  color: var(--primary-color, #f09199);
  cursor: move;
  user-select: none;
}

/* 提示框内容容器 */
#wikiEpRelate .staff-tip-content {
  padding: 12px 16px;
  max-height: 400px;
  overflow-y: auto;
  font-size: 13px;
}

/* 提示框标题 */
#wikiEpRelate .staff-tip-title {
  margin: 0 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 14px;
  color: inherit;
}
#wikiEpRelate .staff-tip-title.new {
  color: #0a6e1e;
}
#wikiEpRelate .staff-tip-title.existing {
  color: #0d5b68;
}
#wikiEpRelate .staff-tip-title.unmatched {
  color: #a0222e;
}

/* 记录列表容器 */
#wikiEpRelate .staff-record-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}

/* 统一记录项基础样式 */
#wikiEpRelate .staff-record-item {
  padding: 8px 12px;
  border-radius: 8px;
  backdrop-filter: blur(5px);
  color: inherit !important;
  text-decoration: none;
  transition: background 0.2s ease;
  overflow-wrap: break-word;
  position: relative;
}

/* 新增参与项 */
#wikiEpRelate .staff-record-item.new {
  background: rgba(240, 255, 244, 0.6);
  border: 1px solid rgba(40, 167, 69, 0.2);
}
#wikiEpRelate .staff-record-item.new:hover {
  background: rgba(230, 255, 233, 0.8);
}

/* 已有参与项 */
#wikiEpRelate .staff-record-item.existing {
  background: rgba(240, 248, 255, 0.6);
  border: 1px solid rgba(23, 162, 184, 0.2);
}
#wikiEpRelate .staff-record-item.existing:hover {
  background: rgba(230, 242, 255, 0.8);
}

/* 未匹配记录项 */
#wikiEpRelate .staff-record-item.unmatched {
  padding: 8px 12px;
  border-radius: 8px;
  backdrop-filter: blur(5px);
  background: rgba(255, 248, 248, 0.6);
  color: #a0222e;
  border: 1px solid rgba(220, 53, 69, 0.2);
  transition: background 0.2s ease;
}
#wikiEpRelate .staff-record-item.unmatched:hover {
  background: rgba(255, 235, 235, 0.8);
}

/* 记录项名称强调 */
#wikiEpRelate .staff-person-name {
  font-weight: 500;
  color: inherit;
}

/* 行侧按钮点击后，对应面板记录的闪烁定位环 */
#wikiEpRelate .staff-record-item.staff-row-jump-flash {
  box-shadow: inset 0 0 0 3px oklch(0.62 0.12 80);
}

#wikiEpRelate .staff-tip-content > details > details {
  margin-left: 1.5em;
}

/* 关联行高亮：别名新增 / 同名重复 / 集数有改，同一行命中多个时叠加竖条纹。
   三色各自用 oklch，同主题统一亮度，只差色相，深浅都贴合主题 */
#crtRelateSubjects li.staff-alias-li {
  background: oklch(0.92 0.05 255);
}
/* 行侧跳转按钮：定位结果面板对应记录 */
#crtRelateSubjects li .staff-row-jump {
  margin-left: 0.5em;
  padding: 0 0.3em;
  border: none;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
  color: oklch(0.32 0.05 255);
  background: oklch(0.92 0.05 255);
}
#crtRelateSubjects li.staff-repeat-li {
  background: oklch(0.92 0.05 128);
}
#crtRelateSubjects li.staff-changed-li {
  background: oklch(0.92 0.05 100);
}
#crtRelateSubjects li.staff-alias-li.staff-repeat-li {
  background: repeating-linear-gradient(
    90deg,
    oklch(0.92 0.05 255) 0 12px,
    oklch(0.92 0.05 128) 12px 24px
  );
}

/* 夜间模式适配 */
html[data-theme='dark'] #wikiEpRelate.staff-tip-box {
  background: rgba(40, 40, 40, 0.8);
  color: #fff;
  box-shadow: 0 5px 30px 10px rgba(0, 0, 0, 0.2);
}
html[data-theme='dark'] #wikiEpRelate .staff-warning-section {
  background: rgba(60, 40, 0, 0.4);
  border-color: rgba(255, 153, 0, 0.5);
  color: #ffd700;
}
html[data-theme='dark'] #wikiEpRelate .staff-tip-title {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}
html[data-theme='dark'] #wikiEpRelate .staff-tip-title.new {
  color: #51cf66;
}
html[data-theme='dark'] #wikiEpRelate .staff-tip-title.existing {
  color: #4dd0e1;
}
html[data-theme='dark'] #wikiEpRelate .staff-tip-title.unmatched {
  color: #e57373;
}
html[data-theme='dark'] #crtRelateSubjects li.staff-alias-li {
  background: oklch(0.32 0.05 255);
}
html[data-theme='dark'] #crtRelateSubjects li .staff-row-jump {
  color: oklch(0.9 0.05 255);
  background: oklch(0.32 0.05 255);
}
html[data-theme='dark'] #crtRelateSubjects li.staff-repeat-li {
  background: oklch(0.32 0.04 128);
}
html[data-theme='dark'] #crtRelateSubjects li.staff-changed-li {
  background: oklch(0.32 0.04 100);
}
html[data-theme='dark'] #crtRelateSubjects li.staff-alias-li.staff-repeat-li {
  background: repeating-linear-gradient(
    90deg,
    oklch(0.32 0.05 255) 0 12px,
    oklch(0.32 0.04 128) 12px 24px
  );
}
html[data-theme='dark'] #wikiEpRelate .staff-record-item.new {
  background: rgba(25, 65, 35, 0.4);
  border-color: rgba(76, 175, 80, 0.4);
}
html[data-theme='dark'] #wikiEpRelate .staff-record-item.new:hover {
  background: rgba(25, 65, 35, 0.6);
}
html[data-theme='dark'] #wikiEpRelate .staff-record-item.existing {
  background: rgba(30, 45, 65, 0.4);
  border-color: rgba(33, 150, 243, 0.4);
}
html[data-theme='dark'] #wikiEpRelate .staff-record-item.existing:hover {
  background: rgba(30, 45, 65, 0.6);
}
html[data-theme='dark'] #wikiEpRelate .staff-record-item.unmatched {
  background: rgba(65, 30, 35, 0.4);
  border-color: rgba(244, 67, 54, 0.4);
}
html[data-theme='dark'] #wikiEpRelate .staff-record-item.unmatched:hover {
  background: rgba(65, 30, 35, 0.6);
}`;
document.head.appendChild(styleEl);

(() => {
  // src/positions.js
  var POSITIONS = [
    { name: "脚本", pattern: "(?:脚本|シナリオ|剧本|编剧|プロット|大纲)" },
    { name: "分镜", pattern: "(?:分镜|コンテ|ストーリーボード|絵コンテ|画コンテ)" },
    { name: "演出", pattern: "(?<!チーフ|OP・ED[ 　]|アニメーション|コンテ・)(?:演出)" },
    { name: "构图", pattern: "(?:レイアウト|构图|layout|レイアウター)" },
    {
      name: "作画监督",
      pattern: "(?<!総|总|アクション|メカ|ニック|エフェクト|动作|机械|特效|プロップ|キャラクター|レイアウト|特技)(?:作監|作画監督|作监|作画监督|作艦|アニメーション演出)"
    },
    {
      name: "总作画监督",
      pattern: "(?:(?:総|总)(?:作監|作画監督|作监|作画监督|作艦)|作画総監督|チーフ作画監督)"
    },
    { name: "动作作画监督", pattern: "(?:アクション|动作)(?:作監|作画監督|作监|作画监督|作艦)" },
    { name: "机械作画监督", pattern: "(?:メカ|メカニック|机械)(?:作監|作画監督|作监|作画监督|作艦)" },
    { name: "特效作画监督", pattern: "(?:エフェクト|特效|特技)(?:作監|作画監督|作监|作画监督|作艦)" },
    { name: "原画", pattern: "(?<!第二)(?:原画|作画)" },
    { name: "第二原画", pattern: "(?:第二原画|二原|原画協力)" },
    {
      name: "作画监督助理",
      pattern: "(?<!総|总)(?:作監|作画監督|作监|作画监督|作艦)(?:補|補佐|补佐|协力|協力|辅佐|辅助|助理)"
    },
    { name: "演出助理", pattern: "演出(?:補|補佐|补佐|协力|協力|辅佐|辅助|助理|助手)" },
    {
      name: "監督補佐",
      pattern: "(?:助監督|(?<!作画)監督(?:補|補佐|补佐|协力|協力|辅佐|辅助|助理|助手))"
    },
    // not a real bgm position; 助監督/監督補佐 matches are intentionally dropped, never related as 副导演
    { name: "剪辑", pattern: "(?<!オンライン|オフライン|台詞)(?:剪辑|編集)" },
    { name: "3DCG 导演", pattern: "(?:3DCGディレクター|3DCG导演|3DCG監督)" },
    { name: "CG 导演", pattern: "(?<!3D)(?:CGディレクター|CG导演|CG監督)" },
    { name: "美术监督", pattern: "(?:美術監督|美术监督|アートディレクション|背景監督)" },
    { name: "美术", pattern: "(?:美術|美术)" },
    { name: "背景美术", pattern: "(?:背景)" },
    { name: "制作进行", pattern: "(?<!CG|3DCG|美術|美术)(?:制作进行|制作進行)" },
    { name: "设定制作", pattern: "(?:设定制作|設定制作|制作設定)" },
    {
      name: "制作管理",
      pattern: "(?<!音響|音响)(?:制作デスク|制作管理|制作主任|制作マネージャー|制作担当|制作班長)"
    },
    { name: "制作协力", pattern: "(?:制作協力|制作协力|協力プロダクション|作品協力)" },
    {
      name: "总作画监督助理",
      pattern: "(?:(?:総|总)(?:作監|作画監督|作监|作画监督|作艦)|作画総監督)(?:補|補佐|补佐|协力|協力|辅佐|辅助|助理)"
    },
    { name: "色彩脚本", pattern: "(?:カラースクリプト)" },
    { name: "印象板", pattern: "(?:イメージボード)" },
    { name: "动画检查", pattern: "(?:動画検査|动画检查|動检|動画チェック)" },
    { name: "特效", pattern: "(?:特殊効果)" },
    {
      name: "导演",
      pattern: "(?<!美術|美术|音響|音响|撮影|摄影|作画|総|总|アクション|メカ|メカニック|エフェクト|动作|机械|特效|特技|特撮|3DCG|CG|助|副|アニメーション|テクニカル|联合)(?:監督|导演|ディレクター|シリーズ監督)"
    },
    {
      name: "人物设定",
      pattern: "(?<!サブ|ゲスト|客座|劇中劇|剧中剧|副)(?:キャラクターデザイン|キャラ設定|人物設定|人物设计|人物设定|キャラデザ|人设)"
    },
    {
      name: "系列构成",
      pattern: "(?<!副)(?:シリーズ構成|系列构成|系列構成|シナリオディレクター|構成|脚本構成)"
    },
    { name: "色彩设计", pattern: "(?:色彩設計|色彩设计|色彩設定|カラーデザイン)" },
    { name: "摄影监督", pattern: "(?:撮影|摄影)(?:監督|监督)" },
    { name: "音响监督", pattern: "(?:音響|音响)(?:監督|监督)" },
    { name: "原作", pattern: "(?:原作)" },
    { name: "音乐", pattern: "(?:音楽|音乐|楽曲)" },
    { name: "3DCG", pattern: "(?:3DCG|3D ?CG)" },
    { name: "原案", pattern: "(?<!キャラ|人物|メカニカル|メカニック|机械|機械)(?:原案)" },
    { name: "配音监督", pattern: "(?:配音)(?:監督|监督|导演)" },
    { name: "选曲", pattern: "(?:選曲|选曲)" },
    { name: "监修", pattern: "(?<!作画|レイアウト)(?:監修|监修|シリーズ監修|スーパーバイザー)" },
    { name: "录音", pattern: "(?:録音|录音)" },
    { name: "音效", pattern: "(?:音響効果|効果音|音效)" },
    { name: "企画", pattern: "(?:企画|企划|プランニング|企画開発)" },
    { name: "分镜协力", pattern: "(?:コンテ協力|分镜协力|分鏡協力|絵コンテ協力)" },
    { name: "上色", pattern: "(?:仕上|仕上げ|上色)" },
    { name: "主动画师", pattern: "(?:メインアニメーター|主動畫師|主动画师)" },
    { name: "插画", pattern: "(?:イラスト|插画|挿絵|片尾插画)" },
    { name: "道具设计", pattern: "(?:プロップデザイン|道具設計|道具设计|小物設定)" },
    { name: "美术设计", pattern: "(?:美術設定|美术设定|美術設計|美术设计)" },
    { name: "色彩指定", pattern: "(?:色彩指定|色指定)" },
    { name: "上色检查", pattern: "(?:仕上検查|仕上検査|上色检查|仕上げ検査)" },
    { name: "色彩检查", pattern: "(?:色検查|色検査|色彩检查)" },
    { name: "补间动画", pattern: "(?:動画|补间动画)" },
    { name: "摄影", pattern: "(?:撮影|摄影)" },
    {
      name: "设定",
      pattern: "(?<!キャラ|人物|色彩|小物|美術|美术|メカニック|机械|機械|衣装|基本|場面|背景|制作)(?:設定|设定)"
    },
    {
      name: "制作",
      pattern: "(?<!设定|設定|动画|アニメーション|アニメ|音乐|楽曲|音楽|文芸|文艺|CG)(?:製作|制作)"
    },
    { name: "音响", pattern: "(?:音響|音声|音响)" },
    { name: "人物原案", pattern: "(?:キャラ原案|人物原案)" },
    { name: "机械设定", pattern: "(?:メカニック設定|机械设定|機械設定)" },
    { name: "总导演", pattern: "(?:(?<!作画)総監督|チーフディレクター|总导演)" },
    { name: "分镜抄写", pattern: "(?:絵コンテ清書|コンテ清書|分镜抄写)" },
    {
      name: "动画制作",
      pattern: "(?<!OP・ED ?|OP ?|ED ?)(?:アニメーション制作|アニメ制作|动画制作)"
    },
    { name: "脚本协力", pattern: "(?:脚本協力|脚本协力)" },
    {
      name: "协力",
      pattern: "(?<!作監|作画監督|作监|作画监督|作艦|演出|原画|原作|原案|制作|製作|コンテ|絵コンテ|分镜|分鏡|脚本|友情|設定|设定|デザイン|制作進行|制作进行|作品|宣伝|広告宣伝|番組宣伝|宣传)(?:協力|协力)(?!プロダクション)"
    },
    { name: "特别鸣谢", pattern: "(?:友情協力|特别鸣谢)" },
    { name: "OP・ED 分镜", pattern: "(?:OP・ED(?:の)?分鏡|OP・ED(?:の)?分镜|OP絵コンテ)" },
    { name: "美术板", pattern: "(?:美術ボード|美术板)" },
    { name: "美术监督助理", pattern: "(?:美術監督補佐|美术监督助理)" },
    { name: "设定协力", pattern: "(?:設定協力|デザイン協力|设定协力)" },
    { name: "道具作画监督", pattern: "(?:プロップ作画監督|プロップ作監|道具作画监督)" },
    { name: "角色作画监督", pattern: "(?:キャラクター作画監督|角色作画监督)" },
    { name: "作画监修", pattern: "(?:作画監修|作画监修)" },
    { name: "构图监修", pattern: "(?:レイアウト監修|构图监修)" },
    { name: "构图作画监督", pattern: "(?:レイアウト作画監督|レイアウト作監|构图作画监督)" },
    { name: "服装设计", pattern: "(?:衣装デザイン|衣装設定|服装设计|服裝設計)" },
    { name: "概念设计", pattern: "(?:コンセプトデザイン|概念设计)" },
    { name: "背景设定", pattern: "(?:基本設定|場面設定|場面設計|背景设定)" },
    { name: "主演出", pattern: "(?:チーフ演出|主演出)" },
    { name: "视觉导演", pattern: "(?:ビジュアルディレクター|视觉导演)" },
    { name: "音乐监督", pattern: "(?:音楽ディレクター|音乐监督)" },
    { name: "录音助理", pattern: "(?:録音アシスタント|録音助手|录音助理)" },
    { name: "制作进行协力", pattern: "(?:制作進行協力|制作进行协力)" },
    { name: "音乐制作", pattern: "(?:楽曲制作|音楽制作|音乐制作)" },
    { name: "摄影监督助理", pattern: "(?:撮影監督補佐|摄影监督助理)" },
    { name: "色彩设计助理", pattern: "(?:色彩設計補佐|色彩设计助理)" },
    { name: "制作管理助理", pattern: "(?:制作デスク補佐|制作管理助理)" },
    { name: "设定制作助理", pattern: "(?:設定制作補佐|设定制作助理)" },
    { name: "动作导演", pattern: "(?:アクション監督|动作导演)" },
    { name: "制作助理", pattern: "(?:制作アシスタント|制作補佐|製作補|制作助理)" },
    { name: "制作协调", pattern: "(?:制作コーディネーター|制作协调)" },
    { name: "构成协力", pattern: "(?:構成協力|构成协力)" },
    { name: "企画协力", pattern: "(?:企画協力|企画协力)" },
    { name: "在线剪辑", pattern: "(?:オンライン編集|在线剪辑)" },
    { name: "离线剪辑", pattern: "(?:オフライン編集|离线剪辑)" },
    { name: "剧本协调", pattern: "(?:シナリオコーディネーター|剧本协调)" },
    { name: "副系列构成", pattern: "(?:副シリーズ構成|副系列构成)" },
    { name: "OP・ED 演出", pattern: "(?:OP・ED 演出|OP・ED演出)" },
    { name: "特摄效果", pattern: "(?:特撮|特摄效果)" },
    { name: "视觉效果", pattern: "(?:ビジュアルエフェクト|视觉效果)" },
    { name: "录音工作室", pattern: "(?:録音スタジオ|录音工作室)" },
    { name: "整音", pattern: "(?:整音)" },
    { name: "台词编辑", pattern: "(?:台詞編集|台词编辑)" },
    {
      name: "制片人",
      pattern: "(?<!チーフ|アソシエイト|ライン|美術|音響|企画|企划|営業|营业|アシスタント|助理|協力|CGI|CG|宣伝|宣传|制作|アニメーション|アニメ|动画|クリエイティブ|创意|音楽|音乐)(?:プロデュース|プロデューサー|制片人)"
    },
    { name: "宣传", pattern: "(?:パブリシティ|宣伝|広告宣伝|番組宣伝|宣传)" },
    { name: "标题设计", pattern: "(?:タイトルデザイン|标题设计)" },
    { name: "总制片人", pattern: "(?:チーフプロデューサー|チーフ制作|総合プロデューサー|总制片人)" },
    { name: "执行制片人", pattern: "(?:製作総指揮|执行制片人)" },
    { name: "副制片人", pattern: "(?:アソシエイトプロデューサー|副制片人)" },
    { name: "现场制片人", pattern: "(?:ラインプロデューサー|现场制片人)" },
    {
      name: "创意总监",
      pattern: "(?:クリエイティブスーパーバイザー|クリエイティブディレクター|创意总监)"
    },
    { name: "制作统括", pattern: "(?:制作統括|制作统括)" },
    { name: "监制", pattern: "(?:监制)" },
    { name: "概念艺术", pattern: "(?:コンセプトアート|概念艺术)" },
    { name: "画面设计", pattern: "(?:画面設計|画面设计)" },
    { name: "美术制作人", pattern: "(?:美術プロデューサー|美术制作人)" },
    { name: "音响制作人", pattern: "(?:音響プロデューサー|音响制作人)" }
  ];

  // src/positions.generated.js
  var FALLBACK_POSITIONS = [
    { name: "数码绘图", pattern: "(?:(?:デジタル彩色|数码绘图))" },
    { name: "主题歌编曲", pattern: "(?:(?:主題歌|主题歌)(?:編曲|编曲))" },
    { name: "主题歌作曲", pattern: "(?:(?:主題歌|主题歌)(?:作曲))" },
    { name: "主题歌作词", pattern: "(?:(?:主題歌|主题歌)(?:作詞|作词))" },
    { name: "主题歌演出", pattern: "(?:(?:主題歌|主题歌)(?:演出))" },
    { name: "插入歌演出", pattern: "(?:(?:挿入歌|插入歌)(?:演出))" },
    {
      name: "企划制作人",
      pattern: "(?:企划(?:プロデューサー|制片人|制作人)|(?:企画プロデューサー)|(?:企画営業プロデューサー))"
    },
    { name: "联合导演", pattern: "(?:联合(?:監督|导演|ディレクター))" },
    {
      name: "助理制片人",
      pattern: "(?:助理(?:プロデューサー|制片人)|(?:協力プロデューサー)|(?:アシスタントプロデューサー))"
    },
    { name: "音乐助理", pattern: "(?:(?:音乐助理)|(?:音楽アシスタント))" },
    {
      name: "演员监督",
      pattern: "(?:(?:演員|演员)(?:監督|监督)|(?:キャスティングコーディネーター監督))"
    },
    { name: "联合制片人", pattern: "(?:联合(?:プロデューサー|制片人))" },
    { name: "后期制片协调", pattern: "(?:(?:后期制片协调)|(?:ポストプロダクション協力))" },
    { name: "副导演", pattern: "(?:副(?:監督|导演|ディレクター))" },
    {
      name: "音乐制作人",
      pattern: "(?:音乐(?:プロデューサー|制片人|制作人)|(?:音楽プロデューサー))"
    },
    {
      name: "动画制片人",
      pattern: "(?:(?:アニメーション|動畫|动画)(?:プロデューサー|制片人)|(?:アニメプロデューサー)|(?:アニメーションプロデューサー))"
    },
    { name: "2D 设计", pattern: "(?:2D(?: ?)(?:設計|设计))" },
    { name: "3D 设计", pattern: "(?:3D(?: ?)(?:設計|设计))" },
    {
      name: "技术导演",
      pattern: "(?:技术(?:監督|导演|ディレクター)|(?:テクニカルディレクター)|(?:テクニカル監督))"
    },
    { name: "特技导演", pattern: "(?:特技(?:監督|导演|ディレクター)|(?:特撮監督))" },
    {
      name: "副人物设定",
      pattern: "(?:副人物(?:設定|设定)|(?:サブキャラクターデザイン)|(?:副キャラクターデザイン))"
    },
    { name: "客座人物设定", pattern: "(?:客座人物(?:設定|设定)|(?:ゲストキャラクターデザイン))" },
    {
      name: "插入歌作词",
      pattern: "(?:(?:挿入歌|插入歌)(?:作詞|作词)|(?:Insert(?: ?)Song(?: ?)Lyrics))"
    },
    {
      name: "插入歌作曲",
      pattern: "(?:(?:挿入歌|插入歌)(?:作曲)|(?:Insert(?: ?)Song(?: ?)Composition))"
    },
    {
      name: "插入歌编曲",
      pattern: "(?:(?:挿入歌|插入歌)(?:編曲|编曲)|(?:Insert(?: ?)Song(?: ?)Arrangement))"
    },
    {
      name: "创意制片人",
      pattern: "(?:创意(?:プロデューサー|制片人)|(?:クリエイティブプロデューサー))"
    },
    { name: "文艺制作", pattern: "(?:文艺(?:制作|製作)|(?:文芸制作))" },
    { name: "剧中剧人设", pattern: "(?:(?:剧中剧人设)|(?:劇中劇(?: ?)キャラクターデザイン))" },
    { name: "转场绘", pattern: "(?:(?:トランジション|转场)(?:绘)|(?:アイキャッチ))" },
    { name: "机设原案", pattern: "(?:(?:机设原案)|(?:メカニカル原案))" },
    {
      name: "视觉概念",
      pattern: "(?:(?:ビジュアル|视觉)(?:コンセプト|概念)|(?:ビジュアルコンセプト))"
    },
    { name: "怪物设计", pattern: "(?:(?:モンスター|怪物)(?:設計|设计)|(?:モンスターデザイン))" },
    {
      name: "故事概念",
      pattern: "(?:(?:ストーリー|故事)(?:コンセプト|概念)|(?:ストーリーコンセプト))"
    },
    { name: "音响制作担当", pattern: "(?:音响(?:制作|製作)(?:担当)|(?:音響制作担当))" },
    {
      name: "3D 动画师",
      pattern: "(?:3D(?: ?)(?:アニメーター|动画师)|(?:3Dアニメーター)|(?:3Dアニメーション))"
    },
    {
      name: "CG 制作人",
      pattern: "(?:CG(?: ?)(?:プロデューサー|制片人|制作人)|(?:CGプロデューサー)|(?:CGIプロデューサー))"
    },
    { name: "宣传制片人", pattern: "(?:宣传(?:プロデューサー|制片人)|(?:宣伝プロデューサー))" },
    {
      name: "CG 制作进行",
      pattern: "(?:CG(?: ?)(?:制作|製作)(?:进行)|(?:CG進行)|(?:CG(?:制作|製作)?進行))"
    },
    {
      name: "美术制作进行",
      pattern: "(?:美术(?:制作|製作)(?:进行)|(?:美術進行)|(?:美術(?:制作|製作)?進行))"
    },
    { name: "剪辑助理", pattern: "(?:(?:剪辑助理)|(?:編集助手))" },
    { name: "宣传协力", pattern: "(?:宣传(?:協力|协力)|(?:宣伝協力))" },
    { name: "建模/模型", pattern: "(?:(?:建模/模型)|(?:モデリング)|(?:CGモデラー))" },
    {
      name: "视觉开发/外观开发",
      pattern: "(?:(?:ビジュアル|视觉)(?:开发/外观开发)|(?:ルックデヴ)|(?:ルックデベロップメント))"
    },
    {
      name: "动画导演",
      pattern: "(?:(?:アニメーション|動畫|动画)(?:監督|导演|ディレクター)|(?:アニメーションディレクター)|(?:アニメーション監督))"
    },
    { name: "发行", pattern: "(?:(?:配給|发行)|(?:配給))" },
    { name: "原作协力", pattern: "(?:原作(?:協力|协力)|(?:原作協力)|(?:原案協力))" },
    { name: "製作协力", pattern: "(?:製作(?:協力|协力)|(?:製作協力))" },
    { name: "製作统括", pattern: "(?:(?:製作统括)|(?:製作統括))" },
    { name: "制作事务", pattern: "(?:(?:制作|製作)(?:事務|事务)|(?:制作事務))" },
    {
      name: "OP・ED 动画制作",
      pattern: "(?:OP・ED(?: ?)(?:アニメーション|動畫|动画)(?:制作|製作)|(?:OP・ED(?: ?)アニメーション制作)|(?:OP・ED(?: ?)アニメ制作)|(?:OP(?: ?)アニメーション制作)|(?:OP(?: ?)アニメ制作)|(?:ED(?: ?)アニメーション制作)|(?:ED(?: ?)アニメ制作))"
    },
    {
      name: "3DCG 导演助理",
      pattern: "(?:3DCG(?: ?)(?:監督|导演|ディレクター)(?:助理)|(?:3DCG(?: ?)監督補佐)|(?:3DCG(?: ?)監督補))"
    },
    {
      name: "CG 导演助理",
      pattern: "(?<!3D)(?:CG(?: ?)(?:監督|导演|ディレクター)(?:助理)|(?:CG(?: ?)監督補佐)|(?:CG(?: ?)監督補))"
    },
    {
      name: "制作制片人",
      pattern: "(?:(?:制作|製作)(?:プロデューサー|制片人)|(?:制作プロデューサー))"
    }
  ];

  // src/regexes.js
  var SEP = "(?:\\uff1a|\\u003A|】|\\/|／|·|-、|・|･|、|=|＝|＆|\\u0026|•|♦|◆|■|◎|×|\\[|\\s?\\]|\\s(?![×\\]:：]))";
  var [regexes_per, regexes_role_per, regexes_role] = (() => {
    const per = {}, rolePer = {}, role = {};
    const tolerateIWS = (p) => {
      const i = p.lastIndexOf("(?:");
      return i < 0 ? p : p.slice(0, i) + p.slice(i).replace(/([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc])/g, "$1\\u3000?");
    };
    for (const { name, pattern } of [...POSITIONS, ...FALLBACK_POSITIONS]) {
      const tp = tolerateIWS(pattern);
      const kw = tp + "\\s*?" + SEP;
      const nameCapture = "(\\W|\\w)+?(?=\\n|$|\\s*\\|)";
      per[name] = new RegExp("(?<=[\\u3040-\\u9fa5]*?" + kw + ")" + nameCapture, "g");
      rolePer[name] = new RegExp(kw + nameCapture, "g");
      role[name] = new RegExp(kw, "g");
    }
    return [per, rolePer, role];
  })();
  var regex_sym = /[\uff1a\u003A【】（）()/／、、＆\u0026♦◆■=]/g;

  // src/extract.js
  function extractStaffInfo(epDescs) {
    const result = {};
    const noStaffEps = [];
    for (const [epLabel, desc] of Object.entries(epDescs)) {
      let processedDesc = desc.replaceAll("\r", "").replaceAll(regex_sym, "、");
      const regexes = Object.entries(regexes_per).sort((a, b) => {
        const posA = processedDesc.search(a[1]);
        const posB = processedDesc.search(b[1]);
        return posA < 0 ? 1 : posB < 0 ? -1 : posA - posB;
      });
      const episodeStaff = {};
      regexes.forEach(([role, regex]) => {
        const matches = processedDesc.match(regex);
        for (const existingRole in episodeStaff) {
          episodeStaff[existingRole] = episodeStaff[existingRole].map((name) => {
            const replaced = trimCommas(name.replaceAll(regexes_role_per[role], ""));
            if (replaced[0] !== name[0]) {
              return trimCommas(name.replaceAll(regexes_role[role], ""));
            } else {
              return replaced;
            }
          });
        }
        episodeStaff[role] = [];
        if (matches) {
          episodeStaff[role] = matches.map((name) => trimCommas(name));
        }
      });
      regexes.forEach(([role]) => {
        for (const existingRole in episodeStaff) {
          episodeStaff[existingRole] = episodeStaff[existingRole].map((name) => {
            const replaced = trimCommas(name.replaceAll(regexes_role_per[role], ""));
            if (replaced[0] !== name[0]) {
              return trimCommas(name.replaceAll(regexes_role[role], ""));
            } else {
              return replaced;
            }
          });
        }
      });
      for (const role in episodeStaff) {
        const seenNames = /* @__PURE__ */ new Set();
        const newStaffList = [];
        for (const name of episodeStaff[role]) {
          if (!name || name.trim() === "") continue;
          const separatorGroups = [
            ["、", ",", "，", "､"],
            // 第一类：始终作为分隔符
            ["・", "•", "·", "･"],
            // 第二类：前后不都是preservedchar时作为分隔符
            ["　", " "]
            // 第三类：空格
          ];
          let currentNames = [name.trim()];
          for (let groupIndex = 0; groupIndex < separatorGroups.length; groupIndex++) {
            const separators = separatorGroups[groupIndex];
            const newNames = [];
            for (const currentName of currentNames) {
              if (groupIndex > 0 && currentNames.length > 1) {
                newNames.push(currentName);
                continue;
              }
              if (groupIndex === 2) {
                const japaneseRegex = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]/;
                const hasJapaneseCharacters = japaneseRegex.test(currentName);
                const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(currentName);
                const shouldSplitBySpace = hasJapaneseCharacters && (hasKana ? currentName.length > 10 : currentName.length > 7);
                if (!shouldSplitBySpace) {
                  newNames.push(currentName);
                  continue;
                }
              }
              let tempName = "";
              const splitResult = [];
              let hasValidSeparator = false;
              for (let i = 0; i < currentName.length; i++) {
                const char = currentName[i];
                const prevChar = i > 0 ? currentName[i - 1] : "";
                const nextChar = i < currentName.length - 1 ? currentName[i + 1] : "";
                const isSeparator = separators.includes(char);
                if (isSeparator) {
                  if (groupIndex === 0) {
                    if (tempName.trim()) {
                      splitResult.push(trimCommas(tempName));
                    }
                    tempName = "";
                    hasValidSeparator = true;
                  } else if (groupIndex === 1) {
                    const isEnglishContext = (isPreservedChar(prevChar) || !prevChar) && (isPreservedChar(nextChar) || !nextChar);
                    if (!isEnglishContext) {
                      if (tempName.trim()) {
                        splitResult.push(trimCommas(tempName));
                      }
                      tempName = "";
                      hasValidSeparator = true;
                    } else {
                      tempName += char;
                    }
                  } else if (groupIndex === 2) {
                    const isEnglishContext = isPreservedChar(prevChar) && isPreservedChar(nextChar);
                    if (!isEnglishContext) {
                      if (tempName.trim()) {
                        splitResult.push(trimCommas(tempName));
                      }
                      tempName = "";
                    } else {
                      tempName += char;
                    }
                  }
                } else {
                  tempName += char;
                }
              }
              if (tempName.trim()) {
                splitResult.push(trimCommas(tempName));
              }
              if (splitResult.length === 0) {
                newNames.push(currentName);
              } else {
                if (groupIndex === 2) {
                  const cjk1 = (t) => t.length === 1 && /[\u4e00-\u9fff]/.test(t);
                  const han = (t) => /^[\u4e00-\u9fff]+$/.test(t);
                  const sc = splitResult.filter((t) => cjk1(t));
                  if (sc.length) {
                    const merged = [];
                    for (let i = 0; i < splitResult.length; i++) {
                      const c = splitResult[i];
                      const n = splitResult[i + 1];
                      if (cjk1(c) && n && han(n) && n.length >= 2) {
                        merged.push(c + n);
                        i++;
                      } else if (n && cjk1(n) && c.length >= 2 && han(c)) {
                        merged.push(c + n);
                        i++;
                      } else if (cjk1(c) && n && cjk1(n)) {
                        merged.push(c + n);
                        i++;
                      } else {
                        merged.push(c);
                      }
                    }
                    newNames.push(...merged);
                  } else {
                    newNames.push(...splitResult);
                  }
                } else {
                  newNames.push(...splitResult);
                }
                if (groupIndex === 1 && hasValidSeparator) {
                  newNames.splice(newNames.length - splitResult.length, splitResult.length);
                  const reSplitResult = [];
                  let reTempName = "";
                  for (let i = 0; i < currentName.length; i++) {
                    const char = currentName[i];
                    const isSeparator = separators.includes(char);
                    if (isSeparator) {
                      if (reTempName.trim()) {
                        reSplitResult.push(trimCommas(reTempName));
                      }
                      reTempName = "";
                    } else {
                      reTempName += char;
                    }
                  }
                  if (reTempName.trim()) {
                    reSplitResult.push(trimCommas(reTempName));
                  }
                  newNames.push(...reSplitResult.filter((n) => n && n.trim() !== ""));
                }
              }
            }
            currentNames = newNames.filter((n) => n && n.trim() !== "");
          }
          currentNames.forEach((singleName) => {
            if (singleName && singleName.trim() !== "") {
              newStaffList.push(singleName.trim());
            }
          });
        }
        episodeStaff[role] = newStaffList.filter((name) => {
          if (seenNames.has(name) || !name || name.trim() === "") {
            return false;
          }
          seenNames.add(name);
          return true;
        });
      }
      let hasStaff = false;
      for (const [role, staffList] of Object.entries(episodeStaff)) {
        for (const name of staffList) {
          const staffName = name.replace(
            // eslint-disable-next-line no-irregular-whitespace
            /^([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]{1,4})[ 　]+([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]{1,4})$/g,
            "$1$2"
          );
          result[staffName] ||= {};
          result[staffName][role] ||= [];
          if (!result[staffName][role].includes(epLabel)) {
            result[staffName][role].push(epLabel);
            hasStaff = true;
          }
        }
      }
      if (!hasStaff) noStaffEps.push(epLabel);
    }
    return [result, noStaffEps];
  }
  function isPreservedChar(char) {
    return /[a-zA-Z\u30a0-\u30ff\u3005\u30fc]/.test(char);
  }
  function trimCommas(x) {
    if (typeof x === "string") {
      x = x.trim();
      while (x.startsWith("、")) {
        x = x.replace("、", "").trimStart();
      }
      while (x.endsWith("、")) {
        x = x.split("").reverse().join("").replace("、", "").trimStart().split("").reverse().join("");
      }
    }
    return x;
  }

  // src/state.js
  var roleOptions = (typeof crtTypeList === "undefined" ? [] : crtTypeList).filter((position) => position.cn && position.id).map((position) => ({ value: String(position.id), label: position.cn }));
  var roleValues = roleOptions.reduce((map, { value, label }) => {
    (map[label] ||= []).push(value);
    return map;
  }, {});
  var MERGE_PENDING = 23;
  var roleIdMap = roleOptions.reduce((map, { value, label }) => {
    if (value == MERGE_PENDING) return map;
    map[label] ??= value;
    return map;
  }, {});
  var ambiguousRoleLabels = new Set(
    Object.entries(roleValues).filter(([, values]) => values.filter((v) => v != MERGE_PENDING).length > 1).map(([label]) => label)
  );
  var staffSet = /* @__PURE__ */ new Set();
  var repeatSet = /* @__PURE__ */ new Set();
  var ambiguousRoleSet = /* @__PURE__ */ new Set();
  var bgmIdMap = {
    KADOKAWA: 19306,
    斉藤壮馬: 14604,
    週刊ビッグコミックスピリッツ: 7620,
    あきやまえんま: 30863,
    しづ: 12529,
    タチ: 12008,
    優: 18233,
    ホリ: 46769,
    Koi: 13864,
    KEI: 8295,
    tomomi: 45315,
    はらだ: 16346,
    LAM: 40914,
    lack: 30250,
    Ruki: 90718,
    ヒロユキ: 3404,
    かわく: 90716,
    あきやま: 30863,
    さと: 14236,
    かおり: 14760,
    NON: 10778,
    うめ: 8559,
    すか: 16242,
    フライ: 28795
  };
  var failedRequests = /* @__PURE__ */ new Map();
  var failedKeywords = /* @__PURE__ */ new Set();
  var unmatchedKeywords = /* @__PURE__ */ new Set();
  var RETRY_INTERVAL = 500;
  var MAX_RETRIES = 3;

  // src/aliases.js
  var getProvider = () => localStorage.getItem("wikiMissingPositionsProvider") || "https://bgq.iccci.cc.cd";
  var aliasMemo = /* @__PURE__ */ new Map();
  async function fetchAliases(name) {
    try {
      const res = await fetch(`${getProvider()}/api/aliases/${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) {
      console.error("personAliasFallback API error:", e);
    }
    const all = await window.personAliasQueryAll?.(name);
    if (all && all.length > 0) return all;
    if (all !== void 0) return [];
    const single = await window.personAliasQuery?.(name);
    if (single) return [single];
    return [];
  }
  function personAliasFallback(name) {
    if (!aliasMemo.has(name)) aliasMemo.set(name, fetchAliases(name));
    return aliasMemo.get(name);
  }
  async function personAliasFallbackBatch(names) {
    const unique = [...new Set(names)];
    const result = {};
    const missing = [];
    for (const name of unique) {
      if (aliasMemo.has(name)) result[name] = await aliasMemo.get(name);
      else missing.push(name);
    }
    if (missing.length) {
      try {
        const query = missing.map((n) => `names=${encodeURIComponent(n)}`).join("&");
        const res = await fetch(`${getProvider()}/api/aliases?${query}`);
        if (res.ok) {
          const data = await res.json();
          for (const name of missing) {
            const entries = data?.names?.[name];
            if (Array.isArray(entries)) {
              result[name] = entries;
              aliasMemo.set(name, Promise.resolve(entries));
            }
          }
        }
      } catch (e) {
        console.error("personAliasFallbackBatch API error:", e);
      }
      for (const name of missing) {
        if (!(name in result)) result[name] = await personAliasFallback(name);
      }
    }
    return result;
  }

  // src/opencc.js
  var regions = ["cn", "tw", "hk", "jp"];
  var converters = {};
  var loading;
  function refinedToCN(str) {
    const KEEP = "";
    const stashed = str.includes("ノ") ? str.replace(/ノ/g, KEEP) : str;
    const out = openccCN.refinedToCN(stashed, {
      jp2t: converters["jp-tw"] || OpenCC.Converter({ from: "jp", to: "tw" }),
      t2s: converters["tw-cn"] || OpenCC.Converter({ from: "tw", to: "cn" }),
      tw2s: converters["tw-cn"] || OpenCC.Converter({ from: "tw", to: "cn" }),
      hk2s: converters["hk-cn"] || OpenCC.Converter({ from: "hk", to: "cn" }),
      t2jp: converters["tw-jp"] || OpenCC.Converter({ from: "tw", to: "jp" })
    });
    return str.includes("ノ") ? out.replace(new RegExp(KEEP, "g"), "ノ") : out;
  }
  async function getConvertedNames(str) {
    if (!loading && !Object.keys(converters).length) {
      loading = new Promise((resolve) => {
        const srcs = [
          "https://cdn.jsdmirror.com/npm/opencc-js@1.0.5/dist/umd/full.js",
          "https://cdn.jsdmirror.com/npm/opencc-cn-name/dist/umd/opencc-cn-name.js"
        ];
        let remaining = srcs.length;
        let ok = true;
        srcs.forEach((src) => {
          const script = document.createElement("script");
          script.src = src;
          script.onload = () => {
            if (--remaining === 0) {
              if (ok && typeof OpenCC !== "undefined") {
                regions.forEach(
                  (from) => regions.forEach((to) => {
                    if (from !== to) converters[`${from}-${to}`] = OpenCC.Converter({ from, to });
                  })
                );
              }
              resolve(ok);
            }
          };
          script.onerror = () => {
            ok = false;
            if (--remaining === 0) resolve(false);
          };
          document.head.appendChild(script);
        });
      });
    }
    const success = await loading;
    if (!success || typeof openccCN === "undefined") return [];
    const converted = /* @__PURE__ */ new Set();
    regions.forEach(
      (from) => regions.forEach((to) => {
        if (from !== to) converted.add(converters[`${from}-${to}`](str));
      })
    );
    const refined = refinedToCN(str);
    if (refined !== str) converted.add(refined);
    return Array.from(converted);
  }

  // src/search.js
  async function autoSearchAndRelate(name, role) {
    try {
      const bgmIdMap2 = getLastestMap();
      const searchResult = await searchPerson(name);
      let ids = /* @__PURE__ */ new Set();
      let displayName;
      if (!searchResult) {
        failedKeywords.add(name);
        return;
      }
      if (Object.keys(searchResult).length) {
        for (let id in searchResult) {
          const resultName = searchResult[id].name;
          if (normalize(name) === normalize(resultName) || bgmIdMap2[name] == id || (await personAliasFallback(name)).some((a) => a.id == id)) {
            await addPersonToRelate(role, normalize(name), id, searchResult[id]);
            ids.add(id);
            displayName ||= resultName;
          } else {
            unmatchedKeywords.add(name);
          }
        }
      }
      if (!displayName) return;
      return { ids: [...ids], name: displayName };
    } catch (error) {
      console.error("autoSearchAndRelate failed:", error);
    }
  }
  function normalize(name) {
    return name.replace(/\s/g, "").replaceAll("-", "").replace(/々/g, function(m, offset, str) {
      return offset > 0 ? str[offset - 1] : "";
    }).replace(/[\u30A1-\u30F6]/g, function(match) {
      return String.fromCharCode(match.charCodeAt(0) - 96);
    }).replace(/[\uFF21-\uFF5A]/g, function(match) {
      return String.fromCharCode(match.charCodeAt(0) - 65248);
    }).toLowerCase();
  }
  function getLastestMap() {
    let json = localStorage.getItem("localPrsnMap");
    let mergedMap = { ...bgmIdMap };
    try {
      if (json) {
        let obj = JSON.parse(json);
        mergedMap = { ...mergedMap, ...obj };
      }
    } catch (e) {
      console.warn("Failed to parse localPrsnMap:", e);
    }
    return mergedMap;
  }
  function searchPerson(query) {
    return new Promise((resolve) => {
      const q = trans(query);
      const key = q;
      const execute = () => {
        $.ajax({
          type: "GET",
          url: `/json/search-person/${encodeURIComponent(q)}`,
          dataType: "json",
          success: (res) => {
            failedRequests.delete(key);
            resolve(res || {});
          },
          error: (xhr, status, error) => {
            const retries = (failedRequests.get(key) || 0) + 1;
            if (retries > MAX_RETRIES) {
              console.error("请求错误:", error, "查询:", query);
              failedRequests.delete(key);
              resolve(null);
              return;
            }
            failedRequests.set(key, retries);
            console.log(`"${query}" 将于 ${RETRY_INTERVAL}ms 后重试(${retries}/${MAX_RETRIES})`);
            setTimeout(execute, RETRY_INTERVAL);
          }
        });
      };
      execute();
    });
  }
  function trans(staff) {
    let id = bgmIdMap[staff];
    return id ? "bgm_id=" + id : staff;
  }
  async function addPersonToRelate(role, name, personId, personData) {
    const roleId = roleIdMap[role];
    const roleIdList = roleValues[role] || [roleId];
    if (!staffSet.has(roleId + "/" + personId)) {
      const existing = [...document.querySelectorAll("#crtRelateSubjects li")].some(
        (li) => li.querySelector(".title a").href.split("/").pop() == personId && roleIdList.includes(li.querySelector("select").value)
      );
      if (existing) return false;
      staffSet.add(roleId + "/" + personId);
      staffSet.has(roleId + name) ? repeatSet.add(name + "-" + role) : staffSet.add(roleId + name);
      if (ambiguousRoleLabels.has(role)) ambiguousRoleSet.add(name + "-" + role);
      subjectList[personId] = personData;
      addRelateSubject(personId, "searchResult");
      $("#crtRelateSubjects select").eq(0).val(roleId);
      addSbjListener();
      recolorRepeatRows();
      return true;
    }
    return false;
  }
  function recolorRepeatRows() {
    const groups = /* @__PURE__ */ new Map();
    for (const li of document.querySelectorAll("#crtRelateSubjects li")) {
      li.classList.remove("staff-repeat-li");
    }
    for (const li of document.querySelectorAll("#crtRelateSubjects li.clearit")) {
      const key = li.id || `${normalize(li.querySelector(".title a")?.textContent ?? "")}-${normalize(
        li.querySelector("option:checked")?.textContent.split(" /")[0] ?? ""
      )}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(li);
    }
    for (const lis of groups.values()) {
      if (lis.length < 2) continue;
      for (const li of lis) li.classList.add("staff-repeat-li");
    }
    return groups;
  }
  function addSbjListener() {
    $("#crtRelateSubjects .rr").off("click").on("click", function() {
      const $li = $(this).parents("li.clearit");
      const job = $li.find("option:checked").text().split(" /")[0];
      const staff = $li.find(".title a").text();
      const key = `${normalize(staff)}-${normalize(job)}`;
      $li.remove();
      const groups = recolorRepeatRows();
      if ((groups.get(key) || []).length < 2) repeatSet.delete(key);
    });
  }

  // src/ep.js
  var epsCache;
  var setEpsCache = (v) => {
    epsCache = v;
  };
  async function getEps(subjectId, offset = 0) {
    const response = await fetch(
      `https://api.bgm.tv/v0/episodes?subject_id=${subjectId}&offset=${offset}`
    );
    if (!response.ok) throw new Error(`API请求失败：HTTP ${response.status}`);
    const data = await response.json();
    return data.data || [];
  }
  function parseEpLabel(input) {
    if (!input) return "";
    const trimmed = input.trim();
    const match = trimmed.match(/^([a-zA-Z]+)\.(\d+(\.\d+)?)/);
    if (!match) return trimmed;
    const [, type, number] = match;
    return type.toLowerCase() === "ep" ? number : `${type}${number}`;
  }

  // src/appear-eps.js
  function isStrictInt(str) {
    return /^-?\d+$/.test(str);
  }
  function sortAppearEps(eps) {
    return eps.sort((a, b) => {
      const isANum = isStrictInt(a);
      const isBNum = isStrictInt(b);
      if (isANum && isBNum) return Number(a) - Number(b);
      if (isANum) return -1;
      if (isBNum) return 1;
      return a.localeCompare(b);
    });
  }
  function parseAppearEps(input) {
    if (!input) return [];
    const rawSegments = input.split(",").map((seg) => seg.trim()).filter((seg) => seg);
    const resultSet = /* @__PURE__ */ new Set();
    rawSegments.forEach((seg) => {
      if (seg.includes("-")) {
        const [s, e] = seg.split("-").map((p) => p.trim());
        if (isStrictInt(s) && isStrictInt(e)) {
          const min = Math.min(Number(s), Number(e));
          const max = Math.max(Number(s), Number(e));
          for (let i = min; i <= max; i++) {
            resultSet.add(i.toString());
          }
        } else {
          resultSet.add(seg);
        }
      } else {
        resultSet.add(seg);
      }
    });
    return sortAppearEps(Array.from(resultSet));
  }
  function genAppearEps(epArr) {
    epArr = sortAppearEps([...new Set(epArr)]);
    const isStrictInt2 = (str) => /^-?\d+$/.test(str);
    const integers = epArr.filter(isStrictInt2).map(Number);
    const others = epArr.filter((e) => !isStrictInt2(e));
    const rangeParts = [];
    if (integers.length > 0) {
      let start = integers[0];
      let prev = integers[0];
      for (let i = 1; i <= integers.length; i++) {
        const curr = integers[i];
        if (i < integers.length && curr === prev + 1) {
          prev = curr;
        } else {
          rangeParts.push(start === prev ? `${start}` : `${start}-${prev}`);
          if (i < integers.length) {
            start = curr;
            prev = curr;
          }
        }
      }
    }
    return [...rangeParts, ...others].join(",");
  }

  // src/tip-box.js
  function createDraggableTipBox(newRecords, existingRecords, unMatchedRecords, noStaffEps, roleMissingEps) {
    document.querySelector(".staff-tip-box")?.remove();
    const tipBox = document.createElement("div");
    tipBox.className = "staff-tip-box";
    tipBox.id = "wikiEpRelate";
    const dragHandle = document.createElement("div");
    dragHandle.className = "staff-tip-handle";
    const handleLabel = document.createElement("span");
    handleLabel.textContent = "制作人员参与填写结果";
    dragHandle.append(handleLabel);
    const contentBox = document.createElement("div");
    contentBox.className = "staff-tip-content";
    tipBox.append(dragHandle, contentBox);
    contentBox.innerHTML = `
        ${noStaffEps?.length ? `<div class="staff-warning-section">
        <div class="staff-warning-title">以下${noStaffEps.length}个集数未匹配到任何制作人员信息：</div>
        ${noStaffEps.map((ep) => `<span title="${escapeAttr(epsCache?.[ep]?.desc || "")}"><a class="l" href="/ep/${epsCache?.[ep]?.id}" target="_blank">${ep}</a></span>`).join(",")}
        </div>` : ""}
        ${Object.entries(roleMissingEps).map(
      ([role, missingEps]) => `
            <div class="staff-warning-section">
                <div class="staff-warning-title">职位「${role}」在以下${missingEps.length}个集数中未出现：</div>
                ${missingEps.map((ep) => `<span title="${escapeAttr(epsCache?.[ep]?.desc || "")}"><a class="l" href="/ep/${epsCache?.[ep]?.id}" target="_blank">${ep}</a></span>`).join(",")}
            </div>
        `
    ).join("")}
        ${repeatSet.size ? `<div class="staff-warning-section">
            <div class="staff-warning-title">以下${repeatSet.size}个新关联的同名制作人员需要检查：</div>
            ${[...repeatSet].map((repeat) => `<a class="l" href="#staff-${repeat}">${repeat.replace(/-(.+)$/, "（$1）")}</a>`).join("、")}
            </div>` : ""}
        ${ambiguousRoleSet.size ? `<div class="staff-warning-section">
            <div class="staff-warning-title">以下${ambiguousRoleSet.size}个新关联使用的是同名职位中的第一个，关联到的项可能并非目标「制作助理」，请核对：</div>
            ${[...ambiguousRoleSet].map((pair) => `<a class="l" href="#staff-${pair}">${pair.replace(/-(.+)$/, "（$1）")}</a>`).join("、")}
            </div>` : ""}
        ${recordSection(newRecords, "新增参与（点击跳转）", "new")}
        ${recordSection(existingRecords, "已有参与（点击跳转）", "existing")}
        ${recordSection(unMatchedRecords, "未匹配", "unmatched")}
        ${(() => {
      if (!epsCache) return "";
      const epCacheEntries = Object.entries(epsCache);
      return `<details><summary>各集详情</summary>${epCacheEntries.map(
        ([epLabel, { desc }]) => `
                <details><summary>${epLabel}</summary>${desc.replaceAll("\n", "<br>")}</details>`
      ).join("")}</details>`;
    })()}`;
    contentBox.querySelectorAll(":scope .search-again").forEach(
      (a) => a.addEventListener("click", () => {
        document.querySelector("#subjectName").value = a.dataset.keyword;
        findSubjectFunc();
      })
    );
    function recordSection(records, text, className) {
      if (!records.length) return "";
      const itemTag = className === "unmatched" ? "div" : "a";
      return (
        /* html */
        `
        <div class="staff-record-list">
            <h4 class="staff-tip-title ${className}">${text}</h4>
            ${records.map(
          ({ name, names, role, epLabels, aliases, liId }) => `
                <${itemTag} class="staff-record-item ${className}" ${liId ? `href="#${escapeAttr(liId)}"` : ""}>
                    ${(() => {
            const matchedNames = (names?.length ? names : [name]).map((n) => `<span class="staff-person-name">${n}</span>`).join("、");
            const originalNames = aliases && Object.keys(aliases) || [];
            const bracket = originalNames.length ? `<span title="${escapeAttr(
              Object.values(aliases).map((eps) => eps.join(",")).join(",")
            )}">[${originalNames.map(escapeAttr).join("、")}]</span>` : "";
            return bracket ? `${matchedNames} ${bracket}` : matchedNames;
          })()}
                    （${role}）${epLabels.length ? ` - ${epLabels.map((ep) => `<span title="${escapeAttr(epsCache?.[ep]?.desc || "")}">${ep}</span>`).join(",")}` : ""}
                    ${className === "unmatched" ? `→ <a class="l" href="/person/new?name=${escapeAttr(name)}" target="blank">创建</a>
                    ${failedKeywords.has(name) ? ` / 自动搜索失败，<a class="l search-again" data-keyword="${name}" href="javascript:">点击再次搜索</a>` : ""}
                    ${unmatchedKeywords.has(name) ? ` / <a class="l search-again" data-keyword="${name}" href="javascript:">查看搜索结果</a>` : ""}` : ""}
                </${itemTag}>`
        ).join("")}
        </div>`
      );
    }
    tipBox.style.opacity = "0";
    document.body.appendChild(tipBox);
    contentBox.querySelectorAll("a.staff-record-item").forEach((item) => {
      const rowId = item.getAttribute("href")?.slice(1);
      if (!rowId) return;
      for (const row of document.querySelectorAll("#crtRelateSubjects li")) {
        if (row.id !== rowId || row.querySelector(".staff-row-jump")) continue;
        const btn = document.createElement("button");
        btn.className = "staff-row-jump";
        btn.type = "button";
        btn.textContent = "⤷";
        btn.title = "定位到结果面板对应记录" + (row.dataset.aliasOrigin ? `
来自原名：${row.dataset.aliasOrigin.replaceAll("\n", "、")}` : "");
        btn.addEventListener("click", () => {
          item.scrollIntoView({ block: "center", behavior: "smooth" });
          item.classList.add("staff-row-jump-flash");
          setTimeout(() => item.classList.remove("staff-row-jump-flash"), 1200);
        });
        row.querySelector(".title").append(btn);
      }
    });
    let isDragging = false;
    let startX, startY, offsetX, offsetY;
    const boxWidth = tipBox.offsetWidth;
    const boxHeight = tipBox.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    let targetRight = 50;
    let targetBottom = 50;
    const maxRight = windowWidth - boxWidth;
    targetRight = Math.min(targetRight, maxRight);
    targetRight = Math.max(targetRight, 0);
    const maxBottom = windowHeight - boxHeight;
    targetBottom = Math.min(targetBottom, maxBottom);
    targetBottom = Math.max(targetBottom, 0);
    tipBox.style.bottom = `${targetBottom}px`;
    tipBox.style.right = `${targetRight}px`;
    tipBox.style.opacity = "";
    function handleMove(clientX, clientY) {
      const moveX = clientX - startX;
      const moveY = clientY - startY;
      const newX = offsetX + moveX;
      const newY = offsetY + moveY;
      tipBox.style.left = `${newX}px`;
      tipBox.style.top = `${newY}px`;
      tipBox.style.right = "auto";
      tipBox.style.bottom = "auto";
    }
    dragHandle.addEventListener("mousedown", (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      offsetX = tipBox.offsetLeft;
      offsetY = tipBox.offsetTop;
    });
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      handleMove(e.clientX, e.clientY);
    });
    document.addEventListener("mouseup", () => {
      if (isDragging) isDragging = false;
    });
    dragHandle.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        isDragging = true;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        offsetX = tipBox.offsetLeft;
        offsetY = tipBox.offsetTop;
      },
      { passive: false }
    );
    document.addEventListener(
      "touchmove",
      (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
      },
      { passive: false }
    );
    document.addEventListener("touchend", () => {
      if (isDragging) isDragging = false;
    });
  }
  function escapeAttr(str) {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // src/person-matching.js
  async function updAppearEps(staffInfo, noStaffEps, { summary, progress = "解析参与中", indicatorId = "epDescStaff" } = {}) {
    const groupedRecords = {
      new: {},
      // 本次新增的参与记录
      existing: {},
      // 已存在的参与记录
      unmatched: {}
      // 未匹配记录
    };
    const oldLis = [...document.querySelectorAll("#crtRelateSubjects li")];
    const allEpLabels = /* @__PURE__ */ new Set();
    const roleEpMap = {};
    const indicator = document.querySelector(`#${indicatorId}`);
    const staffInfoEntries = Object.entries(staffInfo);
    const total = staffInfoEntries.length;
    let i = 0;
    for (const [originalName, roles] of staffInfoEntries) {
      i++;
      indicator.textContent = `${progress}（${i}/${total}）……`;
      for (const [role, epLabels] of Object.entries(roles)) {
        let handleMatched = function(matchedLi2) {
          matchedLi2.id ||= liId;
          if (aliased && !matchedLi2.classList.contains("old")) {
            matchedLi2.classList.add("staff-alias-li");
          }
          if (aliased) {
            const names = matchedLi2.dataset.aliasOrigin ? matchedLi2.dataset.aliasOrigin.split("\n") : [];
            if (!names.includes(originalName)) names.push(originalName);
            matchedLi2.dataset.aliasOrigin = names.join("\n");
          }
          if (!epLabels.length) {
            const targetGroup = matchedLi2.classList.contains("old") ? "existing" : "new";
            const record = groupedRecords[targetGroup][groupKey] ||= {
              name,
              names: [],
              role,
              epLabels: /* @__PURE__ */ new Set(),
              aliases: {},
              liId,
              personIds: [],
              sourceNorms: []
            };
            const canonicalName = matchedLi2.querySelector(".title a").textContent;
            if (!record.names.includes(canonicalName)) record.names.push(canonicalName);
            const personId = matchedLi2.querySelector(".title a").href.split("/").pop();
            if (!record.personIds.includes(personId)) record.personIds.push(personId);
            const sourceNorm = normalize(originalName);
            if (!record.sourceNorms.includes(sourceNorm)) record.sourceNorms.push(sourceNorm);
            if (aliased) record.aliases[originalName] ||= [];
            return;
          }
          const input = matchedLi2.querySelector('[name$="[appear_eps]"]');
          const existingSet = new Set(parseAppearEps(input.value));
          const labelsToAdd = [];
          for (const epLabel of epLabels) {
            const wasExisting = existingSet.has(epLabel);
            if (!wasExisting) {
              labelsToAdd.push(epLabel);
              if (matchedLi2.classList.contains("old")) {
                matchedLi2.classList.add("staff-changed-li");
              }
            }
            const targetGroup = wasExisting ? "existing" : "new";
            const record = groupedRecords[targetGroup][groupKey] ||= {
              name,
              names: [],
              role,
              epLabels: /* @__PURE__ */ new Set(),
              aliases: {},
              liId,
              personIds: [],
              sourceNorms: []
            };
            record.epLabels.add(epLabel);
            const personId = matchedLi2.querySelector(".title a").href.split("/").pop();
            if (!record.personIds.includes(personId)) record.personIds.push(personId);
            const canonicalName = matchedLi2.querySelector(".title a").textContent;
            if (!record.names.includes(canonicalName)) record.names.push(canonicalName);
            const sourceNorm = normalize(originalName);
            if (!record.sourceNorms.includes(sourceNorm)) record.sourceNorms.push(sourceNorm);
            if (aliased) {
              record.aliases[originalName] ||= [];
              record.aliases[originalName].push(epLabel);
            }
          }
          if (labelsToAdd.length) {
            input.value = genAppearEps([...existingSet, ...labelsToAdd]);
          }
        };
        epLabels.forEach((ep) => allEpLabels.add(ep));
        if (!roleEpMap[role]) roleEpMap[role] = /* @__PURE__ */ new Set();
        epLabels.forEach((ep) => roleEpMap[role].add(ep));
        const roleId = roleIdMap[role];
        if (!roleId) continue;
        let aliased = false;
        const roleIdList = roleValues[role] || [roleId];
        const sameRole = (li) => roleIdList.includes(li.querySelector("select").value);
        const sameName = (name2) => (li) => {
          const liName = li.querySelector(".title a").textContent;
          return normalize(liName) === normalize(name2);
        };
        const similarName = (name2) => (li) => {
          const liName = li.querySelector(".title a").textContent;
          return isSimilarOrContained(normalize(name2), normalize(liName));
        };
        const sameId = (id) => (li) => {
          const liId2 = li.querySelector(".title a").href.split("/").pop();
          return liId2 == id;
        };
        const matchOldLi = (name2) => oldLis.find((li) => sameName(name2)(li) && sameRole(li));
        let matchedLiFuzzy;
        const memOldLiFuzzy = (name2) => matchedLiFuzzy ||= oldLis.find((li) => similarName(name2)(li) && sameRole(li));
        let matchedLi, name = originalName;
        async function* candidateNames() {
          const yielded = /* @__PURE__ */ new Set([originalName]);
          const yieldUnique = (v) => {
            if (yielded.has(v)) return false;
            yielded.add(v);
            return true;
          };
          yield originalName;
          aliased = true;
          const variants = await getConvertedNames(originalName);
          const aliasMap = await personAliasFallbackBatch([originalName, ...variants]);
          for (const a of aliasMap[originalName] || []) {
            if (yieldUnique(a.name)) yield a.name;
          }
          for (const name2 of variants) {
            if (yieldUnique(name2)) yield name2;
          }
          for (const name2 of variants) {
            for (const a of aliasMap[name2] || []) {
              if (yieldUnique(a.name)) yield a.name;
            }
          }
        }
        for await (const candidate of candidateNames()) {
          matchedLi = matchOldLi(candidate);
          if (!matchedLi) {
            memOldLiFuzzy(candidate);
            continue;
          }
          name = candidate;
          break;
        }
        if (!matchedLi) {
          if (matchedLiFuzzy) {
            matchedLi = matchedLiFuzzy;
            name = matchedLi.querySelector(".title a").textContent;
            aliased = true;
          }
        }
        let matchedLis;
        if (!matchedLi) {
          aliased = false;
          for await (const candidate of candidateNames()) {
            const searchResult = await autoSearchAndRelate(candidate, role);
            if (!searchResult) continue;
            const { ids, name: resultName } = searchResult;
            const newLiList = [...document.querySelectorAll("#crtRelateSubjects li:not(.old)")];
            if (ids.length === 1) {
              matchedLi = newLiList.find((li) => sameId(ids[0])(li) && sameRole(li));
            } else {
              matchedLis = newLiList.filter((li) => ids.some((id) => sameId(id)(li)) && sameRole(li));
            }
            if (name !== resultName) aliased = true;
            name = resultName;
            break;
          }
        }
        let groupKey = `${normalize(originalName)}-${role}`;
        let liId = `staff-${originalName.replace(/\s/g, "")}-${role.replace(/\s/g, "")}`;
        if (matchedLi) {
          handleMatched(matchedLi);
        } else if (matchedLis) {
          matchedLis.forEach(handleMatched);
        } else if (await tryReSplit()) {
        } else {
          groupedRecords.unmatched[groupKey] ||= {
            name: originalName,
            role,
            epLabels: new Set(epLabels)
          };
        }
        async function tryReSplit() {
          const trySearch = async (token) => {
            const sr = await autoSearchAndRelate(token, role);
            if (!sr) return null;
            const { ids, name: resultName } = sr;
            const allLis = [...document.querySelectorAll("#crtRelateSubjects li")];
            const li = allLis.find((l) => ids.some((id) => sameId(id)(l)) && sameRole(l));
            return li ? { name: resultName, li } : null;
          };
          if (/[ 　]/.test(originalName)) {
            const tokens = originalName.split(/[ 　]+/).filter(Boolean);
            const cjkTokens = tokens.filter(
              (t) => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u3005\u30fc]/.test(t)
            );
            if (cjkTokens.length > 1) {
              const matched = [];
              for (const token of cjkTokens) {
                let li = matchOldLi(token);
                if (li) {
                  matched.push({ name: token, li, token });
                  continue;
                }
                const sr = await trySearch(token);
                if (sr) {
                  matched.push({ name: sr.name, li: sr.li, token });
                }
              }
              if (matched.length) {
                for (const m of matched) {
                  name = m.name;
                  groupKey = `${normalize(m.name)}-${role}`;
                  liId = `staff-${m.name.replace(/\s/g, "")}-${role.replace(/\s/g, "")}`;
                  handleMatched(m.li);
                }
                const matchedSet = new Set(matched.map((m) => m.token));
                const rest = cjkTokens.filter((t) => !matchedSet.has(t));
                if (rest.length) {
                  const restName = rest.join(" ");
                  groupedRecords.unmatched[`${restName}-${role}`] ||= {
                    name: restName,
                    role,
                    epLabels: new Set(epLabels)
                  };
                }
                return true;
              }
            }
          }
          if (/[・•·･]/.test(originalName)) {
            const tokens = originalName.split(/[・•·･]+/).filter(Boolean);
            const matched = [];
            for (const token of tokens) {
              let li = matchOldLi(token);
              if (li) {
                matched.push({ name: token, li, token });
                continue;
              }
              const sr = await trySearch(token);
              if (sr) {
                matched.push({ name: sr.name, li: sr.li, token });
              }
            }
            if (matched.length) {
              for (const m of matched) {
                name = m.name;
                groupKey = `${m.name}-${role}`;
                liId = `staff-${m.name.replace(/\s/g, "")}-${role.replace(/\s/g, "")}`;
                handleMatched(m.li);
              }
              const matchedSet = new Set(matched.map((m) => m.token));
              const rest = tokens.filter((t) => !matchedSet.has(t));
              if (rest.length) {
                const restName = rest.join("・");
                groupedRecords.unmatched[`${restName}-${role}`] ||= {
                  name: restName,
                  role,
                  epLabels: new Set(epLabels)
                };
              }
              return true;
            }
          }
          {
            const desc = epsCache?.[epLabels[0]]?.desc || "";
            if (desc) {
              const esc = originalName.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
              const m = desc.match(new RegExp(esc));
              if (m && /\s/.test(m[0])) {
                const parts = m[0].split(/\s+/).filter(Boolean);
                if (parts.length > 1 && !parts.some((p) => p.length === 1 && /[\u4e00-\u9fff]/.test(p))) {
                  const matched = [];
                  for (const part of parts) {
                    let li = matchOldLi(part);
                    if (!li) {
                      const sr = await trySearch(part);
                      if (sr) li = sr.li;
                    }
                    if (li) matched.push({ name: part, li });
                  }
                  if (matched.length) {
                    aliased = false;
                    for (const m2 of matched) {
                      name = m2.name;
                      groupKey = `${normalize(m2.name)}-${role}`;
                      liId = `staff-${m2.name.replace(/\s/g, "")}-${role.replace(/\s/g, "")}`;
                      handleMatched(m2.li);
                    }
                    const matchedSet = new Set(matched.map((m2) => m2.name));
                    const rest = parts.filter((p) => !matchedSet.has(p));
                    if (rest.length) {
                      const restName = rest.join(" ");
                      groupedRecords.unmatched[`${restName}-${role}`] ||= {
                        name: restName,
                        role,
                        epLabels: new Set(epLabels)
                      };
                    }
                    return true;
                  }
                }
              }
            }
          }
          return false;
        }
      }
    }
    const roleMissingEps = {};
    Object.entries(roleEpMap).forEach(([role, presentEps]) => {
      const missingEps = [];
      allEpLabels.forEach((ep) => {
        if (!presentEps.has(ep)) {
          missingEps.push(ep);
        }
      });
      if (missingEps.length && missingEps.length < allEpLabels.size) {
        roleMissingEps[role] = missingEps;
      }
    });
    recolorRepeatRows();
    createDraggableTipBox(
      formatRecords(groupedRecords.new),
      formatRecords(groupedRecords.existing),
      formatRecords(groupedRecords.unmatched),
      noStaffEps,
      roleMissingEps
    );
    const editSummaryInput = document.querySelector("#editSummary");
    editSummaryInput.value = summary ?? `根据${new URLSearchParams(location.search).get("source") || ""}章节简介填写参与`;
  }
  function mergeRecords(records) {
    const merged = [];
    for (const item of Object.values(records)) {
      const itemPersonIds = item.personIds || [];
      const itemSourceNorms = item.sourceNorms || [];
      const target = merged.find(
        (m) => m.role === item.role && ((m.personIds || []).some((p) => itemPersonIds.includes(p)) || (m.sourceNorms || []).some((n) => itemSourceNorms.includes(n)))
      );
      if (!target) {
        merged.push(item);
        continue;
      }
      target.personIds ||= [];
      target.sourceNorms ||= [];
      target.names ||= [];
      for (const p of itemPersonIds) if (!target.personIds.includes(p)) target.personIds.push(p);
      for (const n of itemSourceNorms)
        if (!target.sourceNorms.includes(n)) target.sourceNorms.push(n);
      for (const n of item.names || []) if (!target.names.includes(n)) target.names.push(n);
      item.epLabels.forEach((ep) => target.epLabels.add(ep));
      for (const [alias, eps] of Object.entries(item.aliases || {})) {
        target.aliases[alias] ||= [];
        target.aliases[alias].push(...eps);
      }
    }
    return merged;
  }
  function formatRecords(records) {
    const merged = mergeRecords(records);
    const processedRecords = merged.map((item) => ({
      ...item,
      epLabels: Array.from(item.epLabels).sort((a, b) => {
        const typeOrder = { "": 0, SP: 1, OP: 2, ED: 3 };
        const aType = a.match(/^(SP|OP|ED)/)?.[0] || "";
        const bType = b.match(/^(SP|OP|ED)/)?.[0] || "";
        if (aType !== bType) return typeOrder[aType] - typeOrder[bType];
        const aNum = parseFloat(a.replace(/[A-Za-z]/g, "")) || 0;
        const bNum = parseFloat(b.replace(/[A-Za-z]/g, "")) || 0;
        return aNum - bNum;
      })
    }));
    return processedRecords.sort((a, b) => {
      if (a.role === void 0 || a.role === null) return -1;
      if (b.role === void 0 || b.role === null) return 1;
      return a.role.localeCompare(b.role);
    });
  }
  function isSimilarOrContained(str1, str2) {
    if (!str1 || !str2) return false;
    str1 = str1.trim();
    str2 = str2.trim();
    if (str2.includes(str1)) {
      return true;
    }
    if (Math.abs(str1.length - str2.length) > 1) {
      return false;
    }
    let diff = 0;
    for (let i = 0, j = 0; i < str1.length && j < str2.length; i++, j++) {
      if (str1[i] !== str2[j]) {
        diff++;
        if (diff > 1) return false;
        if (str1.length > str2.length)
          j--;
        else if (str1.length < str2.length) i--;
      }
    }
    return diff <= 1;
  }

  // ../wikiMissingPositions/src/position-ids.js
  var POSITION_IDS = {
    2: {
      1: "原作",
      2: "导演",
      3: "脚本",
      4: "分镜",
      5: "演出",
      6: "音乐",
      7: "人物原案",
      8: "人物设定",
      9: "构图",
      10: "系列构成",
      11: "美术监督",
      13: "色彩设计",
      14: "总作画监督",
      15: "作画监督",
      16: "机械设定",
      17: "摄影监督",
      18: "监修",
      19: "道具设计",
      20: "原画",
      21: "第二原画",
      22: "动画检查",
      24: "制作助理",
      25: "背景美术",
      26: "色彩指定",
      27: "数码绘图",
      28: "剪辑",
      29: "原案",
      30: "主题歌编曲",
      31: "主题歌作曲",
      32: "主题歌作词",
      33: "主题歌演出",
      34: "插入歌演出",
      35: "企画",
      36: "企划制作人",
      37: "制作管理",
      38: "宣传",
      39: "录音",
      40: "录音助理",
      41: "系列监督",
      42: "製作",
      43: "设定",
      44: "音响监督",
      45: "音响",
      46: "音效",
      47: "特效",
      48: "配音监督",
      49: "联合导演",
      50: "背景设定",
      51: "补间动画",
      52: "执行制片人",
      53: "助理制片人",
      54: "制片人",
      55: "音乐助理",
      56: "制作进行",
      57: "演员监督",
      58: "总制片人",
      59: "联合制片人",
      60: "台词编辑",
      61: "后期制片协调",
      62: "制作助理",
      63: "制作",
      64: "制作协调",
      65: "音乐制作",
      66: "特别鸣谢",
      67: "动画制作",
      69: "CG 导演",
      70: "机械作画监督",
      71: "美术设计",
      72: "副导演",
      73: "OP・ED 分镜",
      74: "总导演",
      75: "3DCG",
      76: "制作协力",
      77: "动作作画监督",
      80: "监制",
      81: "协力",
      82: "摄影",
      83: "制作进行协力",
      84: "设定制作",
      85: "音乐制作人",
      86: "3DCG 导演",
      87: "动画制片人",
      88: "特效作画监督",
      89: "主演出",
      90: "作画监督助理",
      91: "演出助理",
      92: "主动画师",
      93: "上色",
      94: "上色检查",
      95: "色彩检查",
      96: "美术板",
      97: "美术",
      98: "印象板",
      99: "2D 设计",
      100: "3D 设计",
      101: "技术导演",
      102: "特技导演",
      103: "色彩脚本",
      104: "分镜协力",
      105: "分镜抄写",
      106: "副人物设定",
      107: "客座人物设定",
      108: "构图监修",
      109: "构图作画监督",
      110: "总作画监督助理",
      111: "道具作画监督",
      112: "概念设计",
      113: "服装设计",
      114: "标题设计",
      115: "设定协力",
      116: "音乐监督",
      117: "选曲",
      118: "插入歌作词",
      119: "插入歌作曲",
      120: "插入歌编曲",
      121: "创意制片人",
      122: "副制片人",
      123: "制作统括",
      124: "现场制片人",
      125: "文艺制作",
      127: "企画协力",
      128: "OP・ED 演出",
      129: "Bank 分镜演出",
      130: "Live 分镜演出",
      131: "剧中剧分镜演出",
      132: "剧中剧人设",
      133: "视觉导演",
      134: "创意总监",
      135: "特摄效果",
      136: "视觉效果",
      137: "动作导演",
      138: "转场绘",
      139: "插画",
      140: "角色作画监督",
      141: "作画监修",
      142: "机设原案",
      143: "概念艺术",
      144: "视觉概念",
      145: "画面设计",
      146: "怪物设计",
      147: "故事概念",
      148: "剧本协调",
      149: "脚本协力",
      150: "副系列构成",
      151: "构成协力",
      152: "录音工作室",
      153: "整音",
      154: "音响制作担当",
      155: "在线剪辑",
      156: "离线剪辑",
      157: "3D 动画师",
      158: "CG 制作人",
      159: "宣传制片人",
      160: "美术制作人",
      161: "音响制作人",
      162: "CG 制作进行",
      163: "美术制作进行",
      164: "美术监督助理",
      165: "色彩设计助理",
      166: "摄影监督助理",
      167: "制作管理助理",
      168: "设定制作助理",
      169: "剪辑助理",
      170: "宣传协力",
      171: "建模/模型",
      172: "视觉开发/外观开发",
      173: "动画导演",
      174: "发行",
      175: "原作协力",
      176: "製作协力",
      177: "製作统括",
      178: "制作事务",
      179: "OP・ED 动画制作",
      180: "3DCG 导演助理",
      181: "CG 导演助理",
      182: "制作制片人"
    },
    1: {
      2001: "作者",
      2002: "作画",
      2003: "插图",
      2004: "出版社",
      2005: "连载杂志",
      2006: "译者",
      2007: "原作",
      2008: "客串",
      2009: "人物原案",
      2010: "脚本",
      2011: "书系",
      2012: "出品方",
      2013: "图书品牌",
      2014: "编著",
      2015: "构成",
      2016: "监修",
      2017: "解说"
    },
    4: {
      1001: "开发",
      1002: "发行",
      1003: "游戏设计师",
      1004: "剧本",
      1005: "美工",
      1006: "音乐",
      1007: "关卡设计",
      1008: "人物设定",
      1009: "主题歌作曲",
      1010: "主题歌作词",
      1011: "主题歌演出",
      1012: "插入歌演出",
      1013: "原画",
      1014: "动画制作",
      1015: "原作",
      1016: "导演",
      1017: "动画监督",
      1018: "制作总指挥",
      1019: "QC",
      1020: "动画剧本",
      1021: "程序",
      1022: "协力",
      1023: "CG 监修",
      1024: "SD原画",
      1025: "背景",
      1026: "监修",
      1027: "系列构成",
      1028: "企画",
      1029: "机械设定",
      1030: "音响监督",
      1031: "作画监督",
      1032: "制作人",
      1033: "海报",
      1034: "UI",
      1035: "配音导演"
    },
    3: {
      3001: "艺术家",
      3002: "制作人",
      3003: "作曲",
      3004: "厂牌",
      3005: "原作",
      3006: "作词",
      3007: "录音",
      3008: "编曲",
      3009: "插图",
      3010: "脚本",
      3011: "出版方",
      3012: "母带制作",
      3013: "混音",
      3014: "乐器",
      3015: "声乐",
      3016: "念白/旁白",
      3017: "人声编辑",
      3018: "人声指导",
      3019: "客串",
      3020: "音响监督",
      3021: "合唱",
      3022: "和声",
      3023: "设计"
    },
    6: {
      4001: "原作",
      4002: "导演",
      4003: "编剧",
      4004: "音乐",
      4005: "执行制片人",
      4006: "共同执行制作",
      4007: "制片人/制作人",
      4008: "监制",
      4009: "副制作人/制作顾问",
      4010: "故事",
      4011: "编审",
      4012: "剪辑",
      4013: "创意总监",
      4014: "摄影",
      4015: "主题歌演出",
      4016: "主演",
      4017: "配角",
      4018: "制作",
      4019: "出品",
      4020: "配音导演",
      4021: "录音",
      4022: "海报",
      4023: "企划/策划",
      4024: "副导演",
      4025: "美术",
      4026: "联合制片人/副制片人",
      4027: "动作导演/武术指导",
      4028: "特技指导",
      4029: "特摄导演",
      4030: "实拍特效",
      4031: "视觉特效",
      4032: "3DCG",
      4033: "设定",
      4034: "人物设计/皮套设计",
      4035: "造型设计",
      4036: "生物设计",
      4037: "怪兽设计",
      4038: "承制方/摄制",
      4039: "宣传",
      4040: "协力",
      4041: "特别鸣谢",
      4042: "音响监督",
      4043: "后期",
      4044: "发行"
    }
  };

  // src/infobox.js
  var SPLIT_RULE = /[()[\]{}（）<>《》「」『』【】+×·→/／、,，;；:：&＆\\]/;
  var FILTER_WORDS = ["CV:", "CV\\.", "feat\\.", "\\*"];
  var EP_MARKER_RE = /^\d+$|^\d+\s*-\s*\d+$|^(?:OP|ED|SP)(?:\d+)?$/i;
  var TYPE_CODES = { anime: 2, book: 1, music: 3, game: 4, real: 6 };
  function splitStaffs(staffs) {
    return Array.from(
      new Set(
        staffs.replace(new RegExp(FILTER_WORDS.join("|"), "g"), ",").split(SPLIT_RULE).map((staff) => staff.trim()).filter(Boolean).filter((staff) => !EP_MARKER_RE.test(staff))
      )
    );
  }
  function fetchInfobox() {
    const subjectId = location.pathname.split("/")[2];
    return fetch(`/subject/${subjectId}`).then((res) => res.text()).then((html) => new DOMParser().parseFromString(html, "text/html").querySelector("#infobox"));
  }
  async function getInfoboxStaffInfo() {
    const infobox = document.querySelector("#infobox") || await fetchInfobox();
    if (!infobox) throw new Error("未找到infobox");
    const typeSel = document.querySelector(".focus.chl")?.href.split("/").pop();
    const typeCode = TYPE_CODES[typeSel] || 2;
    const typeLabel = TYPE_CODES[typeSel] ? typeSel : "anime";
    const positionNames = new Set(Object.values(POSITION_IDS[typeCode] || {}));
    const staffInfo = {};
    const unknownRoles = /* @__PURE__ */ new Set();
    const skippedRoles = [];
    const allRows = [];
    for (const li of infobox.querySelectorAll("li")) {
      if (li.classList.contains("sub_container")) continue;
      const job = li.childNodes[0]?.textContent.replace(":", "").trim();
      const staffs = li.childNodes[1]?.textContent.trim();
      if (!job || !staffs || !staffs.trim()) continue;
      const names = splitStaffs(staffs.trim());
      allRows.push({ job, names });
      if (!positionNames.has(job)) {
        skippedRoles.push(job);
        continue;
      }
      if (!roleIdMap[job]) {
        unknownRoles.add(job);
        continue;
      }
      for (const name of names) {
        (staffInfo[name] ||= {})[job] = [];
      }
    }
    return { staffInfo, unknownRoles: [...unknownRoles], skippedRoles, allRows, typeLabel };
  }

  // src/index.js
  (async function main() {
    if (location.pathname.match(/^\/ep\/\d+$/)) {
      const subjectId = document.querySelector(".nameSingle a").href.split("/").pop();
      const epLabel = parseEpLabel(document.title);
      const epDesc = document.querySelector(".epDesc")?.textContent;
      if (!epDesc) return;
      const [sfaffInfo] = extractStaffInfo({ [epLabel]: epDesc });
      const staffJSON = JSON.stringify(sfaffInfo);
      if (staffJSON === "{}") return;
      document.querySelector(".title").insertAdjacentHTML(
        "beforeend",
        `<small><a class="l staff-link" href="/subject/${subjectId}/add_related/person?source=${epLabel}&staffs=${encodeURIComponent(staffJSON)}">[关联制作人员参与]</a></small>`
      );
    }
    if (location.pathname.match(/^\/person\/new$/)) {
      const params = new URLSearchParams(location.search);
      if (!params.has("name")) return;
      const name = params.get("name");
      document.querySelector("#crt_name").value = name;
    } else if (location.pathname.match(/^\/subject\/\d+\/add_related\/person$/)) {
      const isAnime = document.querySelector(".focus.chl")?.href.split("/").pop() === "anime";
      const subjectId = location.pathname.split("/")[2];
      const catBox = document.querySelector("#indexCatBox");
      let btn = null;
      if (isAnime) {
        btn = document.createElement("button");
        btn.textContent = "获取章节简介填写参与";
        btn.id = "epDescStaff";
        btn.style = "margin:5px;float:right";
        btn.addEventListener("click", async () => {
          try {
            btn.disabled = true;
            btn.textContent = "获取章节中……";
            const allEps = [];
            let offset = 0;
            const limit = 100;
            while (true) {
              const eps = await getEps(subjectId, offset);
              if (!eps || eps.length === 0) break;
              allEps.push(...eps);
              if (eps.length < limit) break;
              offset += limit;
            }
            if (!allEps.length) throw new Error("未获取到章节数据");
            const epData = {}, epDescs = {};
            for (const ep of allEps) {
              const epTypes = ["", "SP", "OP", "ED"];
              const epLabel = `${epTypes[ep.type]}${ep.sort}`;
              epData[epLabel] = ep;
              epDescs[epLabel] = ep.desc;
            }
            setEpsCache(epData);
            btn.textContent = "解析参与中……";
            const [staffInfo, noStaffEps] = extractStaffInfo(epDescs);
            if (Object.keys(staffInfo).length || noStaffEps.length) {
              await updAppearEps(staffInfo, noStaffEps);
            } else {
              throw new Error("未解析到任何集数的人员信息");
            }
            btn.textContent = `解析完成！共处理 ${allEps.length} 集`;
          } catch (e) {
            console.error("获取章节参与失败：", e);
            alert(`获取失败：${e.message}`);
            btn.textContent = "获取失败，点击重试";
            btn.disabled = false;
          }
        });
        catBox.after(btn);
      }
      const infoboxBtn = document.createElement("button");
      infoboxBtn.textContent = "根据infobox关联";
      infoboxBtn.id = "infoboxStaff";
      infoboxBtn.style = "margin:5px;float:right";
      infoboxBtn.addEventListener("click", async () => {
        try {
          infoboxBtn.disabled = true;
          infoboxBtn.textContent = "解析infobox中……";
          const { staffInfo, unknownRoles, skippedRoles, allRows, typeLabel } = await getInfoboxStaffInfo();
          if (!Object.keys(staffInfo).length) {
            const extra = [];
            if (skippedRoles.length) extra.push(`未识别职位：${skippedRoles.join("、")}`);
            if (unknownRoles.length) extra.push(`下拉缺失：${[...unknownRoles].join("、")}`);
            const err = new Error(
              `未从 ${typeLabel} infobox 解析到任何人员信息${extra.length ? `（${extra.join("；")}）` : ""}`
            );
            err.detail = { skippedRoles, unknownRoles, allRows, typeLabel };
            throw err;
          }
          await updAppearEps(staffInfo, [], {
            summary: "根据infobox关联人物",
            progress: "解析中",
            indicatorId: "infoboxStaff"
          });
          infoboxBtn.textContent = `解析完成！共 ${Object.keys(staffInfo).length} 人` + (unknownRoles.length ? `，未识别职位：${unknownRoles.join("、")}` : "");
        } catch (e) {
          console.error("根据infobox关联失败：", e, e.detail);
          alert(`获取失败：${e.message}`);
          infoboxBtn.textContent = "获取失败，点击重试";
          infoboxBtn.disabled = false;
        }
      });
      if (btn) {
        btn.insertAdjacentElement("beforebegin", infoboxBtn);
      } else {
        catBox.after(infoboxBtn);
      }
      const params = new URLSearchParams(location.search);
      if (params.has("staffs") && btn) {
        try {
          const staffInfo = JSON.parse(params.get("staffs"));
          let cancelled = false;
          document.addEventListener(
            "click",
            () => {
              cancelled = true;
            },
            { capture: true, once: true }
          );
          const waitRelate = () => {
            if (cancelled) return Promise.resolve(false);
            if (document.querySelector("#crtRelateSubjects")) return Promise.resolve(true);
            return new Promise((resolve) => setTimeout(() => resolve(waitRelate()), 200));
          };
          if (!await waitRelate()) return;
          btn.disabled = true;
          btn.textContent = "解析参与中……";
          await updAppearEps(staffInfo, []);
          btn.textContent = "解析完成！点击获取全部章节";
          btn.disabled = false;
        } catch (e) {
          console.error(`参数解析错误：${e.message}`);
        }
      }
    }
  })();
})();

})();
