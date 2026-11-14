# WorkBuddy MaaS compaction rescue — 2026-11-14

Implemented in gateway commits 802affc, f892fd0 and 0fdb041; local application
version 0.1.3913-sub2agent.25. The Agent retains ownership of its history and
summary format. Only recognized compaction requests rejected by MaaS with 413
can use selected, account-allowed hy4free and then non-MaaS Deepseek-V4-Flash
on that same account. Ordinary requests and initial 401/403/429/500 errors do
not activate this policy. Candidates do not cycle, and summaries do not move
main-conversation affinity. Actual-model usage is retained per attempt.

## End-to-end result

An isolated Claude Code 2.1.119 configuration used 13,200 synthetic records and
a 32K output budget through the running production gateway on port 8989.
The 1,223,583-byte incoming summary request produced these actual attempts:

1. GLM-5.3-Flash MaaS: local byte guard returned 413.
2. hy4free: upstream 200 and a usable summary.
3. The ordinary turn and resumed turn: original GLM MaaS, both 200.

Claude reported automatic compaction from 300,847 to 2,011 estimated tokens,
in 160.757 seconds. The original synthetic marker ORCHID-7429 survived the
resumed conversation. Upstream hy4free usage reported 107 uncached input,
290,624 cache-read and 8,025 output tokens, including 6,216 thinking tokens;
reported credits were zero for this request. These actual hy4free counts do
not establish the original MaaS tokenizer or promise future free pricing.

## Important failed controls

Hy4free accepted a 1,215,341-byte marker probe and retained all three markers.
However native summary runs with 1.5K, 4K and 8K output budgets could spend
their entire output on reasoning with no final summary. Adding a brief-summary
instruction did not solve a 4K control; that experimental instruction was not
shipped. A failed/empty summary is not returned as successful compaction.
The gateway preserves the client's output cap; it does not secretly raise it.
The successful 32K-budget run is not a guarantee for a smaller output budget,
other prompts or every Agent. This model can be slow at compaction.

Non-MaaS Deepseek-V4-Flash accepted a 1,215,351-byte request, retained all three
markers and finished in ~7 seconds. A later actual rescue attempt returned a
personal-quota-exhausted 429 on the current account, so native success through
this second candidate could not be verified. The deterministic gateway test
does verify handoff from reasoning-only hy4free to a successful Flash reply.

Focused compaction, byte-cap, image-retention, usage-attribution and affinity
regressions passed. Reverting the new gateway dispatch made the integration
test fail with the original 413. All nine retained pages passed Playwright
without JavaScript errors or missing visible icons. Other Agents were not
tested end-to-end; ordinary 413 requests still require the Agent to initiate
compaction. This is compaction-request failover, not gateway-generated history.

Single-file archive: 32,045,241 bytes, without Bun or user data. SHA-256:
`3251d5ba3d8cd112aa408307d4de9e47f1521095381d66b3de5e157dbed0f590`.
