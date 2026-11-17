'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Preferences are account-scoped. A revision prevents an old offline retry
// from undoing a newer choice from another device.
function createMailPreferences(dataDir) {
  const file=path.join(dataDir,'mail-preferences.json');
  function read(){
    let raw;try{raw=fs.readFileSync(file,'utf8')}catch(err){if(err.code==='ENOENT')return {users:{}};throw err}
    const data=JSON.parse(raw);
    if(!data || typeof data!=='object' || !data.users || typeof data.users!=='object' || Array.isArray(data.users))throw new Error('invalid mail preference store');
    return data;
  }
  function validUser(user){return typeof user==='string'&&user.length>0&&user.length<=256&&!/[\x00-\x1f]/.test(user)}
  function get(user){
    if(!validUser(user))throw new Error('invalid user');
    const data=read(),row=Object.hasOwn(data.users,user)?data.users[user]:null;
    if(!row)return {exists:false,enabled:true,revision:0};
    if(typeof row.enabled!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.operation!=='string')throw new Error('invalid mail preference record');
    return {exists:true,enabled:row.enabled,revision:row.revision};
  }
  function set(user,enabled,expected,operation){
    if(!validUser(user)||typeof enabled!=='boolean'||!Number.isSafeInteger(expected)||expected<0||typeof operation!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(operation))throw new Error('invalid mail preference update');
    const data=read(),old=Object.hasOwn(data.users,user)?data.users[user]:null;
    if(old && (typeof old.enabled!=='boolean'||!Number.isSafeInteger(old.revision)||old.revision<1||typeof old.operation!=='string'))throw new Error('invalid mail preference record');
    const revision=old?.revision||0;
    if(old?.operation===operation) {
      if(old.enabled!==enabled||expected!==revision-1)throw new Error('operation collision');
      return {exists:true,enabled:old.enabled,revision};
    }
    if(revision!==expected)return {conflict:true,exists:!!old,enabled:old?.enabled??true,revision};
    if(revision===Number.MAX_SAFE_INTEGER)throw new Error('revision exhausted');
    Object.defineProperty(data.users,user,{value:{enabled,revision:revision+1,operation},enumerable:true,writable:true,configurable:true});
    fs.mkdirSync(dataDir,{recursive:true});const tmp=path.join(dataDir,`.mail-preferences-${process.pid}-${require('node:crypto').randomBytes(8).toString('hex')}.tmp`);
    try{const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file)}finally{try{fs.unlinkSync(tmp)}catch(err){if(err.code!=='ENOENT')throw err}}
    return {exists:true,enabled,revision:revision+1};
  }
  return {get,set};
}
module.exports={createMailPreferences};
