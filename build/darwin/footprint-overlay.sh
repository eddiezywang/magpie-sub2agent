#!/bin/sh
# footprint-overlay.sh <dir>: writes <dir>/overlay.json and a copy of
# Go's runtime/mem_darwin.go that gives the heap pages Go lets go back in
# a way macOS takes out of the process's footprint, and prints the
# -overlay flag that builds magpie with it.
#
# Go lets a free heap page go with madvise(MADV_FREE_REUSABLE). On macOS
# 27 the page stays in phys_footprint, the number Activity Monitor shows
# as Memory, until the system is short of memory: an idle magpie showed
# ~98 MB of which ~69 MB was heap Go had already given back. A fresh
# anonymous mapping over the same range (mmap MAP_FIXED, as sysFaultOS
# does with PROT_NONE) drops the pages at once and keeps the range
# mapped read-write, so Go's next use of it finds zeroed memory, which
# needZeroAfterSysUnusedOS already has Go expect.
set -eu
dir=$1
src="$(go env GOROOT)/src/runtime/mem_darwin.go"
mkdir -p "$dir"
awk '
/^func sysUnusedOS\(v unsafe.Pointer, n uintptr\) \{$/ { print; inside = 1; next }
inside && /^}$/ {
	print "\t// magpie (build/darwin/footprint-overlay.sh): a fresh mapping, so the"
	print "\t// pages leave the footprint now, not when macOS is short of memory"
	print "\tif p, err := mmap(v, n, _PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_FIXED|_MAP_PRIVATE, -1, 0); p == v && err == 0 {"
	print "\t\treturn"
	print "\t}"
	print "\tmadvise(v, n, _MADV_FREE_REUSABLE)"
	print; inside = 0; done = 1; next
}
inside { next }
{ print }
END { if (!done) exit 3 }
' "$src" > "$dir/mem_darwin.go" || {
	echo "footprint-overlay.sh: sysUnusedOS not found in $src" >&2
	exit 1
}
outdir=$(cd "$dir" && pwd)
# Git Bash's pwd uses /tmp/... while the Windows Go executable needs a
# drive-qualified path. Forward slashes also keep the paths valid in JSON.
case "$(uname -s)" in
	MINGW*|MSYS*|CYGWIN*) src=$(cygpath -m "$src"); outdir=$(cygpath -m "$outdir") ;;
esac
printf '{"Replace":{"%s":"%s"}}\n' "$src" "$outdir/mem_darwin.go" > "$dir/overlay.json"
echo "-overlay=$outdir/overlay.json"
