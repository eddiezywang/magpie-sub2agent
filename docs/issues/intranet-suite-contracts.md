# Intranet full-suite test contracts and lifecycle

- Status: Open
- Recorded: 2026-11-16
- Scope: repository-wide validation, beyond the routing-workspace acceptance
- Remote tracking: unavailable; GitHub repository has_issues=false, create returned HTTP 410. No remote issue was created.
The intranet test matrix still runs several upstream-only GUI fixtures against deliberately omitted distribution features. This blocks a truthful whole-package green result; passing workspace-specific checks must not be described as a passing full suite.

Reproduced at a5b15728b on Windows with Go 1.26.8:

```
go test -tags intranet ./internal/gui -run '^(TestBackupLibraryRoundTrip|TestProviderBilling|TestBootSaysBuiltinsOff)$' -count=1 -timeout 60s
```

Observed failures and identified causes:
- TestBackupLibraryRoundTrip calls backup/import with Library payload; the intranet distribution intentionally refuses Library mutations.
- TestProviderBilling saves an upstream provider excluded by the intranet provider allowlist; the request is correctly rejected.
- TestBootSaysBuiltinsOff expects the upstream built-in registration set; intranet deliberately omits Library/Search/Masking/etc and retains its reporting registration.

The earlier full GUI run also contains related retired-provider, masking, public plugin-directory and boot-visibility expectations. Audit each fixture against the documented intranet contract; retain upstream assertions in the upstream profile and add explicit intranet negative/retained behavior coverage. Do not enable omitted product functionality merely to turn these tests green, or blanket-skip retained core behavior.

A separate full-run observation needs lifecycle investigation: accounting observers created while TestAllowIPsSetting is active later attempt writes to its already-removed temporary directory. The exact disposal owner is not established yet; do not label the package timeout or a particular later test a deadlock without reproduction.

Acceptance for resolving this issue:
- Classify the failing cases by actual source contract and run them in the applicable build profile.
- Keep retained API and native UI behavior covered in intranet, with isolated homes and proper runtime disposal.
- Re-run the full intranet GUI package with enough timeout and no leaked child processes/observers; record remaining failures explicitly.
- Preserve upstream build behavior and its applicable tests.

Workspace validation remains separately recorded in openspec/changes/intranet-routing-workspace/verification.md. This issue does not claim that the full suite currently passes. No logs containing credentials or real user configuration are attached.

