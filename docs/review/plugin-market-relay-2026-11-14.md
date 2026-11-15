# Intranet marketplace relay deployment

Completed the user-specified transfer route on 2026-11-14:
build host -> public relay server -> connected laptop (`labtop`) -> corporate
idisk personal space -> `kf` -> test-jump -> target host with sudo.

Only an AES-256-GCM encrypted temporary archive was served publicly. Its key
was delivered separately over the existing remote-command channel. The plaintext
archive remains in a private server staging directory and internal deployment
locations; no credentials or client data were included. Laptop downloaded and
decrypted it before uploading it with `wecli idisk`. KF used pinned wecli
1.14.0 through internal npm without replacing its older global installation.

Archive: `sub2agent-market-20261114.tgz`, 183471 bytes.
SHA-256: `2a0f35f8a3fc2f1ad7ed0d702e81eb11913c8eeda63f893f2f5b1890673782f4`.
Laptop, cloud download on KF and final server checksum all matched.

The existing target service was already healthy. The deployment backed up its
bin/www tree and systemd unit, installed service files from the transferred
release, restarted the dedicated service and republished all three plugin source
directories through the target Python 3.11 publisher. Same-version hashes stayed
identical; no immutable version was overwritten with different contents.

| Package | Version | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| @sub2agent/workbuddy | 1.0.4 | 58147 | ac9c8cb605cf27f1607c33d71a4556ff08bb31c9d95250331204d46ca2887cb6 |
| @sub2agent/aiep | 1.0.4 | 601 | 4b97b09db1e9b44f3f4957b3f59dedc18c9d3fd448eb6863453972c94d5d9ca8 |
| @magpie-community/gateway-notify | 0.1.4 | 28516 | ccd9960ef1dd6aed49bbf3fada25bb2a02539ec752cdd7408e1ecabbfce4b767 |

Validation: two local deployment unit tests passed. The target check.py passed
before and after service deployment and after publication. Systemd reports
enabled/active and port 80 is listening. KF independently fetched health,
catalog, npm latest metadata and all three ZIPs; lengths and SHA-256 passed.
This validates static distribution, not real enterprise authentication/inference.
No pending MaaS transport or capacity change was released.
