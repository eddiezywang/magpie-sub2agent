package accounting

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

type Item struct {
	ID       string          `json:"id"`
	Kind     string          `json:"kind"`
	Identity Identity        `json:"identity"`
	Created  time.Time       `json:"created"`
	Payload  json.RawMessage `json:"payload"`
}

type queued struct {
	item  Item
	bytes int64
}
type Queue struct {
	mu    sync.Mutex
	dir   string
	limit int64
	bytes int64
	items map[string]queued
}

func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func validID(id string) bool {
	if id == "" || len(id) > 80 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func validKind(kind string) bool { return kind == "legacy" || kind == "usage" }

// The queue owns this dedicated folder. Only completely renamed JSON items
// are loaded; interrupted temporary writes never become deliverable events.
func OpenQueue(dir string, limit int64) (*Queue, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("queue byte limit must be positive")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	q := &Queue{dir: dir, limit: limit, items: map[string]queued{}}
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(f.Name(), ".json")
		if !validID(id) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, f.Name()))
		if err != nil {
			return nil, err
		}
		var it Item
		if len(data) > 65536 || json.Unmarshal(data, &it) != nil || it.ID != id || !validKind(it.Kind) || !json.Valid(it.Payload) || it.Created.IsZero() {
			return nil, fmt.Errorf("invalid accounting queue item %s", f.Name())
		}
		q.items[id] = queued{it, int64(len(data))}
		q.bytes += int64(len(data))
	}
	return q, nil
}

func (q *Queue) Put(it Item) error {
	if !validID(it.ID) || !validKind(it.Kind) || !json.Valid(it.Payload) || it.Identity.InstallID == "" {
		return fmt.Errorf("invalid queue item")
	}
	if it.Created.IsZero() {
		it.Created = time.Now().UTC()
	}
	data, err := json.Marshal(it)
	if err != nil {
		return err
	}
	if len(data) > 65536 {
		return fmt.Errorf("accounting event exceeds 64 KiB")
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if old, ok := q.items[it.ID]; ok {
		if old.item.Kind == it.Kind && old.item.Identity == it.Identity && bytes.Equal(old.item.Payload, it.Payload) {
			return nil
		}
		return fmt.Errorf("accounting event ID collision")
	}
	if q.bytes+int64(len(data)) > q.limit {
		return fmt.Errorf("accounting queue is full")
	}
	f, err := os.CreateTemp(q.dir, ".pending-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), filepath.Join(q.dir, it.ID+".json")); err != nil {
		return err
	}
	q.items[it.ID] = queued{it, int64(len(data))}
	q.bytes += int64(len(data))
	return nil
}

// Pending returns FIFO events from one identity and plane. Old identities
// remain attached to their queued events even if a new install is created.
func (q *Queue) Pending(kind string, n int) []Item {
	q.mu.Lock()
	defer q.mu.Unlock()
	all := []Item{}
	for _, v := range q.items {
		if v.item.Kind == kind {
			all = append(all, v.item)
		}
	}
	slices.SortFunc(all, func(a, b Item) int {
		if c := a.Created.Compare(b.Created); c != 0 {
			return c
		}
		return strings.Compare(a.ID, b.ID)
	})
	out := []Item{}
	for _, it := range all {
		if len(out) >= n {
			break
		}
		if len(out) == 0 || it.Identity == out[0].Identity {
			it.Payload = bytes.Clone(it.Payload)
			out = append(out, it)
		}
	}
	return out
}

func (q *Queue) Ack(ids []string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, id := range ids {
		it, ok := q.items[id]
		if !ok {
			continue
		}
		if err := os.Remove(filepath.Join(q.dir, id+".json")); err != nil && !os.IsNotExist(err) {
			return err
		}
		q.bytes -= it.bytes
		delete(q.items, id)
	}
	return nil
}

func (q *Queue) Clear(kind string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	for id, it := range q.items {
		if it.item.Kind == kind {
			if err := os.Remove(filepath.Join(q.dir, id+".json")); err != nil && !os.IsNotExist(err) {
				return err
			}
			q.bytes -= it.bytes
			delete(q.items, id)
		}
	}
	return nil
}

func (q *Queue) Count() (int, int64) { q.mu.Lock(); defer q.mu.Unlock(); return len(q.items), q.bytes }

// Reject archives the original numeric event before removing it from pending.
// Only IDs explicitly rejected by a negotiated v2 collector reach this method.
func (q *Queue) Reject(ids []string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	dir := filepath.Join(q.dir, "rejected")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var size int64
	for _, file := range files {
		info, err := file.Info()
		if err != nil {
			return err
		}
		size += info.Size()
	}
	for _, id := range ids {
		it, ok := q.items[id]
		if !ok {
			continue
		}
		if size+it.bytes > q.limit {
			return fmt.Errorf("rejected accounting archive is full")
		}
		if err := os.Rename(filepath.Join(q.dir, id+".json"), filepath.Join(dir, id+".json")); err != nil {
			return err
		}
		size += it.bytes
		q.bytes -= it.bytes
		delete(q.items, id)
	}
	return nil
}
