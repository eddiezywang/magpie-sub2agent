# Notes for coding agents

## Operating on 0.177 (172.21.0.177)

0.177 is the shared intranet server for WeMail AND Sub2Agent, reached through
the KF network. Any action on it affects both products. The mandatory protocol,
with no exceptions:

1. Open `wecli test-jump` on KF (session per task, reuse across rounds).
2. `ssh eddiewang@172.21.0.177` — **the eddiewang account is login-only.** It
   must never run commands, never run `sudo -n <cmd>` one-shots, never touch
   the proxy, and never make outbound connections. Every operation beyond
   reaching the shell is forbidden under this account.
3. `sudo su - root` — run all operations in root's login environment.
4. root's login environment configures `http_proxy` by default. Outbound
   access to 134.175.165.190 or any other external target goes through that
   proxy (reference `$http_proxy`, never echo or copy its value into logs,
   scripts or skills).

Probes, health checks, transfers and deployments all count as operations and
follow 2–4. A session that must stay connected across steps keeps the root
shell as its foreground program; long work runs backgrounded with output to a
root-owned file, then polls it.

## Sub2Agent 发布手册

正式发布的安装包和更新制品必须从 `fork/main` 构建。顺序如下。

1. 打包前，将本次发布的全部代码、版本号变更和 changelog 提交并合入 `main`，推送到 `fork/main`。开发和验收可以在开发分支进行。
2. 构建前运行 `git fetch fork`，切换到本地 `main`，确认 `git rev-parse HEAD` 与 `git rev-parse fork/main` 一致，并确认 `git status --porcelain` 无输出。正式制品一律从这个工作区构建。
3. 生成发布清单和上传前，核对构建记录中的源码提交 SHA 与这次构建锁定的 `fork/main` SHA 一致。若发布内容有任何变化，先提交并推送到 `fork/main`，再重新构建、验包和签名。

### 发布说明

每次发布前，在 `build/intranet-release/notes/<版本号>.md` 写明相对于上个已发布版本的用户可见变化。发布准备脚本读取该 Markdown 并写入 `latest.json` 的 `notes` 字段。上传前核对本地清单，自动拉取后从实际更新源回读，确认说明与该版本对应。详细步骤见[发布手册](build/intranet-release/README.zh-CN.md#发布说明)。

## Internal fork workflow

- Commit and push proactively after each independently verified development
  step, before beginning the next step. Record what was verified and any
  remaining limitations in the commit message. If pushing fails, report it
  explicitly and retry; never describe a local-only commit as pushed.
- Develop the Sub2Agent distribution on `develop/intranet`; retain Magpie's
  provider management interactions while integrating Sub2Agent authentication.
- Validate every retained page and capture milestone screenshots for the user's
  review site at http://124.220.199.224:8805/. Never publish credentials, tokens,
  authentication callbacks or screenshots showing unmasked secrets.
- Keep the original apps' credentials and data separate from this distribution.
- Use Playwright for page verification and screenshots; do not use computer-use
  for screenshots. Retain the Sessions page in the intranet distribution.

## Subsystem design and review

Before changing a documented subsystem, read its
[design reference](docs/subsystems/README.md) and verify the linked source.
When preparing or reviewing a PR, follow the same page's documentation update,
semantic change description, and review rules.

## Code standards

Write and review changes against the [code standards](docs/code-standards.md).

## Community PRs

Before reviewing a community PR, read [contributors](docs/contributors.md):
what stops a review for possible harm, what is closed unreviewed, and the
authors whose PRs are closed on sight.

## Lessons

Before changing code, read [LESSONS.md](LESSONS.md): what recent merged
work got wrong and the rule that would have caught it.

## Built-in subscriptions that a plugin serves

These built-in subscriptions are retired. Reaching them can break their
vendors' terms, so they moved out of magpie into community OpenCode plugins,
which keeps magpie itself from being banned. Each one has a plugin that does
the same job:

| Subscription | id | Plugin (npm) | Mover |
| --- | --- | --- | --- |
| Antigravity | `antigravity` | `@magpie-community/opencode-antigravity-auth` | `internal/provider/migrate_antigravity.go` |
| Command Code | `commandcode-plan` | `@magpie-community/opencode-commandcode-auth` | `internal/provider/migrate_side.go` |
| Cursor | `cursor` | `@magpie-community/opencode-cursor-auth` | `internal/provider/migrate_side.go` |
| Devin | `devin` | `@magpie-community/opencode-devin-auth` | `internal/provider/migrate_side.go` |
| Factory | `factory` | `@magpie-community/opencode-factory-auth` | `internal/provider/migrate_factory.go` |
| Grok | `grok` | `@magpie-community/opencode-grok-auth` | `internal/provider/migrate_side.go` |
| Kiro | `kiro` | `@magpie-community/opencode-kiro-auth` | `internal/provider/migrate_kiro.go` |
| Xiaomi MiMo | `mimo-app` | `@magpie-community/opencode-mimo-auth` | `internal/provider/migrate_mimo.go` |
| Qoder, Qoder CN | `qoder`, `qoder-cn` | `@magpie-community/opencode-qoder-auth` | `internal/provider/migrate_qoder.go` |
| WorkBuddy, WorkBuddy AI | `workbuddy`, `workbuddy-ai` | `@magpie-community/opencode-workbuddy-auth` | `internal/provider/migrate_workbuddy.go` |
| ZCode | `zcode` | `@magpie-community/opencode-zcode-auth` | `internal/provider/migrate_zcode.go` |
| Zed | `zed` | `@magpie-community/opencode-zed-auth` | `internal/provider/migrate_zed.go` |

The `movers` map in `internal/provider/migrate*.go` is the source of truth.
`TestMovedBuiltinsSayTheirPlugin` fails when a mover has no notice in its
code.

### Which code actually runs

Two cases decide it:

- **Moved:** the user moved the subscription onto its plugin, from the
  editor's "Move to plugin" (or `provider.Adopt`). Its `migrations.json`
  state is `plugin` (`provider.Moved(id)`). A new user never sees a
  deprecated built-in: the Add sheet leaves one with no account out
  (`unusedSub` in app.js), so it is installed from the Plugins page. A user
  who installs the plugin themselves is moved too
  (`provider.HandOver`): at once when the built-in has no accounts, from the
  gateway's hourly loop (`KeepRetiringMoved`) when it has, unless the
  plugin is signed in under its own `-plugin` id already. Until
  then the Add sheet shows the plugin's tile only (`replacedSub` in app.js).
  Since 10-16 the built-ins are being retired: the hourly loop's
  `MoveRetiring` moves every subscription with a mover that still has
  built-in accounts, a user who moved back included, and there is no way
  back. Turning the plugin off turns the subscription off with it; removing
  it records `removed` (accounts kept with the plugin's sign-ins), and
  installing it again gives the subscription back.
- **Not moved:** the user still has accounts from the built-in: the move
  hasn't run yet, or it failed (tried again after six hours). Nothing
  serves them until it runs.
- **Retired:** the built-in's code is gone (`retiredBuiltins` in
  `internal/provider/migrate.go`; `provider.BuiltinRetired(id)`). The
  plugin serves it, moved or not. Accounts not moved yet are served by
  nothing; a line over the Providers list says so, with why and a Move
  (`providers.unmoved`, `unmovedLine` in app.js). With no row of its own,
  the Add sheet leaves it to the Plugins page (`unusedSub`). Every
  subscription in the table above is retired (10-17; Antigravity 11-15);
  gates ask `provider.PluginServes(id)` (moved or retired). Gemini CLI
  (`gemini`) and the agy agent stay built in.
- **Antigravity's plugin is withdrawn for anyone new** (the owner, 11-15:
  正在使用的继续正常，加个提示，新用户不让下载): Google bans accounts it
  sees on Code Assist through Antigravity's own client. The built-in's code
  is still in the tree, but `googleLogins` lists nothing once the plugin
  serves it, so it asks Google for nothing; the mover reads
  `googleSavedLogins`. The plugin (0.2.1, the mover's min) serves as
  before for whoever has it, and the Providers page tells them the risk
  and points to Antigravity (local agy CLI),
  `@magpie-community/opencode-agy-cli-auth`, which runs the user's own agy
  over ACP (`withdrawn` in `/api/providers`). `plugin.Add` turns it away
  for anyone who doesn't have it listed (`plugin.RefuseWithdrawn`); the
  mover installs it for the user's own accounts under
  `plugin.KeepWithdrawn`, and it left the registry. Don't offer it to
  anyone new. The built-in route's tests serve it again through
  `provider.AntigravityBuiltinForTest()` until its code is taken out
  (#6723).

The plugin does everything: sign-in, refresh, models, requests, usage and
errors. It runs in the plugin host (`internal/plugin`). The built-ins'
sign-in, models, usage and gateway translators are gone. What is left of
them in `internal/provider` (and `internal/qoder/endpoints.go`) reads the
built-in's saved accounts so the mover can carry them over. The gateway
sends every request to the plugin's fetch.

So a bug report about one of these subscriptions is usually about the
plugin:

1. Check whether the user's subscription is moved. A moved provider's row in
   `/api/providers` has `move.state == "plugin"`; the provider id is in
   `onPlugins`.
2. Fix the plugin in the community repo,
   [magpie-community/plugins](https://github.com/magpie-community/plugins)
   (`packages/<name>`, provider id = the built-in's id; checked out locally
   at `~/workspace/projects/magpie-commuity-plugins`). Publish a new version.
3. Raise the mover's `min` to that version. `keepMovedCurrent` then updates
   every moved user's plugin.

This magpie-side code still runs for moved subscriptions:

- the plugin host: `internal/plugin`, `host.js`;
- `internal/provider/plugins.go`, `plugin_usage.go` (`movedCards`) and
  `pluginsignin.go`;
- the move itself: `internal/provider/migrate*.go`;
- the GUI's plugin paths in `internal/gui/assets/app.js`: `subOf`,
  `pluginSubs` and `startPluginSignIn`.

The parity tests, `internal/gateway/plugin_*_test.go`, hold each plugin to
what its built-in did.
