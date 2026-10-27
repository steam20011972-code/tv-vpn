(function(){'use strict';
 var $=function(id){return document.getElementById(id);},pending=[],current={},requesting=false,demo=typeof PalmServiceBridge==='undefined',priorFocus=null,phase='checking',installing=false,autoInstall=true,demoInstalled=false;
 var L=window.I18N,t=L.t,M=L.messages,labels=M.states,errors=M.errors,setupErrors=M.setupErrors,reasons=M.reasons;
 var checkLabels=['root','arch','node','tun','ip','connmanctl'];
 // Directory of the installed app; setup.cjs ships inside it. commands.js lets only plain path characters through.
 var appDir=decodeURIComponent(location.pathname).replace(/\/[^\/]*$/,'');
 function exec(command,timeout){return new Promise(function(resolve,reject){
  var bridge=new PalmServiceBridge(),ended=false;pending.push(bridge);
  var timer=setTimeout(function(){done(Error(t('service.timeout')));},timeout);
  function done(err,value){if(ended)return;ended=true;clearTimeout(timer);pending.splice(pending.indexOf(bridge),1);err?reject(err):resolve(value);}
  bridge.onservicecallback=function(raw){try{var response=JSON.parse(raw),data;try{data=JSON.parse(response.stdoutString||'');}catch(e){data=null;}
   if(!data){var e=Error(t('service.homebrew'));e.code='no-service';throw e;}
   if(!data.ok){var f=Error(setupErrors[data.error]||data.error||t('service.controller'));f.code=data.error;throw f;}done(null,data);}catch(e){done(e);}};
  bridge.call('luna://org.webosbrew.hbchannel.service/exec',JSON.stringify({command:command}));
 });}
 var demoProfiles={active:'demo0001',items:[{id:'demo0001',name:'Amsterdam',kind:'VLESS · Reality · Vision'},{id:'demo0002',name:'Frankfurt',kind:'VLESS · Reality'}],subscriptions:[{id:'demosub01',count:2,updatedAt:Date.now()-3600000}]},demoImport={state:'idle'};
 function demoCall(action,arg){
  var p=demoProfiles,item=function(){return p.items.filter(function(x){return x.id===p.active;})[0];};
  // Preview: a phone "sends" two profiles eight seconds after the QR code appears.
  if(action==='import-begin'&&demoImport.state!=='listening'){demoImport={state:'listening',url:'http://192.168.1.20:41234/0123456789abcdef0123456789abcdef',expiresAt:Date.now()+300000,added:0,updated:0,rejected:{}};setTimeout(function(){if(demoImport.state!=='listening')return;demoImport.state='done';demoImport.added=2;demoImport.rejected={'unsupported-protocol':1};p.items.push({id:'demo'+Date.now(),name:'Helsinki',kind:'VLESS · Reality · Vision'},{id:'demo'+(Date.now()+1),name:'Warsaw',kind:'VLESS · Reality · Vision'});},8000);}
  if(action==='import-end')demoImport={state:'idle'};
  if(action==='import-usb')return Promise.reject(Error(setupErrors['usb-not-found']));
  if(action==='refresh-subscription')p.subscriptions[0].updatedAt=Date.now();
  if(action==='start')current={state:'connected',healthy:true,autostart:current.autostart,latency:48};if(action==='stop'||action==='restore-network')current.state='disconnected';if(action==='set-autostart')current.autostart=arg==='on';
  if(action==='select')p.active=arg;if(action==='delete'){if(arg===p.active&&current.state==='connected')return Promise.reject(Error(setupErrors['profile-in-use']));p.items=p.items.filter(function(x){return x.id!==arg;});if(arg===p.active)p.active=p.items.length?p.items[0].id:null;}
  var a=item();return Promise.resolve(Object.assign({ok:true,state:'disconnected',autostart:false},current,{profile:a?a.name:null,profileKind:a?a.kind:null,profiles:p,import:demoImport,result:{added:0,updated:2,removed:0,rejected:{}}}));
 }
 function call(action,arg){
  if(demo)return demoCall(action,arg);
  // Allowed actions and argument checks live in commands.js.
  var command=window.TVCommands.ctl(action,arg);if(!command)return Promise.reject(Error(setupErrors['invalid-action']));
  // USB files and subscriptions may download up to three subscriptions (15 s each).
  return exec(command,action==='import-usb'||action==='refresh-subscription'?65000:12000);
 }
 function setup(action,arg){
  // Preview: index.html#setup shows the install screen in a desktop browser; #setup-fail makes the installation fail.
  if(demo){
   if(action==='install')return new Promise(function(resolve,reject){setTimeout(function(){if(location.hash==='#setup-fail')reject(Error(setupErrors['install-failed']));else{demoInstalled=true;resolve({ok:true,ready:true,current:true,profile:true,checks:{}});}},3000);});
   return Promise.resolve(action==='status'&&/^#setup/.test(location.hash)&&!demoInstalled?{ok:true,ready:true,current:false,installed:null,appVersion:'0.2.0',checks:{root:true,arch:true,node:true,tun:true,ip:true,connmanctl:true}}:{ok:true,ready:true,current:true,profile:true,checks:{}});
  }
  // commands.js prefers the root-only installed setup.cjs; see the comment there.
  var command=window.TVCommands.setup(appDir,action,arg);if(!command)return Promise.reject(Error(setupErrors['invalid-action']));
  return exec(command,action==='status'?15000:120000);
 }
 // runtime/profiles.cjs labels a profile without certificate checks in English; show it in the TV's language.
 function kindText(k){return String(k||'').replace('No cert check',t('kind.insecure'));}
 function render(s){current=s;s.profileKind=s.profileKind&&kindText(s.profileKind);var key=s.state||'disconnected',label=labels[key]||labels.fallback;document.body.className=key;$('state-title').textContent=label[0];$('pill-text').textContent=label[2];$('state-description').textContent=errors[s.error]||(!s.profile&&key==='disconnected'?t('state.noProfile'):label[1]);$('profile').textContent=s.profile||t('profile.none');$('profile-kind').textContent=s.profileKind||t('profile.open');$('route-mode').textContent=t(key==='connected'?'route.vpn':'route.direct');$('power').setAttribute('aria-label',t(key==='connected'?'power.disconnect':'power.connect'));$('power').setAttribute('aria-busy',key==='connecting'||key==='disconnecting'?'true':'false');$('autostart').setAttribute('aria-pressed',s.autostart?'true':'false');var meta=(s.profileKind||'').toUpperCase();$('connection-meta').textContent=key==='connected'?meta+' · '+(s.latency||'—')+' '+t('ms'):meta;}
 function toast(message){$('toast').textContent=message;$('toast').hidden=false;setTimeout(function(){$('toast').hidden=true;},5000);}
 function refresh(){if(phase!=='main'||requesting||document.hidden)return;requesting=true;call('status').then(render).catch(function(){ $('state-title').textContent=t('service.down');$('state-description').textContent=t('service.downText');$('pill-text').textContent=t('service.downPill');document.body.className='fallback';}).then(function(){requesting=false;});}
 function enterMain(s){phase='main';$('setup-screen').hidden=true;$('main').hidden=false;$('power').focus();refresh();}
 // Setup screen: not root, missing TV features, or runtime absent/outdated for this app version.
 function showSetup(s,error){
  phase='setup';$('main').hidden=true;$('setup-screen').hidden=false;document.body.className='fallback';
  var c=s&&s.checks||{},list=$('setup-checks'),button=$('setup-install'),root=s&&c.root,ready=s&&s.ready,update=s&&s.installed;
  list.textContent='';
  if(s)checkLabels.forEach(function(k){var li=document.createElement('li');li.className=c[k]?'ok':'missing';li.textContent=M.checks[k];list.appendChild(li);});
  $('setup-title').textContent=!root?setupErrors['not-root']:t(!ready?'setup.unsupported':update?'setup.update':'setup.install');
  $('setup-description').textContent=error||(!root?t('setup.notRootText'):!ready?t('setup.notReadyText'):update?t('setup.updateText',{installed:s.installed.version,app:s.appVersion}):t('setup.installText'));
  // After an error the button checks again, and the check installs again.
  var canInstall=root&&ready&&!error;button.dataset.action=canInstall?'install':'check';button.textContent=canInstall?$('setup-title').textContent:t('setup.retry');button.removeAttribute('aria-busy');button.focus();
 }
 // Components install (or update after a new IPK) by themselves when the app opens; installing keeps
 // visibilitychange from starting a second run. After uninstall only the button installs them again.
 function install(){if(installing)return;installing=true;var button=$('setup-install');button.dataset.action='install';button.setAttribute('aria-busy','true');button.textContent=t('setup.installing');
  setup('install').then(function(s){toast(t('setup.installed'));enterMain(s);}).catch(function(e){return setup('status').then(function(s){showSetup(s,e.message);},function(){showSetup(null,e.message);});}).then(function(){installing=false;});}
 function check(){phase='checking';return setup('status').then(function(s){if(s.ready&&s.current)enterMain(s);else{showSetup(s);if(s.ready&&autoInstall)install();}}).catch(function(e){showSetup(null,e.code==='no-service'?t('setup.noHomebrew'):e.message);});}
 $('setup-install').onclick=function(){if(installing)return;if(this.dataset.action==='install')install();else check();};
 $('power').onclick=function(){if(requesting)return;var action=current.state==='connected'||current.state==='connecting'?'stop':'start';requesting=true;call(action).then(function(s){s.state=action==='start'?'connecting':'disconnecting';render(s);}).catch(function(e){toast(e.message);}).then(function(){requesting=false;setTimeout(refresh,1000);});};
 $('autostart').onclick=function(){call('set-autostart',current.autostart?'off':'on').then(render).catch(function(e){toast(e.message);});};
 $('restore').onclick=function(){call('restore-network').then(function(s){render(s);toast(t('restore.done'));setTimeout(refresh,1000);}).catch(function(e){toast(e.message);});};
 // dialogCleanup runs once when the current dialog is replaced or closed (the import screen stops its listener).
 var dialogCleanup=null;
 function leaveDialog(){if(dialogCleanup){var f=dialogCleanup;dialogCleanup=null;f();}}
 function dialogActions(actions){var box=$('dialog-actions');box.textContent='';actions.forEach(function(a){var b=document.createElement('button');b.className='dialog-button'+(a.kind?' '+a.kind:'');b.textContent=a.label;b.onclick=a.fn;box.appendChild(b);});box.firstChild.focus();}
 function openDialog(title,content,actions){leaveDialog();if($('dialog').hidden)priorFocus=document.activeElement;$('dialog-title').textContent=title;$('dialog-content').textContent='';$('dialog-content').appendChild(content);$('dialog').hidden=false;dialogActions(actions);}
 function closeDialog(){leaveDialog();$('dialog').hidden=true;if(priorFocus&&priorFocus.offsetParent!==null)priorFocus.focus();}
 function diagnostics(s){var rows=[[t('diag.connection'),(labels[s.state]||labels.disconnected)[0]],[t('diag.autostart'),t(s.autostart?'diag.on':'diag.off')],[t('diag.check'),t(s.healthy?'diag.checkOk':'diag.checkNo')],['DNS',t('diag.dnsText')],['IPv6',t('diag.ipv6Text')],[t('diag.error'),errors[s.error]||s.error||t('diag.noError')]];var dl=document.createElement('dl');rows.forEach(function(r){var dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=r[0];dd.textContent=r[1];dl.appendChild(dt);dl.appendChild(dd);});
  openDialog(t('diag.dialog'),dl,[{label:t('ok'),fn:closeDialog},{label:t('uninstall.open'),kind:'danger',fn:confirmUninstall}]);}
 function confirmUninstall(){var p=document.createElement('p');p.className='dialog-text';p.textContent=t('uninstall.text');
  openDialog(t('uninstall.title'),p,[{label:t('cancel'),fn:closeDialog},{label:t('uninstall.keep'),kind:'danger',fn:function(){uninstall('keep-profile');}},{label:t('uninstall.all'),kind:'danger',fn:function(){uninstall('delete-profile');}}]);}
 function uninstall(arg){phase='checking';var p=document.createElement('p');p.className='dialog-text';p.textContent=t('uninstall.progress');$('dialog-content').textContent='';$('dialog-content').appendChild(p);$('dialog-actions').textContent='';
  setup('uninstall',arg).then(function(s){autoInstall=false;$('dialog').hidden=true;showSetup(s);toast(t(s.profileRetained?'uninstall.doneKept':'uninstall.doneAll'));}).catch(function(e){$('dialog').hidden=true;phase='main';toast(e.message);refresh();});}
 // Profiles screen: OK on a profile makes it active (an active VPN reconnects with it), "Delete" asks first.
 function profilesDialog(r){
  var list=r.profiles||{items:[]},box=document.createElement('div'),focus=null;box.className='profile-list';
  if(!list.items.length){var empty=document.createElement('p');empty.className='dialog-text';empty.textContent=t('profiles.empty');box.appendChild(empty);}
  list.items.forEach(function(it){
   var row=document.createElement('div'),pick=document.createElement('button'),name=document.createElement('strong'),kind=document.createElement('small'),del=document.createElement('button'),isActive=it.id===list.active;
   row.className='profile-item'+(isActive?' active':'');pick.className='profile-pick';name.textContent=it.name;kind.textContent=(isActive?t('profiles.current'):'')+kindText(it.kind);pick.appendChild(name);pick.appendChild(kind);
   pick.onclick=function(){if(isActive)closeDialog();else selectProfile(it);};
   del.className='profile-delete';del.textContent=t('profiles.delete');del.setAttribute('aria-label',t('profiles.deleteAria',{name:it.name}));del.onclick=function(){confirmDelete(it);};
   row.appendChild(pick);row.appendChild(del);box.appendChild(row);if(isActive||!focus)focus=pick;
  });
  // Subscription URLs stay on the TV; the list only knows a count and the last update.
  (list.subscriptions||[]).forEach(function(sub,n){
   var row=document.createElement('div'),info=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small'),refresh=document.createElement('button');
   row.className='profile-item subscription';info.className='profile-pick';name.textContent=t('sub.name',{n:n+1});
   meta.textContent=L.plural(sub.count||0,'profile')+(sub.updatedAt?t('sub.updated',{date:new Date(sub.updatedAt).toLocaleString(L.locale,{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}):'');
   refresh.className='profile-refresh';refresh.textContent=t('sub.refresh');refresh.setAttribute('aria-label',t('sub.refreshAria',{n:n+1}));refresh.onclick=function(){refreshSubscription(n+1,sub.id);};
   info.appendChild(name);info.appendChild(meta);row.appendChild(info);row.appendChild(refresh);box.appendChild(row);
  });
  openDialog(t('profiles.title'),box,[{label:t('profiles.add'),fn:openImport},{label:t('close'),fn:closeDialog}]);if(focus)focus.focus();
 }
 // Import results are counters only: the runtime never returns links or names of imported profiles.
 function summary(r){
  var parts=[],keys=Object.keys(r.rejected||{}),rejected=keys.reduce(function(n,k){return n+r.rejected[k];},0);
  if(r.added)parts.push(t('sum.added',{profiles:L.plural(r.added,'profile')}));if(r.updated)parts.push(t('sum.updated',{n:r.updated}));if(r.removed)parts.push(t('sum.removed',{n:r.removed}));
  if(rejected)parts.push(t('sum.rejected',{n:rejected,reasons:keys.map(function(k){return reasons[k]||k;}).join(', ')}));
  var text=parts.join(', ')||t('sum.none');return text.charAt(0).toUpperCase()+text.slice(1);
 }
 // QR code of the one-time import address; encoding by qrcode-generator (app/vendor/qrcode.js, MIT).
 function drawQR(canvas,text){
  var q=qrcode(0,'M');q.addData(text);q.make();
  var n=q.getModuleCount(),cell=Math.max(4,Math.floor(400/(n+8))),size=cell*(n+8),g=canvas.getContext('2d');
  canvas.width=canvas.height=size;g.fillStyle='#fff';g.fillRect(0,0,size,size);g.fillStyle='#000';
  for(var r=0;r<n;r++)for(var c=0;c<n;c++)if(q.isDark(r,c))g.fillRect((c+4)*cell,(r+4)*cell,cell,cell);
 }
 // Add profile: the TV opens a LAN page for 5 minutes (QR code), polls its state every 2 s and closes it on leave.
 // Opening a new code from this screen must not send import-end, which could overtake the new import-begin.
 function openImport(){dialogCleanup=null;call('import-begin').then(function(r){render(r);importDialog(r.import||{});}).catch(function(e){toast(e.message);});}
 function importDialog(im){
  if(im.state==='failed'){toast(setupErrors[im.error]||setupErrors['import-failed']);return;}
  var box=document.createElement('div'),canvas=document.createElement('canvas'),side=document.createElement('div'),steps=document.createElement('ol'),address=document.createElement('code'),status=document.createElement('p'),shown=null,timer=null,finished=false;
  box.className='import';address.className='import-url';status.className='import-status';status.setAttribute('role','status');
  ['import.step1','import.step2','import.step3'].forEach(function(s){var li=document.createElement('li');li.textContent=t(s);steps.appendChild(li);});
  side.appendChild(steps);side.appendChild(address);side.appendChild(status);box.appendChild(canvas);box.appendChild(side);
  var waitingActions=[{label:t('done'),fn:openProfiles},{label:t('usb.load'),fn:usbImport}];
  function show(im){
   if(finished)return;
   if(im.url&&im.url!==shown){shown=im.url;address.textContent=im.url;drawQR(canvas,im.url);}
   if(im.state==='done'){finished=true;clearInterval(timer);box.className='import used';status.textContent=t('import.done',{summary:summary(im)});toast(summary(im));refresh();dialogActions([{label:t('profiles.back'),fn:openProfiles}]);}
   else if(im.state==='listening'){var left=Math.max(0,Math.round((im.expiresAt-Date.now())/1000)),seen=im.added||im.updated||Object.keys(im.rejected||{}).length;status.textContent=(seen?summary(im)+'. ':'')+t('import.waiting',{time:Math.floor(left/60)+':'+('0'+left%60).slice(-2)});}
   else if(im.state!=='starting'){finished=true;clearInterval(timer);box.className='import used';status.textContent=im.state==='failed'?setupErrors[im.error]||setupErrors['import-failed']:t('import.expired');dialogActions([{label:t('import.newCode'),fn:openImport},{label:t('usb.load'),fn:usbImport},{label:t('close'),fn:openProfiles}]);}
  }
  openDialog(t('profiles.add'),box,waitingActions);show(im);
  if(!finished)timer=setInterval(function(){call('import-status').then(function(s){show(s.import||{});}).catch(function(){});},2000);
  dialogCleanup=function(){finished=true;clearInterval(timer);call('import-end').catch(function(){});};
 }
 function usbImport(){toast(t('usb.searching'));call('import-usb').then(function(r){render(r);toast(summary(r.result)+(r.result.added||r.result.updated?t('usb.deleteFile'):''));}).catch(function(e){toast(e.message);});}
 function refreshSubscription(n,id){toast(t('sub.refreshing',{n:n}));call('refresh-subscription',id).then(function(r){render(r);toast(t('sub.result',{n:n,summary:summary(r.result).toLowerCase()}));profilesDialog(r);}).catch(function(e){toast(e.message);});}
 function openProfiles(){call('profiles').then(function(r){render(r);profilesDialog(r);}).catch(function(e){toast(e.message);});}
 function selectProfile(it){call('select',it.id).then(function(s){closeDialog();render(s);toast(t(s.desired?'select.switching':'select.selected',{name:it.name}));setTimeout(refresh,1000);}).catch(function(e){toast(e.message);});}
 function confirmDelete(it){var p=document.createElement('p');p.className='dialog-text';p.textContent=t('delete.text',{name:it.name});
  openDialog(t('delete.title'),p,[{label:t('cancel'),fn:openProfiles},{label:t('profiles.delete'),kind:'danger',fn:function(){call('delete',it.id).then(function(s){render(s);toast(t('delete.done',{name:it.name}));profilesDialog(s);}).catch(function(e){toast(e.message);openProfiles();});}}]);}
 $('profile-card').onclick=openProfiles;
 $('diagnostics').onclick=function(){call('diagnostics').then(diagnostics).catch(function(e){toast(e.message);});};
 function visible(selector){return Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function(b){return b.offsetParent!==null;});}
 // Remote arrows. Up/down: the nearest row in that direction; in it the button under the focused one,
 // otherwise the row's first button (dialog actions start with the main one). Left/right: the same row first.
 function nextFocus(buttons,active,code){
  var a=active.getBoundingClientRect(),vertical=code===38||code===40,sign=code===37||code===38?-1:1,ahead=[];
  buttons.forEach(function(b){if(b===active)return;var r=b.getBoundingClientRect(),
   along=vertical?(r.top+r.bottom-a.top-a.bottom)/2:(r.left+r.right-a.left-a.right)/2,
   perp=vertical?(r.left+r.right-a.left-a.right)/2:(r.top+r.bottom-a.top-a.bottom)/2;
   if(along*sign<=0)return;
   ahead.push({b:b,r:r,along:Math.abs(along),perp:Math.abs(perp),
    gap:Math.max(0,sign>0?(vertical?r.top-a.bottom:r.left-a.right):(vertical?a.top-r.bottom:a.left-r.right)),
    cross:vertical?Math.max(0,r.left-a.right,a.left-r.right):Math.max(0,r.top-a.bottom,a.top-r.bottom)});});
  // beyond: entirely past the focused button's edge; a partly overlapping button is not the next row or column.
  var beyond=ahead.filter(function(c){return vertical?(sign>0?c.r.top>=a.bottom-4:c.r.bottom<=a.top+4):(sign>0?c.r.left>=a.right-4:c.r.right<=a.left+4);});
  if(vertical&&beyond.length){
   var row=Math.min.apply(null,beyond.map(function(c){return c.gap;})),inRow=beyond.filter(function(c){return c.gap<=row+8;});
   var under=inRow.filter(function(c){return c.cross===0;}).sort(function(x,y){return Math.abs(x.r.left-a.left)-Math.abs(y.r.left-a.left);});
   return (under[0]||inRow.sort(function(x,y){return x.r.left-y.r.left;})[0]).b;
  }
  var same=vertical?[]:ahead.filter(function(c){return c.cross===0;});
  if(same.length)return same.sort(function(x,y){return x.gap-y.gap||x.perp-y.perp;})[0].b;
  var pool=vertical?ahead:beyond;
  return pool.length?pool.sort(function(x,y){return x.along+x.perp*2-y.along-y.perp*2;})[0].b:null;
 }
 document.addEventListener('keydown',function(e){var code=e.keyCode,dialogOpen=!$('dialog').hidden;if(code===461||code===27){if(dialogOpen){e.preventDefault();if($('dialog-actions').firstChild)closeDialog();}else if(window.webOS&&webOS.platformBack)webOS.platformBack();else if(window.PalmSystem&&PalmSystem.platformBack)PalmSystem.platformBack();else window.close();return;}if([37,38,39,40].indexOf(code)<0)return;e.preventDefault();var buttons=visible(dialogOpen?'#dialog button':'.shell main button'),active=document.activeElement;if(!buttons.length)return;if(buttons.indexOf(active)<0){buttons[0].focus();return;}var best=nextFocus(buttons,active,code);if(best)best.focus();});
 // Leaving the app (Home) while the QR code is shown also closes the phone page.
 document.addEventListener('visibilitychange',function(){if(document.hidden&&dialogCleanup&&!$('dialog').hidden)closeDialog();if(phase==='main')refresh();else if(phase==='setup'&&!document.hidden&&!installing)check();});
 L.apply(document);$('preview').hidden=!demo;check();setInterval(refresh,4000);
})();
