# Architecture

How MEDZH VPN is put together on a rooted LG webOS TV, what runs as root, what it trusts, and what it leaves behind. Written for reviewers; the code is the source of truth, and each section names the files it describes. Facts about the TV were measured on an LG 55UA75009LA (webOS 25, Node.js 16.20.2) with Homebrew Channel.

## Components

| Component | Source | On the TV | Runs as | Role |
|---|---|---|---|---|
| UI | `app/` | `/media/developer/apps/usr/palm/applications/io.github.steam20011972code.tvvpn` | the web app (WebAppMgr) | Plain HTML/JS. Calls only the app's own Luna service, plus one fixed Homebrew Channel `exec` command to elevate it. Puts no user data into any command. |
| Luna service | `service/` (+ copies of `runtime/secure-app.cjs`, `runtime/signature.cjs`) | `…/usr/palm/services/io.github.steam20011972code.tvvpn.service` | root, after `elevate-service` | Thin facade: checks caller, uid and arguments, then runs the installed runtime with `execFile` (no shell). |
| Installer | `runtime/setup.cjs` | the installed copy in `BASE/runtime` | root | `status`, `install`, `uninstall`. Verifies the package signature and core hash, copies runtime, core and boot hook into `BASE`. |
| CLI | `runtime/ctl.cjs` | `BASE/runtime` | root | Fixed action list; starts the supervisor if needed and talks to it over `BASE/run/control.sock` (0600). |
| Supervisor | `runtime/supervisor.cjs` | `BASE/runtime` | root, detached | VPN state machine: connect, health checks every 8 s, fallback to the normal network, retries with back-off up to 5 min, profiles and subscriptions, import page. |
| Watchdog | `runtime/watchdog.sh` | `BASE/runtime` | root, separate `sh` process per connection | Independent of Node: if the supervisor dies or its heartbeat is older than 12 s, runs `recover.cjs` and `launch.cjs resume`. |
| Recovery | `runtime/common.cjs` `cleanup()`, `runtime/recover.cjs` | `BASE/runtime` | root | Idempotent removal of exactly what the current lease recorded (below). |
| Boot hook | `runtime/70-tv-vpn` | `/var/lib/webosbrew/init.d/70-tv-vpn` (0700) | root, at boot (Homebrew Channel) | `launch.cjs boot`: puts the package modes back, starts the supervisor; it connects only if autostart is on. |
| Import server | `runtime/import-server.cjs` | `BASE/runtime` | uid/gid 65532 after `listen` | One-shot LAN page for adding profiles from a phone. |
| Core | sing-box 1.14.3 `linux-armv7`, pinned in `core.lock.json` | `BASE/bin/sing-box` (0700) | root | TUN `tvvpn0`, routing rules, DoH inside the tunnel, local DNS listener. |

`BASE` is `/media/developer/tv-vpn`. It holds the installed runtime, the core and all state: `profiles/` (0700, files 0600), `preferences.json`, `installed.json`, `config.json`, `device-id`, `run/` (socket, lease, heartbeat, logs). Once components are installed nothing in the app directory runs as root; root only tightens its modes (below).

## Call path

```
UI (app.js)
  │ PalmServiceBridge  luna://io.github.steam20011972code.tvvpn.service/<method>  {fixed fields}
  ▼
Luna service (service.js)                 1. caller = ls2Message.applicationID() == app id   else forbidden
  │                                       2. process uid == 0                               else not-elevated
  │                                       3. method in whitelist, arguments typed/regex     else invalid-action
  │ execFile('/usr/bin/node', [BASE/runtime/ctl.cjs | setup.cjs, action, args…], env {PATH})
  ▼
ctl.cjs ──unix socket 0600──▶ supervisor.cjs ──spawn──▶ sing-box, watchdog.sh
                                             └─fork (IPC)─▶ import-server.cjs
setup.cjs (install/uninstall/status)
```

- **Methods** (`service/services.json`): `status`, `start`, `stop`, `restoreNetwork`, `setAutostart {enabled: boolean}`, `profiles`, `select {id}`, `delete {id}`, `importBegin`, `importStatus`, `importEnd`, `importUsb`, `refreshSubscription {id}`, `diagnostics`, `setupStatus`, `setupInstall`, `setupUninstall {deleteProfile: boolean}`. An `id` must match `^[a-z0-9]{8,16}$`; other payload fields are ignored. `ctl.cjs` and the supervisor check the values again.
- **Answers** are the last JSON line the program prints, `{ok: true, …}` or `{ok: false, error}`, with `returnValue` equal to `ok`. They carry no server addresses, UUIDs, keys or subscription URLs; the import URL with its token goes only to the app.
- **Elevation.** Before `elevate-service`, webOS runs the service in a jail with an unprivileged uid; it then answers `not-elevated` to everything and exits, so the next call starts it again. The app reacts by running the one command it ever gives Homebrew Channel `exec` (`app/commands.js`):
  `/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service io.github.steam20011972code.tvvpn.service`
  — fixed text, no user data. Elevation survives reboots; every install or update of the package resets it, and the app elevates again on the first `not-elevated`.
- **Time limits.** VPN methods 30 s (75 s for `importUsb` and `refreshSubscription`), `setupStatus` 30 s; install and uninstall run one at a time without a limit, because cut short they would leave `BASE/runtime` moved aside.

## Trust model

What the code relies on, and where each guarantee ends. "Local process" below means code already running on the TV outside an app jail.

### Who may call the service
After `elevate-service` the service's methods are public on the Luna bus (`allowedNames: *` and a `…api.public.json`). The only barrier is the caller check: `ls2Message.applicationID()` must equal `io.github.steam20011972code.tvvpn` (WebAppMgr appends `" <pid>"`, which is stripped). `message.sender` is not used, because for a non-app client it falls back to the bus name, which a client could choose. On the test TV the hub refuses a client that registers a bus name equal to the app id ("Not permitted to send"), both as root and as uid 99. Root can still impersonate the app (`luna-send -a`), so this check separates MEDZH VPN from other apps, not from root.

### What runs as root, and from where
- **Installed runtime.** Once components are installed, every call runs `BASE/runtime/ctl.cjs` or `setup.cjs`, never code from the app directory. The service first checks that `BASE` is root's and not a link, and that `BASE/runtime` passes `secureApp()` (below).
- **Before components are installed** (first install, or components from 0.6.1 or older; this covers `setupStatus` too). The package directory lies in `applications/`, which everyone can write to, so its `setup.cjs` does not run where it lies. The service:
  1. runs `secureApp()` on the app directory: every entry opened with `O_NOFOLLOW`, checked through the descriptor (regular file or directory, owner root, no hard links, `/proc/self/fd` shows the expected path), group/other write removed with `fchmod`; anything else is `package-unsafe`;
  2. verifies the package signature with the public key built into the service;
  3. copies the signed `runtime/` files into a fresh `mkdtemp` directory in `/tmp` (0700, files 0600, `COPYFILE_EXCL`), hashes each copy against the manifest, runs that copy with `--app <package>`, and removes the directory afterwards.
- **Environment.** `execFile` gets `env: {PATH: '/usr/sbin:/usr/bin:/sbin:/bin'}` and nothing else; `webos-service` is loaded by absolute path, so nothing is resolved through `node_modules` in the writable `services/` directory.
- **Boot.** The hook and the watchdog run node from `BASE` only if `BASE`, `BASE/runtime` and the file itself are root's and not links.

### Package signature
`tools/build.cjs` writes `manifest.json` with the SHA-256 of every file root later runs or trusts — `runtime/*`, `core/*`, `core.lock.json`, `appinfo.json`, and, under a separate `service` key, every file of the Luna service — and signs those bytes with the release key (Ed25519) into `manifest.sig` (`runtime/signature.cjs`). The private key is the CI secret `TVVPN_SIGNING_KEY`; tag builds fail without it (`--require-signature`). On the TV:
- `setup.cjs install` refuses an unsigned, foreign-signed or altered package before stopping anything, and hashes every file again after copying it into `BASE`;
- the key that counts for updates is the one in the installed copy in `BASE/runtime`; for the first install, the one built into the service, which arrived in the same package;
- the developer override `TVVPN_ALLOW_UNSIGNED=1` works only for `setup.cjs` run over SSH: the service passes no environment.

The build also checks the packaged bytes: the signature holds for the key in `runtime/signature.cjs`, the service ships byte-identical to Git, and every IPK entry is owned by root with no group/other write.

### The core
`core.lock.json` pins the sing-box release URL and the SHA-256 of the archive, the binary and its licence. `tools/fetch-core.cjs` downloads the archive from the SagerNet GitHub release in CI and checks all three; the build checks the binary again inside the finished IPK. Nothing is built from source and no binary is committed. On the TV, `setup.cjs` refuses a core whose hash differs from `core.lock.json` or from the signed manifest, and checks the copy in `BASE/bin` once more before putting it in place.

### Profiles and secrets
Profiles, keys and subscription URLs live only in `BASE` (directories 0700, files 0600). They never appear on a command line (subscription URLs reach curl through its config on stdin), in Luna answers, logs or diagnostics, and never in Git or the IPK. Links that turn off certificate checks are refused. Subscriptions are fetched only from public IPv4 addresses, checked again on each redirect and pinned for the request.

### Import server
Started only on request from the app (`importBegin`), bound to the TV's LAN IPv4 on a random port. After `listen` it drops to uid/gid 65532 with no supplementary groups (an id no account or process on the TV uses) and refuses to serve if that fails. It accepts only private source addresses, a 128-bit one-time token in the URL, 64 KB bodies and 10 requests a minute in total, and closes after the first import that stored a profile, after 5 minutes, or when the user leaves the screen. It never touches the profile store: it passes the pasted text to the supervisor over IPC and gets back counts only. Traffic is plain HTTP inside the LAN; the README says so and recommends USB import on an untrusted network.

### Other listeners
While connected, sing-box also listens on the TV's LAN IPv4 port 53 (DNS answered only for the TV's own address, everything else rejected) and on `127.0.0.1:17890` (HTTP/SOCKS without authentication, used for health checks, reachable only from the TV itself).

### Known limits
Most of these come from developer mode and Homebrew Channel and cannot be closed from inside the project's own files; the boot window for `BASE` also follows from the project's choice to keep `BASE` in `/media/developer` (see the end of this section):
- **Local root is not a boundary.** Homebrew Channel's `exec` is public and does not check its caller, so any local client of the Luna bus can already run commands as root. Every elevated Homebrew service runs through Homebrew Channel's `run-js-service`, which is mode 0777.
- **`devmode.sh` runs `chmod -R 777 /media/developer` at every boot.** Until the boot hook runs, `BASE`, the app and the service are writable, and profiles readable, by every local user. The hook then gives the app and service directories back 0755/0644 (`launch.cjs boot` → `securePackage()`) and the supervisor it starts gives `BASE` its 0700/0600 modes back (`harden()`). There is still a window between the hook's ownership check and the start of node.
- **`applications/` and `services/` are 0777 without the sticky bit.** A local process can rename our service directory and put its own in its place; checking files inside the directory cannot detect a swapped directory.
- **First install trusts the package as installed**: its signature is checked with a key from the same package. Compare the IPK's SHA-256 with the release page (Homebrew Channel does this itself from the catalog manifest).

Processes inside other apps' jails do not see `/media/developer` at all (checked on the test TV for system apps and a developer app), so the file-mode limits concern code that already runs outside a jail. The public `exec` is different: any client of the Luna bus can call it, jailed apps included, so on such a TV local code of any kind can reach root through Homebrew Channel regardless of MEDZH VPN. `BASE` was kept in `/media/developer` deliberately; moving it to a root-only directory would close the boot window for profiles and is a possible future change.

## What is created on the TV

| Where | What | Created by | Removed by |
|---|---|---|---|
| `/media/developer/apps/usr/palm/applications/<id>`, `…/services/<id>.service` | app and Luna service | webOS installer | webOS installer (app removal) |
| `/var/luna-service2-dev/{services.d,roles.d,client-permissions.d,api-permissions.d,manifests.d}` | Luna registration, including files written by `elevate-service` | installer, `elevate-service` | `appInstallService/dev/remove` (app removal) removes all of them |
| `BASE/bin`, `BASE/runtime`, `BASE/run`, `config.json`, `preferences.json`, `installed.json` | core, runtime, state | `setup.cjs`, supervisor | `uninstall.cjs` |
| `BASE/profiles/`, `device-id` (and a legacy `profile.json`, moved into `profiles/` on first use) | profiles and the id subscription panels count | supervisor | `uninstall.cjs --delete-profile` |
| `/var/lib/webosbrew/init.d/70-tv-vpn` | boot hook | `setup.cjs` (refuses to replace a hook that is not ours) | `uninstall.cjs` (stops if the hook does not name our launcher) |
| `/tmp/tvvpn-setup-*` | checked runtime copy for a first install | service | service, right after the call; a service killed mid-call leaves it behind (root-only, not used again) |

While connected (recorded in `BASE/run/lease.json`, removed by `cleanup()`):
- interface `tvvpn0` with `172.30.247.1/30`;
- IPv4 rules with priority 18000–18099 and route table 20220 (sing-box `auto_route`); a rule is deleted only when every rule at its priority matches the lease;
- IPv6 `unreachable ::/1` and `8000::/1`, metric 42760, proto 186 (external IPv6 is blocked, not tunnelled);
- ConnMan nameservers of the active service pointed at the TV's own LAN IPv4, restored only if still pointing there;
- processes `sing-box`, `watchdog.sh`, `supervisor.cjs`, `import-server.cjs`, identified by pid, `/proc` start time and command line; nothing else is ever killed.

Connecting refuses (`route-conflict`, `address-conflict`) when any of these already exists without a lease. LAN routes stay outside the tunnel. Firmware and system partitions are never modified.

## Removal

1. In the app, "Status and diagnostics" → "Remove MEDZH VPN completely" (`setupUninstall`), or over SSH `node BASE/runtime/uninstall.cjs [--delete-profile]`. It turns autostart off, stops the supervisor, core and watchdog, restores routes and DNS, removes the boot hook and the files in the table above, and keeps profiles and `device-id` unless asked to delete them. The `BASE` directory itself is kept. Stopping and removal are idempotent.
2. Remove the app from the TV's app menu (or Homebrew Channel). The webOS installer deletes the app, the service and all Luna files, including those from `elevate-service`.

## Why the app id changed

Up to 0.6.4 the app id was `io.github.steam20011972-code.tvvpn`. `ares-package` requires a service id to start with the app id, and Luna rejects service names containing `-` (`LSUriParse: Not a valid service name`), so that package could not have a service. 0.7.0 uses `io.github.steam20011972code.tvvpn`; repository links stay at `github.com/steam20011972-code/tv-vpn`. A package with a new id installs beside the old one rather than updating it. On its first `setupInstall` the new service removes the old app through the system installer (`appInstallService/dev/remove`) before installing components, so that the old app cannot put its own components back; profiles, settings and the boot hook live in `BASE` and are kept. The old app counts as installed only if its directory and `appinfo.json` are root's and name the old id.
