# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through the repository's **Security → Report a vulnerability** (GitHub private advisory). Do not open a public issue for security problems.

Never include VPN links, UUIDs, keys, server addresses, passwords or raw sing-box logs in reports. Replace them with placeholders.

## Scope

In scope: the TV runtime (`runtime/`), the webOS app (`app/`), developer tools (`tools/`), and how they handle profiles, routes, DNS and processes on the TV.

Out of scope: sing-box itself (report to [SagerNet/sing-box](https://github.com/SagerNet/sing-box)), Homebrew Channel / rooting tools, and your VPN server.

## Design rules

- Profiles and secrets stay out of Git, the IPK, logs and diagnostics. TV files holding them use mode 0600.
- Secrets are never passed on a command line (subscription URLs reach curl through its config on stdin).
- The only network listener is the profile import page: started on request, bound to the TV's LAN IPv4, private source addresses only, 128-bit one-time token, 64 KB bodies, 10 requests a minute, closed after one successful import or 5 minutes. It can only add profiles and answers with counts, never echoing links. Traffic to it is unencrypted HTTP inside the LAN.
- The runtime removes only processes, interfaces, routes and rules it created; stopping is idempotent.
- The project never modifies TV firmware or system partitions.
