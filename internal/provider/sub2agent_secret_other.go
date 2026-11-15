//go:build !windows

package provider

import "errors"

func legacyUnprotect([]byte) ([]byte, error) {
	return nil, errors.New("Windows credentials require the original Windows user")
}
