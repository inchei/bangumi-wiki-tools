// ==UserScript==
// @name         由单行本创建系列
// @namespace    wiki.vol.to.series
// @homepage     https://bgm.tv/group/topic/451224
// @version      0.2.0
// @description  从单行本第一卷创建系列条目；无网络请求，封面交给 wikiUploadPic 上传
// @author       you
// @icon         https://bgm.tv/img/favicon.ico
// @match        http*://bgm.tv/subject/*
// @match        http*://bgm.tv/new_subject/1
// @match        http*://bangumi.tv/subject/*
// @match        http*://bangumi.tv/new_subject/1
// @match        http*://chii.in/subject/*
// @match        http*://chii.in/new_subject/1
// @grant        none
// @license      MIT
// @updateURL    https://github.com/bangumi/scripts/raw/master/inchei/wikiVolToSeries.user.js
// @gf
// @gadget
// ==/UserScript==
(() => {
  // src/wiki-template.generated.js
  var INFOBOX_TEMPLATES = {
    "Album": { header: "Album", fields: ["中文名", "别名", "艺术家", "作曲", "编曲", "作词", "厂牌", "发售日期", "价格", "版本特性", "播放时长", "录音", "碟片数量", "链接"] },
    "Anime": { header: "animanga/Anime", fields: ["中文名", "别名", "上映年度", "片长", "官方网站", "链接", "其他", "Copyright"] },
    "Book": { header: "animanga/Book", fields: ["中文名", "别名", "作者", "插图", "出版社", "价格", "其他出版社", "连载杂志", "发售日", "页数", "ISBN", "链接", "其他"] },
    "BookSeries": { header: "animanga/BookSeries", fields: ["中文名", "别名", "出版社", "连载杂志", "开始", "结束", "册数", "话数", "原作", "链接", "其他"] },
    "Crt": { header: "Crt", fields: ["简体中文名", "别名", "性别", "生日", "血型", "身高", "体重", "BWH", "引用来源"] },
    "Game": { header: "Game", fields: ["中文名", "别名", "平台", "游戏类型", "游戏引擎", "游玩人数", "发行日期", "售价", "开发", "发行", "剧本", "程序", "website", "链接"] },
    "Manga": { header: "animanga/Manga", fields: ["中文名", "别名", "作者", "作画", "脚本", "原作", "出版社", "价格", "其他出版社", "连载杂志", "发售日", "册数", "页数", "话数", "ISBN", "链接", "其他"] },
    "Movie": { header: "animanga/Movie", fields: ["中文名", "别名", "上映年度", "片长", "官方网站", "链接", "其他", "Copyright"] },
    "Novel": { header: "animanga/Novel", fields: ["中文名", "别名", "作者", "插图", "出版社", "价格", "连载杂志", "发售日", "册数", "页数", "话数", "ISBN", "链接", "其他"] },
    "OVA": { header: "animanga/OVA", fields: ["中文名", "别名", "话数", "发售日", "官方网站", "开始", "结束", "链接", "其他"] },
    "PhotoBook": { header: "Book/PhotoBook", fields: ["中文名", "别名", "作者", "摄影", "出版社", "价格", "其他出版社", "连载杂志", "发售日", "页数", "ISBN", "链接", "其他"] },
    "TV": { header: "real/Television", fields: ["中文名", "别名", "集数", "季数", "放送星期", "开始", "结束", "主演", "导演", "音乐", "原作", "制作", "类型", "国家/地区", "语言", "每集长", "在线播放平台", "电视网", "电视台", "频道", "视频制式", "音频制式", "首播国家", "首播地区", "台湾名称", "港澳名称", "马新名称", "官方网站", "链接", "imdb_id", "tvdb_id"] },
    "TVAnime": { header: "animanga/TVAnime", fields: ["中文名", "别名", "话数", "放送开始", "放送星期", "官方网站", "在线播放平台", "播放电视台", "其他电视台", "播放结束", "导演", "音乐", "链接", "其他", "Copyright"] },
    "doujinBook": { header: "doujin/Book", fields: ["作者", "原作", "CP", "语言", "页数", "尺寸", "价格", "发售日"] },
    "doujinGame": { header: "doujin/Game", fields: ["别名", "开发者", "原作", "平台", "游戏类型", "游戏引擎", "游玩人数", "语言", "价格", "发售日"] },
    "doujinMusic": { header: "doujin/Album", fields: ["艺术家", "原作", "语言", "版本特性", "碟片数量", "播放时长", "价格", "发售日"] },
    "realMovie": { header: "real/Movie", fields: ["中文名", "别名", "上映日", "片长", "类型", "国家/地区", "语言", "官方网站", "链接", "imdb_id", "tmdb_id", "tvdb_id"] }
  };
  var BOOK_PLATFORMS = {
    "其他": { id: 0, template: "Book" },
    "漫画": { id: 1001, template: "Manga" },
    "小说": { id: 1002, template: "Novel" },
    "画集": { id: 1003, template: "Book" },
    "绘本": { id: 1004, template: "Book" },
    "写真": { id: 1005, template: "PhotoBook" },
    "公式书": { id: 1006, template: "Book" }
  };

  // src/index.js
  var PLATFORM_TYPES = Object.fromEntries(
    Object.entries(BOOK_PLATFORMS).map(([cn, p]) => [p.id, cn])
  );
  (function() {
    "use strict";
    const pathname = location.pathname;
    const exposeEntry = () => {
      const a = document.createElement("a");
      a.classList.add("l");
      a.textContent = "/ 创建对应系列";
      a.href = "/new_subject/1";
      const br = document.createElement("br");
      document.querySelector(".modifyTool .tip_i p:nth-of-type(2)").append(br, a);
    };
    if (pathname.match(/^\/subject\/\d+$/)) {
      if (document.querySelector(".focus.chl").href.split("/").pop() !== "book") return;
      if (document.querySelector(".nameSingle .grey").nextElementSibling) {
        const info = sessionStorage.getItem("seriesVolumeInfo");
        if (document.referrer !== `${location.origin}/new_subject/1` || !info) return;
        location.href += "/add_related/subject/book";
      } else {
        exposeEntry();
        const title = document.querySelector(".nameSingle a");
        sessionStorage.setItem(
          "seriesVolumeInfo",
          `${title.textContent}"""${title.href.split("/").pop()}`
        );
        sessionStorage.setItem("seriesVolumeCover", document.querySelector(".cover")?.href || "");
        sessionStorage.setItem("seriesVolumeWiki", JSON.stringify(dumpVolumeWiki()));
      }
    } else if (pathname === "/new_subject/1") {
      const referrer = document.referrer;
      const sbjId = referrer.match(/subject\/(\d+)/)?.[1];
      const info = sessionStorage.getItem("seriesVolumeInfo");
      const cover = sessionStorage.getItem("seriesVolumeCover");
      const wiki = JSON.parse(sessionStorage.getItem("seriesVolumeWiki") || "null");
      if (sbjId !== info?.split('"""')?.[1] || !cover && cover !== "" || !wiki) return;
      const inputBtns = document.querySelectorAll(":not(.canvas-btn-container) .inputBtn");
      const trimmedTitle = wiki.name.replace(/\s(上|下|\d+|[\u0030-\u0039\uFF10-\uFF19]+)|[（(].+?[）)]$/, "").trim();
      const titleInput = document.querySelector('input[name="subject_title"]');
      titleInput.addEventListener("input", () => {
        inputBtns.forEach((inputBtn) => {
          if (titleInput.value !== wiki.name) {
            inputBtn.style.pointerEvents = "auto";
            inputBtn.value = "提交";
          } else {
            inputBtn.style.pointerEvents = "none";
            inputBtn.value = "与来源单行本重名，请更改书名";
          }
        });
      });
      titleInput.value = trimmedTitle;
      titleInput.dispatchEvent(new Event("input"));
      document.querySelector("#subjectSeries").click();
      document.querySelector(`[value="${wiki.platform}"]`)?.click();
      document.querySelector("#subject_summary").value = wiki.summary;
      document.querySelector("#tags").value = `${PLATFORM_TYPES[wiki.platform] || ""} 系列`;
      setInfobox(wiki.infobox);
      if (cover) {
        coverToDataURL(cover).then((coverDataURL) => deliverCover(coverDataURL)).catch((e) => console.error("封面转换失败：", e));
      }
    } else if (pathname.endsWith("/add_related/subject/book")) {
      const sbjId = document.referrer.match(/subject\/(\d+)/)?.[1];
      const info = sessionStorage.getItem("seriesVolumeInfo");
      if (!sbjId || !info || document.querySelector(".focus.chl").href.split("/").pop() !== "book" || !document.querySelector(".nameSingle .grey").nextElementSibling)
        return;
      const [volName, volId] = info.split('"""');
      let cancelled = false;
      document.addEventListener(
        "click",
        () => {
          cancelled = true;
        },
        { capture: true, once: true }
      );
      const run = () => {
        if (cancelled) return;
        const ul = document.querySelector("#crtRelateSubjects");
        const searchInput = document.querySelector("#subjectName");
        if (!ul || !searchInput) throw new Error("关联列表未就绪");
        if (document.querySelector(`#crtRelateSubjects li a[href="/subject/${volId}"]`)) {
          sessionStorage.removeItem("seriesVolumeInfo");
          sessionStorage.removeItem("seriesVolumeCover");
          sessionStorage.removeItem("seriesVolumeWiki");
          return;
        }
        subjectList = [{ id: volId, type_id: "1", name: volName, name_cn: "", url_mod: "subject" }];
        addRelateSubject(0, "submitForm");
        searchInput.value = document.querySelector(".nameSingle a").textContent;
        findSubjectFunc();
        $("#crtRelateSubjects a.h").click(rmParent);
        waitForElement("#id_start", (e) => {
          e.value = volId;
          document.querySelector("#id_end").value = volId;
        });
      };
      const attempt = () => {
        try {
          run();
        } catch {
          setTimeout(attempt, 200);
        }
      };
      attempt();
    }
    function dumpVolumeWiki() {
      const grey = (document.querySelector(".nameSingle .grey")?.textContent || "").trim();
      const platformInfo = BOOK_PLATFORMS[grey];
      const template = INFOBOX_TEMPLATES[platformInfo?.template] || INFOBOX_TEMPLATES.Book;
      const values = {};
      const groups = [];
      const rowLine = (li) => {
        const tip = li.querySelector(":scope > span.tip");
        const key = tip ? tip.textContent.replace(/[:：]\s*$/u, "").trim() : "";
        const value = tip ? li.textContent.slice(tip.textContent.length).trim() : li.textContent.trim();
        return key && value && !key.includes("ISBN") ? `[${key}|${value}]` : "";
      };
      let groupTags = null;
      let groupIndex = 0;
      const ul = document.querySelector(".infobox_container ul#infobox");
      if (ul) {
        for (const node of [...ul.children].filter((el) => el.tagName === "LI")) {
          const li = node.cloneNode(true);
          if (li.classList.contains("sub_group")) {
            groupTags = [...li.querySelectorAll("span.tag.group_tag:not(.more)")];
            groupIndex = 0;
            continue;
          }
          if (li.classList.contains("sub_container")) {
            if (li.querySelector(":scope > ul > li.sub_section")) {
              const lines = [...li.querySelectorAll(":scope > ul > li.sub")].map((sub) => {
                const tip2 = sub.querySelector(":scope > span.tip");
                const unofficial = tip2 && tip2.textContent.trim() === "非官方";
                const value2 = tip2 ? sub.textContent.slice(tip2.textContent.length).trim() : sub.textContent.trim();
                return value2 ? unofficial ? `[非官方|${value2}]` : `[${value2}]` : "";
              });
              if (lines.length) values["别名"] = `|别名={
${lines.filter(Boolean).join("\n")}
}`;
              continue;
            }
            const tag = groupTags?.[groupIndex++];
            if (tag) {
              const gname = li.querySelector("li.group_section")?.textContent.trim() || tag.textContent.trim();
              const gkey = li.getAttribute("attr-info-group") || "版本";
              const lines = [...li.querySelectorAll(":scope > ul > li")].filter((member) => !member.classList.contains("group_section")).map(rowLine).filter(Boolean);
              if (lines.length) groups.push(`|${gkey}:${gname}={
${lines.join("\n")}
}`);
            }
            continue;
          }
          const tip = li.querySelector(":scope > span.tip");
          if (!tip) continue;
          const key = tip.textContent.replace(/[:：]\s*$/u, "").trim();
          const value = li.textContent.slice(tip.textContent.length).trim();
          if (!value || key === "页数" || key === "价格" || key.includes("ISBN")) continue;
          values[key] = `|${key}= ${value}`;
        }
      }
      const templateFields = new Set(template.fields);
      const body = [];
      for (const field of template.fields) {
        if (field === "页数" || field === "ISBN" || field === "价格") continue;
        body.push(
          values[field] ?? (field === "别名" || field === "链接" ? `|${field}= {

}` : `|${field}= `)
        );
      }
      for (const [key, piece] of Object.entries(values)) {
        if (!templateFields.has(key)) body.push(piece);
      }
      body.push(...groups);
      return {
        name: document.querySelector(".nameSingle a")?.textContent || "",
        infobox: `{{Infobox ${template.header}
${body.join("\n")}
}}`,
        summary: (document.querySelector("#subject_summary")?.textContent || "").trim(),
        platform: platformInfo?.id
      };
    }
    async function coverToDataURL(coverUrl) {
      const path = new URL(coverUrl.replace(/^\/\//, `${location.protocol}//`)).pathname;
      const blob = await fetch(path).then((response) => {
        if (!response.ok) throw new Error(`获取封面失败，状态码：${response.status}`);
        return response.blob();
      });
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(blob);
      });
    }
    function setInfobox(text) {
      if (!text) return;
      const box = document.querySelector("#subject_infobox");
      const isNormal = typeof nowmode !== "undefined" && nowmode === "normal";
      if (isNormal) {
        if (typeof NormaltoWCODE !== "function") return;
        NormaltoWCODE();
      }
      box.value = text;
      if (isNormal) {
        if (typeof WCODEtoNormal !== "function") return;
        WCODEtoNormal();
      }
    }
    function deliverCover(dataUrl) {
      if (!dataUrl) return;
      const cover = document.createElement("img");
      cover.setAttribute("data-bgm-import-cover", "");
      cover.style.display = "none";
      cover.src = dataUrl;
      document.body.appendChild(cover);
      waitForElement("img.preview", (img) => {
        img.src = dataUrl;
      });
    }
    function waitForElement(selector, callback) {
      const element = document.querySelector(selector);
      if (element) {
        callback(element);
        return;
      }
      const observer = new MutationObserver(() => {
        const elem = document.querySelector(selector);
        if (elem) {
          observer.disconnect();
          callback(elem);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  })();
})();

