# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's **Security → Report a vulnerability** (GitHub private advisory). Do not open a public issue for security problems.

Do not send vulnerabilities to the project's Telegram ([@medzh_vpn](https://t.me/medzh_vpn)); it is for questions and feedback only.

Never include VPN links, UUIDs, keys, server addresses, passwords or raw sing-box logs in reports. Replace them with placeholders.

## Scope

In scope: the TV runtime (`runtime/`), the Luna service (`service/`), the webOS app (`app/`), developer tools (`tools/`), and how they handle profiles, routes, DNS and processes on the TV.

Out of scope: sing-box itself (report to [SagerNet/sing-box](https://github.com/SagerNet/sing-box)), Homebrew Channel / rooting tools, and your VPN server.

## Design rules

The components, the call path from the app to root and the full trust model are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- Profiles and secrets stay out of Git, the IPK, logs and diagnostics. TV files holding them use mode 0600.
- Secrets are never passed on a command line (subscription URLs reach curl through its config on stdin).
- Network listeners. The profile import page: started on request, bound to the TV's LAN IPv4, private source addresses only, 128-bit one-time token, 64 KB bodies, 10 requests a minute, closed after one successful import or 5 minutes; it can only add profiles and answers with counts, never echoing links; traffic to it is unencrypted HTTP inside the LAN. While VPN is connected, sing-box also listens on the TV's LAN IPv4 port 53 (TCP/UDP; DNS answered only for the TV's own address, everything else rejected) and on 127.0.0.1:17890 (an HTTP/SOCKS proxy without authentication, reachable only by processes on the TV).
- Links that turn off certificate checks (`allowInsecure`, `insecure`) are refused.
- Subscriptions are fetched only from public IPv4 addresses; redirects are followed one hop at a time with the same check, and the checked address is pinned for the request.
- Packages are signed: the build lists the SHA256 of every file root runs or trusts (runtime, core, core.lock.json, appinfo.json and the Luna service) in `manifest.json` and signs it with the release key (Ed25519). `setup.cjs` refuses an unsigned, foreign-signed or altered package before stopping anything and hashes every copied file again. The key that counts is the one in the copy already installed in `/media/developer/tv-vpn` (owned by root, 0700).
- The IPK stores files as 0644 and directories as 0755 (the build fails otherwise); the webOS installer applies the file modes but keeps existing directories, and a first install may leave them 0777. Once components are installed, root never runs code from the app directory: the app's Luna service runs the installed copy of `setup.cjs` and passes the package as `--app` (`service/service.js`). Only the first install, or an update from 0.6.1 or older, runs the package's own `setup.cjs`: after root has removed group/other write from the whole app directory and found every entry owned by root with no symlinks or hard links, the service checks the package signature with the key built into it and runs a copy of the signed runtime files, each hashed again, from a fresh root-only directory in `/tmp`. Developer mode makes `/media/developer` writable by everyone at every boot; the boot hook then gives the app and service directories back their package modes. The data directory must be owned by root; temporary files are created fresh, never written through an existing name.
- The Luna service answers only the MEDZH VPN app (`applicationID()` of the call), only once elevated, and only whitelisted methods with typed arguments; it runs the installed runtime with `execFile` and a fixed `PATH`, never a shell. The app's only Homebrew Channel `exec` command is the fixed `elevate-service` call for that service.
- The import server drops to uid/gid 65532 without groups once its socket is bound.
- Known limits (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#known-limits)):
  - the first install trusts the package as installed (its signature is checked with a key from the same package). Check the IPK's SHA256 against the release page before installing;
  - on a TV with developer mode and Homebrew Channel, local processes are not separated from root: Homebrew Channel's `exec` is public, its `run-js-service` is mode 0777, and `devmode.sh` makes `/media/developer` (data directory, app and service) writable by everyone at every boot; afterwards the boot hook gives the app and service directories their package modes back and the supervisor it starts does the same for the data directory. `applications/` and `services/` stay writable by everyone, so a service directory can be swapped. The caller check separates MEDZH VPN from other apps, not from root.
- The runtime removes only processes, interfaces, routes and rules it created; stopping is idempotent.
- The project never modifies TV firmware or system partitions.
