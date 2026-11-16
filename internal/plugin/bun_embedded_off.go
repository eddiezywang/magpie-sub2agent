//go:build !intranet || !embeddedbun

package plugin

const embeddedBunAvailable = false

func materializeEmbeddedBun() (string, error) { return "", nil }
