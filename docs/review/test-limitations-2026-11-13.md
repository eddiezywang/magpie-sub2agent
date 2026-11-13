# Validation issues found during internal release verification

The full `go test -tags intranet ./internal/provider` run currently fails tests
that assume retired public providers are discoverable. Examples include
`TestSetWindowAmount` (no provider codex), `TestAccountOrderSideLoginsAllRoutingModes`
(no provider antigravity), and `TestAntigravityQuotaReadingListsNewModels` (nil
provider dereference). The internal distribution intentionally filters these
providers. Those tests need an upstream discovery fixture or a standard-profile
run, while intranet tests verify the retained provider scope. Do not report the
full intranet suite as passing. No production provider scope was broadened to
satisfy these tests.

Current routing regression: disabling internal template dispatch makes
`TestInternalPlanAndPriceTemplatesFollowServerScores` select the full GLM plan
model before Flash. Restoring the change passes, along with template refresh,
manual-edit opt-out, score refresh/outage/expiry and accounting tests.
