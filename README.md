# MEDZH VPN

**Requires a rooted LG webOS TV with Homebrew Channel reporting "Root OK".** Without root it cannot work: webOS does not let regular apps create a TUN device or change routes and DNS.

[Русский](README.ru.md)

A VPN client for LG webOS built on [sing-box](https://github.com/SagerNet/sing-box) (ARMv7) and a small controller running on the TV's built-in Node.js. The **MEDZH VPN** app turns a whole-MEDZH VPN on and off, restores the normal network on failure, and can connect automatically when the TV starts.

> **Status: early, developer-only.** Tested on one model (LG 55UA75009LA, webOS 25). Components install from the app itself; the profile is still loaded from a PC over SSH, QR import is in progress.

## Disclaimer

- Provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).
- Rooting and changing the TV's network setup is at your own risk. The project never touches firmware or system partitions, but a network mistake can leave the TV offline until recovered (see "Network recovery").
- You need **your own** VPN server or a profile you are entitled to use. No servers are provided.
- Obey the laws of your country.

## Currently supported

- Profile: `vless://` with TCP / Reality / Vision (`flow=xtls-rprx-vision`, `encryption=none`). More protocols are planned.
- All TV IPv4 traffic goes through the VPN; DNS uses DoH inside the tunnel. External IPv6 is blocked while connected. The LAN stays reachable.
- If the server is unreachable, the controller restores the normal network and retries with back-off up to 5 minutes. An independent watchdog restores the network if the controller hangs.

## Installation

1. Install the IPK `io.github.steam20011972-code.tvvpn_<version>_all.ipk` (Homebrew Channel, `ares-install` or `node tools/install-app.cjs`).
2. Open MEDZH VPN. The app checks root, `/dev/net/tun`, `ip rule`, ConnMan and Node.js and offers "Install components". The sing-box core and controller are copied from the package into `/media/developer/tv-vpn` (modes 0700/0600); the core hash is checked against `core.lock.json`. Autostart is off by default.
3. After an IPK update the app offers "Update components"; profile and settings are kept, and a VPN that was on reconnects.

Without root the app shows "Homebrew Channel with Root OK required".

## Development

Requirements: Node.js 18+, root SSH access to the TV over LAN, the TV host key in `~/.ssh/known_hosts`.

```sh
npm install
export TV_HOST=<TV IP address>
export TV_SSH_PASSWORD=<root password>   # current process environment only
```

- `npm test`; `npm run build` downloads the core pinned in `core.lock.json` (`tools/fetch-core.cjs`, SHA256-checked), builds the IPK with runtime and core, and verifies the core hash inside the package.
- `node tools/install-app.cjs` installs the IPK and launches the app.
- Profile: `TVVPN_PROFILE_FILE=path/to/file node tools/stage.cjs`, or pipe the link via stdin. Keep that file outside the repository and delete it afterwards.
- Without the app: `node tools/deploy-runtime.cjs` (runtime) and `node tools/set-autostart.cjs on|off`; install over SSH with `/usr/bin/node /media/developer/apps/usr/palm/applications/<id>/runtime/setup.cjs install|status`.

## Controls

The big button toggles the VPN. Arrows move focus, OK selects, Back closes diagnostics or the app. "Connect automatically" applies when the TV powers on. Closing the app does not drop the connection.

## Network recovery

Over SSH on the TV:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs restore-network
```

If the controller does not respond:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/recover.cjs
```

Disable autostart permanently:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs set-autostart off
/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs stop
```

## Uninstall

In the app: "Status and diagnostics" → "Remove MEDZH VPN completely", then choose whether to keep the profile. Or over SSH:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/uninstall.cjs
```

It disables autostart, stops its own processes, restores DNS and routes, and removes the components. The profile is kept (mode 0600); add `--delete-profile` to remove it too. Then remove the MEDZH VPN icon from the TV app menu.

## Security

Profiles and keys never go into Git, the IPK, logs or diagnostics; on the TV they are mode 0600. To report a vulnerability see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). sing-box is GPL-3.0-or-later — see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
