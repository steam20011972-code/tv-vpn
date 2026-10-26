# TV VPN

**Requires a rooted LG webOS TV with Homebrew Channel reporting "Root OK".** Without root it cannot work: webOS does not let regular apps create a TUN device or change routes and DNS.

[Русский](README.ru.md)

A VPN client for LG webOS built on [sing-box](https://github.com/SagerNet/sing-box) (ARMv7) and a small controller running on the TV's built-in Node.js. The **TV VPN** app turns a whole-TV VPN on and off, restores the normal network on failure, and can connect automatically when the TV starts.

> **Status: early, developer-only.** Tested on one model (LG 55UA75009LA, webOS 25). Installation currently runs from a PC over SSH; in-app installation and QR profile import are in progress.

## Disclaimer

- Provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).
- Rooting and changing the TV's network setup is at your own risk. The project never touches firmware or system partitions, but a network mistake can leave the TV offline until recovered (see "Network recovery").
- You need **your own** VPN server or a profile you are entitled to use. No servers are provided.
- Obey the laws of your country.

## Currently supported

- Profile: `vless://` with TCP / Reality / Vision (`flow=xtls-rprx-vision`, `encryption=none`). More protocols are planned.
- All TV IPv4 traffic goes through the VPN; DNS uses DoH inside the tunnel. External IPv6 is blocked while connected. The LAN stays reachable.
- If the server is unreachable, the controller restores the normal network and retries with back-off up to 5 minutes. An independent watchdog restores the network if the controller hangs.

## Installation (developers)

Requirements: Node.js 18+, `tar`, root SSH access to the TV over LAN, the TV host key in `~/.ssh/known_hosts`.

```sh
npm install
export TV_HOST=<TV IP address>
export TV_SSH_PASSWORD=<root password>   # current process environment only
```

1. Download [sing-box-1.14.3-linux-armv7.tar.gz](https://github.com/SagerNet/sing-box/releases/download/v1.14.3/sing-box-1.14.3-linux-armv7.tar.gz) into `downloads/`, verify the SHA256 from [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) and unpack it.
2. `node tools/tv.cjs exec "mkdir -p /media/developer/tv-vpn/bin; chmod 700 /media/developer/tv-vpn"`
3. `node tools/tv.cjs upload downloads/sing-box-1.14.3-linux-armv7/sing-box /media/developer/tv-vpn/bin/sing-box 700`
4. Profile: `TVVPN_PROFILE_FILE=path/to/file node tools/stage.cjs`, or pipe the link via stdin. Keep that file outside the repository and delete it afterwards.
5. `node tools/deploy-runtime.cjs`, then `npm test` and `npm run build`.
6. `node tools/install-app.cjs` installs the IPK and launches the app.
7. Check a manual connection. Autostart: `node tools/set-autostart.cjs on`.

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

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/uninstall.cjs
```

It disables autostart, stops its own processes, restores DNS and routes, and removes the components. The profile is kept (mode 0600); add `--delete-profile` to remove it too. Then remove the TV VPN icon from the TV app menu.

## Security

Profiles and keys never go into Git, the IPK, logs or diagnostics; on the TV they are mode 0600. To report a vulnerability see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). sing-box is GPL-3.0-or-later — see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
