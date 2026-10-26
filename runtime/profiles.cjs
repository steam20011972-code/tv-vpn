'use strict';
// Profile store: BASE/profiles/<id>.json (0600) and BASE/profiles/index.json {active,items[],subscriptions[]}.
// index.json and list() hold no secrets: only ids, names, protocol labels and subscription counters.
// A subscription URL carries an access token, so it lives in its own 0600 file BASE/profiles/sub-<id>.json.
// A BASE/profile.json (older runtime, or tools/stage.cjs) is moved into the store and becomes active.
const crypto=require('crypto'),C=require('./common.cjs');
const DIR=C.BASE+'/profiles',ID=/^[a-z0-9]{8,16}$/;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,12);
const NAMES={vless:'VLESS',vmess:'VMess',trojan:'Trojan',shadowsocks:'Shadowsocks',hysteria2:'Hysteria2',tuic:'TUIC'},TRANSPORTS={ws:'WS',grpc:'gRPC',httpupgrade:'HTTPUpgrade'};
// QUIC protocols always use TLS, so only TCP-based ones name it.
function kind(o){const quic=['hysteria2','tuic'].includes(o.type);return [NAMES[o.type]||String(o.type||'').toUpperCase(),o.tls&&o.tls.reality&&o.tls.reality.enabled?'Reality':o.tls&&o.tls.enabled&&!quic?'TLS':null,o.transport&&TRANSPORTS[o.transport.type],o.flow==='xtls-rprx-vision'?'Vision':null].filter(Boolean).join(' · ');}
function valid(p){return !!(p&&typeof p.name==='string'&&p.outbound&&p.outbound.type&&p.outbound.server);}
function index(){const i=C.read('profiles/index.json');if(!i||!Array.isArray(i.items))return {active:null,items:[],subscriptions:[]};if(!Array.isArray(i.subscriptions))i.subscriptions=[];return i;}
function save(i){C.fs.mkdirSync(DIR,{recursive:true,mode:0o700});C.write('profiles/index.json',i);}
function drop(i,id){i.items=i.items.filter(x=>x.id!==id);try{C.fs.unlinkSync(DIR+'/'+id+'.json');}catch{}}
// Same outbound gives the same id, so a re-import or an interrupted migration does not duplicate.
// Writes the profiles and upserts their items; a manual add keeps an existing subscription link.
function put(i,profiles,subscription){
 C.fs.mkdirSync(DIR,{recursive:true,mode:0o700});const ids=[];let created=0;
 for(const profile of profiles){
  if(!valid(profile))throw Error('invalid-profile');
  const id=hash(JSON.stringify(profile.outbound));C.write('profiles/'+id+'.json',profile);
  const at=i.items.findIndex(x=>x.id===id),item={id,name:profile.name,kind:kind(profile.outbound),subscription:subscription||(at<0?null:i.items[at].subscription)};
  if(at<0){i.items.push(item);created++;}else i.items[at]=item;ids.push(id);
 }
 if(!i.active&&ids.length)i.active=ids[0];
 return {ids:[...new Set(ids)],created};
}
function add(profile,subscription=null){const i=index(),{ids}=put(i,[profile],subscription);save(i);return ids[0];}
function addMany(profiles){const i=index(),{ids,created}=put(i,profiles,null);save(i);return {added:created,updated:ids.length-created};}
function migrate(){
 const legacy=C.read('profile.json');if(!valid(legacy))return;
 const id=add(legacy),i=index();i.active=id;save(i);
 C.fs.unlinkSync(C.BASE+'/profile.json');C.log('profile-migrated');
}
function list(){
 migrate();const i=index();
 return {active:i.active,items:i.items.map(x=>({id:x.id,name:x.name,kind:x.kind,subscription:!!x.subscription})),subscriptions:i.subscriptions.map(s=>({id:s.id,count:s.count,updatedAt:s.updatedAt}))};
}
function active(){migrate();const i=index();return i.active?C.read('profiles/'+i.active+'.json'):null;}
function activeItem(){const i=list();return i.items.find(x=>x.id===i.active)||null;}
function select(id){if(!ID.test(String(id)))return false;const i=index();if(!i.items.some(x=>x.id===id))return false;i.active=id;save(i);return true;}
// Removing the last profile of a subscription removes the subscription too.
function remove(id){
 if(!ID.test(String(id)))return false;const i=index(),item=i.items.find(x=>x.id===id);if(!item)return false;
 drop(i,id);if(i.active===id)i.active=i.items.length?i.items[0].id:null;
 if(item.subscription&&!i.items.some(x=>x.subscription===item.subscription)){i.subscriptions=i.subscriptions.filter(s=>s.id!==item.subscription);try{C.fs.unlinkSync(DIR+'/sub-'+item.subscription+'.json');}catch{}}
 save(i);return true;
}
function subscriptionUrl(id){if(!ID.test(String(id)))return null;const s=C.read('profiles/sub-'+id+'.json');return s&&typeof s.url==='string'?s.url:null;}
// Stores a subscription's fresh profile list. Profiles that left the subscription are removed, except the active one:
// it moves to a fresh profile with the same name (rotated credentials) or stays as it is.
function replace(url,profiles){
 const sub=hash(url),i=index();
 C.fs.mkdirSync(DIR,{recursive:true,mode:0o700});C.write('profiles/sub-'+sub+'.json',{url});
 const before=i.active,{ids,created}=put(i,profiles,sub),fresh=new Set(ids);let removed=0;
 for(const old of i.items.filter(x=>x.subscription===sub&&!fresh.has(x.id))){
  if(old.id===i.active){const twin=i.items.find(x=>fresh.has(x.id)&&x.name===old.name);if(!twin)continue;i.active=twin.id;}
  drop(i,old.id);removed++;
 }
 const record={id:sub,count:i.items.filter(x=>x.subscription===sub).length,updatedAt:Date.now()},at=i.subscriptions.findIndex(s=>s.id===sub);
 if(at<0)i.subscriptions.push(record);else i.subscriptions[at]=record;
 save(i);
 return {subscription:sub,added:created,updated:ids.length-created,removed,activeChanged:!!before&&before!==i.active};
}
function subscriptions(){return index().subscriptions;}
module.exports={ID,kind,add,addMany,migrate,list,active,activeItem,select,remove,subscriptionUrl,replace,subscriptions};
