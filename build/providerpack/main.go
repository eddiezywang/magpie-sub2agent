// providerpack embeds the generated provider manifests and entrypoints.
package main

import (
	"archive/zip"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: providerpack <generated-runtime> <output.zip>")
		os.Exit(2)
	}
	if err := pack(os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func pack(source, out string) error {
	file, err := os.CreateTemp(filepath.Dir(out), ".providerpack-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	z := zip.NewWriter(file)
	for _, kind := range []string{"codebuddy", "workbuddy", "trae", "aiep", "native-api", "community-antigravity", "community-commandcode", "community-cursor", "community-devin", "community-factory", "community-grok", "community-kiro", "community-mimo", "community-qoder", "community-workbuddy", "community-zcode", "community-zed"} {
		for _, name := range []string{"index.js", "package.json"} {
			data, err := os.ReadFile(filepath.Join(source, kind, name))
			if err != nil {
				z.Close()
				file.Close()
				return err
			}
			entry, err := z.Create(kind + "/" + name)
			if err != nil {
				z.Close()
				file.Close()
				return err
			}
			if _, err = entry.Write(data); err != nil {
				z.Close()
				file.Close()
				return err
			}
		}
	}
	if err = z.Close(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	// Windows cannot rename onto an existing file.
	if err = os.Remove(out); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(file.Name(), out)
}
