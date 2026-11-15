# Sub2Agent integration progress

Active branch: `develop/intranet`.

User-approved scope:

1. Commit each independently verified step proactively.
2. Fix the Agents page loading failure and verify every retained page.
3. Replace the upstream provider catalog with Sub2Agent providers, preserving
   Magpie's add/edit/account interactions and each provider's authentication.
4. Publish milestone screenshots to the designated review site, without secrets.

The offline prototype is committed as `0659fc3`. Provider migration is the next
stage; no original application's credential store is to be deleted or rewritten.

Branding and parallel app milestone: Sub2Agent title, S icons and native
Windows resources; gateway 8989 / administration 8990; installed app data,
startup entry, URL handler and instance ID isolated from upstream Magpie.
Both real apps were observed listening independently (8989 vs 3425).
Playwright visited Agents, Providers, Routing, Groups, Gateway, Usage, Masking,
Plugins and Settings without uncaught page errors. Plugin discovery still waits
for the internal registry, and the provider catalog is not yet migrated.
Packed-shell Chromium regression and focused Go tests passed. Appdir tests
passed except TestFoldersJoinedOnce's Windows allocation assertion (3 rather
than 0), reproduced unchanged in the upstream checkout with the same toolchain.
User clarification: retain Sessions; use Playwright for future screenshots.
