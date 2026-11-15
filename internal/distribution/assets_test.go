package distribution

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssetURL(t *testing.T) {
	if Base != "http://172.21.0.177:18989" || !strings.HasPrefix(AppFeed, Base+"/") {
		t.Fatal("managed services must use port 18989")
	}
	for _, raw := range []string{Base + "/npm/x", AppMirror + "/latest.json", "http://127.0.0.1:1234/x", "http://[::1]:1234/x"} {
		if err := AssetURL(raw); err != nil {
			t.Errorf("%s: %v", raw, err)
		}
	}
	for _, raw := range []string{"https://registry.npmjs.org/x", "http://172.21.0.177.evil.invalid/x", "http://172.21.0.178/x", "http://user@172.21.0.177/x", "http://uat.rcrai.weoa.com/wemail/other", AppMirror + "/../other", "file:///x"} {
		if AssetURL(raw) == nil {
			t.Errorf("allowed %s", raw)
		}
	}
}

func TestAssetRedirectCannotLeaveInternalServer(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://public.invalid/tarball", http.StatusFound)
	}))
	defer s.Close()
	_, err := AssetClient(s.Client()).Get(s.URL)
	if err == nil || !strings.Contains(err.Error(), "public resource downloads are disabled") {
		t.Fatalf("redirect error: %v", err)
	}
}
