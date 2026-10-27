import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

// Exercise the production CLI process and filesystem contract, without native/model work.
test('context output saves the selected projection once, reports a small receipt, and leaves write receipts intact',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cli-output-')),requests:string[]=[],writes:any[]=[];
 const scope={projectId:'carddemo',taskId:'REQ-output',nodeId:'prepare',tab:'delivery'};
 const model={view:'model',scope,revision:7,basisDigest:'a'.repeat(64),skills:[{id:'skill',content:'Complete business skill body.\n'.repeat(300)}],knowledge:{assets:[{id:'knowledge',detail:'Full knowledge body.'}]},references:[{id:'reference'}]};
 const full={...model,view:undefined,talentInputs:{skills:model.skills},events:[{summary:'full history'}]};
 const receipt={ok:true,replayed:false,receipt:{operationId:'will-be-set',revision:8,adoptionId:'adoption'}};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://127.0.0.1');requests.push(url.pathname+url.search);res.setHeader('content-type','application/json');
  if(url.pathname==='/api/health')return res.end(JSON.stringify({app:'teams-talent-carddemo',service:'teams'}));
  if(url.pathname==='/api/collaboration/context')return res.end(JSON.stringify(url.searchParams.get('view')==='full'?full:model));
  if(url.pathname==='/api/session')return res.end(JSON.stringify({token:'isolated-token'}));
  if(url.pathname==='/api/collaboration') {let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));receipt.receipt.operationId=writes.at(-1).operationId;return res.end(JSON.stringify(receipt));}
  res.writeHead(404);res.end(JSON.stringify({error:'unexpected path'}));
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw new Error('address missing');
 const run=(args:string[])=>promisify(execFile)(process.execPath,[resolve('scripts/teams-demo.mjs'),'--endpoint',`http://127.0.0.1:${address.port}`,'--receipt-dir',join(dir,'receipts'),...args],{maxBuffer:1024*1024});
 try{
  const output=join(dir,'带 空格','context.json'),args=['context','get','--input',JSON.stringify(scope)];
  const saved=JSON.parse((await run([...args,'--output',output])).stdout);
  assert.equal(saved.kind,'context.saved');assert.equal(saved.view,'model');assert.equal(saved.outputPath,output);assert.deepEqual(saved.scope,scope);assert.equal(saved.revision,model.revision);assert.equal(saved.basisDigest,model.basisDigest);assert.deepEqual(saved.resources,{skills:1,knowledge:1,references:1});
  const bytes=await readFile(output);assert.equal(saved.bytes,bytes.length);assert.deepEqual(JSON.parse(bytes.toString()),model);assert.ok(JSON.stringify(saved).length<700);assert.equal('skills'in saved,false);assert.equal('knowledge'in saved,false);
  assert.ok(requests.some(path=>path.includes('view=model')));assert.deepEqual(JSON.parse((await run(args)).stdout),model);
  const fullOutput=join(dir,'full.json'),fullReceipt=JSON.parse((await run([...args,'--view','full','--output',fullOutput])).stdout);assert.equal(fullReceipt.view,'full');assert.deepEqual(JSON.parse(await readFile(fullOutput,'utf8')),JSON.parse(JSON.stringify(full)));assert.ok(requests.some(path=>path.includes('view=full')));
  assert.deepEqual(JSON.parse((await run([...args,'--view','full'])).stdout),JSON.parse(JSON.stringify(full)));
  await mkdir(join(dir,'directory'));await assert.rejects(run([...args,'--output',join(dir,'directory')]),error=>{const failure=error as Error&{stdout:string;stderr:string};assert.equal(failure.stdout,'');assert.equal(JSON.parse(failure.stderr).ok,false);return true;});
  const count=requests.length;await assert.rejects(run([...args,'--view','unknown']),/--view/);assert.equal(requests.length,count,'invalid view does not call the API');
  const operationId=randomUUID(),input={...scope,expectedRevision:7,runId:randomUUID(),sessionId:randomUUID(),basisDigest:model.basisDigest,readReferences:[]};
  const writeOutput=join(dir,'write.json'),write=JSON.parse((await run(['inputs','adopt','--operation-id',operationId,'--input',JSON.stringify(input),'--output',writeOutput])).stdout);
  assert.equal(write.ok,true);assert.deepEqual(write.receipt,receipt.receipt);assert.equal(write.outputPath,writeOutput);assert.equal(writes.length,1);assert.deepEqual(writes[0].input,input);
  assert.deepEqual(JSON.parse(await readFile(write.receiptPath,'utf8')),receipt);assert.deepEqual(JSON.parse(await readFile(writeOutput,'utf8')),{...receipt,requestPath:write.requestPath,receiptPath:write.receiptPath});
  await assert.rejects(run(['inputs','adopt','--operation-id',operationId,'--input',JSON.stringify(input),'--view','full']),/--view/);assert.equal(writes.length,1);
 }finally{await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));await rm(dir,{recursive:true,force:true});}
});
