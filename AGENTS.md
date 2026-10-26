# MEDZH VPN — contributor and agent notes

VPN client for rooted LG webOS TVs: webOS app in `app/`, TV controller in `runtime/`, PC developer tools in `tools/`.

- Never modify TV firmware or system partitions.
- Before routing changes, keep the independent watchdog working and LAN SSH reachable.
- Remove only project-owned processes, interfaces, routes and rules. Stop must be idempotent.
- Secrets stay out of Git, logs, diagnostics and the IPK; TV files holding them use mode 0600; never pass them on a command line.
- Do not commit real VPN links, UUIDs, keys, IP addresses or hostnames; tests use documentation ranges (192.0.2.0/24) and example.com.
- Commands: `npm test`, `npm run build`. TV tools need `TV_HOST` and `TV_SSH_PASSWORD` in the environment.
