package plugin

import (
	"context"
	"errors"
	"net"
	"net/url"
	"syscall"
	"testing"
)

func TestMarketFailureCategories(t *testing.T) {
	for _, tc := range []struct {
		err    error
		reason string
		code   int
	}{
		{&url.Error{Op: "Get", URL: "http://user:secret@server/?token=secret", Err: context.DeadlineExceeded}, "timeout", 0},
		{&net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}, "refused", 0},
		{&net.DNSError{Err: "lookup failed", Name: "server"}, "dns", 0},
		{context.Canceled, "cancelled", 0},
		{errNotFound, "http", 404},
		{&statusError{Code: 503}, "http", 503},
		{&marketCatalogError{errors.New("invalid JSON")}, "invalid", 0},
		{errors.New("network unavailable"), "unreachable", 0},
	} {
		got, code := marketFailure(tc.err)
		if got != tc.reason || code != tc.code {
			t.Errorf("%T: %s/%d, want %s/%d", tc.err, got, code, tc.reason, tc.code)
		}
	}
}
