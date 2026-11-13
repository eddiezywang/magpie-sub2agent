package provider

import "encoding/base64"

func decodeLegacySecret(cipher string, unprotect func([]byte) ([]byte, error)) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(cipher)
	if err != nil {
		return nil, err
	}
	return unprotect(data)
}
