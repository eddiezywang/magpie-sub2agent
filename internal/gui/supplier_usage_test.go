package gui

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestConfiguredUsageSuppliers(t *testing.T) {
	got := configuredUsageSuppliers([]provider.Provider{
		{ID: "aiep-coding-plan-2", Key: "private-fixture"},
		{ID: "cib-zht-apikey"},
		{ID: "sub2agent-workbuddy-cib", Key: "private-fixture"},
		{ID: "sub2agent-workbuddy-enterprise", Key: "private-fixture"},
		{ID: "workbuddy", Key: "private-fixture"},
	})
	want := []usageSupplier{
		{ID: "tig", Providers: []string{"aiep-coding-plan-2"}},
		{ID: "workbuddy-enterprise", Providers: []string{"sub2agent-workbuddy-enterprise"}},
		{ID: "workbuddy-cib", Providers: []string{"sub2agent-workbuddy-cib"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("configured suppliers: %+v, want %+v", got, want)
	}
	encoded, err := json.Marshal(got)
	if err != nil || strings.Contains(string(encoded), "private-fixture") {
		t.Fatal("configuration response included credentials or failed to encode")
	}
}
