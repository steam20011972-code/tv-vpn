# MEDZH VPN

**Requires a rooted LG webOS TV with Homebrew Channel reporting "Root OK".** Without root it cannot work: webOS does not let regular apps create a TUN device or change routes and DNS.

[Русский](README.ru.md)

A VPN client for LG webOS built on [sing-box](https://github.com/SagerNet/sing-box) (ARMv7) and a small controller running on the TV's built-in Node.js. The **MEDZH VPN** app turns a whole-TV VPN on and off, restores the normal network on failure, and can connect automatically when the TV starts.

> **Status: beta.** Tested on one model (LG 55UA75009LA, webOS 25); other rooted LG TVs should work if they pass the install checks below. Components install from the app itself; profiles are added from a phone via QR code or from a USB stick.

## Disclaimer

- Provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).
- Rooting and changing the TV's network setup is at your own risk. The project never touches firmware or system partitions, but a network mistake can leave the TV offline until recovered (see "Network recovery").
- **No kill switch.** Whenever the VPN is not connected (TV start-up, server failure, retries for up to 5 minutes, network changes), all TV traffic goes directly over your normal Internet connection, without the VPN. The app then shows "Normal internet".
- You need **your own** VPN server or a profile you are entitled to use. No servers are provided.
- Obey the laws of your country.

## Currently supported

- Profiles (share links or sing-box JSON outbounds):
  - `vless://` — security none / TLS / Reality; transport TCP, WebSocket (incl. `?ed=` early data), gRPC, HTTPUpgrade; `flow=xtls-rprx-vision`;
  - `vmess://` (v2rayN base64 JSON, `alterId` 0), `trojan://`, `ss://` (SIP002 and legacy base64; AEAD and 2022 ciphers, no plugins), `hysteria2://` / `hy2://` (salamander obfs, port hopping), `tuic://`.
  - Links as Marzban, 3x-ui, Remnawave and Hiddify generate them are accepted (fixtures in `test/panels.test.cjs`). Their extra parameters are mapped where sing-box has an equivalent (TLS `fragment`, Hysteria2 `gecko` obfs, `upmbps`/`downmbps`), or dropped when sing-box needs nothing for them (markers, `spx`, `pqv`, mux settings, mixed-case/padding tricks, a certificate pin without `insecure`), with a note on the profile where it matters.
  - A link that turns off certificate checks (`allowInsecure=1`, `insecure=1`) is refused: anyone on the network path could impersonate such a server and read the tunnel. Use a server with a valid certificate or Reality. A profile of this kind stored by version 0.6.1 or older keeps working and is labelled "no certificate check".
  - Refused rather than silently changed: an unknown parameter, ECH, a gRPC `authority` other than the server name, gRPC `multi` mode, a certificate pin together with `insecure`, Shadowsocks plugins or TLS, and Xray-only features (xhttp, kcp, VLESS encryption, `fm` finalmask tricks) as "not supported by sing-box". IPv6 server addresses are not supported.
  - The server may be a domain name: it is resolved with the TV's normal DNS before the tunnel starts. The VPN counts as connected when Cloudflare's trace through the tunnel shows the server's address, or an exit address different from the TV's direct one.
- All TV IPv4 traffic goes through the VPN; DNS uses DoH inside the tunnel. External IPv6 is blocked while connected. The LAN stays reachable.
- If the server is unreachable, the controller restores the normal network and retries with back-off up to 5 minutes. An independent watchdog restores the network if the controller hangs.

## Installation

### Prepare the TV: root with DangBro

If Homebrew Channel → Settings already shows **"Root OK"**, skip to installing MEDZH VPN below.

For your own compatible TV, use [DangBro](https://github.com/azoffshowy/dangbro). Its author lists webOS 7.x–25 and DVB-tuner models; the webOS version alone does not guarantee compatibility with a particular firmware. This project records successful rooting of an LG 55UA75009LA with webOS 25, firmware 33.31.61.

1. Connect the computer and TV to the same home network; find the TV's IP address in its network settings.
2. On the computer, open the [DangBro page](https://azoffshowy.github.io/dangbro/), enter the TV's IP address and click **connect**.
3. Accept the pairing prompt on the TV. DangBro automatically obtains root and installs Homebrew Channel. **It removes the Developer Mode app if installed**; you do not need to install that app beforehand for this method.
4. Wait for a success message and reboot the TV. Then open Homebrew Channel → Settings and confirm **"Root OK"**.

For a certificate error, open `https://<TV-IP>:3001/` in the same browser and accept only your own TV's self-signed certificate, then reconnect. If Homebrew Channel is missing after reboot, check that Quick Start+ is disabled. See the [author's troubleshooting instructions](https://github.com/azoffshowy/dangbro#troubleshooting) for other errors and limitations. If unsupported, check alternatives at [CanI.RootMy.TV](https://cani.rootmy.tv/) and [webOS Homebrew](https://www.webosbrew.org/rooting/).

Sources checked on October 27, 2026. Root does not guarantee VPN compatibility: the component installation screen checks that separately.

### Install MEDZH VPN

> **After acceptance into the Homebrew Channel catalog.** The submission to [webosbrew/apps-repo](https://github.com/webosbrew/apps-repo) is pending; until MEDZH VPN shows up in Homebrew Channel, use [manual installation](#manual-installation).

1. **Check root.** Homebrew Channel → Settings must show "Root OK" (see preparation above).
2. **Install from Homebrew Channel:** open Homebrew Channel → **MEDZH VPN** → **Install**. Homebrew Channel downloads the IPK from this project's [Releases](https://github.com/steam20011972-code/tv-vpn/releases) and checks its SHA-256 itself.
3. **Open MEDZH VPN.** Components install automatically: the app checks the TV (see below), copies the sing-box core and the controller from the package into `/media/developer/tv-vpn` (modes 0700/0600) and verifies the core hash against `core.lock.json`. If a check fails, the screen shows the error and "Check again". Autostart is off by default.
4. **Add a profile** (next section) and press the big button.

The app follows the TV's language: Russian for Russian, English otherwise.

### Updates

Homebrew Channel shows when a new version is available: open it → MEDZH VPN → **Update**. The next time you open the app it updates its components by itself; profiles and settings are kept, and a VPN that was on reconnects. The app itself does not check for new versions.

### Manual installation

Without the catalog, or to install a specific version:

1. **Download** `io.github.steam20011972-code.tvvpn_<version>_arm.ipk` and its `.sha256` from [Releases](https://github.com/steam20011972-code/tv-vpn/releases) and check it: `sha256sum -c io.github.steam20011972-code.tvvpn_<version>_arm.ipk.sha256`.
2. **Install the IPK** with [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop), with `ares-install --device <tv> <file>.ipk`, or over SSH: copy it to `/tmp/tv-vpn.ipk` and run
   `luna-send -i -f luna://com.webos.appInstallService/dev/install '{"id":"io.github.steam20011972-code.tvvpn","ipkUrl":"/tmp/tv-vpn.ipk","subscribe":true}'`.
3. **Open MEDZH VPN**: components install automatically, as above. Update the same way with a newer IPK.

### What the install screen checks

Each item is shown with a tick or a cross; any cross means VPN cannot work on that TV.

| Check | Why |
|---|---|
| Root (Homebrew Channel "Root OK") | TUN, routes and DNS need root |
| ARM processor | the bundled sing-box is `linux-armv7` |
| Node.js 14 or newer | the controller runs on the TV's built-in Node.js and uses modern syntax (`?.`) |
| `/dev/net/tun` | the tunnel device |
| `ip rule` | policy routing that sends traffic into the tunnel and keeps the LAN direct |
| `connmanctl` | reading and restoring the TV's DNS settings |

If your TV fails only the Node.js check, please open a [compatibility report](https://github.com/steam20011972-code/tv-vpn/issues/new?template=compatibility.yml): a build for older Node.js is possible if there is demand.

### Compatibility

Beta: so far confirmed on one model. Results from other TVs are welcome through the [compatibility form](https://github.com/steam20011972-code/tv-vpn/issues/new?template=compatibility.yml).

| Model | webOS | Firmware | Node.js | Result |
|---|---|---|---|---|
| LG 55UA75009LA (2025) | webOS TV Lite 10.3.1 (webOS 25) | 33.31.61 | 16.20.2 | Works: install from the app, import by QR and subscription, VLESS (Reality) and Trojan connect |

## Adding profiles

Open the profile card → "Add profile".

- **Phone (QR code).** The phone must be on the same network as the TV. Scan the code, paste a link (`vless`, `vmess`, `trojan`, `ss`, `hysteria2`, `tuic`), several links or a subscription URL, and tap "Add". The TV shows how many profiles were added and why others were rejected.
- **USB stick.** Put the text into `tv-vpn.txt` in the root of the stick (up to 64 KB), plug it into the TV and choose "Load from USB". Delete the file afterwards: it holds your access keys.
- **Subscriptions.** An `http(s)` URL returning a base64 list, a plain list of links or sing-box JSON (up to 1 MB). The subscription server and every redirect must be a public IPv4 address: addresses in your LAN, the TV itself, link-local and similar ranges are refused. The profiles screen has "Refresh" for each subscription; after a TV start, subscriptions older than a day refresh automatically. If the active profile's credentials rotate, it follows the profile with the same name.

While the QR code is shown, the TV runs a small web page on its LAN address: plain HTTP without encryption, only from private networks (10/8, 172.16/12, 192.168/16), at most 10 requests a minute, a 128-bit one-time token in the URL. It closes after the first successful import, after 5 minutes, or when you leave the screen, and it can only add profiles — no routing or settings. Do not use it on a network you do not trust; use USB instead.

## Development

Requirements: Node.js 20+, root SSH access to the TV over LAN, the TV host key in `~/.ssh/known_hosts`.

```sh
npm install
export TV_HOST=<TV IP address>
export TV_SSH_PASSWORD=<root password>   # current process environment only
```

- `npm test`; `npm run build` downloads the core pinned in `core.lock.json` (`tools/fetch-core.cjs`, SHA256-checked), builds the IPK with runtime and core, and verifies the core hash inside the package.
- Release packages are signed (Ed25519, `runtime/signature.cjs`); the TV refuses unsigned or altered packages. The build signs with `TVVPN_SIGNING_KEY`, `TVVPN_SIGNING_KEY_FILE` or `~/.tvvpn/release-signing.key`, and CI with the repository secret `TVVPN_SIGNING_KEY`. A fork needs its own key pair and public key in `runtime/signature.cjs`. To install your own unsigned build over SSH, run `setup.cjs install` with `TVVPN_ALLOW_UNSIGNED=1`.
- CI (`.github/workflows/build.yml`) runs the tests and the build on every push and pull request. A tag `vX.Y.Z` equal to the version in `app/appinfo.json` publishes a release with the IPK, its `.sha256` and the Homebrew Channel manifest (`tools/manifest.cjs`).
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

## Reporting a problem

Open an [issue](https://github.com/steam20011972-code/tv-vpn/issues/new/choose) and attach the anonymized report. Over SSH on the TV:

```sh
/usr/bin/node /media/developer/apps/usr/palm/applications/io.github.steam20011972-code.tvvpn/runtime/report.cjs
```

It only reads files and prints JSON: TV model, webOS version, the install checks, app and core versions, VPN state, protocol labels and recent event codes. Profile names, servers, links, subscription URLs, addresses, serial numbers and MACs are left out. Still look it over before posting.

## Support

MEDZH VPN is free. If it is useful to you, you can support development with a donation:

| Coin | Network | Address |
|---|---|---|
| USDT | TON | `UQBn42QVGWfeh2cD4ebmpMCT4eqLfgoeVmdk1bvXjHjUm4cg` |

Send USDT only on the **TON** network. Coins sent on another network (TRC-20, ERC-20, BEP-20 and so on) are lost.

Questions and feedback: Telegram [@medzh_vpn](https://t.me/medzh_vpn). Bugs go to [issues](https://github.com/steam20011972-code/tv-vpn/issues/new/choose); vulnerabilities only as described in [SECURITY.md](SECURITY.md), never in Telegram.

## Security

Profiles, keys and subscription URLs never go into Git, the IPK, logs or diagnostics; on the TV they are mode 0600, and import results show only counts. To report a vulnerability see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). sing-box is GPL-3.0-or-later — see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
