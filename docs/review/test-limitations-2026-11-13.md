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

The full standard-profile provider run was also attempted. It failed, including
Windows symbolic-HEAD fixtures in `TestGitOnDiskIsWhatGitFinds` and
`TestGitOnDiskAgreesWithGit`. Full repository validation is not claimed.
Catalog suites pass in both profiles; the accounting suite and focused retained
provider/plugin/template checks pass. Windows race testing is unavailable
without a C compiler; WSL cannot start because virtualization is unavailable.
No compiler or virtualization configuration was changed on the user's computer.

The .18 executable passed nine real-package pages in headless Chrome. The
20 settings layout/interaction cases were run on the preceding .17 UI; .18
contains no frontend-asset changes. Local boot/provider metadata confirms .18
and provider 1.0.3. No real-tenant inference or quota-reset vendor response was
captured in this release; those remain separate from sandbox contract tests.
