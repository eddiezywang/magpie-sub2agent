package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestConnectCurrentPickPrecedesHistory(t *testing.T) {
	for _, selected := range []string{"vendor/new", "group/cheap-first[1m]", ""} {
		t.Run(selected, func(t *testing.T) {
			value := selected
			a := &Agent{ID: "current-pick-" + selected, Name: "Current pick", Spelled: func(string) bool { return true }, SplitSuffix: func(v string) (string, string, bool) { return strings.TrimSuffix(v, "[1m]"), "", true }}
			a.Fields = []Field{{Key: "model", Get: func() string { return value }, Set: func(v string) error { value = v; return nil }, Options: func(map[string]string) []Option {
				return []Option{{Value: "vendor/old", Ref: "vendor/old"}, {Value: "vendor/new", Ref: "vendor/new"}, {Value: "group/cheap-first", Ref: "group/cheap-first"}}
			}}}

			rec, _ := json.Marshal(reconnection{Magpie: map[string]string{"model": "vendor/old"}, Routed: []string{"model"}, Left: map[string]string{"model": selected}})
			stash(map[string]string{a.ID + ".reconnect": string(rec)})
			connection, err := a.ConnectHow()
			if err != nil {
				t.Fatal(err)
			}
			want, how := selected, "same"
			if selected == "" {
				want, how = "vendor/old", "again"
			}
			if value != want || connection.How != how {
				t.Fatalf("got model %q (%s), want %q (%s)", value, connection.How, want, how)
			}
		})
	}
}
