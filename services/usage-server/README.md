# Usage server source baseline

Source imported from the existing authorized internal deployment on 2026-11-13.
Only application code and its package manifest were copied. No environment,
credentials, production data, fonts or node_modules are included.
The existing deployment retains its assets and persistent data independently.

Run with Node 18+ (`node src/server.js`). Before deploying changes, back up the
existing code, retain its service environment and data directory, run isolated
integration tests and check the existing health/report paths after restart.
