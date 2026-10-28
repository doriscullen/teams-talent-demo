import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,mkdir,writeFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {traceRequestType} from '../server/local-trace-codec.js';
import {checkNativeTraceReceiver} from '../scripts/native/tui-trace.mjs';
const temp=await realpath(await mkdtemp(join(tmpdir(),'python-trace-service-'))),port=46212;
process.env.DEMO_STATE_DIR=join(temp,'state');process.env.DEMO_TRACE_DATA_DIR=join(temp,'traces');process.env.DEMO_TRACE_PORT=String(port);
const {startTraceService,stopTraceService}=await import('../server/trace-service.js');
const origin=`http://127.0.0.1:${port}`,projectId='TRACE-PROBE-'+randomUUID(),sessionId=randomUUID(),runId=randomUUID(),taskId='probe-only-no-model',nodeId='prepare';
try {
  await startTraceService();await startTraceService();
  const health=await(await fetch(origin+'/health')).json();assert.equal(health.app,'teams-trace-server');assert.equal(health.workspaceRoot,resolve('.'));assert.equal(health.stateRoot,process.env.DEMO_TRACE_DATA_DIR);
  await checkNativeTraceReceiver(origin+'/v1/traces',{workspaceRoot:resolve('.'),stateRoot:process.env.DEMO_TRACE_DATA_DIR});
  await assert.rejects(checkNativeTraceReceiver(origin+'/v1/traces',{workspaceRoot:'/another-workspace'}),/其他工作区/);
  const attributes=Object.entries({'trace2.project.id':projectId,'service.name':'teams-protocol-probe','teams.task.id':taskId,'teams.node.id':nodeId,'teams.run.id':runId}).map(([key,stringValue])=>({key,value:{stringValue}}));
  const request={resourceSpans:[{resource:{attributes},scopeSpans:[{scope:{name:'explicit-test-probe'},spans:[{traceId:randomBytes(16),spanId:randomBytes(8),name:'Explicit probe; no native model execution',kind:1,startTimeUnixNano:String(BigInt(Date.now())*1000000n),endTimeUnixNano:String(BigInt(Date.now()+2)*1000000n),attributes:[{key:'session.id',value:{stringValue:sessionId}}],status:{code:1}}]}]}]};
  const response=await fetch(origin+'/v1/traces',{method:'POST',headers:{'content-type':'application/x-protobuf','content-encoding':'gzip'},body:new Uint8Array(gzipSync(traceRequestType.encode(traceRequestType.fromObject(request)).finish()))});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/x-protobuf');
  let list:any;for(let n=0;n<60;n++){list=await(await fetch(origin+`/api/v1/projects/${projectId}/traces`)).json();if(list.total===1)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(list.total,1,JSON.stringify(list));
  const detail=await(await fetch(origin+`/api/v1/projects/${projectId}/traces/${list.items[0].id}`)).json();assert.ok(detail.trace);assert.equal(detail.spans.length,1);
  const files:string[]=[];async function walk(path:string){for(const item of await readdir(path,{withFileTypes:true})){const file=join(path,item.name);if(item.isDirectory())await walk(file);else files.push(file);}}await walk(join(temp,'traces'));
  const raw=(await Promise.all(files.map(path=>readFile(path,'utf8')))).join('\n');for(const value of [projectId,taskId,nodeId,runId,sessionId])assert.ok(raw.includes(value),value);
  await mkdir('test-results/native-merge',{recursive:true});await writeFile('test-results/native-merge/python-trace-service.json',JSON.stringify({passed:true,health,probe:{projectId,taskId,nodeId,runId,sessionId},gzipProtobuf:true,persisted:true,queryVisible:true,serviceReuse:true,nativeModelInvocations:0},null,2));console.log('Python trace production service: health identity + gzip OTLP + JSONL + monitor query passed; no native model');
} finally {await stopTraceService();for(let n=0;n<50;n++){try{await fetch(origin+'/health');}catch{break;}await new Promise(resolve=>setTimeout(resolve,100));}await rm(temp,{recursive:true,force:true});}
