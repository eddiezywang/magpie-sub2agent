package provider

import (
	"bytes"
	"encoding/base64"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestLegacySub2AgentDPAPICompatibility(t *testing.T) {
	plain := []byte("fixture-only-sub2agent-credential")
	input := windows.DataBlob{Size: uint32(len(plain)), Data: &plain[0]}
	var encrypted windows.DataBlob
	if err := windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &encrypted); err != nil {
		t.Fatal(err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(encrypted.Data)))
	cipher := base64.StdEncoding.EncodeToString(unsafe.Slice(encrypted.Data, encrypted.Size))
	got, err := decodeLegacySecret(cipher, legacyUnprotect)
	if err != nil || !bytes.Equal(got, plain) {
		t.Fatal("could not read the old store's CurrentUser/null-entropy format", err)
	}
	if _, err = decodeLegacySecret("invalid", legacyUnprotect); err == nil {
		t.Fatal("invalid ciphertext accepted")
	}
}
