package gui

import (
	"strings"
	"testing"
	"time"
)

func TestZHTCLIOutputSelection(t *testing.T) {
	now := time.UnixMilli(1800000000000)
	output := []byte(`CLI 安全提示：stdout contains personal keys.
 npm install -g @webank/zht-dt-cli@0.3.0
 {"respCode":"0000","data":[
 {"apiKeyId":"other-id","apiKeyValue":"never-select"},
 {"apiKeyId":"api_8899_expired","apiKeyValue":"expired","expireTime":1},
 {"apiKeyId":"api_8899_one","apiKeyValue":"fixture-one","apiKeyUser":"fixture-user","expireTime":4102416000000},
 {"apiKeyId":"api_8899_two","apiKeyValue":"fixture-two"},
 {"apiKeyId":"api_8899_empty","apiKeyValue":""}
 ],"bizSeq":"fixture"}
 update notice after JSON`)
	keys, err := parseZHTKeys(output, now)
	if err != nil || len(keys) != 2 || keys[0].Value != "fixture-one" || keys[1].Value != "fixture-two" {
		t.Fatalf("CLI selection did not retain the two eligible keys: count=%d, error=%v", len(keys), err)
	}
	for _, body := range []string{
		`{"respCode":"0000","data":[{"apiKeyId":"other-id","apiKeyValue":"fixture-secret"}]}`,
		`{"respCode":"1000","respMsg":"fixture-secret","data":[]}`,
		`invalid fixture-secret`,
		strings.Repeat("fixture-secret", 100000),
	} {
		_, err := parseZHTKeys([]byte(body), now)
		if err == nil || strings.Contains(err.Error(), "fixture-secret") {
			t.Fatal("unusable reply accepted or a secret escaped in the error")
		}
	}
}
