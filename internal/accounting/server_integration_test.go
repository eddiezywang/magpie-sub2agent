//go:build intranet

package accounting

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/proc"
	"github.com/yetone/magpie/internal/usage"
)

func TestSenderAgainstRealSummaryServer(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node 18+ is required for cross-language verification")
	}
	source, err := filepath.Abs("../../services/usage-server/src/server.js")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := proc.CommandContext(ctx, node, "-e", `const {createUsageServer}=require(process.argv[1]);const app=createUsageServer({host:'127.0.0.1',port:0,dataDir:process.argv[2]});app.start().then(p=>console.log(p));`, source, t.TempDir())
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); _ = cmd.Wait() }()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("server did not start")
	}
	base := "http://127.0.0.1:" + scanner.Text()
	res, err := http.Get(base + "/usage/aggregation-rules")
	if err != nil {
		t.Fatal(err)
	}
	var rules AggregationRules
	err = json.NewDecoder(res.Body).Decode(&rules)
	res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err = rules.Validate(); err != nil {
		t.Fatal(err)
	}
	var buffer minuteBuffer
	at := time.Now().UTC().Truncate(time.Minute)
	record := usage.Record{Agent: "codex", Provider: "sub2agent-workbuddy", Model: "glm-5.3-flash-maas-fixture", Input: 100, Output: 20, Status: 200}
	for range 10 {
		if err = buffer.Add(record, at, &rules); err != nil {
			t.Fatal(err)
		}
	}
	buffer.Seal(at, true)
	packet, ok := buffer.First()
	if !ok {
		t.Fatal("no summary")
	}
	if packet.Groups[0].ContextTier != "base" {
		t.Fatal("server's managed model rule did not classify the actual request")
	}
	raw, _ := json.Marshal(packet)
	sender := Sender{UsageURL: base + "/usage/events"}
	item := Item{ID: packet.ID, Kind: "summary", Identity: Identity{InstallID: "fixture-device", Username: "fixture-user"}, Created: at, Payload: raw}
	for range 2 {
		ack, err := sender.Send(ctx, []Item{item})
		if err != nil || len(ack) != 1 || ack[0] != packet.ID {
			t.Fatalf("real server acknowledgement: %v %v", ack, err)
		}
	}
	res, err = http.Get(base + "/reports/fixture-user/daily.json?date=" + at.Format("2006-01-02"))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var report struct {
		Totals struct {
			Requests int `json:"requests"`
			Input    int `json:"input_tokens"`
		} `json:"totals"`
		Billing struct {
			Amounts map[string]float64 `json:"amounts_by_currency"`
		} `json:"billing"`
	}
	if err = json.NewDecoder(res.Body).Decode(&report); err != nil {
		t.Fatal(err)
	}
	if report.Totals.Requests != 10 || report.Totals.Input != 1000 || report.Billing.Amounts["POINTS"] != 1200 {
		t.Fatalf("summary not billed exactly once: %+v", report)
	}
	if strings.Contains(string(raw), "fixture-user") {
		t.Fatal("identity leaked into group payload")
	}
}
