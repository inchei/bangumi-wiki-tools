package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunIngestRejectsExistingDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bangumi.db")
	if err := os.WriteFile(dbPath, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := runIngest(t.TempDir(), dbPath)
	if err == nil || !strings.Contains(err.Error(), "数据库已存在") {
		t.Fatalf("expected existing-database error, got %v", err)
	}
}
