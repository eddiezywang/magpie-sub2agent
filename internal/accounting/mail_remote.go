package accounting

import (
	"context"
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

// Set posts the choice. The signed reply carries nothing the app needs,
// because the service owns the real state.
func (b billingMailRemote) Set(ctx context.Context, user string, enabled bool) error {
	u, err := endpoint(b.base)
	if err != nil {
		return err
	}
	u.Path = "/mail-preferences/" + user
	u.RawQuery = url.Values{"enabled": {strconv.FormatBool(enabled)}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), nil)
	if err != nil {
		return err
	}
	if err = SignBillingRequest(req, b.key, time.Now()); err != nil {
		return err
	}
	c := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if b.client != nil {
		c = *b.client
		c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	res, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("mail preference service unavailable")
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 65537))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("mail preference service HTTP %d", res.StatusCode)
	}
	return nil
}

// NewDefaultMailPreferences uses the same user label and managed service as
// the existing billing reports; the shared signing key is not user identity.
func NewDefaultMailPreferences(dir, user string) (*MailPreferences, error) {
	user = strings.TrimSpace(user)
	return NewMailPreferences(dir, user, billingMailRemote{base: Defaults().UsageURL, key: reportSigningKey})
}
