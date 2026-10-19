package aliases

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

// Entry is a person alias entry: a display name and its person ID.
type Entry struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

// Data is the parsed person_alias.json: person entries and the alias → person
// index mapping. ModTime is the source file mtime and Size its byte length,
// used for hot-reload and HTTP cache validators.
type Data struct {
	Persons []Entry
	Aliases map[string][]int
	ModTime time.Time
	Size    int64
}

// Load reads and parses person_alias.json: a two-element array
// [persons, aliases] where persons is [[name, id], ...] and aliases maps a
// normalized alias to one or more indices into persons.
func Load(path string) (*Data, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("打开 aliases 文件失败: %w", err)
	}
	defer func() { _ = f.Close() }()

	fi, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("获取 aliases 文件状态失败: %w", err)
	}

	var raw []any
	if err := json.NewDecoder(f).Decode(&raw); err != nil {
		return nil, fmt.Errorf("解析 aliases JSON 失败: %w", err)
	}

	if len(raw) != 2 {
		return nil, fmt.Errorf("aliases 数据格式错误: 需要 [persons, aliases] 两个元素")
	}

	personsRaw, ok := raw[0].([]any)
	if !ok {
		return nil, fmt.Errorf("aliases 数据格式错误: persons 应为数组")
	}

	persons := make([]Entry, len(personsRaw))
	for i, p := range personsRaw {
		arr, ok := p.([]any)
		if !ok || len(arr) < 2 {
			continue
		}
		name, _ := arr[0].(string)
		id, _ := arr[1].(float64)
		persons[i] = Entry{Name: name, ID: int(id)}
	}

	aliasesRaw, ok := raw[1].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("aliases 数据格式错误: aliases 应为对象")
	}

	aliases := make(map[string][]int, len(aliasesRaw))
	for alias, indicesRaw := range aliasesRaw {
		switch v := indicesRaw.(type) {
		case []any:
			for _, idx := range v {
				if f, ok := idx.(float64); ok {
					aliases[alias] = append(aliases[alias], int(f))
				}
			}
		case float64:
			aliases[alias] = []int{int(v)}
		}
	}

	log.Printf("已加载 %d 个别名，映射到 %d 个人物", len(aliases), len(persons))
	return &Data{Persons: persons, Aliases: aliases, ModTime: fi.ModTime(), Size: fi.Size()}, nil
}

// Normalize normalizes a person alias for lookup.
// Source must be UTF-8; requires a font covering CJK Unified and Compatibility
// Ideographs for review (e.g. 﨑 U+FA11). NFKC handles halfwidth katakana
// (U+FF66-FF9D) -> fullwidth katakana and fullwidth alphanumerics
// (U+FF21-FF5A) -> ASCII; the remaining katakana->hiragana step uses a
// literal range and is kept in sync with person_alias.py and the JS
// implementations.
func Normalize(name string) string {
	nfkc := norm.NFKC.String(name)
	var buf strings.Builder
	buf.Grow(len(nfkc))
	for _, r := range nfkc {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '-' || r == '\u3000' {
			continue
		}
		if r >= 0x30A1 && r <= 0x30F6 {
			r -= 0x60
		}
		buf.WriteRune(r)
	}
	return strings.ToLower(buf.String())
}
