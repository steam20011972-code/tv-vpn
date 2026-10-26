(function(){'use strict';
 var $=function(id){return document.getElementById(id);},pending=[],current={},requesting=false,demo=typeof PalmServiceBridge==='undefined',priorFocus=null,phase='checking';
 var labels={disconnected:['Отключено','Нажмите кнопку, чтобы подключиться','Обычный интернет'],connecting:['Подключаемся','Проверяем сервер и настраиваем сеть','Соединяемся'],connected:['Подключено','Интернет телевизора работает через VPN','VPN активен'],fallback:['Обычный интернет','VPN недоступен. Повторим подключение автоматически','Восстановление'],disconnecting:['Отключаемся','Возвращаем обычное подключение','Подождите']};
 var errors={'connection-failed':'Не удалось подключиться к VPN','connection-lost':'Соединение с VPN потеряно','core-start-failed':'Не удалось запустить сетевой модуль','invalid-profile':'Проверьте профиль VPN','no-network':'Телевизор не подключён к сети','network-changed':'Сеть изменилась. Подключаем VPN заново','route-conflict':'Обнаружен конфликт сетевых настроек','recovery-pending':'Восстановление сети ещё выполняется','controller-error':'Ошибка управления подключением','core-stopped':'Сетевой модуль был остановлен','no-profile':'Выберите или добавьте профиль VPN'};
 var setupErrors={'not-root':'Нужен Homebrew Channel с Root OK','not-ready':'На этом телевизоре нет нужных компонентов','recovery-pending':'Не удалось остановить текущее подключение. Попробуйте ещё раз','core-mismatch':'Файл сетевого модуля повреждён. Переустановите приложение','no-space':'Недостаточно свободного места на телевизоре','hook-conflict':'Найден чужой файл автозапуска 70-tv-vpn','uninstall-failed':'Не удалось удалить компоненты','install-failed':'Не удалось установить компоненты','invalid-action':'Команда недоступна','profile-in-use':'Это текущий профиль. Сначала выберите другой или отключите VPN','unknown-profile':'Профиль не найден','profile-store-error':'Не удалось изменить список профилей'};
 var checkLabels=[['root','Права root (Homebrew Channel)'],['arch','Процессор ARM'],['node','Node.js 14 или новее'],['tun','Устройство /dev/net/tun'],['ip','Маршрутизация (ip rule)'],['connmanctl','Сетевой менеджер ConnMan']];
 // Directory of the installed app; setup.cjs ships inside it. Only plain path characters reach the exec command line.
 var appDir=decodeURIComponent(location.pathname).replace(/\/[^\/]*$/,'');
 function exec(command,timeout){return new Promise(function(resolve,reject){
  var bridge=new PalmServiceBridge(),ended=false;pending.push(bridge);
  var timer=setTimeout(function(){done(Error('Нет ответа от сервиса MEDZH VPN'));},timeout);
  function done(err,value){if(ended)return;ended=true;clearTimeout(timer);pending.splice(pending.indexOf(bridge),1);err?reject(err):resolve(value);}
  bridge.onservicecallback=function(raw){try{var response=JSON.parse(raw),data;try{data=JSON.parse(response.stdoutString||'');}catch(e){data=null;}
   if(!data){var e=Error('Homebrew-сервис недоступен');e.code='no-service';throw e;}
   if(!data.ok){var f=Error(setupErrors[data.error]||data.error||'Нет ответа контроллера');f.code=data.error;throw f;}done(null,data);}catch(e){done(e);}};
  bridge.call('luna://org.webosbrew.hbchannel.service/exec',JSON.stringify({command:command}));
 });}
 var demoProfiles={active:'demo0001',items:[{id:'demo0001',name:'Мой VPN',kind:'VLESS · Reality · Vision'},{id:'demo0002',name:'Резервный',kind:'VLESS · Reality'}]};
 function demoCall(action,arg){
  var p=demoProfiles,item=function(){return p.items.filter(function(x){return x.id===p.active;})[0];};
  if(action==='start')current={state:'connected',healthy:true,autostart:current.autostart,latency:48};if(action==='stop'||action==='restore-network')current.state='disconnected';if(action==='set-autostart')current.autostart=arg==='on';
  if(action==='select')p.active=arg;if(action==='delete'){if(arg===p.active&&current.state==='connected')return Promise.reject(Error(setupErrors['profile-in-use']));p.items=p.items.filter(function(x){return x.id!==arg;});if(arg===p.active)p.active=p.items.length?p.items[0].id:null;}
  var a=item();return Promise.resolve(Object.assign({ok:true,state:'disconnected',autostart:false},current,{profile:a?a.name:null,profileKind:a?a.kind:null,profiles:p}));
 }
 function call(action,arg){
  if(demo)return demoCall(action,arg);
  var allowed=['start','stop','status','set-autostart','diagnostics','restore-network','profiles','select','delete'];
  // Profile ids are the only free-form argument and are checked as strictly as in runtime/ctl.cjs.
  if(allowed.indexOf(action)<0||(action==='set-autostart'?['on','off'].indexOf(arg)<0:action==='select'||action==='delete'?!/^[a-z0-9]{8,16}$/.test(arg||''):!!arg))return Promise.reject(Error('Команда недоступна'));
  return exec('/usr/bin/node /media/developer/tv-vpn/runtime/ctl.cjs '+action+(arg?' '+arg:''),12000);
 }
 function setup(action,arg){
  // Preview: index.html#setup shows the install screen in a desktop browser.
  if(demo)return Promise.resolve(action==='status'&&location.hash==='#setup'?{ok:true,ready:true,current:false,installed:null,appVersion:'0.2.0',checks:{root:true,arch:true,node:true,tun:true,ip:true,connmanctl:true}}:{ok:true,ready:true,current:true,profile:true,checks:{}});
  if(['status','install','uninstall'].indexOf(action)<0||arg&&['keep-profile','delete-profile'].indexOf(arg)<0||!/^\/[A-Za-z0-9._\/-]+$/.test(appDir))return Promise.reject(Error('Команда недоступна'));
  return exec('/usr/bin/node '+appDir+'/runtime/setup.cjs '+action+(arg?' '+arg:''),action==='status'?15000:120000);
 }
 function render(s){current=s;var key=s.state||'disconnected',label=labels[key]||labels.fallback;document.body.className=key;$('state-title').textContent=label[0];$('pill-text').textContent=label[2];$('state-description').textContent=errors[s.error]||(!s.profile&&key==='disconnected'?'Профиль VPN ещё не загружен':label[1]);$('profile').textContent=s.profile||'Профиль не выбран';$('profile-kind').textContent=s.profileKind||'Нажмите, чтобы открыть профили';$('route-mode').textContent=key==='connected'?'Весь интернет ТВ':'Обычный интернет';$('power').setAttribute('aria-label',key==='connected'?'Отключить VPN':'Подключить VPN');$('power').setAttribute('aria-busy',key==='connecting'||key==='disconnecting'?'true':'false');$('autostart').setAttribute('aria-pressed',s.autostart?'true':'false');var meta=(s.profileKind||'').toUpperCase();$('connection-meta').textContent=key==='connected'?meta+' · '+(s.latency||'—')+' мс':meta;}
 function toast(message){$('toast').textContent=message;$('toast').hidden=false;setTimeout(function(){$('toast').hidden=true;},5000);}
 function refresh(){if(phase!=='main'||requesting||document.hidden)return;requesting=true;call('status').then(render).catch(function(){ $('state-title').textContent='Сервис недоступен';$('state-description').textContent='Проверьте Homebrew Channel и установку MEDZH VPN';$('pill-text').textContent='Нет связи с сервисом';document.body.className='fallback';}).then(function(){requesting=false;});}
 function enterMain(s){phase='main';$('setup-screen').hidden=true;$('main').hidden=false;$('power').focus();refresh();}
 // Setup screen: not root, missing TV features, or runtime absent/outdated for this app version.
 function showSetup(s,error){
  phase='setup';$('main').hidden=true;$('setup-screen').hidden=false;document.body.className='fallback';
  var c=s&&s.checks||{},list=$('setup-checks'),button=$('setup-install'),root=s&&c.root,ready=s&&s.ready,update=s&&s.installed;
  list.textContent='';
  if(s)checkLabels.forEach(function(k){var li=document.createElement('li');li.className=c[k[0]]?'ok':'missing';li.textContent=(c[k[0]]?'✓ ':'✗ ')+k[1];list.appendChild(li);});
  $('setup-title').textContent=!root?'Нужен Homebrew Channel с Root OK':!ready?'Телевизор не поддерживается':update?'Обновить компоненты':'Установить компоненты';
  $('setup-description').textContent=error||(!root?'MEDZH VPN работает только на телевизоре с root. Откройте Homebrew Channel и убедитесь, что в настройках указано «Root OK».':!ready?'Не хватает компонентов, отмеченных ниже. VPN на этом телевизоре работать не сможет.':update?'Установлена версия '+s.installed.version+'. Обновим сетевой модуль и контроллер до версии '+s.appVersion+'. Профиль и настройки сохранятся.':'Скопируем сетевой модуль sing-box и контроллер в память телевизора. Автоподключение останется выключенным.');
  button.dataset.action=root&&ready?'install':'check';button.textContent=root&&ready?$('setup-title').textContent:'Проверить снова';button.removeAttribute('aria-busy');button.focus();
 }
 function check(){phase='checking';return setup('status').then(function(s){if(s.ready&&s.current)enterMain(s);else showSetup(s);}).catch(function(e){showSetup(null,e.code==='no-service'?'Homebrew Channel не отвечает. Установите Homebrew Channel и включите Root OK.':e.message);});}
 $('setup-install').onclick=function(){var button=this;if(button.getAttribute('aria-busy')==='true')return;if(button.dataset.action!=='install'){check();return;}
  button.setAttribute('aria-busy','true');button.textContent='Устанавливаем… Это займёт до минуты';
  setup('install').then(function(s){toast('Компоненты MEDZH VPN установлены');enterMain(s);}).catch(function(e){setup('status').then(function(s){showSetup(s,e.message);},function(){showSetup(null,e.message);});});};
 $('power').onclick=function(){if(requesting)return;var action=current.state==='connected'||current.state==='connecting'?'stop':'start';requesting=true;call(action).then(function(s){s.state=action==='start'?'connecting':'disconnecting';render(s);}).catch(function(e){toast(e.message);}).then(function(){requesting=false;setTimeout(refresh,1000);});};
 $('autostart').onclick=function(){call('set-autostart',current.autostart?'off':'on').then(render).catch(function(e){toast(e.message);});};
 $('restore').onclick=function(){call('restore-network').then(function(s){render(s);toast('VPN отключён. Возвращаем обычный интернет.');setTimeout(refresh,1000);}).catch(function(e){toast(e.message);});};
 function openDialog(title,content,actions){if($('dialog').hidden)priorFocus=document.activeElement;$('dialog-title').textContent=title;$('dialog-content').textContent='';$('dialog-content').appendChild(content);var box=$('dialog-actions');box.textContent='';actions.forEach(function(a){var b=document.createElement('button');b.className='dialog-button'+(a.kind?' '+a.kind:'');b.textContent=a.label;b.onclick=a.fn;box.appendChild(b);});$('dialog').hidden=false;box.firstChild.focus();}
 function closeDialog(){$('dialog').hidden=true;if(priorFocus&&priorFocus.offsetParent!==null)priorFocus.focus();}
 function diagnostics(s){var rows=[['Подключение',(labels[s.state]||labels.disconnected)[0]],['Автоподключение',s.autostart?'Включено':'Выключено'],['Проверка интернета',s.healthy?'Проходит через VPN':'VPN не подтверждён'],['DNS','Через VPN при подключении'],['IPv6','Внешний IPv6 блокируется во время VPN'],['Ошибка',errors[s.error]||s.error||'Нет']];var dl=document.createElement('dl');rows.forEach(function(r){var dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=r[0];dd.textContent=r[1];dl.appendChild(dt);dl.appendChild(dd);});
  openDialog('Диагностика',dl,[{label:'Понятно',fn:closeDialog},{label:'Удалить MEDZH VPN полностью',kind:'danger',fn:confirmUninstall}]);}
 function confirmUninstall(){var p=document.createElement('p');p.className='dialog-text';p.textContent='VPN отключится, автозапуск и сетевой модуль будут удалены, обычный интернет восстановлен. Профиль можно сохранить на случай повторной установки.';
  openDialog('Удалить MEDZH VPN?',p,[{label:'Отмена',fn:closeDialog},{label:'Удалить, сохранить профиль',kind:'danger',fn:function(){uninstall('keep-profile');}},{label:'Удалить вместе с профилем',kind:'danger',fn:function(){uninstall('delete-profile');}}]);}
 function uninstall(arg){phase='checking';var p=document.createElement('p');p.className='dialog-text';p.textContent='Удаляем компоненты и восстанавливаем сеть…';$('dialog-content').textContent='';$('dialog-content').appendChild(p);$('dialog-actions').textContent='';
  setup('uninstall',arg).then(function(s){$('dialog').hidden=true;showSetup(s);toast('MEDZH VPN удалён'+(s.profileRetained?', профиль сохранён':' вместе с профилем')+'. Иконку можно убрать из меню телевизора.');}).catch(function(e){$('dialog').hidden=true;phase='main';toast(e.message);refresh();});}
 // Profiles screen: OK on a profile makes it active (an active VPN reconnects with it), "Удалить" asks first.
 function profilesDialog(r){
  var list=r.profiles||{items:[]},box=document.createElement('div'),focus=null;box.className='profile-list';
  if(!list.items.length){var empty=document.createElement('p');empty.className='dialog-text';empty.textContent='Профилей пока нет. Добавление профиля по QR-коду появится в следующей версии.';box.appendChild(empty);}
  list.items.forEach(function(it){
   var row=document.createElement('div'),pick=document.createElement('button'),name=document.createElement('strong'),kind=document.createElement('small'),del=document.createElement('button'),isActive=it.id===list.active;
   row.className='profile-item'+(isActive?' active':'');pick.className='profile-pick';name.textContent=it.name;kind.textContent=(isActive?'Текущий · ':'')+(it.kind||'');pick.appendChild(name);pick.appendChild(kind);
   pick.onclick=function(){if(isActive)closeDialog();else selectProfile(it);};
   del.className='profile-delete';del.textContent='Удалить';del.setAttribute('aria-label','Удалить профиль '+it.name);del.onclick=function(){confirmDelete(it);};
   row.appendChild(pick);row.appendChild(del);box.appendChild(row);if(isActive||!focus)focus=pick;
  });
  openDialog('Профили',box,[{label:'Закрыть',fn:closeDialog}]);if(focus)focus.focus();
 }
 function openProfiles(){call('profiles').then(function(r){render(r);profilesDialog(r);}).catch(function(e){toast(e.message);});}
 function selectProfile(it){call('select',it.id).then(function(s){closeDialog();render(s);toast((s.desired?'Переключаемся на профиль «':'Выбран профиль «')+it.name+'»');setTimeout(refresh,1000);}).catch(function(e){toast(e.message);});}
 function confirmDelete(it){var p=document.createElement('p');p.className='dialog-text';p.textContent='Профиль «'+it.name+'» будет удалён с телевизора. Вернуть его можно только повторным импортом.';
  openDialog('Удалить профиль?',p,[{label:'Отмена',fn:openProfiles},{label:'Удалить',kind:'danger',fn:function(){call('delete',it.id).then(function(s){render(s);toast('Профиль «'+it.name+'» удалён');profilesDialog(s);}).catch(function(e){toast(e.message);openProfiles();});}}]);}
 $('profile-card').onclick=openProfiles;
 $('diagnostics').onclick=function(){call('diagnostics').then(diagnostics).catch(function(e){toast(e.message);});};
 function visible(selector){return Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function(b){return b.offsetParent!==null;});}
 document.addEventListener('keydown',function(e){var code=e.keyCode,dialogOpen=!$('dialog').hidden;if(code===461||code===27){if(dialogOpen){e.preventDefault();if($('dialog-actions').firstChild)closeDialog();}else if(window.webOS&&webOS.platformBack)webOS.platformBack();else if(window.PalmSystem&&PalmSystem.platformBack)PalmSystem.platformBack();else window.close();return;}if([37,38,39,40].indexOf(code)<0)return;e.preventDefault();var buttons=visible(dialogOpen?'#dialog button':'.shell main button'),active=document.activeElement;if(!buttons.length)return;if(buttons.indexOf(active)<0){buttons[0].focus();return;}var a=active.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2,best=null,score=Infinity;buttons.forEach(function(b){if(b===active)return;var r=b.getBoundingClientRect(),dx=r.left+r.width/2-ax,dy=r.top+r.height/2-ay;var primary=code===37?-dx:code===39?dx:code===38?-dy:dy,secondary=code===37||code===39?Math.abs(dy):Math.abs(dx);if(primary>0){var n=primary+secondary*2;if(n<score){score=n;best=b;}}});if(best)best.focus();});
 document.addEventListener('visibilitychange',function(){if(phase==='main')refresh();else if(phase==='setup'&&!document.hidden&&$('setup-install').getAttribute('aria-busy')!=='true')check();});
 $('preview').hidden=!demo;check();setInterval(refresh,4000);
})();
