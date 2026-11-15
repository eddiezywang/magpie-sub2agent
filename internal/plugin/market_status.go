package plugin

import (
	"context"
	"errors"
	"net"
	"syscall"
	"time"
)

// MarketStatus describes the directory request, independently of how many
// plugins it contained. Error details never include URLs, proxies or credentials.
type MarketStatus struct {
	State      string    `json:"state"` // online, cached, unavailable
	Reason     string    `json:"reason,omitempty"`
	HTTPStatus int       `json:"httpStatus,omitempty"`
	CheckedAt  time.Time `json:"checkedAt,omitzero"`
	UpdatedAt  time.Time `json:"updatedAt,omitzero"`
}

type marketCatalogError struct{ error }

// MarketWithStatus returns the list and its status from the same locked read.
func MarketWithStatus(ctx context.Context) ([]Listing, MarketStatus) {
	marketMu.Lock()
	defer marketMu.Unlock()
	ls, err := marketLocked(ctx)
	s := MarketStatus{State: "online", CheckedAt: marketChecked, UpdatedAt: marketUpdated}
	if err != nil {
		s.State = "unavailable"
		if !marketUpdated.IsZero() {
			s.State = "cached"
		}
		s.Reason, s.HTTPStatus = marketFailure(err)
	}
	return ls, s
}

func marketFailure(err error) (string, int) {
	var ne net.Error
	var dns *net.DNSError
	var status *statusError
	var catalog *marketCatalogError
	switch {
	case errors.Is(err, context.DeadlineExceeded) || errors.As(err, &ne) && ne.Timeout():
		return "timeout", 0
	case errors.Is(err, context.Canceled):
		return "cancelled", 0
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused", 0
	case errors.As(err, &dns):
		return "dns", 0
	case errors.Is(err, errNotFound):
		return "http", 404
	case errors.As(err, &status):
		return "http", status.Code
	case errors.As(err, &catalog):
		return "invalid", 0
	default:
		return "unreachable", 0
	}
}
