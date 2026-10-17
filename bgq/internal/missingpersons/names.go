package missingpersons

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/inchei/bangumi-query/internal/aliases"
	"github.com/inchei/bangumi-query/internal/model"
)

var musicExtraPositions = map[int]string{
	30:   "主题歌编曲",
	31:   "主题歌作曲",
	32:   "主题歌作词",
	33:   "主题歌演出",
	34:   "插入歌演出",
	118:  "插入歌作词",
	119:  "插入歌作曲",
	120:  "插入歌编曲",
	4015: "主题歌演出",
}

var subjectTypeNames = map[int]string{1: "书籍", 2: "动画", 3: "音乐", 4: "游戏", 6: "三次元"}

func isDelim(r rune) bool {
	switch r {
	case '(', ')', '[', ']', '{', '}', '（', '）', '<', '>',
		'《', '》', '「', '」', '『', '』', '【', '】',
		'+', '×', '·', '→', '/', '／', '、', ',', '，', ';', '；', '：',
		':', '&', '＆', '\\', '等':
		return true
	}
	return false
}

var noiseSubstringsCJK = []string{
	"总监", "总策划", "总制片", "总导演", "总作监", "出品人", "发行人",
	"制片", "制片人", "制作人", "制作总指挥", "制作管理", "制作进行", "制作担当", "制作デスク",
	"导演", "監督", "チーフディレクター", "ディレクター", "チーフ",
	"监制", "监修", "監修", "作监",
	"企画", "構成", "构成", "策划", "统筹", "协力", "協力", "协助", "提供", "支持",
	"辅助", "辅佐", "助理", "助手", "修型", "鳴謝", "鸣谢",
	"指导", "编剧", "脚本", "原作", "原案", "分镜", "演出", "作曲", "作词", "编曲",
	"录音", "混音", "选曲", "整音", "效果", "編集", "剪辑", "编辑", "摄影", "宣传",
	"设计", "合成", "特效", "美術", "色彩", "人设", "原画", "作画", "背景", "动画", "制作", "製作",
	"出品", "发行", "出版", "発行", "連載", "掲載", "刊", "版",
	"后期", "前期", "版权", "文学", "文艺", "设定", "設定",
	"原创音乐", "原作音乐", "调整", "指挥", "指挥者", "指挥家",
	"工作室", "委员会", "委員会", "株式会社", "有限公司", "有限责任公司", "集团", "公司",
	"企鹅影视", "哔哩哔哩", "腾讯", "爱奇艺", "优酷",
	"ミュージック", "ピクチャーズ", "エンタテインメント", "エンタテイメント",
	"ワークス", "スタジオ", "プロダクション", "アニメーション", "プロモーション",
	"エージェンシー", "ウォンバット", "DIGITAL",
	"テレビジョン", "テレビ", "放送", "出版", "発行", "シリーズ",
	"鬼戦車",
	"話", "回", "巻", "期", "集", "冊", "章",
	"北京", "上海", "東京", "日本", "台湾", "香港", "中国",
	"顾问", "演奏", "指揮", "協力", "宣伝", "宣伝協力",
	"より", "漫画", "アニメ", "小説", "原作小説", "原作漫画",
	"片头曲", "片尾曲", "插曲", "主題歌", "主題曲",
	"製作担当", "音楽協力", "製作協力",
	"録音調整", "補佐", "拟音", "内容推广", "Layout", "調整", "和声", "人声", "有", "https",
	"企划", "场景", "助监督", "主题曲", "内容宣发", "特别感谢", "配音团队", "组长", "场景监督", "场景美术",
	"発売", "封面", "ドラマ",
	"東映動画", "創通", "マーベラス", "Showgate", "ショウゲート",
	"钢琴", "小提琴", "中提琴", "大提琴", "吉他", "贝斯", "萨克斯", "单簧管", "双簧管",
	"竖琴", "小号", "长号", "圆号", "长笛", "短笛", "口琴", "手风琴", "电子琴", "架子鼓",
	"インディペンデント", "インディーズ", "オムニバス", "サントラ", "アルバム",
	"イメージ", "ラジオ", "ビデオ", "レーベル", "イラスト", "サウンドトラック",
	"ドラマ", "コンピレーション", "音楽", "ゲーム",
	"itaku", "委託", "パブリッシング", "マーケティング", "エンタテインメント", "コミュニケーション",
	"录制", "混音", "母带", "伴奏",
	"主笔", "本編", "本篇", "番外", "特典", "限定", "体验版", "体验", "无语音", "语音",
	"中文版", "日文版", "英文版", "副", "现", "总", "辅", "ほか", "他",
	"北美", "大陆", "全球", "韩国", "法国", "英国", "加拿大", "欧洲", "亚洲",
	"英文", "中文", "日文", "韩文", "繁中", "简中", "武汉", "日",
	"映画", "配音", "国际", "剧本", "主演", "出演", "友情", "特別", "领衔", "映像",
	"应援", "カメオ", "声音", "声客", "電子", "非首发",
	"环境音效", "厦门", "上色", "選曲", "CG", "Mac", "主美", "内容运营",
	"一原", "立绘", "协作", "三维", "合唱", "美术", "3D", "3D美术", "合作单位",
	"デザイン", "グラフィック", "サウンド", "エフェクト", "キャラクター",
	"プログラム", "プログラミング", "シナリオ", "プランナー", "ディレクター",
	"ライター", "イラスト", "モンスター", "ロボット", "メカ", "メイン",
}

var personCNNameRe = regexp.MustCompile(`\|\s*简体中文名\s*=\s*([^\n|]*)`)

func extractPersonCNName(infobox string) string {
	m := personCNNameRe.FindStringSubmatch(infobox)
	if len(m) >= 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

var noiseEnRe = regexp.MustCompile(`(?i)\b(?:` +
	`letterer|colorist|inker|penciler|penciller|translator|editor|` +
	`assistant|credited|uncredited|retouch|assist|technic?ian|` +
	`coordinat(?:or|ion)|contributor|collaborator|producer|` +
	`supervis(?:or|ion)|manage[rm]|planner|director|` +
	`distribut(?:or|ion)|packager|printer|binder|staff|` +
	`piano|violin|guitar|bass|drums|flute|sax(?:ophone)?|` +
	`cello|harp|trumpet|trombone|clarinet|oboe|viola|` +
	`ukulele|synthesiz(?:s|er)|keyboard|drum|` +
	`recording|mastering|remastering|vocaloid|utau|` +
	`(?:various\s+)?artists|` +
	`p[lc]c?|llc|l\.?t\.?d|ltd|gmbh|inc|corp|co|` +
	`android|ios|windows|steam|switch|new|` +
	`program|programming|programmer|design|designer|writer|` +
	`producer|direction?|effects?|graphics?|scenario|planning|` +
	`coordinat(?:or|ion)` +
	`)\b|` +
	`PS\d?|PSP|PSV|3DS|NDS|GBA|FC|SFC|FX|N64|DC|SS|Xbox|XBOX|PC\d?` +
	`[SsTt][Uu][Dd][Ii][Oo]|[Pp]roduction|[Ee]ntertainment|[Pp]ictures|[Mm]usic|[Ww]orks|` +
	`OP\d?|ED\d?|IN\d?|BGM|OST|OVA|OAD|ONA|TV|BD|DVD|CD|Blu-ray|第\d+` +
	`Team[- ]|CV\b|NC\b|` +
	`INC\.?|Inc\.?|Ltd\.?|Co\.|Corp\.|` +
	`\bS\d|3D|cv\b`,
)

func isNoiseName(name string) bool {
	for _, s := range noiseSubstringsCJK {
		if strings.Contains(name, s) {
			return true
		}
	}
	// Only run regex for names that contain ASCII letters — most CJK names skip this
	if containsASCII(name) && noiseEnRe.MatchString(name) {
		return true
	}
	return false
}

func containsASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') {
			return true
		}
	}
	return false
}

var positionMergeAliases = map[int]int{
	23: 53,
}

func canonicalPosID(pos int) int {
	if merged, ok := positionMergeAliases[pos]; ok {
		return merged
	}
	return pos
}

var allPosIDs []int
var allPosNameToID map[string]int
var allPosIDToName map[int]string

var _typePni typePosNameToID

func init() {
	_typePni = buildTypePosNameToID()

	allPosNameToID = make(map[string]int)
	allPosIDToName = make(map[int]string)
	for _, pni := range _typePni {
		for name, id := range pni {
			allPosNameToID[name] = id
			allPosIDToName[id] = name
		}
	}
	allPosIDs = make([]int, 0, len(allPosIDToName))
	for id := range allPosIDToName {
		allPosIDs = append(allPosIDs, id)
	}
	sort.Ints(allPosIDs)
}

func buildTypePosNameToID() typePosNameToID {
	result := make(typePosNameToID, len(model.StaffPositions))
	for t, pos := range model.StaffPositions {
		pni := make(map[string]int, len(pos))
		for id, name := range pos {
			pni[name] = id
		}
		result[t] = pni
	}
	for id, name := range musicExtraPositions {
		result[int(model.TypeMusic)][name] = id
	}
	return result
}

var (
	isDigitsOnlyRe  = regexp.MustCompile(`^[\d\-./#\s]+$`)
	hasCJKOrAlphaRe = regexp.MustCompile(`[\p{Han}\p{Hiragana}\p{Katakana}a-zA-Z]`)
)

func normalizePersonName(name string) string {
	return aliases.Normalize(name)
}

// personNameVariantMap maps Japanese variant characters to the common form used
// in person names (mirrors NORMALIZE_MAP in find_dup_person_name.py), so that
// variant-spelling duplicates (e.g. 髙橋/高橋, 廣瀬/広瀬) can be recognized.
// Source file must be UTF-8; this table uses literal characters for
// reviewability. Editors need a font covering CJK Unified and Compatibility
// Ideographs (e.g. 﨑 U+FA11), otherwise glyphs may render as tofu.
// If rendering fails, install Noto Sans CJK or check via \uXXXX.
var personNameVariantMap = map[rune]rune{
	'髙': '高',
	'冨': '富',
	'﨑': '崎',
	'嵜': '崎',
	'郞': '郎',
	'栁': '柳',
	'俱': '倶',
	'姬': '姫',
	'兔': '兎',
	'舍': '舎',
	'衞': '衛',
	'愼': '慎',
	'邉': '辺',
	'邊': '辺',
	'濵': '浜',
	'濱': '浜',
	'嶋': '島',
	'澤': '沢',
	'廣': '広',
	'瀨': '瀬',
	'齊': '斉',
	'齋': '斎',
	'櫻': '桜',
	'關': '関',
	'黑': '黒',
	'德': '徳',
	'龍': '竜',
	'與': '与',
	'鐵': '鉄',
	'嶽': '岳',
	'竝': '並',
}

// normalizePersonNameVariant maps variant characters in an alias-normalized
// person name to their common form.
func normalizePersonNameVariant(name string) string {
	var buf strings.Builder
	buf.Grow(len(name))
	for _, r := range name {
		if rep, ok := personNameVariantMap[r]; ok {
			buf.WriteRune(rep)
		} else {
			buf.WriteRune(r)
		}
	}
	return buf.String()
}

// buildVariantExistingIDs maps each existing-person key to its variant-normalized
// form, so to-be-created persons can be checked for variant-spelling collisions.
func buildVariantExistingIDs(knownIDs map[string][]int) map[string][]int {
	out := make(map[string][]int)
	for key, ids := range knownIDs {
		vk := normalizePersonNameVariant(key)
		out[vk] = append(out[vk], ids...)
	}
	return out
}

// splitVariantDupes moves to-be-created persons whose variant-normalized name
// matches an existing person (e.g. 髙橋 → 高橋) out of the missing list into a
// separate related-style list, so they can be linked instead of created.
func splitVariantDupes(missing []*missingPerson, variantExistingIDs map[string][]int, idToRawName map[int]string) ([]*missingPerson, []*missingRelatedPerson) {
	normal := make([]*missingPerson, 0, len(missing))
	var dupes []*missingRelatedPerson
	for _, mp := range missing {
		vk := normalizePersonNameVariant(mp.KeyNorm)
		ids := variantExistingIDs[vk]
		if len(ids) == 0 {
			normal = append(normal, mp)
			continue
		}
		dupes = append(dupes, &missingRelatedPerson{
			DisplayName:       mp.DisplayName,
			KeyNorm:           mp.KeyNorm,
			Count:             mp.Count,
			Subjects:          mp.Subjects,
			TypeCounts:        mp.TypeCounts,
			ExistingPersonIDs: uniqueIDNames(ids, idToRawName),
		})
	}
	return normal, dupes
}

func uniqueIDNames(ids []int, idToName map[int]string) []personIDName {
	seen := make(map[int]bool, len(ids))
	out := make([]personIDName, 0, len(ids))
	for _, pid := range ids {
		if seen[pid] {
			continue
		}
		seen[pid] = true
		name := idToName[pid]
		if name == "" {
			name = fmt.Sprintf("ID:%d", pid)
		}
		out = append(out, personIDName{ID: pid, Name: name})
	}
	return out
}

func isLikelyPerson(name string) bool {
	if len(name) < 2 {
		return false
	}
	if isDigitsOnlyRe.MatchString(name) {
		return false
	}
	if !hasCJKOrAlphaRe.MatchString(name) {
		return false
	}
	if isNoiseName(name) {
		return false
	}
	return true
}
