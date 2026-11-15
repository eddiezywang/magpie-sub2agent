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

## Follow-up: normal threshold and model-limit boundary

The user requested verification near the MaaS model's actual limit, rather
than the lowered trigger above. Additional live tests found that current
behavior does not safely expose the advertised 1,000,000-token model window.

With the user's current `CLAUDE_CODE_AUTO_COMPACT_WINDOW=272000` and no
percentage override, the installed Claude Code automatically compacted a
synthetic prompt: `pre_tokens=204497`, `post_tokens=914`, duration 28307 ms.
The summary request was 833982 bytes and returned HTTP 200 with input/output
usage 239564/1199. The following normal reply succeeded. This verifies real
automatic summarization near the client's current effective window, not the
model's 1M-token limit. Counts from Claude Code and the text-only gateway
estimator differ; neither is an authoritative vendor tokenizer result.

Two blockers were confirmed:

1. The installed Claude Code 2.1.119 binary reads
   `CLAUDE_CODE_MAX_CONTEXT_TOKENS` only in its `DISABLE_COMPACT` branch. Its
   normal custom-model path falls back to 200K unless a recognized long-context
   model marker applies. The auto-compact window is clamped to that model
   window, so setting it to 272K or 1M does not establish a 1M window. Disabling
   compaction is not a solution.
2. The bundled private WorkBuddy resolver rejects MaaS requests over
   `MAAS_MAX_BYTES=900*1024` (921600 bytes), independently of model token caps.
   A direct live request with 880000 synthetic text characters succeeded,
   reporting estimated usage 253019/2. A request with 950000 characters was
   refused with HTTP 413 explicitly naming the 921600-byte local safety limit.
   These byte thresholds do not translate to a fixed token capacity across
   languages, tools or attachments.

A separate Claude Code run requesting a 1M compact window sent a 1037582-byte
request and received 413; its subsequent summary request also returned 413.
Claude Code nevertheless emitted `compact_boundary` (`pre_tokens=254847`,
`post_tokens=206`), but the retained text described a failed summary. The
continuation could not recover `ORCHID-7429`. Therefore a boundary event and
exit code 0 alone must never be treated as a successful compaction test.
This run also exposed an unhelpful error claiming a 32MB maximum for a roughly
1MB request. The exact origin of that generic error is not established here;
the explicit 900KiB resolver rejection was verified separately.

No production limits, thresholds, binaries or user settings were changed.
Removing a local safety cap requires checking the upstream's real byte limit,
and exposing a 1M model window requires a compatible Claude Code model/window
configuration. Existing usage estimation alone solves neither boundary.

## Follow-up: provenance of 1M and 900KiB

A fresh authenticated enterprise catalog read on 2026-11-14 matched the exact
GLM-5.3-Flash MaaS upstream ID. Its row had only `id`, `name`, `vendor`,
`supportsToolCall`, `supportsImages`, `disabledMultiModel` and `tags`; it provided
no input/output/context limits. The saved account also had no override for
this model. The displayed 1M therefore comes from the bundled vendor snapshot
`codebuddy-models.json` (snapshot timestamp 2026-11-12T02:33:33.439Z), matched
to the base `glm-5.3-flash` record. That record contains maxAllowedSize=1000000,
maxInputTokens=1000000 and maxOutputTokens=131072. It is nominal model metadata,
not a measured enterprise transport capacity. Earlier references to this
particular MaaS limit as live enterprise metadata should be read with this
correction; the adapter does preserve deployment limits when supplied.

The 900KiB value is an inherited private resolver constant. Its originating
checkpoint does not establish an upstream-enforced byte limit. Direct 1035000-
and 1050000-character requests were also rejected with the explicit local
921600-byte message. Thus this work has not established an upstream 1MiB or
32MiB cap. The earlier synthetic summary's generic 32MB wording is not evidence
of a real upstream limit.

900KiB means 921600 UTF-8 bytes in the final serialized request, including
messages, tool definitions/results, JSON overhead and binary encoding. 1M
means nominal tokens; the figures cannot be subtracted or substituted. The
effective operating capacity is bounded separately by the model's input/output
token budget, the transport's byte budget and the client's recognized window.
The successful 880000-character probe reported 253019 estimated input tokens;
that illustrates why 900KiB cannot be advertised as a 900K-token window, not a
universal conversion ratio.

Until a controlled isolated upstream probe establishes the true transport
limit, retain the existing byte guard as a conservative local policy rather
than relabelling it as the model's capacity. A prospective operational policy
needs an earlier byte soft threshold with room for the next turn and the
summary request, and a token compaction budget that the installed client
actually honors. The current 700KiB warning is not an automatic compaction
trigger. It does not by itself prevent the failed-summary case above.
