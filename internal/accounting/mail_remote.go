package accounting

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type billingMailRemote struct {
	base, key string
	client    *http.Client
}

func (b billingMailRemote) request(ctx context.Context, user string, params url.Values) (MailRemoteState, error) {
	var result MailRemoteState
	u, err := endpoint(b.base)
	if err != nil {
		return result, err
	}
	u.Path = "/mail-preferences/" + user
	method := http.MethodGet
	if params != nil {
		method = http.MethodPost
		u.RawQuery = params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), nil)
	if err != nil {
		return result, err
	}
	if err = SignBillingRequest(req, b.key, time.Now()); err != nil {
		return result, err
	}
	c := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if b.client != nil {
		c = *b.client
		c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	res, err := c.Do(req)
	if err != nil {
		return result, fmt.Errorf("mail preference service unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusConflict {
		return result, fmt.Errorf("mail preference service HTTP %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if err != nil || len(raw) > 65536 || json.Unmarshal(raw, &result) != nil {
		return result, fmt.Errorf("invalid mail preference response")
	}
	if res.StatusCode == http.StatusConflict {
		result.Conflict = true
	}
	if result.Revision < 0 {
		return result, fmt.Errorf("invalid mail preference revision")
	}
	return result, nil
}
func (b billingMailRemote) Get(ctx context.Context, user string) (MailRemoteState, error) {
	return b.request(ctx, user, nil)
}
func (b billingMailRemote) Set(ctx context.Context, user string, on bool, revision int64, op string) (MailRemoteState, error) {
	return b.request(ctx, user, url.Values{"enabled": {strconv.FormatBool(on)}, "revision": {strconv.FormatInt(revision, 10)}, "operation": {op}})
}

// NewDefaultMailPreferences uses the same user label and managed service as
// the existing billing reports; the shared signing key is not user identity.
func NewDefaultMailPreferences(dir, user string) (*MailPreferences, error) {
	user = strings.TrimSpace(user)
	return NewMailPreferences(dir, user, billingMailRemote{base: Defaults().UsageURL, key: reportSigningKey})
}
