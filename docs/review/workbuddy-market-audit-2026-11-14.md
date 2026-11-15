# WorkBuddy marketplace plugin audit

Inspected on 2026-11-14: marketplace package
`@magpie-community/opencode-workbuddy-auth` 0.2.34. The npm archive was downloaded
and its SHA-512 checked against registry integrity. Repository WorkBuddy path
HEAD observed during the audit: `d6dcb6eaa14b2d4e35413663f8bb6f588418cc81`.
This is a community package listed by the upstream marketplace, not a vendor
certification claim. No application settings, package or credentials changed.

Sources:

- [Marketplace listing](https://github.com/magpie-community/plugins/blob/main/registry.json)
- [Package](https://github.com/magpie-community/plugins/blob/d6dcb6eaa14b2d4e35413663f8bb6f588418cc81/packages/workbuddy/package.json)
- [Implementation](https://github.com/magpie-community/plugins/blob/d6dcb6eaa14b2d4e35413663f8bb6f588418cc81/packages/workbuddy/index.mjs)
- [Enterprise model regression](https://github.com/magpie-community/plugins/blob/d6dcb6eaa14b2d4e35413663f8bb6f588418cc81/packages/workbuddy/custom.test.mjs)
- [Context-limit investigation, all comments](https://github.com/magpie-community/plugins/issues/561)

## Findings

The published plugin has no dedicated MaaS-name branch or 900KiB cap. It
supports enterprise `custom:` models from `/v3/config`, even when omitted from
the CLI agent list, preserving their full upstream IDs. Model limits use
`maxInputTokens` and `maxOutputTokens` when supplied. This differs from our
separate enterprise-directory discovery; it does not prove every private
enterprise model/metadata entry will appear in its list.

`gzipped()` uses `gzipSync` for Chat Completions, and the request sender sets
`Content-Encoding: gzip` and removes the original Content-Length. This follows
WorkBuddy's client transport. It is not applied to native Claude Messages or
image endpoints. Gzip saves transport bytes but does not reduce decoded prompt
tokens or prove a decoded-body byte limit can be avoided.

The published loader was exercised with a fake upstream and enterprise MaaS
ID. A 1066244-byte JSON request passed through and reached the fake upstream
as 3334 gzip bytes, preserving its model ID and include_usage request. Its
synthetic catalog retained context=1000000 and output=64000. The input was
highly repetitive: that compression ratio is not representative of all code
or attachments. No actual enterprise inference was made in this audit.

The same loader probe returned an upstream SSE response with no usage. The
plugin did not synthesize usage. Its `auth.usage()` hook reads account credits
and allowance windows, which is a different responsibility from request token
usage. Thus adopting the public transport cannot replace our private missing-
usage fallback or establish successful client compaction.

The package does not implement an agent-independent compaction engine. It
passes genuine context-overflow errors through for the gateway/client to
interpret. Issue #561 documents why an earlier global 100K context cap was
removed: other users reported successful roughly 992K-token requests and a
vendor overflow naming 1048576. Those are upstream reports for particular
models/accounts, not a validation of this user's enterprise MaaS deployment.

## Consequence for this distribution

The inherited 900KiB rejection is not a restriction of the marketplace plugin
and has not been demonstrated to be a WorkBuddy service requirement. Retaining
it permanently while advertising a 1M-token usable window is misleading.
The earlier proposed 650–700KiB soft threshold is only a temporary workaround
for that local guard; it is not established as the right WorkBuddy capacity.

The next implementation should first validate gzip on this enterprise's Chat
route, then replace the arbitrary local 900KiB guard with explicit memory/body
safety limits and any evidenced upstream constraints. Retain usage estimation,
accurate model-limit provenance and separate client-window adaptation. Keep
token budgets and byte budgets distinct. Repeat a realistic long-conversation
test with successful summary generation and retained markers; a compact event
alone is not sufficient. No such runtime change is included in this audit.
