//go:build intranet

package gateway

// HEIC is forwarded unchanged; providers may reject unsupported formats.
func encodeHEIC([]byte) (string, []byte) { return "", nil }
