# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's **Security → Report a vulnerability** (GitHub private advisory). Do not open a public issue for security problems.

Never include VPN links, UUIDs, keys, server addresses, passwords or raw sing-box logs in reports. Replace them with placeholders.

## Scope

In scope: the TV runtime (`runtime/`), the webOS app (`app/`), developer tools (`tools/`), and how they handle profiles, routes, DNS and processes on the TV.

Out of scope: sing-box itself (report to [SagerNet/sing-box](https://github.com/SagerNet/sing-box)), Homebrew Channel / rooting tools, and your VPN server.

## Design rules

- Profiles and secrets stay out of Git, the IPK, logs and diagnostics. TV files holding them use mode 0600.
- Secrets are never passed on a command line.
- The runtime removes only processes, interfaces, routes and rules it created; stopping is idempotent.
- The project never modifies TV firmware or system partitions.
