package missingpersons

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"regexp"
	"strings"
	"testing"
)

var oldNoiseEnRe = regexp.MustCompile(`(?i)\b(?:` +
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

var oldDigitsOnlyRe = regexp.MustCompile(`^[\d\-./#\s]+$`)
var oldHasCJKOrAlphaRe = regexp.MustCompile(`[\p{Han}\p{Hiragana}\p{Katakana}a-zA-Z]`)

func oldIsNoise(name string) bool {
	for _, s := range noiseSubstringsCJK {
		if strings.Contains(name, s) {
			return true
		}
	}
	return oldNoiseEnRe.MatchString(name)
}

func tokenizeLikeFieldsFunc(s string) []string {
	return strings.FieldsFunc(s, isDelim)
}

func collectTokens(matrix [][]string) map[string]struct{} {
	set := make(map[string]struct{})
	for _, toks := range matrix {
		for _, tok := range toks {
			tok = strings.TrimSpace(tok)
			set[tok] = struct{}{}
		}
	}
	return set
}

func oldIsLikelyPerson(name string) bool {
	if len(name) < 2 {
		return false
	}
	if oldDigitsOnlyRe.MatchString(name) {
		return false
	}
	if !oldHasCJKOrAlphaRe.MatchString(name) {
		return false
	}
	if oldIsNoise(name) {
		return false
	}
	return true
}

func checkEquivalence(t testing.TB, tokens map[string]struct{}) {
	mismatch := 0
	for tok := range tokens {
		oldv := oldIsLikelyPerson(tok)
		newv := isLikelyPerson(tok)
		if oldv != newv {
			mismatch++
			if mismatch <= 20 {
				t.Errorf("likely mismatch %q: old=%v new=%v", tok, oldv, newv)
			}
		}
		if oldv && oldIsNoise(tok) != isNoiseName(tok) {
			mismatch++
			if mismatch <= 20 {
				t.Errorf("noise mismatch %q: old=%v new=%v", tok, oldIsNoise(tok), isNoiseName(tok))
			}
		}
	}
	if mismatch == 0 {
		t.Logf("equivalence OK over %d tokens", len(tokens))
	} else {
		t.Fatalf("equivalence failed: %d mismatches over %d tokens", mismatch, len(tokens))
	}
}

var noiseTestPads = []string{"", "X", "三", "漢字", "0", " ", "《》", "a", "・"}

func addSynthetic(bat map[string]struct{}) {
	for _, s := range noiseSubstringsCJK {
		for _, pre := range noiseTestPads {
			for _, suf := range noiseTestPads {
				bat[pre+s+suf] = struct{}{}
			}
		}
	}
	words := []string{
		"letterer", "colorist", "inker", "penciler", "penciller", "translator",
		"editor", "assistant", "credited", "uncredited", "retouch", "technian",
		"technician", "coordinator", "coordination", "contributor",
		"collaborator", "producer", "supervisor", "supervision", "manager",
		"managem", "planner", "director", "distributor", "distribution",
		"packager", "printer", "binder", "staff", "piano", "violin", "guitar",
		"bass", "drums", "flute", "sax", "saxophone", "cello", "harp", "trumpet",
		"trombone", "clarinet", "oboe", "viola", "ukulele", "synthesizer",
		"synthesizs", "keyboard", "drum", "recording", "mastering",
		"remastering", "vocaloid", "utau", "artists", "pl", "plc", "pc", "pcc",
		"llc", "ltd", "gmbh", "inc", "corp", "co", "android", "ios", "windows",
		"steam", "switch", "new", "program", "programming", "programmer",
		"design", "designer", "writer", "directio", "direction", "effect",
		"effects", "graphic", "graphics", "scenario", "planning",
	}
	for _, w := range words {
		for _, a := range []string{"", "a", "X三", "12"} {
			for _, b := range []string{"", "b", "中", "45"} {
				bat[a+w+b] = struct{}{}
			}
		}
	}
	wordsLower := words
	for casing := 0; casing < 3; casing++ {
		for i := 0; i < len(wordsLower); i++ {
			switch casing {
			case 1:
				wordsLower[i] = strings.ToUpper(words[i])
			case 2:
				if len(words[i]) > 0 {
					wordsLower[i] = strings.ToUpper(words[i][:1]) + strings.ToLower(words[i][1:])
				}
			}
			for _, a := range []string{"", "_", "％"} {
				for _, b := range []string{"", "1"} {
					bat[a+wordsLower[i]+b] = struct{}{}
				}
			}
		}
	}
	extras := []string{
		"PS", "PS2", "PS4", "PSP", "PSV", "3DS", "NDS", "GBA", "FC", "SFC",
		"FX", "N64", "DC", "SS", "Xbox", "XBOX", "PCstudio", "PC1Studio",
		"pc2sTuDio", "Studio", "production", "OP", "OP1", "ED", "ED2", "IN",
		"IN5", "BGM", "OST", "OVA", "OAD", "ONA", "TV", "BD", "DVD", "CD",
		"Blu-ray", "3D", "第1Team", "第 2 Team X", "第12Team-", "第23Team ",
		"CV", "CVX", "aCV", "(CV)", "NC", "NCX", "INC", "Inc.", "Ltd.", "Co.",
		"Corp.", "l.t.d", "L.TD", "LT.D", "l.T.d", "S1", "S9", "aS2", "X S3",
		"3Dsound", "various artists", " Various  Artists ", "music",
		"Works", "Pictures", "Entertainment", "Production", "adv",
		"Shinji", "Shingo", "Scorpion", "incl.", "pico.", "management",
		"technician", "technian", "technician X", "sync", "scorch",
	}
	for _, e := range extras {
		for _, a := range noiseTestPads {
			bat[a+e] = struct{}{}
			bat[e+a] = struct{}{}
		}
	}
	rng := rand.New(rand.NewSource(1))
	alphabets := []string{
		"abciexs_0123456789 ",
		"abCIXS_-.# 0123",
		"中文日本 Assist DC conforming Istanbul",
		"第CvNCS music2 3D-pc studio,",
	}
	for i := 0; i < 20000; i++ {
		alpha := alphabets[rng.Intn(len(alphabets))]
		n := rng.Intn(18) + 2
		b := make([]rune, n)
		for j := range b {
			b[j] = rune(alpha[rng.Intn(len(alpha))])
		}
		bat[string(b)] = struct{}{}
	}
}

func loadRealCorpusTokens(t testing.TB) map[string]struct{} {
	f, err := os.Open("../../../bangumi_archive/subject.jsonlines")
	if err != nil {
		t.Skipf("subject.jsonlines not found: %v", err)
	}
	defer func() { _ = f.Close() }()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	matrix := make([][]string, 0, 500000)
	for sc.Scan() {
		var row struct {
			Infobox string `json:"infobox"`
		}
		if json.Unmarshal(sc.Bytes(), &row) != nil {
			continue
		}
		matrix = append(matrix, tokenizeLikeFieldsFunc(row.Infobox))
		if len(matrix)%50000 == 0 {
			fmt.Fprintf(os.Stderr, "loaded %d lines\n", len(matrix))
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan subject.jsonlines: %v", err)
	}
	return collectTokens(matrix)
}

func TestSyntheticNoiseEquivalence(t *testing.T) {
	bat := make(map[string]struct{})
	addSynthetic(bat)
	checkEquivalence(t, bat)
}

func TestRealCorpusNoiseEquivalence(t *testing.T) {
	if os.Getenv("MP_EQUIV_REAL") == "" {
		t.Skip("set MP_EQUIV_REAL=1 to run full corpus equivalence")
	}
	tokens := loadRealCorpusTokens(t)
	checkEquivalence(t, tokens)
}
