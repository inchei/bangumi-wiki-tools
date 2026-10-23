// ==UserScript==
// @name         预创建人物 / 人物页一键补完已填写未关联条目
// @namespace    bangumi.wiki.missing.positions
// @version      0.3.6
// @description  像 AniDB 一样，无需等待维基人即可查看人物关联 / 维基人可一键补完已填写未关联条目或剧集
// @author       you
// @icon         https://bgm.tv/img/favicon.ico
// @match        http*://bgm.tv/subject/*
// @match        http*://bgm.tv/person/*
// @match        http*://chii.in/subject/*
// @match        http*://chii.in/person/*
// @match        http*://bangumi.tv/subject/*
// @match        http*://bangumi.tv/person/*
// @match        http*://bgm.tv/person/*/add_related/anime
// @match        http*://bgm.tv/person/*/add_related/book
// @match        http*://bgm.tv/person/*/add_related/music
// @match        http*://bgm.tv/person/*/add_related/game
// @match        http*://bgm.tv/person/*/add_related/real
// @match        http*://chii.in/person/*/add_related/anime
// @match        http*://chii.in/person/*/add_related/book
// @match        http*://chii.in/person/*/add_related/music
// @match        http*://chii.in/person/*/add_related/game
// @match        http*://chii.in/person/*/add_related/real
// @match        http*://bangumi.tv/person/*/add_related/anime
// @match        http*://bangumi.tv/person/*/add_related/book
// @match        http*://bangumi.tv/person/*/add_related/music
// @match        http*://bangumi.tv/person/*/add_related/game
// @match        http*://bangumi.tv/person/*/add_related/real
// @grant        none
// @license      MIT
// @gf
// ==/UserScript==

(function () {
  'use strict';
  
const styleEl = document.createElement('style');
styleEl.textContent = `.bgm-mp-settings {
  padding: 12px;
  display: flex;
  flex-flow: column;
  gap: 10px;
  color: #666;
}

.bgm-mp-settings .bgm-mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bgm-mp-settings .bgm-mp-row label {
  color: #666;
  white-space: nowrap;
  flex-shrink: 0;
  margin-right: 8px;
}

.bgm-mp-settings .bgm-mp-row input[type='text'] {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  background: #fff;
  outline: none;
  transition: all 0.2s ease;
  width: 100%;
  max-width: 360px;
}

.bgm-mp-settings .bgm-mp-row input:focus {
  border-color: var(--primary-color, #f09199);
  box-shadow: 0 0 0 2px rgb(240 145 153 / 15%);
}

.bgm-mp-settings .bgm-mp-hint {
  font-size: 12px;
  line-height: 1.6;
  color: #666;
}

.bgm-mp-providers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.bgm-mp-provider-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.bgm-mp-provider-name {
  font-weight: 600;
}

.bgm-mp-provider-row .bgm-mp-fill {
  margin-left: auto;
}

html[data-theme='dark'] .bgm-mp-settings .bgm-mp-hint {
  color: #d8d8d8;
}

html[data-theme='dark'] .bgm-mp-settings .bgm-mp-row label {
  color: #d8d8d8;
}

html[data-theme='dark'] .bgm-mp-settings {
  color: #d8d8d8;
}

html[data-theme='dark'] .bgm-mp-settings .bgm-mp-row input[type='text'] {
  border-color: #404040;
  color: #dcdcdc;
  background: #2d2e2f;
}

html[data-theme='dark'] .bgm-mp-settings .bgm-mp-row input[type='text']:focus {
  border-color: var(--primary-color, #f09199);
  box-shadow: 0 0 0 2px rgb(240 145 153 / 25%);
}

.bgm-mp-settings .bgm-mp-row input[type='text'].bgm-mp-invalid,
.bgm-mp-settings .bgm-mp-row input[type='text'].bgm-mp-invalid:focus {
  border-color: #f56c6c;
  box-shadow: 0 0 0 2px rgb(245 108 108 / 15%);
}

html[data-theme='dark'] .bgm-mp-settings .bgm-mp-row input[type='text'].bgm-mp-invalid,
html[data-theme='dark'] .bgm-mp-settings .bgm-mp-row input[type='text'].bgm-mp-invalid:focus {
  border-color: #f56c6c;
  box-shadow: 0 0 0 2px rgb(245 108 108 / 25%);
}

.bgm-mp-toggle {
  appearance: none;
  width: 40px;
  height: 22px;
  background: #dcdfe6;
  border-radius: 11px;
  border: none;
  cursor: pointer;
  position: relative;
  transition: background 0.25s ease;
  flex-shrink: 0;
  margin: 0;
}

.bgm-mp-toggle::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.bgm-mp-toggle:checked {
  background: var(--primary-color, #f09199);
}

.bgm-mp-toggle:checked::after {
  transform: translateX(18px);
}

html[data-theme='dark'] .bgm-mp-toggle {
  background: #404040;
}

html[data-theme='dark'] .bgm-mp-toggle:checked {
  background: var(--primary-color, #f09199);
}

html[data-theme='dark'] .bgm-mp-toggle::after {
  background: #dcdcdc;
}

.bgm-mp-type-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.bgm-mp-type-label {
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
}

html[data-theme='dark'] .bgm-mp-type-label {
  color: #dcdcdc;
}

.bgm-mp-popup-types {
  display: flex;
  gap: 5px;
  margin-left: 8px;
  margin-right: auto;
}

.bgm-mp-popup-type {
  font-size: 11px;
  color: #909399;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 3px;
  border-radius: 4px;
}

.bgm-mp-popup-type:hover {
  background: rgba(240, 145, 153, 0.1);
}

.bgm-mp-popup-type input:checked + * {
  color: var(--primary-color, #f09199);
}

html[data-theme='dark'] .bgm-mp-popup-type {
  color: #9a9a9a;
}

html[data-theme='dark'] .bgm-mp-popup-type:hover {
  background: rgba(240, 145, 153, 0.15);
}

#bgm-mp-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  float: right;
  margin: 5px 0;
  align-items: flex-end;
}

.bgm-mp-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.bgm-mp-select {
  height: 32px;
  padding: 0 28px 0 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  background: #fff;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23909399' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  transition: all 0.2s ease;
  field-sizing: content;
}

.bgm-mp-select:focus {
  border-color: var(--primary-color, #f09199);
  box-shadow: 0 0 0 2px rgb(240 145 153 / 15%);
}

.bgm-mp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

html[data-theme='dark'] .bgm-mp-select {
  border-color: #404040;
  color: #dcdcdc;
  background-color: #2d2e2f;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239a9a9a' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
}

html[data-theme='dark'] .bgm-mp-select:focus {
  border-color: var(--primary-color, #f09199);
  box-shadow: 0 0 0 2px rgb(240 145 153 / 25%);
}

.bgm-mp-input {
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  background: #fff;
  outline: none;
  transition: all 0.2s ease;
  field-sizing: content;
}

.bgm-mp-input:focus {
  border-color: var(--primary-color, #f09199);
  box-shadow: 0 0 0 2px rgb(240 145 153 / 15%);
}

html[data-theme='dark'] .bgm-mp-input {
  border-color: #404040;
  color: #dcdcdc;
  background: #2d2e2f;
}

html[data-theme='dark'] .bgm-mp-input:focus {
  border-color: var(--primary-color, #f09199);
  box-shadow: 0 0 0 2px rgb(240 145 153 / 25%);
}
/* Notification - wikiEpStaffRelate tip box style */
.bgm-mp-notify {
  position: fixed;
  width: min(380px, 100vw);
  backdrop-filter: blur(10px);
  background: rgba(254, 254, 254, 0.8);
  border-radius: 15px;
  background-clip: padding-box;
  border: 1px solid rgba(255, 255, 255, 0.3);
  box-shadow: 0 5px 30px 10px rgba(80, 80, 80, 0.5);
  z-index: 9999;
  overflow: hidden;
  font-size: 13px;
  color: #303133;
}

html[data-theme='dark'] .bgm-mp-notify {
  background: rgba(40, 40, 40, 0.8);
  color: #fff;
  box-shadow: 0 5px 30px 10px rgba(0, 0, 0, 0.2);
}

.bgm-mp-notify .staff-tip-handle {
  height: 36px;
  line-height: 36px;
  padding: 0 16px;
  border-top-left-radius: 15px;
  border-top-right-radius: 15px;
  font-size: 14px;
  font-weight: 500;
  cursor: move;
  user-select: none;
  touch-action: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--primary-color, #f09199);
}

.bgm-mp-notify .staff-tip-content {
  padding: 12px 16px;
  max-height: 400px;
  overflow-y: auto;
  font-size: 13px;
  min-height: 120px;
}

.bgm-mp-notify .staff-tip-title {
  margin: 0 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 14px;
}

/* 警告提示样式（镜像 wikiEpStaffRelate） */
.bgm-mp-notify .staff-warning-section {
  padding: 10px 12px;
  margin: 0 0 16px;
  background: rgba(255, 248, 225, 0.6);
  border: 1px solid rgba(255, 153, 0, 0.3);
  border-radius: 8px;
  color: #856404;
  overflow-wrap: break-word;
}

.bgm-mp-notify .staff-warning-title {
  font-size: 14px;
  font-weight: 500;
}

html[data-theme='dark'] .bgm-mp-notify .staff-warning-section {
  background: rgba(60, 40, 0, 0.4);
  border-color: rgba(255, 153, 0, 0.5);
  color: #ffd700;
}

/* 错误提示样式（镜像 wikiRelDiff staff-error-section） */
.bgm-mp-notify .staff-error-section {
  padding: 10px 12px;
  margin: 0 0 16px;
  background: rgba(255, 224, 178, 0.6);
  border: 1px solid rgba(255, 99, 71, 0.3);
  border-radius: 8px;
  color: #8b0000;
  overflow-wrap: break-word;
}

.bgm-mp-notify .staff-error-title {
  font-size: 14px;
  font-weight: 500;
}

html[data-theme='dark'] .bgm-mp-notify .staff-error-section {
  background: rgba(80, 0, 0, 0.4);
  border-color: rgba(255, 99, 71, 0.5);
  color: #ffb6c1;
}

/* 确认加载按钮（与 warning 格式一致，背景偏白/夜间黑） */
.bgm-mp-notify .staff-confirm-section {
  padding: 10px 12px;
  margin: 0 0 16px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(200, 200, 200, 0.3);
  border-radius: 8px;
  color: #303133;
  overflow-wrap: break-word;
  cursor: pointer;
  text-align: center;
  font-weight: 500;
  transition: background 0.2s ease;
}

.bgm-mp-notify .staff-confirm-section:hover {
  background: rgba(240, 240, 240, 0.8);
}

html[data-theme='dark'] .bgm-mp-notify .staff-confirm-section {
  background: rgba(40, 40, 40, 0.6);
  border-color: rgba(100, 100, 100, 0.5);
  color: #dcdcdc;
}

html[data-theme='dark'] .bgm-mp-notify .staff-confirm-section:hover {
  background: rgba(50, 50, 50, 0.8);
}

.bgm-mp-notify .staff-tip-title.unmatched {
  color: #a0222e;
}

html[data-theme='dark'] .bgm-mp-notify .staff-tip-title {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

html[data-theme='dark'] .bgm-mp-notify .staff-tip-title.unmatched {
  color: #e57373;
}

.bgm-mp-notify-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  color: #909399;
  padding: 0;
  line-height: 1;
}

.bgm-mp-notify-close:hover {
  color: #e07a85;
}

.bgm-mp-btn {
  display: inline-block;
  background: #fff;
  color: #303133;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  transition: all 0.2s ease;
  height: 30px;
  white-space: nowrap;
}

html[data-theme='dark'] .bgm-mp-btn {
  background: #2d2e2f;
  color: #dcdcdc;
  border-color: #404040;
}

html[data-theme='dark'] .bgm-mp-btn:hover,
.bgm-mp-btn:hover {
  color: var(--primary-color, #f09199);
  border-color: var(--primary-color, #f09199);
}

.bgm-mp-spinner {
  display: inline-block;
  width: 32px;
  height: 32px;
  margin-bottom: 16px;
  border: 3px solid #e4e7ed;
  border-top-color: var(--primary-color, #f09199);
  border-radius: 50%;
  animation: bgm-mp-spin 1.2s linear infinite;
}

html[data-theme='dark'] .bgm-mp-spinner {
  border-color: #404040;
  border-top-color: var(--primary-color, #f09199);
}

@keyframes bgm-mp-spin {
  to {
    transform: rotate(360deg);
  }
}

.bgm-mp-loading-text {
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.bgm-mp-loading-wrap {
  text-align: center;
  padding: 40px 20px;
  color: #909399;
}

/* Popup content */
.bgm-mp-result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.bgm-mp-section-title {
  font-weight: 700;
}

.bgm-mp-type-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.bgm-mp-type-title {
  font-weight: 600;
  color: var(--primary-color, #f09199);
  margin-bottom: 6px;
}

html[data-theme='dark'] .bgm-mp-type-title {
  color: var(--primary-color, #f09199);
}

.bgm-mp-empty-hint {
  color: #909399;
  margin-bottom: 8px;
  text-align: center;
}

.bgm-mp-popup-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.bgm-mp-name-link {
  color: #1a7a1a;
  cursor: pointer;
  text-decoration: underline !important;
}

.bgm-mp-pending-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bgm-mp-pending-header {
  margin-bottom: 8px;
  color: #909399;
}

html[data-theme='dark'] .bgm-mp-name-link {
  color: #51cf66;
}

.bgm-mp-subject-popup {
  width: 400px;
  max-width: 100vw;
  max-height: 80vh;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.bgm-mp-status-box {
  display: none;
  padding: 8px 10px;
  max-width: 320px;
  background: #f5f7fa;
  border: 1px solid #d9dee4;
  border-radius: 6px;
  color: #606266;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: break-word;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
}

.bgm-mp-status-box.show {
  display: block;
}

html[data-theme='dark'] .bgm-mp-status-box {
  background: #252627;
  border-color: #4a4b4c;
  color: #b9b9b9;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35);
}

ul.cat a.bgm-mp-has-remaining::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--primary-color, #f09199);
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}`;
document.head.appendChild(styleEl);

(() => {
  // src/position-ids.js
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

  // src/config.js
  var PROVIDER_KEY = "wikiMissingPositionsProvider";
  var SHOW_KEY = "wikiMissingPositionsShow";
  var DEFAULT_PROVIDER = "https://bgq.iccci.cc.cd";
  var PUBLIC_PROVIDERS = [
    { name: "默认", url: DEFAULT_PROVIDER },
    { name: "@wataame", url: "https://bgq.bgmstat.us", home: "https://bgm.tv/user/wataame" }
  ];

  // src/api.js
  function hasChiiApp() {
    return typeof chiiApp !== "undefined" && chiiApp;
  }
  function get(key, def) {
    if (hasChiiApp()) {
      return chiiApp.cloud_settings.get(key) || def;
    }
    return localStorage.getItem(key) || def;
  }
  function getProvider() {
    return get(PROVIDER_KEY, DEFAULT_PROVIDER);
  }
  function getShow() {
    return get(SHOW_KEY, "on");
  }
  function save(key, val) {
    if (hasChiiApp()) {
      try {
        const ret = chiiApp.cloud_settings.update({ [key]: val });
        if (ret && typeof ret.then === "function") {
          return ret;
        }
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    }
    try {
      localStorage.setItem(key, val);
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve();
  }
  function saveProvider(val) {
    return save(PROVIDER_KEY, val);
  }
  function normalizeProvider(raw) {
    let s = String(raw ?? "").trim();
    if (!s) return null;
    if (/^\/\//.test(s)) {
      s = "https:" + s;
    } else if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(s)) {
      s = "https://" + s;
    }
    let url;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    if (url.protocol !== "https:") return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  }
  function saveShow(val) {
    return save(SHOW_KEY, val);
  }

  // src/appear-eps.js
  function parseAppearEps(input) {
    if (!input) return /* @__PURE__ */ new Set([]);
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
    return new Set(sortAppearEps(Array.from(resultSet)));
  }
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
  function genAppearEps(epArr) {
    if (!epArr || !epArr.length) return "";
    epArr = sortAppearEps([...new Set(epArr)]);
    const integers = epArr.filter(isStrictInt).map(Number);
    const others = epArr.filter((e) => !isStrictInt(e));
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

  // src/search.js
  var _searchError = false;
  function lastSearchFailed() {
    return _searchError;
  }
  var createFetch = (method) => async (url, body) => {
    const options = method === "POST" ? { method, body: JSON.stringify(body) } : { method };
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      _searchError = false;
      return await response.json();
    } catch (e) {
      console.error(e);
      _searchError = true;
      return null;
    }
  };
  var fetchPost = createFetch("POST");
  var postSearch = async (cat, keyword, filter, limit = 1) => {
    const url = `https://api.bgm.tv/v0/search/${cat}?limit=${limit}`;
    const body = { keyword, filter };
    const result = await fetchPost(url, body);
    return result?.data;
  };
  var searchPrsnAll = (keyword) => postSearch("persons", keyword, void 0, 5);
  function normalize(name) {
    return name.normalize("NFKC").replace(/\s/g, "").replaceAll("-", "").replace(/[\u30A1-\u30F6]/g, function(match) {
      return String.fromCharCode(match.charCodeAt(0) - 96);
    }).toLowerCase();
  }

  // src/person.js
  async function checkExistingPerson(personName) {
    const result = {
      aliased: null,
      aliasedMulti: null,
      directMatches: null,
      bangumiError: false,
      aliasesError: false
    };
    const normalized = normalize(personName);
    try {
      let aliased = null;
      const provider = getProvider();
      try {
        const res = await fetch(`${provider}/api/aliases/${encodeURIComponent(personName)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            aliased = data[0];
            if (data.length > 1) {
              result.aliasedMulti = data;
            }
          }
        } else {
          result.aliasesError = true;
        }
      } catch (e) {
        console.error("aliases API failed:", e);
        result.aliasesError = true;
      }
      if (!aliased) {
        aliased = await window.personAliasQuery?.(personName);
      }
      if (aliased) result.aliased = { name: aliased.name, id: aliased.id };
      const searchResults = await searchPrsnAll(personName);
      result.bangumiError = lastSearchFailed();
      if (searchResults) {
        const matches = searchResults.filter((r) => normalized === normalize(r.name));
        if (matches.length) {
          result.directMatches = matches.map((r) => {
            const cn = (r.infobox || []).find((f) => f.key === "简体中文名");
            return { name: r.name, id: r.id, display: cn?.value || r.name };
          });
        }
      }
    } catch (e) {
      console.error("checkExistingPerson failed:", e);
    }
    return result;
  }

  // src/errors.js
  var BANGUMI_ERROR_TEXT = '网络出错了，请检查网络或<a href="https://bgm-status.ry.mk" class="l" target="_blank">查看班娘情况</a>';
  function ourApiErrorText(name) {
    const q = encodeURIComponent(name || "");
    return `网络出错了，请检查网络或<a href="https://inchei.github.io/bangumi-wiki-tools/missing-persons/search.html?q=${q}" class="l" target="_blank">看看有没有已经存储的结果</a>`;
  }

  // src/popup.js
  function makeDraggable(popup, handle, excludeSelector) {
    let offX = 0, offY = 0;
    function cx(e) {
      return e.touches ? e.touches[0].clientX : e.clientX;
    }
    function cy(e) {
      return e.touches ? e.touches[0].clientY : e.clientY;
    }
    handle.onmousedown = handle.ontouchstart = (e) => {
      if (excludeSelector && e.target.closest(excludeSelector)) return;
      if (e.cancelable) e.preventDefault();
      const rect = popup.getBoundingClientRect();
      popup.style.transform = "none";
      popup.style.left = rect.left + "px";
      popup.style.top = rect.top + "px";
      popup.style.right = "auto";
      popup.style.bottom = "auto";
      offX = cx(e) - rect.left;
      offY = cy(e) - rect.top;
      document.onmousemove = document.ontouchmove = (ev) => {
        if (ev.cancelable) ev.preventDefault();
        popup.style.left = cx(ev) - offX + "px";
        popup.style.top = cy(ev) - offY + "px";
      };
      document.onmouseup = document.ontouchend = () => {
        document.onmousemove = document.ontouchmove = null;
      };
    };
  }
  function createNotifyPopup({ handleHTML, className = "", onClose, dragExclude = "" }) {
    const popup = document.createElement("div");
    popup.className = "bgm-mp-notify" + (className ? ` ${className}` : "");
    const handle = document.createElement("div");
    handle.className = "staff-tip-handle";
    handle.innerHTML = handleHTML;
    const content = document.createElement("div");
    content.className = "staff-tip-content";
    popup.append(handle, content);
    document.body.appendChild(popup);
    popup.querySelector(".bgm-mp-notify-close").onclick = () => {
      onClose?.();
      popup.remove();
    };
    const exclude = [".bgm-mp-notify-close", dragExclude].filter(Boolean).join(", ");
    makeDraggable(popup, handle, exclude);
    return { popup, handle, content };
  }
  function showPendingEps(allUnmatched, personName, type2) {
    const existing = document.querySelector(".bgm-mp-notify");
    if (existing) existing.remove();
    const sections = allUnmatched.map(({ sid, entry }) => {
      const eps = entry.episodes || [];
      const epLinks = eps.map(
        (ep) => `<a class="l" href="https://bgm.tv/ep/${ep.episode_id}#:~:text=${encodeURIComponent(personName)}" target="_blank">${ep.label}</a>`
      ).join(", ");
      return { sid, entry, eps, epLinks };
    });
    if (!sections.length) return;
    const { popup, content } = createNotifyPopup({
      handleHTML: '<strong>疑似匹配</strong><button class="bgm-mp-notify-close">&times;</button>'
    });
    let html = '<div class="bgm-mp-pending-header">以下剧集简介包含此名称但未定位到职位：</div>';
    for (const sec of sections) {
      html += `<div class="bgm-mp-pending-item">
        <strong><a href="/subject/${sec.sid}">${sec.entry.name || "#" + sec.sid}</a></strong> ${sec.epLinks}
        <button class="bgm-mp-btn bgm-mp-relate-btn" data-sid="${sec.sid}" href="javascript:">关联</button>
        <button class="bgm-mp-btn bgm-mp-copy-btn" data-sid="${sec.sid}" href="javascript:">复制</button>
        <button class="bgm-mp-btn bgm-mp-locate-btn" data-sid="${sec.sid}" href="javascript:">定位</button>
      </div>`;
    }
    content.innerHTML = html;
    popup.style.opacity = "0";
    const boxW = popup.offsetWidth;
    const boxH = popup.offsetHeight;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let right = 50, bottom = 50;
    right = Math.min(right, winW - boxW);
    right = Math.max(right, 0);
    bottom = Math.min(bottom, winH - boxH);
    bottom = Math.max(bottom, 0);
    popup.style.bottom = `${bottom}px`;
    popup.style.right = `${right}px`;
    popup.style.opacity = "";
    popup.querySelectorAll(".bgm-mp-btn").forEach((btn) => {
      btn.onclick = () => {
        const sec = sections.find((s) => String(s.sid) === btn.dataset.sid);
        if (!sec) return;
        const epLabels = sec.eps.map((ep) => ep.label);
        if (!epLabels.length) return;
        subjectList = [
          {
            id: Number(sec.sid),
            type_id: type2,
            name: sec.entry.name,
            name_cn: "",
            url_mod: "subject"
          }
        ];
        addRelateSubject(0, "submitForm");
      };
    });
    popup.querySelectorAll(".bgm-mp-copy-btn").forEach((btn) => {
      btn.onclick = () => {
        const sec = sections.find((s) => String(s.sid) === btn.dataset.sid);
        if (!sec) return;
        const epLabels = sec.eps.map((ep) => ep.label);
        if (!epLabels.length) return;
        navigator.clipboard.writeText(genAppearEps(epLabels));
        const orig = btn.textContent;
        btn.textContent = "复制成功";
        setTimeout(() => btn.textContent = orig, 2e3);
      };
    });
    popup.querySelectorAll(".bgm-mp-locate-btn").forEach((btn) => {
      btn.onclick = () => {
        document.querySelector('[data-group-mode="subject"]').click();
        const l = document.querySelector(`[href="/subject/${btn.dataset.sid}"]`);
        if (!l) return;
        window.location.href += `#:~:text=${l.textContent}`;
      };
    });
  }

  // src/subject-page.js
  function errSection(html) {
    return `<div class="staff-error-section">${html}</div>`;
  }
  var cacheKey = (name, t, target) => `mp:${name}:${t}:${target}`;
  var LOADING_MSGS = [
    "坐和放宽",
    "正在准备数据<br>请勿™关闭计算机",
    "好东西就要来了！",
    () => `你已完成${10 * (2 + Math.floor(Math.random() * 7))}%`,
    "正在处理一些事情",
    "你正在成功！",
    "不巧的是，它花费的时间比通常要长",
    "再等一下下就好了",
    "这通常不会太久",
    "我们正在帮你搞定一切"
  ];
  function randomMsg() {
    const m = LOADING_MSGS[Math.floor(Math.random() * LOADING_MSGS.length)];
    return typeof m === "function" ? m() : m;
  }
  function initSubjectPage() {
    if (getShow() === "off") return;
    const href = document.querySelector(".focus").href.split("/").pop();
    const typeCode = { anime: 2, book: 1, music: 3, game: 4, real: 6 }[href] || 0;
    if (!typeCode) return;
    const posNames = new Set(Object.values(POSITION_IDS[typeCode] || {}));
    const infobox = document.querySelector("#infobox");
    if (!infobox) return;
    const DELIM_RE = /[()[\]{}（）<>《》「」『』【】+×·→/／、,，;；：&＆\\等]+/;
    const EP_MARKER_RE = /^\d+$|^\d+\s*-\s*\d+$|^(?:OP|ED|SP)(?:\d+)?$/i;
    infobox.querySelectorAll("li:not(.sub_container):not(.sub_group)").forEach((li) => {
      const tip = li.querySelector(".tip");
      if (!tip) return;
      const fieldName = tip.textContent.replace(/[:：]\s*$/, "").trim();
      if (!posNames.has(fieldName)) return;
      const linked = /* @__PURE__ */ new Set();
      li.querySelectorAll("a").forEach((a) => linked.add(a.textContent.trim()));
      const clone = li.cloneNode(true);
      clone.querySelectorAll("a, .tip").forEach((el) => el.remove());
      const text = clone.textContent;
      const names = text.split(DELIM_RE).map((s) => s.trim()).filter(Boolean).filter((n) => !EP_MARKER_RE.test(n));
      names.sort((a, b) => b.length - a.length);
      let tipHTML = "";
      if (tip) {
        tipHTML = tip.outerHTML;
        tip.remove();
      }
      const unlinked = names.filter((n) => !linked.has(n));
      if (unlinked.length) {
        const nameRE = new RegExp(
          `(?<=^|[^<\\w])(${unlinked.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([^<\\w]|$)`,
          "g"
        );
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => node.parentElement.closest("a, .tip") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        const tNodes = [];
        while (walker.nextNode()) tNodes.push(walker.currentNode);
        for (const node of tNodes) {
          const html = node.textContent.replace(
            nameRE,
            (_, name, p3) => `<a class="bgm-mp-name bgm-mp-name-link" data-name="${name}">${name}</a>${p3}`
          );
          if (html !== node.textContent) {
            const span = document.createElement("span");
            span.innerHTML = html;
            node.replaceWith(...span.childNodes);
          }
        }
      }
      if (tipHTML) li.insertAdjacentHTML("afterbegin", tipHTML);
    });
    document.querySelectorAll(".bgm-mp-name").forEach((a) => {
      a.addEventListener("click", () => openSubjectPopup(a.dataset.name, typeCode));
    });
  }
  var _abortController = null;
  function openSubjectPopup(personName, typeCode) {
    if (_abortController) _abortController.abort();
    _abortController = new AbortController();
    const signal = _abortController.signal;
    const existing = document.querySelector(".bgm-mp-subject-popup");
    if (existing) existing.remove();
    const provider = getProvider();
    const typeNames = { 1: "书", 2: "动", 3: "乐", 4: "游", 6: "实" };
    const typeChecks = [1, 2, 3, 4, 6].map(
      (t) => `<label class="bgm-mp-popup-type"><input type="checkbox" class="bgm-mp-type-check" value="${t}"${t === typeCode ? " checked" : ""}>${typeNames[t]}</label>`
    ).join("");
    const { popup, content } = createNotifyPopup({
      className: "bgm-mp-subject-popup",
      handleHTML: `<strong>${personName}</strong><span class="bgm-mp-popup-types">${typeChecks}</span><button class="bgm-mp-notify-close">&times;</button>`,
      onClose: () => _abortController.abort(),
      dragExclude: ".bgm-mp-popup-type, .bgm-mp-popup-types"
    });
    content.innerHTML = `<div class="bgm-mp-loading-wrap"><div class="bgm-mp-spinner"></div><div class="bgm-mp-loading-text">${randomMsg()}</div></div>`;
    const errs = { bangumi: false, ours: false };
    const doMultiFetch = (existing2, targetParam) => {
      if (!_ready) return;
      const checked = [...popup.querySelectorAll(".bgm-mp-type-check:checked")].map(
        (c) => Number(c.value)
      );
      const targetId = (existing2?.aliased?.id || existing2?.directMatches?.[0]?.id || 0).toString();
      const encoded = encodeURIComponent(personName);
      let uncached = [];
      let cached = {};
      for (const t of checked) {
        const key = cacheKey(encoded, t, targetId);
        const cachedData = sessionStorage.getItem(key);
        if (cachedData) {
          try {
            cached[t] = JSON.parse(cachedData);
          } catch {
            uncached.push(t);
          }
        } else {
          uncached.push(t);
        }
      }
      if (uncached.length === 0) {
        renderResults(content, cached, null, encoded, personName, errs);
        return;
      }
      _abortController.abort();
      _abortController = new AbortController();
      const sig = _abortController.signal;
      content.innerHTML = `<div class="bgm-mp-loading-wrap"><div class="bgm-mp-spinner"></div><div class="bgm-mp-loading-text">${randomMsg()}</div></div>`;
      fetchMultiType(
        personName,
        provider,
        sig,
        content,
        targetParam,
        uncached,
        cached,
        targetId,
        errs
      );
    };
    popup.querySelectorAll(".bgm-mp-type-check").forEach((cb) => {
      cb.addEventListener("change", () => doMultiFetch(_existing, _targetParam));
    });
    let _existing = null, _targetParam = "", _ready = false;
    (async () => {
      const existing2 = await checkExistingPerson(personName);
      _existing = existing2;
      let targetParam = "";
      if (existing2.aliased) targetParam = `&target=${existing2.aliased.id}`;
      else if (existing2.directMatches) targetParam = `&target=${existing2.directMatches[0].id}`;
      _targetParam = targetParam;
      _ready = true;
      errs.bangumi = existing2.bangumiError;
      errs.ours = existing2.aliasesError;
      const hasExisting = existing2.aliased || existing2.directMatches;
      if (hasExisting) {
        let warningHtml = "";
        if (existing2.bangumiError) warningHtml += errSection(BANGUMI_ERROR_TEXT);
        if (existing2.aliasesError) warningHtml += errSection(ourApiErrorText(personName));
        if (existing2.aliased) {
          if (existing2.aliasedMulti && existing2.aliasedMulti.length > 1) {
            warningHtml += `<div class="staff-warning-section"><div class="staff-warning-title">别名为「${personName}」匹配到多个人物，已取第一个：</div>`;
            for (const p of existing2.aliasedMulti) {
              warningHtml += `<a class="l" href="/person/${p.id}" target="_blank">${p.name}</a> `;
            }
            warningHtml += "</div>";
          } else {
            warningHtml += `<div class="staff-warning-section"><div class="staff-warning-title">别名为「${personName}」的人物已存在：</div><a class="l" href="/person/${existing2.aliased.id}" target="_blank">${existing2.aliased.name}</a></div>`;
          }
        }
        if (existing2.directMatches) {
          warningHtml += '<div class="staff-warning-section"><div class="staff-warning-title">同名人物已存在：</div>';
          for (const p of existing2.directMatches) {
            warningHtml += `<a class="l" href="/person/${p.id}" target="_blank">${p.display || p.name}</a> `;
          }
          warningHtml += "</div>";
        }
        warningHtml += '<div class="staff-confirm-section" id="bgm-mp-confirm-btn">仍然加载</div>';
        content.innerHTML = warningHtml;
        document.querySelector("#bgm-mp-confirm-btn").onclick = () => {
          document.querySelector("#bgm-mp-confirm-btn").remove();
          doMultiFetch(existing2, targetParam);
        };
      } else {
        doMultiFetch(existing2, targetParam);
      }
    })();
  }
  async function fetchMultiType(personName, provider, signal, content, targetParam, types, cached, targetId, errs) {
    const encodedName = encodeURIComponent(personName);
    let subjectsByType = { ...cached }, episodesData = null;
    const fetches = types.map(
      (t) => fetch(`${provider}/api/persons/${encodedName}/missing-subjects?type=${t}${targetParam}`, {
        signal
      }).then((res) => {
        if (!res.ok) {
          errs.ours = true;
          return null;
        }
        return res.json();
      }).then((data) => {
        if (data && Object.keys(data).length) {
          sessionStorage.setItem(cacheKey(encodedName, t, targetId), JSON.stringify(data));
        }
        return { type: t, data };
      }).catch((e) => {
        if (e.name === "AbortError") throw e;
        console.error(`missing-subjects type=${t} failed:`, e);
        errs.ours = true;
        return { type: t, data: null };
      })
    );
    try {
      const results = await Promise.all(fetches);
      for (const r of results) {
        if (r.data && Object.keys(r.data).length) {
          subjectsByType[r.type] = r.data;
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") throw e;
      return;
    }
    if (types.includes(2)) {
      try {
        const epQuery = targetParam ? "?" + targetParam.slice(1) : "";
        const epRes = await fetch(
          `${provider}/api/persons/${encodedName}/missing-episodes${epQuery}`,
          { signal }
        );
        if (epRes.ok) episodesData = await epRes.json();
        else errs.ours = true;
      } catch (e) {
        if (e.name === "AbortError") return;
        errs.ours = true;
      }
    }
    renderResults(content, subjectsByType, episodesData, encodedName, personName, errs);
  }
  function renderResults(content, subjectsByType, episodesData, encodedName, personName, errs) {
    const typeNamesFull = { 1: "书籍", 2: "动画", 3: "音乐", 4: "游戏", 6: "三次元" };
    const totalEntries = Object.values(subjectsByType).reduce((c, d) => c + Object.keys(d).length, 0);
    const hasData = totalEntries || episodesData && (Object.keys(episodesData.matched || {}).length || Object.keys(episodesData.unmatched || {}).length);
    let html = "";
    if (errs?.bangumi) html += errSection(BANGUMI_ERROR_TEXT);
    if (!hasData && errs?.ours) html += errSection(ourApiErrorText(personName));
    if (totalEntries) {
      html += '<div class="bgm-mp-result-list">';
      html += '<div class="bgm-mp-section-title">缺失条目关联：</div>';
      for (const t of [2, 1, 3, 4, 6]) {
        const data = subjectsByType[t];
        if (!data) continue;
        html += `<div class="bgm-mp-type-section"><div class="bgm-mp-type-title">${typeNamesFull[t]}</div>`;
        for (const [sid, entry] of Object.entries(data)) {
          const posNames = (entry.positions || []).map((pid) => POSITION_IDS[t]?.[pid] || pid).join("、");
          html += `<div><strong><a class="l" href="/subject/${sid}" target="_blank">${entry.name || "#" + sid}</a></strong> - ${posNames}</div>`;
        }
        html += "</div>";
      }
      html += "</div>";
    }
    if (episodesData) {
      const matched = Object.entries(episodesData.matched || {});
      const unmatched = Object.entries(episodesData.unmatched || {});
      if (matched.length) {
        html += '<div class="bgm-mp-result-list">';
        html += '<div class="bgm-mp-section-title">缺失剧集关联：</div>';
        for (const [sid, entry] of matched) {
          const parts = Object.entries(entry.episodes || {}).map(
            ([pid, labels]) => `${POSITION_IDS[2]?.[pid] || pid}：${genAppearEps(labels)}`
          );
          html += `<div><strong><a class="l" href="/subject/${sid}" target="_blank">${entry.name || "#" + sid}</a></strong> ${parts.join("，")}</div>`;
        }
        html += "</div>";
      }
      if (unmatched.length) {
        html += '<div class="bgm-mp-result-list">';
        html += '<div class="bgm-mp-section-title">疑似缺失剧集关联：</div>';
        for (const [sid, entry] of unmatched) {
          html += `<div><strong><a class="l" href="/subject/${sid}" target="_blank">${entry.name || "#" + sid}</a></strong> - ${(entry.episodes || []).map(
            (ep) => `<a class="l" href="/ep/${ep.episode_id}#:~:text=${encodedName}" target="_blank">${ep.label}</a>`
          ).join(", ")}</div>`;
        }
        html += "</div>";
      }
    }
    if (!hasData && !errs?.bangumi && !errs?.ours) {
      html = '<div class="bgm-mp-empty-hint">未找到缺失关联</div>';
    }
    html += `<div class="bgm-mp-popup-actions">
      <button class="bgm-mp-btn" id="bgm-mp-create-btn">创建人物</button>
    </div>`;
    content.innerHTML = html;
    document.querySelector("#bgm-mp-create-btn").onclick = () => {
      if (!hasData) {
        window.open(`/person/new?name=${encodeURIComponent(personName)}`);
        return;
      }
      const allSubjects = {};
      for (const [t, data] of Object.entries(subjectsByType)) {
        for (const [sid, entry] of Object.entries(data)) {
          allSubjects[`${t}:${sid}`] = { ...entry, _type: Number(t) };
        }
      }
      localStorage.setItem(
        "bgm-mp-pending",
        JSON.stringify({
          personName,
          subjectsData: allSubjects,
          episodesData
        })
      );
      window.open("/person/new");
    };
  }
  async function initPersonNewPage() {
    const params = new URLSearchParams(location.search);
    let raw = null;
    if (params.has("bgm_mp") && window.opener) {
      raw = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3e3);
        const handler = (e) => {
          if (e.data && e.data.type === "bgm_mp_data" && e.data.data) {
            clearTimeout(timer);
            window.removeEventListener("message", handler);
            resolve(e.data.data);
          }
        };
        window.addEventListener("message", handler);
        window.opener.postMessage({ type: "bgm_mp_request" }, "*");
      });
    }
    if (!raw) {
      raw = localStorage.getItem("bgm-mp-pending");
    }
    if (!raw) {
      raw = window.name && window.name.startsWith("{") ? window.name : null;
    }
    if (!raw) {
      const nameParam = params.get("name");
      if (nameParam) {
        const input = document.querySelector("#crt_name");
        if (input) input.value = nameParam;
      }
      return;
    }
    try {
      const data = JSON.parse(raw);
      const input = document.querySelector("#crt_name");
      if (!input || !data.personName) {
        localStorage.removeItem("bgm-mp-pending");
        window.name = "";
        return;
      }
      input.value = data.personName;
      localStorage.setItem("bgm-mp-pending", raw);
      window.name = "";
      if (params.has("bgm_mp")) {
        params.delete("bgm_mp");
        const qs = params.toString();
        history.replaceState(null, "", qs ? location.pathname + "?" + qs : location.pathname);
      }
    } catch (_e) {
      localStorage.removeItem("bgm-mp-pending");
    }
  }
  function addAliasLine(value, aliasName) {
    const aliasLine = `[${aliasName}]`;
    const lines = value.split("\n");
    const aliasIdx = lines.findIndex((l) => /^\|别名=\{$/.test(l.trim()));
    if (aliasIdx >= 0) {
      if (lines.slice(aliasIdx + 1).some((l) => l.trim() === aliasLine)) return value;
      lines.splice(aliasIdx + 1, 0, aliasLine);
      return lines.join("\n");
    }
    const cnIdx = lines.findIndex((l) => /^\|简体中文名=/.test(l.trim()));
    const insertIdx = cnIdx >= 0 ? cnIdx + 1 : 1;
    lines.splice(insertIdx, 0, "|别名={", aliasLine, "}");
    return lines.join("\n");
  }
  async function initPersonEditPage() {
    const params = new URLSearchParams(location.search);
    let raw = null;
    if (params.has("bgm_mp_alias") && window.opener) {
      raw = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3e3);
        const handler = (e) => {
          if (e.data && e.data.type === "bgm_mp_alias_data" && e.data.data) {
            clearTimeout(timer);
            window.removeEventListener("message", handler);
            resolve(e.data.data);
          }
        };
        window.addEventListener("message", handler);
        window.opener.postMessage({ type: "bgm_mp_alias_request" }, "*");
      });
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const variantName = data.personName;
      if (!variantName) return;
      const infoboxInput = document.querySelector("#subject_infobox");
      const isNormal = typeof nowmode !== "undefined" && nowmode === "normal";
      if (isNormal) {
        if (typeof NormaltoWCODE !== "function") return;
        NormaltoWCODE();
      }
      if (!infoboxInput) return;
      infoboxInput.value = addAliasLine(infoboxInput.value, variantName);
      if (isNormal) {
        if (typeof WCODEtoNormal !== "function") return;
        WCODEtoNormal();
      }
      infoboxInput.scrollIntoView({ block: "center" });
      infoboxInput.style.outline = "2px solid #ffb300";
      setTimeout(() => {
        infoboxInput.style.outline = "";
      }, 4e3);
    } catch (_e) {
    }
  }
  function initPersonPage() {
    const raw = localStorage.getItem("bgm-mp-pending");
    if (!raw) return;
    const personId2 = location.pathname.match(/\/person\/(\d+)/)?.[1];
    if (!personId2) return;
    try {
      const data = JSON.parse(raw);
      if (!data.subjectsData) return;
      if (data.personId != null) {
        if (String(data.personId) !== personId2) return;
      } else if (!document.referrer.includes("/person/new")) {
        return;
      }
      const typeExts = { 1: "book", 2: "anime", 3: "music", 4: "game", 6: "real" };
      const types = [
        ...new Set(
          Object.values(data.subjectsData).map((e) => e._type).filter(Boolean)
        )
      ];
      if (types.length >= 1) {
        const ext = typeExts[types[0]];
        if (ext) {
          if (data.personId == null) {
            data.personId = Number(personId2);
          }
          localStorage.setItem("bgm-mp-pending", JSON.stringify(data));
          location.href = `/person/${personId2}/add_related/${ext}`;
        }
      }
    } catch (e) {
      console.error("initPersonPage failed:", e);
    }
  }

  // src/add-related.js
  var select;
  var type;
  var nameInput;
  var epNameInput;
  var epBtn;
  var personId;
  var statusBox;
  var _retryCancel = false;
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.closest(
        'button, .bgm-mp-btn, input[type="submit"], input[type="button"], input.inputBtn'
      )) {
        _retryCancel = true;
      }
    },
    { capture: true }
  );
  function retry(op, interval = 200) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (_retryCancel) {
          reject(new Error("操作已取消"));
          return;
        }
        try {
          resolve(op());
        } catch (e) {
          setTimeout(attempt, interval);
        }
      };
      attempt();
    });
  }
  function setStatusBox(html) {
    if (!statusBox) return;
    statusBox.innerHTML = html || "";
    statusBox.classList.toggle("show", Boolean(html));
  }
  function findSubjectLi(sid, posId) {
    return [...document.querySelectorAll(`#crtRelateSubjects li:has([href="/subject/${sid}"])`)].find(
      (li) => String(li.querySelector('select[name$="[prsnPos]"]')?.value) === String(posId)
    );
  }
  function findNewSubjectLi(sid) {
    return [...document.querySelectorAll(`#crtRelateSubjects li:has([href="/subject/${sid}"])`)].find(
      (li) => !li.classList.contains("old")
    );
  }
  function addOrFindSubjectLi(sid, posId, name) {
    const existing = findSubjectLi(sid, posId);
    if (existing) return { li: existing, added: false };
    subjectList = [{ id: Number(sid), type_id: type, name, name_cn: "", url_mod: "subject" }];
    addRelateSubject(0, "submitForm");
    const added = findNewSubjectLi(sid);
    added.querySelector('select[name$="[prsnPos]"]').value = posId;
    return { li: added, added: true };
  }
  function addSubjectLi(sid, posId, name) {
    return addOrFindSubjectLi(sid, posId, name).li;
  }
  async function processEpisodesData(data, queryName) {
    let none = true;
    for (const [sid, entry] of Object.entries(data.matched || {})) {
      for (const [posId, labels] of Object.entries(entry.episodes || {})) {
        const li = addSubjectLi(sid, posId, entry.name);
        const epInput = li.querySelector('[name$="[appear_eps]"]');
        if (epInput) {
          const currentSet = parseAppearEps(epInput.value);
          const hasAll = labels.every((l) => currentSet.has(l));
          if (!hasAll) {
            none = false;
            epInput.value = genAppearEps(labels);
            if (li.classList.contains("old")) {
              li.style.background = document.documentElement.getAttribute("data-theme") === "dark" ? "rgba(255, 248, 165, 0.08)" : "rgba(255, 248, 165, 0.2)";
            }
          }
        }
      }
    }
    const allUnmatched = [];
    for (const [sid, entry] of Object.entries(data.unmatched || {})) {
      none = false;
      allUnmatched.push({ sid, entry });
    }
    if (allUnmatched.length) showPendingEps(allUnmatched, queryName, type);
    return none;
  }
  function resolveTarget(name) {
    if (!name || !personId) return "";
    return `&target=${personId}`;
  }
  async function runEpisodeCheck() {
    const alias = epNameInput.value.trim();
    const queryName = alias || document.querySelector(".nameSingle").textContent.trim();
    epBtn.disabled = true;
    setStatusBox("获取中……");
    const targetParam = await resolveTarget(alias);
    const pending = getPendingData();
    if (pending && pending.episodesData && (Object.keys(pending.episodesData.matched || {}).length || Object.keys(pending.episodesData.unmatched || {}).length)) {
      const none = await processEpisodesData(pending.episodesData, queryName);
      setStatusBox(none ? "未查找到任何已填写剧集" : "剧集关联完成！");
      epBtn.disabled = false;
      return;
    }
    const provider = getProvider();
    try {
      const url = `${provider}/api/persons/${encodeURIComponent(queryName)}/missing-episodes${targetParam ? "?" + targetParam.slice(1) : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      const none = await processEpisodesData(data, queryName);
      setStatusBox(none ? "未查找到任何已填写剧集" : "剧集关联完成！");
    } catch (e) {
      console.error(e);
      setStatusBox(ourApiErrorText(queryName));
    } finally {
      epBtn.disabled = false;
    }
  }
  function initAddRelated() {
    const personName = document.querySelector(".nameSingle")?.textContent.trim();
    if (!personName) return;
    const pidMatch = location.pathname.match(/\/person\/(\d+)/);
    personId = pidMatch ? pidMatch[1] : "";
    const typeName = {
      anime: 2,
      book: 1,
      music: 3,
      game: 4,
      real: 6
    }[location.pathname.split("/").pop()];
    if (!typeName) return;
    type = typeName;
    select = document.createElement("select");
    select.className = "bgm-mp-select";
    let posOpts = '<option value="">所有职位</option>';
    Object.keys(POSITION_IDS[type] || {}).map(Number).sort(function(a, b) {
      return a - b;
    }).forEach(function(id) {
      posOpts += `<option value="${id}">${POSITION_IDS[type][id]}</option>`;
    });
    select.innerHTML = posOpts;
    const container = document.createElement("div");
    container.id = "bgm-mp-container";
    const group1 = document.createElement("div");
    group1.className = "bgm-mp-group";
    nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "bgm-mp-input";
    nameInput.placeholder = "别名（可选）";
    const btn = document.createElement("button");
    btn.textContent = "关联已填写条目";
    btn.id = "missingPositions";
    btn.className = "bgm-mp-btn";
    btn.addEventListener("click", async () => {
      const position = select.value;
      const pending = getPendingData();
      if (pending && pending.subjectsData && Object.keys(pending.subjectsData).length) {
        const resEntries = Object.entries(pending.subjectsData);
        let none = true;
        for (const [key, entry] of resEntries) {
          if ((entry._type || 0) !== type) continue;
          const sid = key.split(":").pop();
          for (const pos of entry.positions || []) {
            if (position && String(pos) !== position) continue;
            const { added } = addOrFindSubjectLi(sid, pos, entry.name);
            if (added) none = false;
          }
        }
        setStatusBox(none ? "未查找到任何已填写条目" : "关联完成！");
        return;
      }
      const provider = getProvider();
      try {
        btn.disabled = true;
        setStatusBox("获取中……");
        const alias = nameInput.value.trim();
        const targetParam = await resolveTarget(alias);
        const res = await fetch(
          `${provider}/api/persons/${encodeURIComponent(alias || personName)}/missing-subjects?type=${type}&position=${position}${targetParam}`
        );
        const data = await res.json();
        const resEntries = Object.entries(data);
        let none = true;
        for (const [id, entry] of resEntries) {
          for (const pos of entry.positions) {
            const { added } = addOrFindSubjectLi(id, pos, entry.name);
            if (added) none = false;
          }
        }
        setStatusBox(none ? "未查找到任何已填写条目" : "关联完成！");
      } catch (e) {
        console.error(e);
        setStatusBox(ourApiErrorText(personName));
      } finally {
        btn.disabled = false;
      }
    });
    const group2 = document.createElement("div");
    group2.className = "bgm-mp-group";
    if (type === 2) {
      epNameInput = document.createElement("input");
      epNameInput.type = "text";
      epNameInput.className = "bgm-mp-input";
      epNameInput.placeholder = "别名（可选）";
      epBtn = document.createElement("button");
      epBtn.textContent = "关联已填写剧集";
      epBtn.id = "missingEpisodes";
      epBtn.className = "bgm-mp-btn";
      epBtn.addEventListener("click", runEpisodeCheck);
      group2.append(epNameInput, epBtn);
    }
    group1.append(nameInput, select, btn);
    statusBox = document.createElement("div");
    statusBox.className = "bgm-mp-status-box";
    container.append(group1, group2, statusBox);
    document.querySelector("#indexCatBox").after(container);
    processPendingData();
  }
  var _pendingData = null;
  var _relateBackdoor = false;
  function getPendingData() {
    return _pendingData;
  }
  async function processPendingData() {
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.has("bgm_mp_relate") && window.opener && !_relateBackdoor) {
      const handler = (e) => {
        if (e.data && e.data.type === "bgm_mp_relate_data" && e.data.data) {
          window.removeEventListener("message", handler);
          _relateBackdoor = true;
          localStorage.setItem("bgm-mp-pending", e.data.data);
          processPendingData();
        }
      };
      window.addEventListener("message", handler);
      window.opener.postMessage({ type: "bgm_mp_relate_request" }, "*");
      return;
    }
    const raw = localStorage.getItem("bgm-mp-pending");
    if (!raw) return;
    const referrer = document.referrer;
    if (!_relateBackdoor && !referrer.includes("/person/new") && !referrer.match(/\/person\/(\d+)/))
      return;
    try {
      const data = JSON.parse(raw);
      _pendingData = data;
      if (!data.subjectsData) {
        localStorage.removeItem("bgm-mp-pending");
        return;
      }
      if (data.personId != null && String(data.personId) !== personId) return;
      const typeMap = { book: 1, anime: 2, music: 3, game: 4, real: 6 };
      const pageType = typeMap[location.pathname.split("/").pop()] || 0;
      if (pageType === 0) return;
      const matching = {};
      const remaining = {};
      let hasRemaining = false;
      for (const [key, entry] of Object.entries(data.subjectsData)) {
        if ((entry._type || 0) === pageType) {
          matching[key] = entry;
        } else {
          remaining[key] = entry;
          hasRemaining = true;
        }
      }
      let consumed = true;
      let hasExisting = false;
      _retryCancel = false;
      try {
        for (const [key, entry] of Object.entries(matching)) {
          for (const posId of entry.positions || []) {
            const li = await retry(
              () => addSubjectLi(Number(key.split(":").pop()), posId, entry.name)
            );
            if (li && !li.classList.contains("old")) {
              consumed = false;
            }
            if (li && li.classList.contains("old")) {
              hasExisting = true;
              li.style.background = document.documentElement.getAttribute("data-theme") === "dark" ? "rgba(255, 248, 165, 0.08)" : "rgba(255, 248, 165, 0.2)";
            }
          }
        }
        if (pageType === 2 && data.episodesData?.matched) {
          for (const [sid, entry] of Object.entries(data.episodesData.matched)) {
            for (const [posId, labels] of Object.entries(entry.episodes || {})) {
              const li = await retry(() => addSubjectLi(Number(sid), Number(posId), entry.name));
              const epInput = li.querySelector('[name$="[appear_eps]"]');
              if (epInput) {
                epInput.value = genAppearEps(labels);
                if (li.classList.contains("old")) {
                  hasExisting = true;
                  li.style.background = document.documentElement.getAttribute("data-theme") === "dark" ? "rgba(255, 248, 165, 0.08)" : "rgba(255, 248, 165, 0.2)";
                }
              }
            }
          }
        }
      } catch (e) {
        if (e.message === "操作已取消") {
          setStatusBox("");
          return;
        }
        throw e;
      }
      if (pageType === 2 && Object.keys(data.episodesData?.unmatched || {}).length) {
        const allUnmatched = Object.entries(data.episodesData.unmatched).map(([sid, entry]) => ({
          sid,
          entry
        }));
        showPendingEps(allUnmatched, data.personName, 2);
      }
      if (hasRemaining) {
        localStorage.setItem(
          "bgm-mp-pending",
          JSON.stringify({
            personName: data.personName,
            subjectsData: remaining,
            episodesData: null,
            personId: data.personId
          })
        );
      } else {
        localStorage.removeItem("bgm-mp-pending");
      }
      markRemainingTypes(remaining);
      setStatusBox(hasExisting ? "关联完成！部分关联已存在" : "关联完成！");
      if (hasRemaining && consumed) {
        const typeExts = { 1: "book", 2: "anime", 3: "music", 4: "game", 6: "real" };
        const nextType = [
          ...new Set(
            Object.values(remaining).map((e) => e._type).filter(Boolean)
          )
        ][0];
        if (nextType) {
          const personIdMatch = location.pathname.match(/\/person\/(\d+)/);
          if (personIdMatch)
            location.href = `/person/${personIdMatch[1]}/add_related/${typeExts[nextType]}`;
        }
      }
    } catch (e) {
      localStorage.removeItem("bgm-mp-pending");
    }
  }
  function markRemainingTypes(remaining) {
    const cat = document.querySelector("ul.cat");
    if (!cat) return;
    const types = new Set(
      Object.values(remaining).map((e) => e._type).filter(Boolean)
    );
    const typeExts = { 1: "book", 2: "anime", 3: "music", 4: "game", 6: "real" };
    cat.querySelectorAll("a").forEach((a) => {
      a.classList.remove("bgm-mp-has-remaining");
      const href = a.getAttribute("href") || "";
      for (const [t, ext] of Object.entries(typeExts)) {
        if (types.has(Number(t)) && href.endsWith("/" + ext)) {
          a.classList.add("bgm-mp-has-remaining");
          return;
        }
      }
    });
  }

  // src/index.js
  var pathname = location.pathname;
  (function route() {
    if (/^\/subject\/\d+$/.test(pathname)) {
      initSubjectPage();
      return;
    }
    if (pathname === "/person/new") {
      initPersonNewPage();
      return;
    }
    if (/^\/person\/\d+\/edit$/.test(pathname)) {
      initPersonEditPage();
      return;
    }
    if (/^\/person\/\d+$/.test(pathname)) {
      initPersonPage();
      return;
    }
    if (/^\/person\/\d+\/add_related\/(anime|book|music|game|real)$/.test(pathname)) {
      initAddRelated();
    }
  })();
  if (typeof chiiLib !== "undefined" && chiiLib.ukagaka && chiiLib.ukagaka.addPanelTab) {
    chiiLib.ukagaka.addPanelTab({
      tab: "wiki_missing_positions",
      label: "缺失职位",
      type: "custom",
      customContent: function() {
        const provider = getProvider();
        const show = getShow();
        return (
          /* html */
          `
        <div class="bgm-mp-settings">
          <div class="bgm-mp-row">
            <label for="bgm-mp-provider">API 地址</label>
            <input type="text" id="bgm-mp-provider" value="${provider.replace(/"/g, "&quot;")}" placeholder="${DEFAULT_PROVIDER}">
            <button type="button" class="bgm-mp-btn" id="bgm-mp-save" disabled>保存</button>
          </div>
          <div class="bgm-mp-hint">可用公共部署地址：</div>
          <div class="bgm-mp-providers" id="bgm-mp-providers"></div>
          <div class="bgm-mp-row">
            <label for="bgm-mp-show">条目页显示未关联人物</label>
            <input type="checkbox" class="bgm-mp-toggle" id="bgm-mp-show"${show === "on" ? " checked" : ""}>
          </div>
        </div>`
        );
      },
      onInit: function(tabSelector, $tabContent) {
        const $provider = $tabContent.find("#bgm-mp-provider");
        const $save = $tabContent.find("#bgm-mp-save");
        let savedValue = $provider.val();
        let invalid = false;
        let saveTimer = null;
        function setSaveState(dirty, saving) {
          if (saving) {
            $save.text("保存中").prop("disabled", true);
          } else {
            $save.text("保存").prop("disabled", !dirty || invalid);
          }
        }
        function validate() {
          invalid = normalizeProvider($provider.val()) === null;
          $provider.toggleClass("bgm-mp-invalid", invalid);
          setSaveState($provider.val() !== savedValue, false);
        }
        function doSave() {
          const normalized = normalizeProvider($provider.val());
          if (normalized === null) {
            validate();
            return;
          }
          setSaveState(false, true);
          saveProvider(normalized).then(
            function() {
              savedValue = normalized;
              $provider.val(normalized);
              setSaveState(false, false);
            },
            function() {
              setSaveState(true, false);
            }
          );
        }
        $tabContent.off("input change", "#bgm-mp-provider").on("input change", "#bgm-mp-provider", function() {
          clearTimeout(saveTimer);
          validate();
          saveTimer = setTimeout(doSave, 400);
        });
        $tabContent.off("click", "#bgm-mp-save").on("click", "#bgm-mp-save", function() {
          clearTimeout(saveTimer);
          doSave();
        });
        $tabContent.off("change", "#bgm-mp-show").on("change", "#bgm-mp-show", function() {
          saveShow(this.checked ? "on" : "off");
        });
        function escapeHtml(s) {
          return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        }
        function renderProviders() {
          const rows = PUBLIC_PROVIDERS.map(function(item) {
            const name = item.home ? `<a class="l" href="${escapeHtml(item.home)}" target="_blank">${escapeHtml(item.name)}</a>` : `${escapeHtml(item.name)}`;
            return `<div class="bgm-mp-provider-row">
            <a class="l" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.url)}</a> - ${name}
            <a class="l bgm-mp-fill" href="#" data-url="${escapeHtml(item.url)}">填入</a>
          </div>`;
          }).join("");
          $tabContent.find("#bgm-mp-providers").html(rows);
        }
        $tabContent.off("click", "#bgm-mp-providers .bgm-mp-fill").on("click", "#bgm-mp-providers .bgm-mp-fill", function(e) {
          e.preventDefault();
          $provider.val(this.dataset.url);
          validate();
          clearTimeout(saveTimer);
          doSave();
        });
        validate();
        renderProviders();
      }
    });
  }
})();

})();
