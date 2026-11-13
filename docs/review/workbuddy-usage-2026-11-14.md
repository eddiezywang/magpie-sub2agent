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
requests and consume no quota. This is not evidence that a particular real
agent has actually compacted a conversation.

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
and real-agent compaction are not claimed.
