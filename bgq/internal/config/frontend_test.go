package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/inchei/bangumi-query/internal/model"
)

// The Web UI re-implements YAML validation in frontend/src/yaml.js.
// This test compares the duplicated lists against the Go contract so drift
// breaks go test here instead of failing at runtime in the editor.

func TestFrontendValidationParity(t *testing.T) {
	src, err := os.ReadFile("../../frontend/src/yaml.js")
	if errors.Is(err, fs.ErrNotExist) {
		t.Skip("frontend/src/yaml.js not found")
	}
	if err != nil {
		t.Fatal(err)
	}

	requireSetEqual(t, "validTargets ↔ TARGETS", mapKeys(validTargets),
		stringsSet(frontendList(t, src, "TARGETS")))

	requireSetEqual(t, "validModes ↔ MODES", mapKeys(validModes),
		stringsSet(frontendList(t, src, "MODES")))

	requireSetEqual(t, "validOperators ↔ OPERATORS", mapKeys(validOperators),
		stringsSet(frontendList(t, src, "OPERATORS")))

	requireSetEqual(t, "Filter yaml tags ↔ FILTER_KEYS", filterYAMLKeys(t),
		stringsSet(frontendList(t, src, "FILTER_KEYS")))

	typeNums := map[string]bool{}
	for n := range model.TypeNumToCN {
		typeNums[strconv.Itoa(n)] = true
	}
	requireSetEqual(t, "model.TypeNumToCN ↔ SUBJECT_TYPE_NUMS", typeNums,
		stringsSet(frontendList(t, src, "SUBJECT_TYPE_NUMS")))
}

// filterYAMLKeys collects the yaml tags of Filter's filter-type pointer
// fields — the exact set the frontend's walkFilters keys on.
func filterYAMLKeys(t *testing.T) map[string]bool {
	t.Helper()
	keys := map[string]bool{}
	typ := reflect.TypeOf(Filter{})
	for i := 0; i < typ.NumField(); i++ {
		tag := strings.SplitN(typ.Field(i).Tag.Get("yaml"), ",", 2)[0]
		if tag != "" {
			keys[tag] = true
		}
	}
	if len(keys) == 0 {
		t.Fatal("no 'yaml' tags found on config.Filter")
	}
	return keys
}

// frontendList extracts the elements of `const NAME = new Set([...])` or
// `const NAME = [...]` from the frontend source.
func frontendList(t *testing.T, src []byte, name string) []string {
	t.Helper()
	re := regexp.MustCompile(`(?s)const ` + name + ` = (?:new Set\()?\[([^\]]*)\]`)
	m := re.FindStringSubmatch(string(src))
	if m == nil {
		t.Fatalf("frontend/src/yaml.js: const %s not found", name)
	}
	var out []string
	for _, tok := range strings.Split(m[1], ",") {
		tok = strings.TrimSpace(tok)
		tok = strings.Trim(tok, `"'`)
		if tok != "" {
			out = append(out, tok)
		}
	}
	return out
}

func stringsSet(items []string) map[string]bool {
	set := map[string]bool{}
	for _, s := range items {
		set[s] = true
	}
	return set
}

func mapKeys[V any](m map[string]V) map[string]bool {
	keys := map[string]bool{}
	for k := range m {
		keys[k] = true
	}
	return keys
}

func requireSetEqual(t *testing.T, what string, want, got map[string]bool) {
	t.Helper()
	var missing, extra []string
	for k := range want {
		if !got[k] {
			missing = append(missing, k)
		}
	}
	for k := range got {
		if !want[k] {
			extra = append(extra, k)
		}
	}
	if len(missing) > 0 || len(extra) > 0 {
		t.Errorf("%s drifted (Go side is the source of truth):\n  missing in frontend: %v\n  extra in frontend:   %v (update backend or frontend/src/yaml.js together)",
			what, fmt.Sprint(missing), fmt.Sprint(extra))
	}
}
