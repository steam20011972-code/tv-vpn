# TV VPN

**Нужен телевизор LG webOS с root и Homebrew Channel в состоянии «Root OK».** Без root приложение работать не может: webOS не даёт обычным приложениям создавать TUN, менять маршруты и DNS.

[English](README.md)

VPN-клиент для LG webOS на основе [sing-box](https://github.com/SagerNet/sing-box) (ARMv7) и небольшого контроллера на Node.js, который уже есть на ТВ. Приложение **TV VPN** включает и выключает VPN для всего телевизора, восстанавливает обычную сеть при сбое и умеет подключаться автоматически при включении ТВ.

> **Статус: ранняя версия для разработчиков.** Проверено на одной модели (LG 55UA75009LA, webOS 25). Сейчас установка выполняется с ПК по SSH; установка из самого приложения и импорт профиля по QR — в работе.

## Дисклеймер

- Программа предоставляется «как есть», без каких-либо гарантий (см. [LICENSE](LICENSE)).
- Root и изменение сетевых настроек ТВ — на ваш риск. Проект не трогает прошивку и системные разделы, но ошибка в сетевых настройках может временно оставить ТВ без интернета (см. «Восстановление сети»).
- Нужен **собственный** VPN-сервер или профиль, которым вы вправе пользоваться. Проект не предоставляет серверов.
- Соблюдайте законы своей страны.

## Что поддерживается сейчас

- Профиль: `vless://` с TCP / Reality / Vision (`flow=xtls-rprx-vision`, `encryption=none`). Другие протоколы — в планах.
- Весь IPv4-трафик ТВ идёт через VPN, DNS — через DoH внутри туннеля. Внешний IPv6 во время VPN блокируется. Локальная сеть доступна.
- Если сервер недоступен, контроллер возвращает обычную сеть и повторяет подключение с паузами до 5 минут. Отдельный watchdog восстанавливает сеть, если контроллер завис.

## Установка (для разработчиков)

Нужны: Node.js 18+, `tar`, SSH-доступ root к ТВ по LAN, ключ ТВ в `~/.ssh/known_hosts`.

```sh
npm install
export TV_HOST=<IP телевизора>
export TV_SSH_PASSWORD=<пароль root>   # только в окружении текущего процесса
```

1. Скачайте ядро [sing-box-1.14.3-linux-armv7.tar.gz](https://github.com/SagerNet/sing-box/releases/download/v1.14.3/sing-box-1.14.3-linux-armv7.tar.gz) в `downloads/`, проверьте SHA256 из [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) и распакуйте.
2. `node tools/tv.cjs exec "mkdir -p /media/developer/tv-vpn/bin; chmod 700 /media/developer/tv-vpn"`
3. `node tools/tv.cjs upload downloads/sing-box-1.14.3-linux-armv7/sing-box /media/developer/tv-vpn/bin/sing-box 700`
4. Профиль: `TVVPN_PROFILE_FILE=путь/к/файлу node tools/stage.cjs` или передайте ссылку через stdin. Файл со ссылкой храните вне репозитория и удалите после импорта.
5. `node tools/deploy-runtime.cjs`, затем `npm test` и `npm run build`.
6. `node tools/install-app.cjs` — установить IPK и открыть приложение.
7. Проверьте ручное подключение. Автозапуск: `node tools/set-autostart.cjs on`.

## Управление

Большая кнопка включает/выключает VPN. Стрелки — фокус, OK — выбор, Back — закрыть диагностику или приложение. «Подключать автоматически» относится к включению ТВ. Закрытие приложения не разрывает соединение.

## Восстановление сети

По SSH на ТВ:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs restore-network
```

Если контроллер не отвечает:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/recover.cjs
```

Отключить автозапуск навсегда:

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs set-autostart off
/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs stop
```

## Удаление

```sh
/usr/bin/node /media/developer/tv-vpn/runtime/uninstall.cjs
```

Скрипт отключает автозапуск, завершает свои процессы, восстанавливает DNS и маршруты и удаляет компоненты. Профиль остаётся (права 0600); чтобы удалить и его, добавьте `--delete-profile`. Затем удалите значок TV VPN через меню приложений ТВ.

## Безопасность

Профиль и ключи не попадают в Git, IPK, логи и диагностику; на ТВ файлы имеют права 0600. Об уязвимостях — см. [SECURITY.md](SECURITY.md).

## Лицензия

MIT — см. [LICENSE](LICENSE). sing-box распространяется под GPL-3.0-or-later — см. [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
