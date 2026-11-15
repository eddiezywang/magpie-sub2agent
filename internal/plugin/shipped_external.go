//go:build !intranet || !embeddedproviders

package plugin

func defaultShippedDirectory() string {
	return legacyShippedDirectory()
}
