package modelmap

import (
	"encoding/json"
	"github.com/yetone/magpie/internal/gwmw"
	"github.com/yetone/magpie/internal/middleware"
	"github.com/yetone/magpie/internal/pluginrt"
	"github.com/yetone/magpie/internal/testenv"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMain(m *testing.M) { testenv.Main(m) }
func TestModelMapDefaultsLifecycleAndReplies(t *testing.T) {
	var manifest pluginrt.Manifest
	for _, m := range pluginrt.Registered() {
		if m.ID == "modelmap" {
			manifest = m
		}
	}
	rows := pluginrt.Compose([]pluginrt.Manifest{manifest}, pluginrt.File{Preset: pluginrt.PresetEssentials})
	if len(rows) != 1 || !rows[0].Enabled || rows[0].Config["mapping"] != "{}" {
		t.Fatalf("mapping must be enabled with empty rules: %+v", rows)
	}
	rt := pluginrt.New([]pluginrt.Manifest{manifest})
	defer rt.Stop()
	settings := map[string]map[string]any{"modelmap": {"mapping": `{"fast":"plan/model"}`, "keepUpstreamName": false}}
	rt.Reconcile(map[string]bool{"modelmap": true}, settings)
	agents := gwmw.Agents()
	if len(agents) != 1 {
		t.Fatalf("expected exactly one mapper, got %d", len(agents))
	}
	for _, stream := range []bool{false, true} {
		run := agents[0].Begin(gwmw.Info{Protocol: "anthropic", Model: "fast", Stream: stream})
		body, reject := run.Request([]byte(`{"model":"fast","messages":[]}`))
		if reject != nil || !strings.Contains(string(body), `"model":"plan/model"`) {
			t.Fatalf("not mapped: %s %+v", body, reject)
		}
		recorder := httptest.NewRecorder()
		writer, done := run.Wrap(recorder)
		if stream {
			writer.Header().Set("Content-Type", "text/event-stream")
			writer.Write([]byte("event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"plan/model\"}}\n\n"))
		} else {
			writer.Header().Set("Content-Type", "application/json")
			writer.Write([]byte(`{"model":"plan/model","content":[]}`))
		}
		done()
		run.End()
		if !strings.Contains(recorder.Body.String(), `"model":"fast"`) {
			t.Fatalf("reply lost alias: %s", recorder.Body.String())
		}
	}
	rt.Reconcile(map[string]bool{"modelmap": false}, nil)
	if len(gwmw.Agents()) != 0 {
		t.Fatal("disabled mapping still served")
	}
}
func TestModelMapRegexChainsCyclesAndKeepName(t *testing.T) {
	for _, tc := range []struct{ mapping, asked, want string }{
		{`{"a":"b","b":"c"}`, "a", "c"},
		{`{"a":"b","b":"a"}`, "a", "b"},
		{`{"/^claude-(.*)$/":"plan/$1"}`, "claude-fast", "plan/fast"},
		{`{}`, "untouched", "untouched"},
	} {
		var mapping map[string]any
		json.Unmarshal([]byte(tc.mapping), &mapping)
		agent, err := middleware.Embedded("modelmap", source, map[string]any{"mapping": mapping, "keep_upstream_name": true})
		if err != nil {
			t.Fatal(err)
		}
		run := agent.Begin(gwmw.Info{Protocol: "responses", Model: tc.asked})
		defer run.End()
		b, _ := json.Marshal(map[string]string{"model": tc.asked})
		got, reject := run.Request(b)
		var result map[string]string
		json.Unmarshal(got, &result)
		if reject != nil || result["model"] != tc.want {
			t.Fatalf("%s -> %s, want %s", tc.asked, got, tc.want)
		}
		recorder := httptest.NewRecorder()
		w, done := run.Wrap(recorder)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"model":"actual"}`))
		done()
		if !strings.Contains(recorder.Body.String(), `"model":"actual"`) {
			t.Fatal("keep upstream name ignored")
		}
	}
}
