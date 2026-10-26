'use strict';
// Profile store: BASE/profiles/<id>.json (0600) and BASE/profiles/index.json {active,items[],subscriptions[]}.
// index.json and list() hold no secrets: only id, name and a protocol label.
// A BASE/profile.json (older runtime, or tools/stage.cjs) is moved into the store and becomes active.
const crypto=require('crypto'),C=require('./common.cjs');
const DIR=C.BASE+'/profiles',ID=/^[a-z0-9]{8,16}$/;
function kind(o){return [String(o.type||'').toUpperCase(),o.tls&&o.tls.reality&&o.tls.reality.enabled?'Reality':o.tls&&o.tls.enabled?'TLS':null,o.flow==='xtls-rprx-vision'?'Vision':null].filter(Boolean).join(' · ');}
function valid(p){return !!(p&&typeof p.name==='string'&&p.outbound&&p.outbound.type&&p.outbound.server);}
function index(){const i=C.read('profiles/index.json');return i&&Array.isArray(i.items)?i:{active:null,items:[],subscriptions:[]};}
function save(i){C.fs.mkdirSync(DIR,{recursive:true,mode:0o700});C.write('profiles/index.json',i);}
// Same outbound gives the same id, so a re-import or an interrupted migration does not duplicate.
function add(profile,subscription=null){
 if(!valid(profile))throw Error('invalid-profile');
 const id=crypto.createHash('sha256').update(JSON.stringify(profile.outbound)).digest('hex').slice(0,12);
 C.fs.mkdirSync(DIR,{recursive:true,mode:0o700});C.write('profiles/'+id+'.json',profile);
 const i=index(),item={id,name:profile.name,kind:kind(profile.outbound),subscription};
 const at=i.items.findIndex(x=>x.id===id);if(at<0)i.items.push(item);else i.items[at]=item;
 if(!i.active)i.active=id;save(i);return id;
}
function migrate(){
 const legacy=C.read('profile.json');if(!valid(legacy))return;
 const id=add(legacy),i=index();i.active=id;save(i);
 C.fs.unlinkSync(C.BASE+'/profile.json');C.log('profile-migrated');
}
function list(){migrate();const i=index();return {active:i.active,items:i.items.map(x=>({id:x.id,name:x.name,kind:x.kind,subscription:!!x.subscription}))};}
function active(){migrate();const i=index();return i.active?C.read('profiles/'+i.active+'.json'):null;}
function activeItem(){const i=list();return i.items.find(x=>x.id===i.active)||null;}
function select(id){if(!ID.test(String(id)))return false;const i=index();if(!i.items.some(x=>x.id===id))return false;i.active=id;save(i);return true;}
function remove(id){
 if(!ID.test(String(id)))return false;const i=index();if(!i.items.some(x=>x.id===id))return false;
 i.items=i.items.filter(x=>x.id!==id);if(i.active===id)i.active=i.items.length?i.items[0].id:null;save(i);
 try{C.fs.unlinkSync(DIR+'/'+id+'.json');}catch{}return true;
}
module.exports={ID,kind,add,migrate,list,active,activeItem,select,remove};
