# Internal product branding audit

The product name is `sub2agent`. Repository name remains `magpie-sub2agent`.
The internal executable, Windows metadata, app identity, data/cache directory,
packed HTML title/wordmark and translated user-facing brand text use sub2agent.
Installed configuration and cache move from the old internal directory only
when no new directory exists; a failed move keeps the old configuration active.
Portable `data` directories keep their location.

The whole source tree was scanned, excluding generated runtime/dependencies.
The scan found 7,007 text files / 76,388 lines containing the old name, mostly
module imports, tests and upstream compatibility contracts. This is not a claim
that no old identifier remains. The Go module import path, plugin `magpie` API,
legacy Agent provider/config names, market URLs, historical records, upstream
build profile and mandatory copyright/license attribution remain intentionally.
Changing these as plain text would break plugin compatibility, old thread and
configuration references, or attribution. They are not the internal product name.
An old SVG path remains an alias; the internal wordmark uses icons/sub2agent.svg.

No executable was rebuilt as part of the source branding change. Runtime and
release verification must use the new lower-case name on the next package.
