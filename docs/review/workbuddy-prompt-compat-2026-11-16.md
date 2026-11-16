# WorkBuddy prompt compatibility verification

## Change

WorkBuddy enterprise and WorkBuddy CIB 1.0.9 share scoped Claude/Codex template
mapping and channel-refusal classification from private Sub2Agent commit
`def6059`. The enterprise resolver includes the missing Codex opening and
requires a leading system message. Explicit channel refusals, including HTTP
413, permit one comma rewrite of a harness opening while keeping system roles.
Persistent refusals carry `prompt_refused` and their upstream status; genuine
size errors retain 413. Ordinary user quotes, tool data and successful streams
are preserved. Existing provider-specific DSH handling stays separate.

The CIB build adapter replaces the pinned community implementation's shared
rules and channel retry block. It retains authentication, signing, compression,
refresh, usage and non-channel error handling. Guarded source seams fail the
build when the reviewed community source changes. Other plugin versions remain
unchanged. No global gateway policy or client config changes are included.

## Verified

- Private checkout: 44 tests passed across `workbuddy-prompt-compat`,
  `workbuddy-subscription`, `workbuddy-context` and `workbuddy-protocol-fidelity`.
  Existing kernel tests cover Messages, Chat and Responses input conversion.
- Distribution: 36 tests passed across the guarded adapter, built factory,
  built CIB and login-network tests. Tests exercise the generated plugin code,
  signed/compressed CIB wire, 400/413/500 fallback, bounded persistent failures,
  default models, credit reporting and credential renewal.
- Regression checks: restoring the old enterprise resolver or old CIB build
  adapter makes the corresponding new 413 test fail with `413 !== 200`.
  The patched implementations were restored and rebuilt afterwards.
- `go test -tags nogui ./internal/gateway -run
  'TestPromptRefusalRestsNobody|TestWorkBuddyRestricted' -count=1` passed.
- `go run ./build/providerpack build/sub2agent-runtime
  internal/plugin/baseline.zip` succeeded. Both WorkBuddy entrypoints in the
  embedded archive exactly match the generated external provider files.
- `git diff --check` passed.

## Broader checks and limits

The legacy private Node suite with a 20-second test timeout reported 569 tests:
538 passed, 26 failed and 5 cancelled. Failures include client-config assertions,
Windows secret-store counts, log rotation and Responses-handler timeouts. These
broader failures have not been resolved or all attributed; this report does
not claim a clean full-suite run.

The full distribution Go suite initially lacked `sh` on PATH. With Git's shell
and Bun available, its Darwin footprint package passed, but `internal/agent`
timed out at 180 seconds in `TestClaudeDefaultLeavesNoDrift`. The complete Go
suite has not passed. No Go source or GUI source changed in this patch.

No real-account WorkBuddy/CIB inference or Codex/Claude session was executed.
The reporter's exact production error envelope was not captured. Full-platform
vet/build checks, GUI screenshots and macOS packaging were not run. Generated
provider packages are for review; this patch is not merged or published as an
application release. Official deployment needs these remaining checks.

Build with the fixed private checkout, for example:

```powershell
$env:SUB2AGENT_TEST_BUNDLE = '1'
node build/sub2agent-providers.mjs ../sub2agent-workbuddy-prompt
node --test build/workbuddy-community-source.test.mjs plugins/sub2agent/factory.test.mjs plugins/sub2agent/workbuddy-cib.test.mjs plugins/sub2agent/login-network.test.mjs
```

The private checkout needs its normal pinned dependencies installed or available
through `NODE_PATH`. Automated macOS builds must set `SUB2AGENT_SOURCE_REF` to
the fixed private commit or a descendant before building this distribution.
