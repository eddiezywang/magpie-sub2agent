# MaaS upstream byte boundary and Claude Code compaction

All probes used synthetic data, the signed-in enterprise account and the normal
WorkBuddy request headers/model mapping. Direct probes bypassed the local
900 KiB rejection; the production process and user Agent settings were untouched.
Evidence: `maas-upstream-boundary-2026-11-14.json` (credentials omitted).

## Observed upstream behavior

GLM-5.3-Flash MaaS accepted 1,045,246 serialized request bytes and rejected
1,049,296 bytes. That brackets 1 MiB (1,048,576), consistent with the nested
Nginx 1.18.0 body-size error; the upstream configuration itself is not visible.
The outer status is **500**, business code 10000, and the nested error names
**413 Request Entity Too Large**. This is not a token-capacity rejection.

All ten current MaaS deployments rejected approximately 1,062,000 bytes with
the same nested Nginx 413: GLM 5.3 Flash / 5.3 / 5.2, DeepSeek V4 Flash / V4 Pro /
V4.1 Flash, MiniMax M3 / M3.1 Flash, Hy4 and Auto. Successful smaller controls
were obtained for GLM Flash, DeepSeek Flash and MiniMax M3; passing every model
at every smaller size has not been established.

GLM accepted approximately one million bytes of both ASCII and Chinese text.
A separate ~1 MB input with different markers at start, middle and end returned
all three correctly. None of these direct responses reported usage, so these
are byte-capacity/retention observations, not verified tokenizer counts or
evidence of a usable 1M-token context.

## Native Agent compaction

An isolated Claude Code run used a test-only resolver with the old byte guard
raised, without changing the installed app or user configuration. The real
summary request was 1,037,025 bytes at the WorkBuddy wire and succeeded.
Claude reported automatic compaction from 254,847 tokens to 861 in 29.9 seconds;
the resumed conversation returned the original synthetic marker. These are
Agent estimates; plugin-generated usage was estimated because upstream omitted
usage. A prior 401 in the initial harness was corrected by the same
case-insensitive authorization-header deduplication the production plugin uses.

The old local 900 KiB guard therefore excluded a summary that upstream accepts.
The 1.0.5 blanket 100K input and 32K output caps were not supported by these
measurements and have been removed in 1.0.6. Generic model-token metadata must
remain separate from byte budgets. A conservative working compaction window
and byte headroom are still required: a summary resends history and cannot
rescue an arbitrary body already larger than the upstream byte boundary.

## Remaining integration constraints

Keep actual/estimated usage separate from context-pressure calculations: never
inflate billed token usage to force an Agent to compact. Generic Agents do not
all consume byte-budget hints or refresh model metadata during a session.
Model capacity cannot be promised as end-to-end capacity without testing the
transport and the Agent. Image bytes and large tool schemas can overflow at far
fewer tokens than a text-only test. Do not silently drop text/tool history.

## Deployed application verification

Version `0.1.3913-sub2agent.22` was rebuilt, started with the existing local
data directory and tested through the production gateway on port 8989.
Claude Code 2.1.119 sent a 1,037,582-byte Anthropic summary request, which the
gateway accepted with HTTP 200. Automatic compaction reported 254,847 to 641
estimated tokens in 25.2 seconds; resuming returned `ORCHID-7429`. This run used
an isolated Claude configuration with a deliberately enlarged compaction
window, not the generated 272K default, so it verifies near-boundary transport
and successful native compaction rather than every default configuration.

All nine retained pages passed Playwright checks without JavaScript errors or
missing visible icons. The model settings retain the supplier's declared
capacity and explain the separate approximate 1 MiB request-size constraint.
Cheap-first ordering still starts with hy4free, then MaaS, then other models.

The released byte guard is 1020 KiB (1,044,480 bytes), with a warning at 900 KiB.
It measures the normalized final request and converts explicit nested size
errors into Agent-readable 413 errors. It does not synthesize a summary, change
the meaning of billed usage or guarantee that every Agent retries by compacting.
The 272K generated Claude window is a working default, not a measured universal
safe context: content encoding, tools and images can reach the byte cap sooner.
Adaptive byte-pressure compaction would require an Agent-specific integration
and separate validation; it is not implemented by these changes.

Archive: 32,043,069 bytes; SHA-256
`f4f090cc01ee0cb270a4c23e323781d01a97419da4f534c2ddde499cd988e563`.
