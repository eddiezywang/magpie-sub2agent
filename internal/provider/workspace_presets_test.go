//go:build intranet

package provider

import (
	"slices"
	"testing"
)

func TestWorkspacePresetsSingleSourceAndCrossVendor(t *testing.T) {
	for _, tc := range []struct {
		name, kind   string
		models, want []string
	}{
		{"single-workbuddy", "flash-first", []string{"glm-5.3-flash-maas", "glm-5.3-maas"}, []string{"p0/glm-5.3-flash-maas"}},
		{"single-byte-plan", "flash-first", []string{"doubao-seed-2.1-lite"}, []string{"p0/doubao-seed-2.1-lite"}},
		{"byte-flagship", "flagship-first", []string{"doubao-seed-2.1-pro"}, []string{"p0/doubao-seed-2.1-pro"}},
		{"mixed-tier", "flash-first", []string{"glm-5.3-flash-maas", "doubao-seed-2.1-lite"}, []string{"p0/glm-5.3-flash-maas", "p1/doubao-seed-2.1-lite"}},
		{"unknown-flash-name", "flash-first", []string{"unknown-flash-pro"}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var ms []rated
			for i, id := range tc.models {
				pid := "p0"
				if tc.name == "mixed-tier" && i == 1 {
					pid = "p1"
				}
				ms = append(ms, tm(pid, id, 1, false, "2026-01-01"))
			}
			tp := templateOf(tc.kind, ms, nil)
			if !slices.Equal(tp.Group.Members, tc.want) || tp.Group.Routing != Rotate || tp.Group.Affinity != AffinitySession {
				t.Fatalf("wrong tier/source selection: %+v", tp)
			}
			if (tp.Need != "") != (len(tc.want) == 0) {
				t.Fatalf("wrong prerequisite: %+v", tp)
			}
		})
	}
}

func TestWorkspacePresetPrefersSharedModelAndIsIdempotent(t *testing.T) {
	ms := []rated{tm("p0", "glm-5.3-flash-zp", 1, true, ""), tm("p0", "deepseek-v4.1-flash", 1, true, ""), tm("p1", "deepseek-v4.1-flash-maas", 1, true, "")}
	if g := templateOf("flash-first", ms, nil).Group; !slices.Equal(g.Members, []string{ms[1].e.ID, ms[2].e.ID}) {
		t.Fatalf("shared model not preferred: %+v", g)
	}
	azureHome(t)
	if err := Save(Provider{ID: "p0", Key: "fixture", Chat: "http://127.0.0.1:1/v1", Models: []string{"glm-5.3-flash-zp"}}); err != nil {
		t.Fatal(err)
	}
	a, err := EnsureTemplate("flash-first")
	if err != nil {
		t.Fatal(err)
	}
	b, err := EnsureTemplate("flash-first")
	if err != nil || a.ID != b.ID {
		t.Fatalf("duplicate default: %v %+v %+v", err, a, b)
	}
}
