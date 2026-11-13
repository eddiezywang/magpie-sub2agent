# WorkBuddy MaaS usage verification

This step adds regression coverage and documents existing behavior; it changes
no production code or installed binary. Local release .19 already includes the
private kernel's missing-usage fallback. No new package or restart is needed.

The provider-loader suite passes all 14 cases, including a new MaaS fixture
that verifies positive input/output estimates before DONE and preservation of
real upstream counters. The private `workbuddy-openai-usage.test.js` suite
passes all 11 cases, covering streaming/non-streaming, partial counts and zero,
late cumulative usage, cache counters, reasoning/tool output, UTF-8 fragments,
cancellation, errors and unfinished streams. Fixtures make no tenant inference
requests and consume no quota. These fixture tests alone are not evidence
that a particular real agent has compacted a conversation; see the live test below.

The focused intranet gateway run passes all three selected tests:
`TestChatTranslationKeepsUsageAfterFinish`, `TestPromptUsageOnMessageStart`,
and `TestResponsesUsageCacheWrite`. It confirms final usage survives Responses
and Anthropic translation, including Chat usage arriving after finish_reason.

An exploratory combined run also included the old private application's
`workbuddy-context.test.js`. Three old CLI configuration assertions failed:
`Claude config compact plan preserves choices` for absent, explicit and disabled
settings. They expect `CLAUDE_CODE_AUTO_COMPACT_WINDOW` writes/preview changes
that the private CLI configuration path no longer supplies. The usage-specific
suite passes independently; this step neither changes that old CLI path nor
claims its compaction threshold configuration works. Full repository validation
is not claimed.

## Real Claude Code integration

On 2026-11-14, the installed Claude Code 2.1.119 was run against the existing
local .19 gateway and the signed-in WorkBuddy enterprise GLM-5.3-Flash MaaS
model. This test consumed real inference quota using synthetic text only.
An isolated config directory and workspace were used; no user settings,
plugins, tools or existing conversations were changed. A loopback forwarding
proxy recorded only request sizes, model identity and response usage counters.
No usage, model replies or compaction outcomes were fabricated.

For rapid automatic triggering, only the test child process set
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` and
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`. The initial synthetic prompt triggered
Claude Code's preflight compaction with `compact_boundary`:

| Trigger | Pre tokens | Post tokens | Duration |
| --- | ---: | ---: | ---: |
| auto | 4047 | 402 | 8553 ms |
| manual (`/compact` on the resumed session) | 685 | 460 | 9361 ms |

Both compactions succeeded with exit code 0. Continuing the session after each
returned the original synthetic marker `ORCHID-7429`. All five message requests
returned HTTP 200. Their final Anthropic `message_delta` usage was, respectively,
6511/291, 644/5, 681/4, 2338/554 and 882/4 input/output tokens. Normal-turn
Claude Code result events also contained positive usage matching the wire
counters. A manual command's result reported zero usage even though its
summary request returned 2338/554; use the actual summary request rather than
that command result when checking gateway compatibility.

The automatic event in this run was triggered before the first model response
from Claude Code's local prompt estimate. It demonstrates actual automatic
summarization and retained context through the MaaS gateway, alongside correct
response usage ingestion. It does not isolate usage as the sole trigger or
validate the user's normal threshold with a full-sized conversation. No
production threshold, default model or application binary was changed.
