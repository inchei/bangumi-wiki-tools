package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

const apiCacheControl = "public, max-age=3600"

// apiETag returns a strong ETag bound to a data version: the source mtime
// (nanosecond precision) and its byte size.
func apiETag(modTime time.Time, size int64) string {
	return fmt.Sprintf("\"%x-%x\"", modTime.UnixNano(), size)
}

// setAPICacheHeaders sets the shared-cache validators on a cacheable response.
func setAPICacheHeaders(w http.ResponseWriter, etag string, modTime time.Time) {
	h := w.Header()
	h.Set("Cache-Control", apiCacheControl)
	h.Set("ETag", etag)
	h.Set("Last-Modified", modTime.UTC().Format(http.TimeFormat))
}

// apiNotModified reports whether the request validators (If-None-Match, then
// If-Modified-Since) match the current data version. If-Modified-Since is
// second-granularity, so the source mtime is truncated to seconds first.
func apiNotModified(r *http.Request, etag string, modTime time.Time) bool {
	if inm := r.Header.Get("If-None-Match"); inm != "" {
		if inm == "*" {
			return true
		}
		for _, part := range strings.Split(inm, ",") {
			part = strings.TrimPrefix(strings.TrimSpace(part), "W/")
			if part == etag {
				return true
			}
		}
		return false
	}
	if ims := r.Header.Get("If-Modified-Since"); ims != "" {
		if t, err := http.ParseTime(ims); err == nil {
			return !modTime.Truncate(time.Second).After(t)
		}
	}
	return false
}

// beginConditional writes the cache validators for a data version and reports
// whether the request is already answered with a bodyless 304. Call it BEFORE
// doing expensive work (e.g. a DuckDB query): on a hit the work is skipped
// entirely.
func beginConditional(w http.ResponseWriter, r *http.Request, modTime time.Time, size int64) bool {
	etag := apiETag(modTime, size)
	setAPICacheHeaders(w, etag, modTime)
	if apiNotModified(r, etag, modTime) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	return false
}
