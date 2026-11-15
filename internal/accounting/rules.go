package accounting

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func readRules(path string) (*AggregationRules, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 1<<20+1))
	var rules AggregationRules
	if err != nil || len(data) > 1<<20 || json.Unmarshal(data, &rules) != nil {
		return nil, fmt.Errorf("invalid cached aggregation rules")
	}
	if err := rules.Validate(); err != nil {
		return nil, err
	}
	return &rules, nil
}

func (r *Runtime) refreshRules(ctx context.Context) error {
	u, err := endpoint(r.options.UsageURL)
	if err != nil {
		return err
	}
	u.Path = "/usage/aggregation-rules"
	var rules AggregationRules
	if err = r.sender.request(ctx, "GET", u.String(), nil, &rules); err != nil {
		return err
	}
	if err = rules.Validate(); err != nil {
		return err
	}
	data, err := json.Marshal(rules)
	if err != nil {
		return err
	}
	r.mu.Lock()
	previous := r.rules
	r.mu.Unlock()
	if previous != nil && previous.Revision == rules.Revision {
		old, _ := json.Marshal(previous)
		if !bytes.Equal(old, data) {
			return fmt.Errorf("aggregation rules changed without a new revision")
		}
		return nil
	}
	path := filepath.Join(r.dir, "accounting-rules.json")
	if _, err := readRules(path); err != nil && !os.IsNotExist(err) {
		if err := os.Rename(path, path+".bad-"+NewID()); err != nil {
			return fmt.Errorf("could not preserve invalid aggregation rules")
		}
	}
	f, err := os.CreateTemp(r.dir, ".accounting-rules-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	r.mu.Lock()
	r.rules = &rules
	r.mu.Unlock()
	return nil
}
