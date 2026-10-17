package model

// CharacterAssociationTypes maps subject_character type codes to Chinese names.
var CharacterAssociationTypes = map[int]string{
	1: "主角",
	2: "配角",
	3: "客串",
	4: "闲角",
	5: "旁白",
	6: "声库",
}

// PersonCharacterTypes maps person_character type codes to Chinese names (CV type).
var PersonCharacterTypes = map[int]string{
	0: "CV",
	1: "译配",
	2: "演员",
	3: "中配",
	4: "日配",
	5: "英配",
	6: "韩配",
}

// SubjectType represents a Bangumi subject type.
type SubjectType int

const (
	TypeBook  SubjectType = 1
	TypeAnime SubjectType = 2
	TypeMusic SubjectType = 3
	TypeGame  SubjectType = 4
	TypeReal  SubjectType = 6
)

// TypeCNToNum maps Chinese type names to numeric codes.
var TypeCNToNum = map[string]int{
	"书籍":  1,
	"动画":  2,
	"音乐":  3,
	"游戏":  4,
	"三次元": 6,
}

// TypeNumToCN maps numeric codes to Chinese type names.
var TypeNumToCN = map[int]string{
	1: "书籍",
	2: "动画",
	3: "音乐",
	4: "游戏",
	6: "三次元",
}
