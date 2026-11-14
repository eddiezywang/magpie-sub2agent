package provider

import "strings"

// WorkBuddyCompactWindow is an operational recommendation, not a vendor token
// limit. Leave growth room before the measured MaaS byte cap; 413 rescue is
// still required because tokens cannot bound serialized bytes.
func WorkBuddyCompactWindow(id string) int {
	return workBuddyCompactWindow(id, GroupFinder())
}

func workBuddyCompactWindow(id string, find func(string) (Group, []Member, bool)) int {
	id = catalogID(id)
	if strings.HasPrefix(id, GroupPrefix) {
		_, members, ok := find(id)
		if !ok {
			return 0
		}
		for _, m := range members {
			if workBuddyMaasModel(m.Provider.ID, m.Provider.OwnModelID(m.Model)) {
				return 224000
			}
		}
		return 0
	}
	pid, model, ok := strings.Cut(id, "/")
	if ok && workBuddyMaasModel(pid, model) {
		return 224000
	}
	return 0
}

func workBuddyMaasModel(pid, model string) bool {
	return pid == "sub2agent-workbuddy" && !strings.HasPrefix(strings.ToLower(model), "auto-") && strings.Contains(strings.ToLower(model), "-maas")
}
