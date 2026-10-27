// UI strings in Russian and English. The language follows the TV's UI locale: Russian for ru, English otherwise.
// runtime/import-server.cjs keeps the phone page's own copy; test/i18n.test.cjs checks that the shared parts match.
(function(root){'use strict';
 var messages={
  ru:{
   'header.note':'ВАШЕ ПОДКЛЮЧЕНИЕ · НА ТЕЛЕВИЗОРЕ','preview':'Предпросмотр','pill.checking':'Проверяем соединение','power.connect':'Подключить VPN','power.disconnect':'Отключить VPN',
   'state.wait':'Подождите…','state.waitText':'Получаем состояние подключения','state.noProfile':'Профиль VPN ещё не загружен','profiles.aria':'Профили VPN','profile.eyebrow':'ТЕКУЩИЙ ПРОФИЛЬ',
   'profile.none':'Профиль не выбран','profile.open':'Нажмите, чтобы открыть профили','profile.protection':'Защита подключения','route.checking':'Проверяем','route.vpn':'Весь интернет ТВ','route.direct':'Обычный интернет','ms':'мс',
   'autostart.title':'Подключать автоматически','autostart.text':'При включении телевизора','diag.title':'Состояние и диагностика','diag.text':'Проверка сети и подключения',
   'restore.title':'Восстановить обычный интернет','restore.text':'Отключить VPN и вернуть настройки сети','restore.done':'VPN отключён. Возвращаем обычный интернет.',
   'footnote.fallback':'При сбое VPN обычный интернет включится автоматически.','footnote.lan':'Домашняя сеть остаётся доступна.',
   'footer.select':'Выбрать','footer.move':'Переместить фокус','footer.note':'Закрытие приложения не отключает VPN',
   'service.timeout':'Нет ответа от сервиса MEDZH VPN','service.homebrew':'Homebrew-сервис недоступен','service.controller':'Нет ответа контроллера',
   'service.down':'Сервис недоступен','service.downText':'Проверьте Homebrew Channel и установку MEDZH VPN','service.downPill':'Нет связи с сервисом',
   'setup.eyebrow':'КОМПОНЕНТЫ MEDZH VPN','setup.checking':'Проверяем телевизор…','setup.checkingText':'Проверяем Homebrew Channel и права root','setup.retry':'Проверить снова',
   'setup.unsupported':'Телевизор не поддерживается','setup.update':'Обновить компоненты','setup.install':'Установить компоненты',
   'setup.notRootText':'MEDZH VPN работает только на телевизоре с root. Откройте Homebrew Channel и убедитесь, что в настройках указано «Root OK».',
   'setup.notReadyText':'Не хватает компонентов, отмеченных ниже. VPN на этом телевизоре работать не сможет.',
   'setup.updateText':'Установлена версия {installed}. Обновляем сетевой модуль и контроллер до версии {app}. Профиль и настройки сохранятся.',
   'setup.installText':'Копируем сетевой модуль sing-box и контроллер в память телевизора. Автоподключение останется выключенным.',
   'setup.noHomebrew':'Homebrew Channel не отвечает. Установите Homebrew Channel и включите Root OK.','setup.installing':'Устанавливаем… Это займёт до минуты','setup.installed':'Компоненты MEDZH VPN установлены',
   'diag.dialog':'Диагностика','diag.connection':'Подключение','diag.autostart':'Автоподключение','diag.on':'Включено','diag.off':'Выключено','diag.check':'Проверка интернета',
   'diag.checkOk':'Проходит через VPN','diag.checkNo':'VPN не подтверждён','diag.dnsText':'Через VPN при подключении','diag.ipv6Text':'Внешний IPv6 блокируется во время VPN','diag.error':'Ошибка','diag.noError':'Нет','diag.version':'Версия приложения',
   'ok':'Понятно','cancel':'Отмена','close':'Закрыть','done':'Готово',
   'uninstall.open':'Удалить MEDZH VPN полностью','uninstall.title':'Удалить MEDZH VPN?','uninstall.keep':'Удалить, сохранить профиль','uninstall.all':'Удалить вместе с профилем',
   'uninstall.text':'VPN отключится, автозапуск и сетевой модуль будут удалены, обычный интернет восстановлен. Профиль можно сохранить на случай повторной установки.',
   'uninstall.progress':'Удаляем компоненты и восстанавливаем сеть…','uninstall.doneKept':'MEDZH VPN удалён, профиль сохранён. Иконку можно убрать из меню телевизора.','uninstall.doneAll':'MEDZH VPN удалён вместе с профилем. Иконку можно убрать из меню телевизора.',
   'profiles.title':'Профили','profiles.empty':'Профилей пока нет. Нажмите «Добавить профиль»: QR-код для телефона или файл tv-vpn.txt на USB.','profiles.current':'Текущий · ',
   'profiles.delete':'Удалить','profiles.deleteAria':'Удалить профиль {name}','profiles.add':'Добавить профиль','profiles.back':'К профилям',
   'sub.name':'Подписка {n}','sub.updated':' · обновлена {date}','sub.refresh':'Обновить','sub.refreshAria':'Обновить подписку {n}','sub.refreshing':'Обновляем подписку {n}…','sub.result':'Подписка {n}: {summary}',
   'sum.added':'добавлено {profiles}','sum.updated':'обновлено {n}','sum.removed':'удалено {n}','sum.rejected':'отклонено {n} ({reasons})','sum.none':'новых профилей нет','kind.insecure':'без проверки сертификата',
   'import.step1':'Подключите телефон к той же сети, что и телевизор','import.step2':'Наведите камеру телефона на QR-код или откройте адрес ниже','import.step3':'Вставьте ссылку (vless, vmess, trojan, ss…) или адрес подписки и нажмите «Добавить»',
   'import.done':'{summary}. Приём закрыт, можно убрать телефон.','import.waiting':'Ожидаем данные с телефона · осталось {time}','import.expired':'Время приёма истекло. Получите новый код.','import.newCode':'Новый код',
   'usb.load':'Загрузить с USB','usb.searching':'Ищем tv-vpn.txt на USB-накопителе…','usb.deleteFile':'. Удалите tv-vpn.txt с флешки: в нём ключи доступа.',
   'select.switching':'Переключаемся на профиль «{name}»','select.selected':'Выбран профиль «{name}»',
   'delete.title':'Удалить профиль?','delete.text':'Профиль «{name}» будет удалён с телевизора. Вернуть его можно только повторным импортом.','delete.done':'Профиль «{name}» удалён',
   profile:['профиль','профиля','профилей'],
   states:{disconnected:['Отключено','Нажмите кнопку, чтобы подключиться','Обычный интернет'],connecting:['Подключаемся','Проверяем сервер и настраиваем сеть','Соединяемся'],connected:['Подключено','Интернет телевизора работает через VPN','VPN активен'],fallback:['Обычный интернет','VPN недоступен. Повторим подключение автоматически','Восстановление'],disconnecting:['Отключаемся','Возвращаем обычное подключение','Подождите']},
   errors:{'connection-failed':'Не удалось подключиться к VPN','connection-lost':'Соединение с VPN потеряно','core-start-failed':'Не удалось запустить сетевой модуль','invalid-profile':'Проверьте профиль VPN','no-network':'Телевизор не подключён к сети','network-changed':'Сеть изменилась. Подключаем VPN заново','route-conflict':'Обнаружен конфликт сетевых настроек','recovery-pending':'Восстановление сети ещё выполняется','controller-error':'Ошибка управления подключением','core-stopped':'Сетевой модуль был остановлен','no-profile':'Выберите или добавьте профиль VPN','server-not-found':'Не удалось найти адрес сервера VPN'},
   setupErrors:{'not-root':'Нужен Homebrew Channel с Root OK','package-unsafe':'Файлы приложения доступны на запись не только root. Переустановите приложение','package-unsigned':'Пакет не подписан. Установите IPK со страницы Releases','package-signature':'Подпись пакета неверна. Скачайте IPK заново со страницы Releases','package-mismatch':'Файлы пакета не совпадают с подписью. Переустановите приложение','app-required':'Не указан каталог приложения','unsafe-base':'Каталог /media/developer/tv-vpn принадлежит не root. Удалите его по SSH и установите компоненты заново','not-ready':'На этом телевизоре нет нужных компонентов','recovery-pending':'Не удалось остановить текущее подключение. Попробуйте ещё раз','core-mismatch':'Файл сетевого модуля повреждён. Переустановите приложение','no-space':'Недостаточно свободного места на телевизоре','hook-conflict':'Найден чужой файл автозапуска 70-tv-vpn','uninstall-failed':'Не удалось удалить компоненты','install-failed':'Не удалось установить компоненты','invalid-action':'Команда недоступна','profile-in-use':'Это текущий профиль. Сначала выберите другой или отключите VPN','unknown-profile':'Профиль не найден','profile-store-error':'Не удалось изменить список профилей','no-network':'Телевизор не подключён к сети','import-failed':'Не удалось открыть приём профилей','usb-not-found':'На USB-накопителе нет файла tv-vpn.txt','subscription-failed':'Не удалось загрузить подписку','subscription-empty':'В подписке нет подходящих профилей','subscription-no-data':'Сервер подписки вернул пустой ответ','unknown-subscription':'Подписка не найдена'},
   reasons:{'invalid-link':'ошибка в ссылке','unsupported-protocol':'протокол пока не поддерживается','unsupported-settings':'такие настройки не поддерживаются','unsupported-by-core':'не поддерживается sing-box (xhttp, kcp и т. п.)','insecure-tls':'ссылка отключает проверку сертификата — сервер можно подменить','unrecognized-format':'непонятный формат','subscription-failed':'подписка не загрузилась','subscription-empty':'в подписке нет подходящих профилей','subscription-no-data':'сервер подписки вернул пустой ответ','too-large':'слишком много текста','too-many':'слишком много ссылок','empty':'пустой текст'},
   checks:{root:'Права root (Homebrew Channel)',arch:'Процессор ARM',node:'Node.js 14 или новее',tun:'Устройство /dev/net/tun',ip:'Маршрутизация (ip rule)',connmanctl:'Сетевой менеджер ConnMan'}
  },
  en:{
   'header.note':'YOUR CONNECTION · ON THE TV','preview':'Preview','pill.checking':'Checking connection','power.connect':'Connect VPN','power.disconnect':'Disconnect VPN',
   'state.wait':'Please wait…','state.waitText':'Getting the connection state','state.noProfile':'No VPN profile added yet','profiles.aria':'VPN profiles','profile.eyebrow':'CURRENT PROFILE',
   'profile.none':'No profile selected','profile.open':'Press to open profiles','profile.protection':'Connection protection','route.checking':'Checking','route.vpn':'All TV internet','route.direct':'Normal internet','ms':'ms',
   'autostart.title':'Connect automatically','autostart.text':'When the TV turns on','diag.title':'Status and diagnostics','diag.text':'Network and connection check',
   'restore.title':'Restore normal internet','restore.text':'Turn off VPN and restore network settings','restore.done':'VPN is off. Restoring normal internet.',
   'footnote.fallback':'If VPN fails, normal internet comes back automatically.','footnote.lan':'Your home network stays reachable.',
   'footer.select':'Select','footer.move':'Move focus','footer.note':'Closing the app does not turn off VPN',
   'service.timeout':'No response from the MEDZH VPN service','service.homebrew':'Homebrew service unavailable','service.controller':'No response from the controller',
   'service.down':'Service unavailable','service.downText':'Check Homebrew Channel and the MEDZH VPN installation','service.downPill':'No connection to the service',
   'setup.eyebrow':'MEDZH VPN COMPONENTS','setup.checking':'Checking the TV…','setup.checkingText':'Checking Homebrew Channel and root access','setup.retry':'Check again',
   'setup.unsupported':'This TV is not supported','setup.update':'Update components','setup.install':'Install components',
   'setup.notRootText':'MEDZH VPN works only on a rooted TV. Open Homebrew Channel and make sure its settings say "Root OK".',
   'setup.notReadyText':'The components marked below are missing. VPN cannot work on this TV.',
   'setup.updateText':'Version {installed} is installed. Updating the network module and controller to {app}. Profiles and settings are kept.',
   'setup.installText':'Copying the sing-box network module and the controller to the TV. Automatic connection stays off.',
   'setup.noHomebrew':'Homebrew Channel does not respond. Install Homebrew Channel and enable Root OK.','setup.installing':'Installing… This takes up to a minute','setup.installed':'MEDZH VPN components installed',
   'diag.dialog':'Diagnostics','diag.connection':'Connection','diag.autostart':'Automatic connection','diag.on':'On','diag.off':'Off','diag.check':'Internet check',
   'diag.checkOk':'Goes through VPN','diag.checkNo':'VPN not confirmed','diag.dnsText':'Through VPN while connected','diag.ipv6Text':'External IPv6 is blocked while VPN is on','diag.error':'Error','diag.noError':'None','diag.version':'App version',
   'ok':'OK','cancel':'Cancel','close':'Close','done':'Done',
   'uninstall.open':'Remove MEDZH VPN completely','uninstall.title':'Remove MEDZH VPN?','uninstall.keep':'Remove, keep profiles','uninstall.all':'Remove with profiles',
   'uninstall.text':'VPN turns off, autostart and the network module are removed, and normal internet is restored. You can keep your profiles in case you reinstall.',
   'uninstall.progress':'Removing components and restoring the network…','uninstall.doneKept':'MEDZH VPN removed, profiles kept. You can remove the icon from the TV menu.','uninstall.doneAll':'MEDZH VPN removed together with profiles. You can remove the icon from the TV menu.',
   'profiles.title':'Profiles','profiles.empty':'No profiles yet. Choose "Add profile": a QR code for your phone or a tv-vpn.txt file on USB.','profiles.current':'Current · ',
   'profiles.delete':'Delete','profiles.deleteAria':'Delete profile {name}','profiles.add':'Add profile','profiles.back':'To profiles',
   'sub.name':'Subscription {n}','sub.updated':' · updated {date}','sub.refresh':'Refresh','sub.refreshAria':'Refresh subscription {n}','sub.refreshing':'Refreshing subscription {n}…','sub.result':'Subscription {n}: {summary}',
   'sum.added':'added {profiles}','sum.updated':'updated {n}','sum.removed':'removed {n}','sum.rejected':'rejected {n} ({reasons})','sum.none':'no new profiles','kind.insecure':'no certificate check',
   'import.step1':'Connect your phone to the same network as the TV','import.step2':'Point the phone camera at the QR code or open the address below','import.step3':'Paste a link (vless, vmess, trojan, ss…) or a subscription URL and tap "Add"',
   'import.done':'{summary}. Import closed; you can put the phone away.','import.waiting':'Waiting for the phone · {time} left','import.expired':'Import time is over. Get a new code.','import.newCode':'New code',
   'usb.load':'Load from USB','usb.searching':'Looking for tv-vpn.txt on the USB drive…','usb.deleteFile':'. Delete tv-vpn.txt from the USB drive: it holds your access keys.',
   'select.switching':'Switching to profile "{name}"','select.selected':'Profile "{name}" selected',
   'delete.title':'Delete profile?','delete.text':'Profile "{name}" will be deleted from the TV. Only a new import brings it back.','delete.done':'Profile "{name}" deleted',
   profile:['profile','profiles'],
   states:{disconnected:['Disconnected','Press the button to connect','Normal internet'],connecting:['Connecting','Checking the server and setting up the network','Connecting'],connected:['Connected','The TV\'s internet goes through VPN','VPN active'],fallback:['Normal internet','VPN unavailable. Retrying automatically','Recovering'],disconnecting:['Disconnecting','Restoring the normal connection','Please wait']},
   errors:{'connection-failed':'Could not connect to VPN','connection-lost':'VPN connection lost','core-start-failed':'Could not start the network module','invalid-profile':'Check the VPN profile','no-network':'The TV is not connected to a network','network-changed':'The network changed. Reconnecting VPN','route-conflict':'Conflicting network settings found','recovery-pending':'Network recovery is still running','controller-error':'Connection controller error','core-stopped':'The network module was stopped','no-profile':'Select or add a VPN profile','server-not-found':'Could not find the VPN server address'},
   setupErrors:{'not-root':'Homebrew Channel with Root OK required','package-unsafe':'App files are writable by users other than root. Reinstall the app','package-unsigned':'The package is not signed. Install the IPK from the Releases page','package-signature':'The package signature is invalid. Download the IPK again from the Releases page','package-mismatch':'Package files do not match the signature. Reinstall the app','app-required':'The app directory was not given','unsafe-base':'/media/developer/tv-vpn is not owned by root. Remove it over SSH and install the components again','not-ready':'This TV lacks required components','recovery-pending':'Could not stop the current connection. Try again','core-mismatch':'The network module file is damaged. Reinstall the app','no-space':'Not enough free space on the TV','hook-conflict':'Found a foreign autostart file 70-tv-vpn','uninstall-failed':'Could not remove the components','install-failed':'Could not install the components','invalid-action':'Command not available','profile-in-use':'This is the current profile. Select another one or turn off VPN first','unknown-profile':'Profile not found','profile-store-error':'Could not change the profile list','no-network':'The TV is not connected to a network','import-failed':'Could not open profile import','usb-not-found':'No tv-vpn.txt file on the USB drive','subscription-failed':'Could not load the subscription','subscription-empty':'No usable profiles in the subscription','subscription-no-data':'The subscription server returned an empty response','unknown-subscription':'Subscription not found'},
   reasons:{'invalid-link':'malformed link','unsupported-protocol':'protocol not supported yet','unsupported-settings':'settings not supported','unsupported-by-core':'not supported by sing-box (xhttp, kcp, etc.)','insecure-tls':'the link turns off certificate checks: the server could be impersonated','unrecognized-format':'unrecognized format','subscription-failed':'subscription did not load','subscription-empty':'no usable profiles in the subscription','subscription-no-data':'the subscription server returned an empty response','too-large':'too much text','too-many':'too many links','empty':'empty text'},
   checks:{root:'Root access (Homebrew Channel)',arch:'ARM processor',node:'Node.js 14 or newer',tun:'/dev/net/tun device',ip:'Routing (ip rule)',connmanctl:'ConnMan network manager'}
  }
 };
 // First listed language that we have; anything else gets English. Same rule as the phone page (Accept-Language).
 function pick(list){for(var i=0;i<list.length;i++){var m=/^\s*([a-z]{2})(?![a-z])/i.exec(list[i]||'');if(m&&messages[m[1].toLowerCase()])return m[1].toLowerCase();}return 'en';}
 function create(lang){
  if(!messages[lang])lang='en';var M=messages[lang];
  function t(key,vars){var s=M[key];if(typeof s!=='string')s=messages.en[key];if(typeof s!=='string')return key;return vars?s.replace(/\{(\w+)\}/g,function(all,k){return k in vars?vars[k]:all;}):s;}
  // Russian has three plural forms (1 профиль, 2 профиля, 5 профилей), English two.
  function plural(n,key){var f=M[key],a=n%10,b=n%100;return n+' '+(f.length===2?f[n===1?0:1]:f[a===1&&b!==11?0:a>=2&&a<=4&&(b<12||b>14)?1:2]);}
  // Static markup: data-i18n sets the text, data-i18n-aria the aria-label.
  function apply(doc){
   doc.documentElement.lang=lang;
   Array.prototype.forEach.call(doc.querySelectorAll('[data-i18n]'),function(el){el.textContent=t(el.getAttribute('data-i18n'));});
   Array.prototype.forEach.call(doc.querySelectorAll('[data-i18n-aria]'),function(el){el.setAttribute('aria-label',t(el.getAttribute('data-i18n-aria')));});
  }
  return {lang:lang,locale:lang==='ru'?'ru-RU':'en-US',t:t,plural:plural,apply:apply,messages:M};
 }
 var api={messages:messages,pick:pick,create:create};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 // webOS UI locale first (webOSSystem, formerly PalmSystem), then the browser's; ?lang=xx forces a language in the preview.
 else{var nav=root.navigator||{},sys=root.webOSSystem||root.PalmSystem||{},forced=/[?&]lang=([a-z]{2})/.exec(root.location&&root.location.search||'');
  root.I18N=create(forced?forced[1]:pick([sys.locale].concat(nav.languages&&nav.languages.length?nav.languages:[nav.language])));}
})(this);
