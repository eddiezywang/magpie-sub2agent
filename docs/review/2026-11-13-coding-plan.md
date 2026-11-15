# Intranet Coding Plan — .10 verification

Implementation: `980ecc2`, committed and pushed before the clean build.

The native provider picker now includes 行内 Coding Plan. The editor accepts
an Anthropic gateway base and a masked AIEP API key, with the full enterprise
WeChat security notice and AIEP/documentation links. No personal key alias or
actual key is shipped. Authentication is Bearer alone for both inference and
model discovery; the header choice is hidden for this preset. The shared URL
normalizer avoids a duplicated messages suffix. Model discovery may be
unsupported by the real service; existing manual model entry remains available.
No model IDs were invented for this plan.

## Verification

- New defaults/persistence test fails on the previous implementation with
  `no preset "aiep-coding-plan"`; restored implementation passes.
- Provider tests record local HTTP model-discovery and inference requests,
  checking `/public/v1/messages`, Authorization Bearer and no x-api-key.
- Gateway test covers Anthropic and OpenAI client requests forwarded to the
  same Anthropic base with the same authentication.
- Related authentication/normalization tests, intranet GUI tests, script budget,
  translations, eight Node i18n checks and provider vet pass.
- Six isolated Chromium/WebKit wide/narrow, light/dark previews verify the
  notice, links, empty masked key, hidden header selector and edited-base save
  payload. No real service or key is used.
- Running .10: all nine retained pages inspected via Playwright; no page errors.
  Actual provider form has the correct default base, an empty key and no
  selectable authentication modes. Public screenshots contain no credentials.

## Build and runtime

```text
Version: 0.1.3913-sub2agent.10
Source: 980ecc2776fece65ce5a90e84e6c2442c2e69c6a
workingTreeChanges: false
Archive: magpie-builds/Sub2Agent-Magpie-windows-x64-20261113-122822.zip
ZIP bytes: 72,946,758
ZIP SHA-256: b3ee9bc1c221bf305eca1a6f9a699bb7ac2ac0873bc3adaf5e6a1e607f908636
Executable bytes: 79,314,944
```

After checking zero busy/waiting gateway requests, the .9 process was
quit through its own POST shutdown API. The replacement executable runs
at the existing portable location with its data retained. Runtime PID 34664
owns ports 8989 and 8990. Original Magpie PID 42876 retains port 3425.
A rollback copy of the .9 executable and release metadata is kept locally.

Live AIEP inference is not verified: the user supplied a placeholder, not a
real key. The existing pending marketplace/billing-server deployment is not
changed or claimed complete by this provider addition.
