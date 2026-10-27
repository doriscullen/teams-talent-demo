import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startLocalTraceReceiver} from '../server/local-trace-receiver.js';
// Optional host probe: uses the actual Python SDK/exporter, no iCode/model call.
// Ordinary npm tests use the independently generated protobuf fixture instead.
const python=process.env.DEMO_ICODE_PYTHON;
if(!python||!isAbsolute(python))throw new Error('Set DEMO_ICODE_PYTHON to the installed runtime Python for this optional exporter probe');
const endpointArg=process.argv.indexOf('--endpoint'),configured=endpointArg<0?null:process.argv[endpointArg+1];
if(endpointArg>=0&&!configured)throw new Error('--endpoint needs a loopback HTTP origin');
if(configured){const url=new URL(configured);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Only an explicit 127.0.0.1 HTTP origin is accepted');}
const directory=await mkdtemp(join(tmpdir(),'real-otlp-exporter-'));
const receiver=configured?null:await startLocalTraceReceiver({port:0,runtimeDir:directory,root:resolve('.')});
const origin=configured??receiver!.origin,projectId='TRACE-PROBE-'+randomUUID(),runId=randomUUID(),sessionId=randomUUID();
const script=`import sys\nfrom opentelemetry.sdk.trace import TracerProvider\nfrom opentelemetry.sdk.resources import Resource\nfrom opentelemetry.sdk.trace.export import SimpleSpanProcessor\nfrom opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter\nfrom opentelemetry.exporter.otlp.proto.http import Compression\nendpoint, project, run, session = sys.argv[1:]\nprovider = TracerProvider(resource=Resource({'service.name':'explicit-no-model-probe','trace2.project.id':project,'teams.task.id':'TRACE-PROBE-TASK','teams.node.id':'prepare','teams.run.id':run}))\nprovider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint=endpoint,headers={},timeout=5,compression=Compression.Gzip)))\nwith provider.get_tracer('teams-local-receiver-probe').start_as_current_span('explicit-probe-not-user-task') as span:\n span.set_attribute('chrys.session_id',session)\n span.set_attribute('probe.only',True)\n span.set_attribute('probe.sensitive','EXPLICIT_PROBE_ONLY_NO_USER_CONTENT')\nprovider.force_flush()\nprovider.shutdown()\n`;
try{
 const health=await(await fetch(origin+'/health')).json();assert.equal(health.app,'teams-local-trace');assert.equal(health.protocol,'otlp/http-protobuf');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('OTEL_')&&!key.startsWith('CHRYS_OTEL')));
 await promisify(execFile)(python,['-c',script,origin+'/v1/traces',projectId,runId,sessionId],{env,timeout:15000,maxBuffer:65536});
 const query=new URLSearchParams({projectId,taskId:'TRACE-PROBE-TASK',nodeId:'prepare',runId,sessionId});
 const response=await fetch(origin+'/api/traces?'+query);assert.equal(response.status,200);const result=await response.json();assert.equal(result.total,1);assert.equal(result.batches[0].spanCount,1);
 const batch=result.batches[0],detail=await(await fetch(origin+'/api/traces/'+batch.id+'?'+query)).json();assert.ok(JSON.stringify(detail.document).includes('EXPLICIT_PROBE_ONLY_NO_USER_CONTENT'));assert.ok(!JSON.stringify(batch).includes('EXPLICIT_PROBE_ONLY_NO_USER_CONTENT'));
 const healthAfter=await(await fetch(origin+'/health')).json();assert.ok(healthAfter.receivedBatches>health.receivedBatches);
 const report={passed:true,at:new Date().toISOString(),origin,health,healthAfter,projectId,runId,sessionId,batchId:batch.id,sha256:batch.sha256,spanCount:1,actualPythonOtlpExporter:true,compression:'gzip',modelCalls:0,businessStateWrites:0,scope:'Explicit isolated probe, not a user task trace'};
 await mkdir('test-results/local-trace',{recursive:true});await writeFile('test-results/local-trace/'+(configured?'live':'isolated')+'-exporter-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await receiver?.close();await rm(directory,{recursive:true,force:true});}
