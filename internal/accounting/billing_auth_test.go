package accounting

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBillingSignatureBindsTargetAndGeneratesNonce(t *testing.T) {
	key := strings.Repeat("12", 32)
	now := time.UnixMilli(1800000000000)
	req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1/reports/alice/daily.json?date=2026-11-14", nil)
	if err := SignBillingRequest(req, key, now); err != nil {
		t.Fatal(err)
	}
	nonce := req.Header.Get("X-Sub2Agent-Nonce")
	ts := req.Header.Get("X-Sub2Agent-Timestamp")
	decoded, _ := hex.DecodeString(key)
	mac := hmac.New(sha256.New, decoded)
	mac.Write([]byte("sub2agent-billing-v1\nGET\n" + req.URL.RequestURI() + "\n" + ts + "\n" + nonce))
	if req.Header.Get("X-Sub2Agent-Signature") != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatal("signature differs")
	}
	if err := SignBillingRequest(req, key, now); err != nil {
		t.Fatal(err)
	}
	if nonce == req.Header.Get("X-Sub2Agent-Nonce") {
		t.Fatal("nonce reused")
	}
	if err := SignBillingRequest(req, "bad", now); err == nil {
		t.Fatal("short key accepted")
	}
}
