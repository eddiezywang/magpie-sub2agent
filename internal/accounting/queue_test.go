package accounting

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func item(id, kind string) Item {
	return Item{ID: id, Kind: kind, Identity: Identity{InstallID: "install"}, Created: time.Unix(1700000000, 0), Payload: json.RawMessage(`{"id":"` + id + `"}`)}
}

func TestQueueSurvivesRestartAndAcknowledgesOnlyNamedEvents(t *testing.T) {
	dir := t.TempDir()
	q, err := OpenQueue(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a", "b"} {
		if err = q.Put(item(id, "usage")); err != nil {
			t.Fatal(err)
		}
	}
	if err = q.Put(item("a", "usage")); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, ".pending-interrupted"), []byte(`{`), 0600)
	q, err = OpenQueue(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Pending("usage", 200)) != 2 {
		t.Fatal("restart lost or duplicated events")
	}
	q.Ack([]string{"a"})
	if got := q.Pending("usage", 200); len(got) != 1 || got[0].ID != "b" {
		t.Fatal("partial ack removed unsent event")
	}
	q, err = OpenQueue(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if got := q.Pending("usage", 200); len(got) != 1 || got[0].ID != "b" {
		t.Fatal("ack did not persist")
	}
	q.Clear("usage")
	if n, _ := q.Count(); n != 0 {
		t.Fatal("disable did not clear pending usage")
	}
}

func TestQueueRejectsUnsafePathsAndExhaustion(t *testing.T) {
	q, _ := OpenQueue(t.TempDir(), 1)
	if err := q.Put(item("a", "usage")); err == nil {
		t.Fatal("byte cap ignored")
	}
	if err := q.Put(item("../escape", "usage")); err == nil {
		t.Fatal("path traversal accepted")
	}
}

func TestLegacySenderPreservesSingleEventAndFailureRetry(t *testing.T) {
	fail := true
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/events" {
			t.Errorf("legacy endpoint changed")
		}
		var e map[string]any
		json.NewDecoder(r.Body).Decode(&e)
		if e["event"] != "desktop_proxy_start" || e["install_id"] != "install" || e["schema"] != nil {
			t.Error("legacy single-event envelope changed")
		}
		if fail {
			w.WriteHeader(500)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	e, _ := Legacy(Identity{InstallID: "install"}, "a", "desktop_proxy_start", "test", time.Now(), nil)
	b, _ := json.Marshal(e)
	it := item("a", "legacy")
	it.Payload = b
	s := Sender{LegacyURL: srv.URL + "/events"}
	if ids, err := s.Send(context.Background(), []Item{it}); err == nil || len(ids) > 0 {
		t.Fatal("failed legacy write acknowledged")
	}
	fail = false
	if ids, err := s.Send(context.Background(), []Item{it}); err != nil || len(ids) != 1 || calls != 2 {
		t.Fatalf("legacy retry: %v %v", ids, err)
	}
}

func TestUsageSenderNegotiatesAndKeepsUnacknowledgedItems(t *testing.T) {
	mode := "old"
	posted := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/healthz" {
			if mode == "old" {
				w.Write([]byte(`{"ok":true}`))
			} else {
				json.NewEncoder(w).Encode(map[string]any{"usage_schemas": []string{UsageSchema}})
			}
			return
		}
		posted++
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		if b["schema"] != UsageSchema || len(b["events"].([]any)) != 2 {
			t.Error("usage batch shape changed")
		}
		switch mode {
		case "counts":
			w.Write([]byte(`{"ok":true,"stored":2}`))
		case "wrong":
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "schema": UsageSchema, "accepted_ids": []string{"not-sent"}})
		default:
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "schema": UsageSchema, "accepted_ids": []string{"a"}})
		}
	}))
	defer srv.Close()
	s := Sender{UsageURL: srv.URL + "/usage/events"}
	items := []Item{item("a", "usage"), item("b", "usage")}
	if ids, err := s.Send(context.Background(), items); err == nil || len(ids) > 0 || posted != 0 {
		t.Fatal("usage sent to an incompatible old collector")
	}
	for _, m := range []string{"counts", "wrong"} {
		mode = m
		if ids, err := s.Send(context.Background(), items); err == nil || len(ids) > 0 {
			t.Fatal("ambiguous or forged ack accepted")
		}
	}
	mode = "v2"
	ids, err := s.Send(context.Background(), items)
	if err != nil || len(ids) != 1 || ids[0] != "a" {
		t.Fatalf("partial ack: %v %v", ids, err)
	}
}
