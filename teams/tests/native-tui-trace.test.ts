import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { nativeTraceEnvironment, checkNativeTraceReceiver, traceLaunchEnvironment, traceLaunchSettings } from '../scripts/native/tui-trace.mjs';

test('process-scoped TUI trace config is pinned across terminal environment, trace-only and loopback-only', () => {
  const scope={projectId:'项目 A,&',taskId:'MKT-001',nodeId:'develop',runId:'run-one'};
  const base={CHRYS_OTEL_SENSITIVE_DATA:'false',OTEL_EXPORTER_OTLP_ENDPOINT:'https://remote/base',OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:'https://remote/logs',OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'https://remote/metrics',OTEL_EXPORTER_OTLP_HEADERS:'secret',OTEL_EXPORTER_OTLP_TRACES_HEADERS:'secret',OTEL_SERVICE_NAME:'user-icode',OTEL_RESOURCE_ATTRIBUTES:'installation=local,teams.task.id=old,trace2.project.id=old',KEEP_UNRELATED:'unchanged'};
  const original=structuredClone(base),trace=nativeTraceEnvironment(base,scope);
  assert.deepEqual(base,original);assert.equal(trace.endpoint,'http://127.0.0.1:8012/v1/traces');assert.equal(trace.enabled,true);assert.equal(trace.sensitiveData,false);assert.equal(trace.env.CHRYS_OTEL_ENDPOINT,'');assert.equal(trace.env.OTEL_EXPORTER_OTLP_PROTOCOL,'http/protobuf');
  for(const key of Object.keys(trace.env))assert.doesNotMatch(key,/^OTEL_EXPORTER_OTLP_(ENDPOINT|LOGS_.*|METRICS_.*|.*HEADERS)$/);
  assert.equal(trace.env.OTEL_SERVICE_NAME,'user-icode');assert.equal(trace.env.KEEP_UNRELATED,'unchanged');assert.equal(trace.env.OTEL_LOGS_EXPORTER,'none');assert.equal(trace.env.OTEL_METRICS_EXPORTER,'none');assert.match(trace.env.OTEL_RESOURCE_ATTRIBUTES!,/installation=local/);assert.ok(trace.env.OTEL_RESOURCE_ATTRIBUTES!.includes('trace2.project.id='+encodeURIComponent(scope.projectId)));assert.doesNotMatch(trace.env.OTEL_RESOURCE_ATTRIBUTES!,/=old/);
  const pinned=traceLaunchSettings(trace);assert.equal(Object.hasOwn(pinned,'env'),false);
  const child=nativeTraceEnvironment(traceLaunchEnvironment({CHRYS_OTEL:'false',OTEL_SERVICE_NAME:'different-terminal'},pinned),scope,pinned.endpoint);assert.equal(child.enabled,true);assert.equal(child.sensitiveData,false);assert.equal(child.env.OTEL_SERVICE_NAME,'user-icode');
  assert.equal(nativeTraceEnvironment({DEMO_TRACE_PORT:'18012'},scope).endpoint,'http://127.0.0.1:18012/v1/traces');assert.equal(nativeTraceEnvironment({},scope).sensitiveData,true);assert.equal(nativeTraceEnvironment({CHRYS_OTEL:'false'},scope).enabled,false);
  for(const endpoint of ['https://127.0.0.1:8012/v1/traces','http://external.test/v1/traces','http://user:secret@127.0.0.1/v1/traces','http://127.0.0.1:8012/v1/logs','http://127.0.0.1:8012/v1/traces?key=x'])assert.throws(()=>nativeTraceEnvironment({},scope,endpoint),/本机 HTTP/);
  assert.throws(()=>nativeTraceEnvironment({CHRYS_OTEL:'invalid'},scope),/配置无效/);
});

test('trace readiness reports HTTP failure and does not claim trace reception', async () => {
  let code=200,posts=0,identity='teams-local-trace';
  const server=createServer((req,res)=>{if(req.method==='POST')posts++;res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',app:identity,service:'trace',protocol:'otlp/http-protobuf',workspaceRoot:'/work',stateRoot:'/state'}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port,endpoint=`http://127.0.0.1:${port}/v1/traces`;
  try {assert.deepEqual(await checkNativeTraceReceiver(endpoint),{endpoint,status:'receiver-ready'});assert.equal(posts,0);await assert.rejects(checkNativeTraceReceiver(endpoint,{app:'teams-trace-server'}),/实现不匹配/);identity='teams-trace-server';assert.deepEqual(await checkNativeTraceReceiver(endpoint,{workspaceRoot:'/work',stateRoot:'/state'}),{endpoint,status:'receiver-ready'});await assert.rejects(checkNativeTraceReceiver(endpoint,{workspaceRoot:'/other'}),/其他工作区/);identity='unrelated-web-server';await assert.rejects(checkNativeTraceReceiver(endpoint),/不是已核验/);identity='teams-local-trace';code=503;await assert.rejects(checkNativeTraceReceiver(endpoint),/503/);} finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
  await assert.rejects(checkNativeTraceReceiver(endpoint));
});

test('local configuration accepts only the explicit local trace endpoint and keeps shell precedence', async () => {
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {loadLocalConfiguration}=await import('../server/local-config.js');
  const root=await mkdtemp(join(tmpdir(),'trace-config-')),file=join(root,'config.json');
  try {
    await writeFile(file,JSON.stringify({DEMO_TRACE_ENDPOINT:'http://127.0.0.1:18012/v1/traces'}));
    const env:NodeJS.ProcessEnv={DEMO_LOCAL_CONFIG:file};loadLocalConfiguration(root,env);assert.equal(env.DEMO_TRACE_ENDPOINT,'http://127.0.0.1:18012/v1/traces');
    const preferred={DEMO_LOCAL_CONFIG:file,DEMO_TRACE_ENDPOINT:'http://127.0.0.1:18013/v1/traces'};loadLocalConfiguration(root,preferred);assert.equal(preferred.DEMO_TRACE_ENDPOINT,'http://127.0.0.1:18013/v1/traces');
    for(const endpoint of ['https://external.test/v1/traces','http://127.0.0.1:8012/v1/logs','http://user:secret@localhost/v1/traces']) {await writeFile(file,JSON.stringify({DEMO_TRACE_ENDPOINT:endpoint}));assert.throws(()=>loadLocalConfiguration(root,{DEMO_LOCAL_CONFIG:file}),/本机 HTTP/);}
  } finally {await rm(root,{recursive:true,force:true});}
});
