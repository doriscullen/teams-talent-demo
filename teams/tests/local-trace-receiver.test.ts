import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile,readdir,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {startLocalTraceReceiver} from '../server/local-trace-receiver.js';
import {decodeTraceRequest,traceRequestType,traceResponseType} from '../server/local-trace-codec.js';

// Created using official Python opentelemetry.proto ExportTraceServiceRequest,
// independently of this receiver's protobufjs parser. No user/session trace.
const probe=await readFile(new URL('./fixtures/otlp/python-trace-probe.bin',import.meta.url));
const projectId='TRACE-PROBE-ISOLATED',scope='?projectId='+projectId;
const post=(origin:string,bytes:Buffer=probe,headers:Record<string,string>={})=>fetch(origin+'/v1/traces',{method:'POST',headers:{'content-type':'application/x-protobuf',...headers},body:bytes as unknown as BodyInit});
async function fixture(run:(receiver:Awaited<ReturnType<typeof startLocalTraceReceiver>>,dir:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'local-otlp-'));const receiver=await startLocalTraceReceiver({port:0,runtimeDir:dir,root:resolve('.')});try{await run(receiver,dir);}finally{await receiver.close();await rm(dir,{recursive:true,force:true});}}

test('official Python OTLP bytes decode exact IDs, nanoseconds and supported scope without model events',()=>{
 const {document,spans}=decodeTraceRequest(probe);assert.equal(spans.length,1);assert.equal(spans[0].traceId,'10'.repeat(16));assert.equal(spans[0].spanId,'20'.repeat(8));assert.equal(spans[0].startTimeUnixNano,'1700000000000000001');assert.equal(spans[0].endTimeUnixNano,'1700000000000001234');assert.equal(spans[0].projectId,projectId);assert.equal(spans[0].taskId,'PROBE-TASK');assert.equal(spans[0].sessionId,'00000000-0000-4000-8000-000000000002');assert.equal(document.resourceSpans[0].scopeSpans[0].scope.name,'independent-python-otlp-probe');
});
test('real HTTP protobuf is persisted privately; summary excludes prompt data; exact scoped facts/raw remain available',async()=>fixture(async(receiver,dir)=>{
 const response=await post(receiver.origin);assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/protobuf/);assert.deepEqual(traceResponseType.toObject(traceResponseType.decode(Buffer.from(await response.arrayBuffer()))),{});const id=response.headers.get('x-trace-batch-id')!;
 const health=await(await fetch(receiver.origin+'/health')).json();assert.equal(health.app,'teams-local-trace');assert.equal(health.receivedBatches,1);assert.equal(health.stateRoot,await realpath(join(dir,'local-traces')));
 const summary=await(await fetch(receiver.origin+'/api/traces'+scope)).json();assert.equal(summary.total,1);assert.equal(summary.batches[0].spanCount,1);assert.ok(!JSON.stringify(summary).includes('PROBE_ONLY_PROMPT'));
 const detail=await(await fetch(receiver.origin+'/api/traces/'+id+scope+'&taskId=PROBE-TASK&nodeId=prepare')).json();assert.ok(JSON.stringify(detail.document).includes('PROBE_ONLY_PROMPT_NOT_USER_DATA'));assert.equal(detail.sensitiveContent,true);
 const raw=await fetch(receiver.origin+'/api/traces/'+id+'/raw'+scope);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),probe);
 assert.equal((await fetch(receiver.origin+'/api/traces/'+id+'?projectId=unrelated')).status,404);assert.equal((await fetch(receiver.origin+'/api/traces')).status,400);
 const stored=JSON.parse(await readFile(join(dir,'local-traces',id+'.json'),'utf8'));assert.equal(stored.sha256,createHash('sha256').update(probe).digest('hex'));assert.deepEqual(Buffer.from(stored.wireBodyBase64,'base64'),probe);if(process.platform!=='win32')assert.equal((await stat(join(dir,'local-traces',id+'.json'))).mode&0o777,0o600);
}));
test('gzip and unknown protobuf fields preserve original bytes across receiver restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'local-otlp-restart-'));let receiver=await startLocalTraceReceiver({port:0,runtimeDir:dir,root:resolve('.')});
 try{const extended=Buffer.concat([probe,Buffer.from([0x98,0x06,0x07])]),compressed=gzipSync(extended);const response=await post(receiver.origin,compressed,{'content-encoding':'gzip'});assert.equal(response.status,200);const id=response.headers.get('x-trace-batch-id')!;await receiver.close();receiver=await startLocalTraceReceiver({port:0,runtimeDir:dir,root:resolve('.')});assert.equal((await(await fetch(receiver.origin+'/api/traces'+scope)).json()).total,1);const raw=await fetch(receiver.origin+'/api/traces/'+id+'/raw'+scope);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),extended);const saved=JSON.parse(await readFile(join(dir,'local-traces',id+'.json'),'utf8'));assert.deepEqual(Buffer.from(saved.wireBodyBase64,'base64'),compressed);}
 finally{await receiver.close();await rm(dir,{recursive:true,force:true});}
});
test('mixed project/task batches are filtered before decoding exposure and cannot bypass scope through raw download',async()=>fixture(async(receiver)=>{
 const a=decodeTraceRequest(probe).document,b=structuredClone(a.resourceSpans[0]);b.resource.attributes.find((item:any)=>item.key==='trace2.project.id').value.stringValue='OTHER-PROBE';a.resourceSpans.push(b);
 const bytes=Buffer.from(traceRequestType.encode(traceRequestType.fromObject(a)).finish()),response=await post(receiver.origin,bytes),id=response.headers.get('x-trace-batch-id')!;assert.equal(response.status,200);
 const value=await(await fetch(receiver.origin+'/api/traces/'+id+scope)).json();assert.equal(value.spans.length,1);assert.equal(value.document.resourceSpans.length,1);assert.ok(!JSON.stringify(value).includes('OTHER-PROBE'));assert.equal((await fetch(receiver.origin+'/api/traces/'+id+'/raw'+scope)).status,409);assert.equal((await(await fetch(receiver.origin+'/api/traces?projectId=OTHER-PROBE')).json()).total,1);
}));
test('invalid bodies, foreign origins/hosts and unsupported signals fail without persistence or CORS',async()=>fixture(async(receiver,dir)=>{
 assert.equal((await post(receiver.origin,Buffer.from('{}'),{'content-type':'application/json'})).status,415);
 assert.equal((await post(receiver.origin,Buffer.from('{"not":"protobuf"}'))).status,400);
 assert.equal((await post(receiver.origin,probe,{'content-encoding':'br'})).status,415);
 assert.equal((await post(receiver.origin,probe,{origin:'https://unrelated.example'})).status,403);
 assert.equal((await fetch(receiver.origin+'/v1/logs',{method:'POST'})).status,404);
 const cross=await fetch(receiver.origin+'/api/traces'+scope,{headers:{origin:'http://127.0.0.1:45970'}});assert.equal(cross.status,403);assert.equal(cross.headers.get('access-control-allow-origin'),null);
 const denied=await new Promise<number>((done,reject)=>{const r=httpRequest(receiver.origin+'/health',{headers:{host:'rebinding.example'}},response=>{response.resume();done(response.statusCode!);});r.on('error',reject);r.end();});assert.equal(denied,403);assert.deepEqual(await readdir(join(dir,'local-traces')),[]);
}));
test('port conflicts and corrupt/persistence failures remain explicit and never report accepted trace data',async()=>fixture(async(receiver,dir)=>{
 await assert.rejects(startLocalTraceReceiver({port:Number(new URL(receiver.origin).port),runtimeDir:dir,root:resolve('.')}),{code:'EADDRINUSE'});
 await assert.rejects(startLocalTraceReceiver({port:0,runtimeDir:dir,root:resolve('.'),host:'0.0.0.0' as '127.0.0.1'}),/loopback/);
 const directory=join(dir,'local-traces');await rename(directory,directory+'.held');await writeFile(directory,'not a directory');const failed=await post(receiver.origin);assert.equal(failed.status,503);assert.equal((await(await fetch(receiver.origin+'/health')).json()).receivedBatches,0);await rm(directory);await rename(directory+'.held',directory);
 const accepted=await post(receiver.origin);assert.equal(accepted.status,200);const id=accepted.headers.get('x-trace-batch-id')!;await writeFile(join(directory,id+'.json'),'broken');assert.equal((await fetch(receiver.origin+'/api/traces'+scope)).status,503);
}));
