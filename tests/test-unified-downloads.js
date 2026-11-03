const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const project = require('../source/src/unified-downloads');
const completedFiles = require('../source/src/download-file-status');
const native = [{id:42,filename:'Episode 1',status:'pending',cancelSource:{private:true}}, {id:'retry',status:'failed',retryAt:123,error:'temporary'}, {id:'done',status:'completed'}];
const projected = project(native);
assert.equal(projected[0].id,'native:42'); assert.equal(projected[0].status,'queued');
assert.equal(projected[1].status,'retrying'); assert.equal(projected[2].status,'completed');
assert.equal(projected[0].cancelSource,undefined); projected[0].status='stopped'; assert.equal(native[0].status,'pending');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'amara-file-status-'));
try {
 const file=path.join(dir,'episode.mp4');fs.writeFileSync(file,Buffer.alloc(110000));
 const first={savePath:file,hongguoInfo:{vid:'first'}};
 assert.equal(completedFiles([first])(first),true);
 assert.equal(completedFiles([first,{...first,hongguoInfo:{vid:'second'}}])(first),false);
 assert.equal(completedFiles([{...first,pathConflict:true}])({...first,pathConflict:true}),false);
 fs.unlinkSync(file); assert.equal(completedFiles([first])(first),false);
 const large=Array.from({length:4168},(_,i)=>({id:i,status:'completed',savePath:path.join(dir,String(i)),hongguoInfo:{vid:String(i)}}));
 const start=Date.now(), valid=completedFiles(large); assert.equal(large.filter(valid).length,0);
 console.log(`PASS: native queue mapping, private state isolation, missing/conflicting files, 4168-file scan (${Date.now()-start}ms)`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
