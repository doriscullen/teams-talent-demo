import {createServer,type IncomingMessage} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,readFile,readdir,realpath,stat,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {decodeTraceRequest,scopedTraceDocument,traceResponseType,type TraceSpanSummary} from './local-trace-codec.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxBytes=8*1024*1024;
class TraceError extends Error{constructor(message:string,readonly status=400){super(message);}}
interface TraceBatch {version:1;id:string;receivedAt:string;sha256:string;wireSha256:string;encoding:'identity'|'gzip';wireBodyBase64:string;document:Record<string,any>;spans:TraceSpanSummary[]}
async function body(request:IncomingMessage){
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of request){size+=chunk.length;if(size>maxBytes)throw new TraceError('Trace request exceeds 8 MiB',413);chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
export interface LocalTraceOptions {port?:number;runtimeDir:string;root:string;host?:'127.0.0.1'}
/** Local-only trace sink. No business state, external forwarding, model calls or UI. */
export async function startLocalTraceReceiver(options:LocalTraceOptions){
 const port=options.port??8012;if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Trace port must be between 0 and 65535');
 if(options.host&&options.host!=='127.0.0.1')throw new Error('Trace receiver must bind IPv4 loopback');
 if(!isAbsolute(options.runtimeDir)||!isAbsolute(options.root))throw new Error('Trace runtime and workspace paths must be absolute');
 await mkdir(options.runtimeDir,{recursive:true,mode:0o700});
 // Normalize platform aliases such as macOS /var -> /private/var once; reject
 // links below that known runtime directory rather than normal OS parent aliases.
 const directory=join(await realpath(options.runtimeDir),'local-traces');await mkdir(directory,{recursive:true,mode:0o700});
 if(await realpath(directory)!==directory)throw new Error('Trace storage cannot be a symbolic link');
 let origin='',received=0,lastReceivedAt:string|null=null,lastError:string|null=null,storageFailed=false;
 async function save(batch:TraceBatch){
  const target=join(directory,batch.id+'.json'),temporary=target+'.tmp';
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(batch));await handle.sync();}catch(error){await handle.close();await unlink(temporary);throw error;}
  await handle.close();try{await rename(temporary,target);}catch(error){await unlink(temporary);throw error;}
 }
 async function load(id:string):Promise<TraceBatch>{
  if(!uuid.test(id))throw new TraceError('Trace batch not found',404);
  const path=join(directory,id+'.json');let raw:string;
  try{if(await realpath(path)!==path)throw new TraceError('Trace storage path is invalid',503);const info=await stat(path);if(!info.isFile()||info.size>64*1024*1024)throw new TraceError('Trace batch is not readable',503);raw=await readFile(path,'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new TraceError('Trace batch not found',404);throw error;}
  let batch:TraceBatch;try{batch=JSON.parse(raw);}catch{throw new TraceError('Trace batch is corrupted',503);}
  if(batch.version!==1||batch.id!==id||!Array.isArray(batch.spans)||!batch.document||typeof batch.wireBodyBase64!=='string'||!['identity','gzip'].includes(batch.encoding))throw new TraceError('Trace batch is corrupted',503);
  try{
   const wire=Buffer.from(batch.wireBodyBase64,'base64'),decoded=batch.encoding==='gzip'?gunzipSync(wire,{maxOutputLength:maxBytes}):wire;
   if(hash(wire)!==batch.wireSha256||hash(decoded)!==batch.sha256)throw new Error('digest mismatch');
   const facts=decodeTraceRequest(decoded);
   if(JSON.stringify(facts.spans)!==JSON.stringify(batch.spans)||JSON.stringify(facts.document)!==JSON.stringify(batch.document))throw new Error('decoded facts mismatch');
  }catch{throw new TraceError('Trace batch integrity check failed',503);}
  return batch;
 }
 const server=createServer(async(request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cross-Origin-Resource-Policy','same-origin');
  const json=(status:number,value:unknown)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  try{
   const actualPort=new URL(origin).port,host=request.headers.host;
   if(!['127.0.0.1:'+actualPort,'localhost:'+actualPort].includes(host??'')||!['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??''))throw new TraceError('Loopback host required',403);
   if(request.headers.origin&&request.headers.origin!==origin||request.headers['sec-fetch-site']==='cross-site')throw new TraceError('Cross-origin access is not allowed',403);
   const url=new URL(request.url??'/',origin);
   if(request.method==='GET'&&url.pathname==='/health'){json(storageFailed?503:200,{status:storageFailed?'error':'ok',app:'teams-local-trace',service:'trace',workspaceRoot:options.root,stateRoot:directory,pid:process.pid,origin,protocol:'otlp/http-protobuf',receivedBatches:received,countersSinceStart:true,lastReceivedAt,lastError});return;}
   if(request.method==='POST'&&url.pathname==='/v1/traces'){
    if(!['application/x-protobuf','application/protobuf'].includes((request.headers['content-type']??'').split(';')[0].trim().toLowerCase()))throw new TraceError('OTLP protobuf content type required',415);
    const encoding=request.headers['content-encoding']??'identity';if(encoding!=='gzip'&&encoding!=='identity')throw new TraceError('Unsupported trace content encoding',415);
    const wire=await body(request);let decoded:Buffer;
    try{decoded=encoding==='gzip'?gunzipSync(wire,{maxOutputLength:maxBytes}):wire;}catch{throw new TraceError('Invalid or oversized compressed trace body',400);}
    let parsed:ReturnType<typeof decodeTraceRequest>;try{parsed=decodeTraceRequest(decoded);}catch{throw new TraceError('Invalid OTLP trace protobuf',400);}
    const batch:TraceBatch={version:1,id:randomUUID(),receivedAt:new Date().toISOString(),sha256:hash(decoded),wireSha256:hash(wire),encoding,wireBodyBase64:wire.toString('base64'),...parsed};
    await save(batch);received++;lastReceivedAt=batch.receivedAt;lastError=null;storageFailed=false;
    response.writeHead(200,{'Content-Type':'application/x-protobuf','X-Trace-Batch-Id':batch.id});response.end(Buffer.from(traceResponseType.encode({}).finish()));return;
   }
   if(request.method==='GET'&&(url.pathname==='/api/traces'||/^\/api\/traces\/[a-z0-9-]+(?:\/raw)?$/.test(url.pathname))){
    const keys=['projectId','taskId','nodeId','runId','sessionId'] as const;
    const filters=Object.fromEntries(keys.flatMap(key=>{const value=url.searchParams.get(key);if(value!==null&&!/^[A-Za-z0-9_.:@%/-]{1,256}$/.test(value))throw new TraceError('Invalid trace scope');return value===null?[]:[[key,value]];}));
    if(!filters.projectId)throw new TraceError('Explicit projectId scope is required');
    const matches=(span:TraceSpanSummary)=>keys.every(key=>filters[key]===undefined||filters[key]===span[key]);
    if(url.pathname==='/api/traces'){
     const limit=Number(url.searchParams.get('limit')??50);if(!Number.isInteger(limit)||limit<1||limit>200)throw new TraceError('Trace limit must be 1–200');
     const ids=(await readdir(directory)).filter(name=>uuid.test(name.replace(/\.json$/,''))&&name.endsWith('.json'));if(ids.length>10000)throw new TraceError('Trace storage exceeds this local query limit',503);
     const results=[];for(const name of ids){const batch=await load(name.slice(0,-5)),spans=batch.spans.filter(matches);if(spans.length)results.push({id:batch.id,receivedAt:batch.receivedAt,sha256:batch.sha256,spanCount:spans.length,spans});}
     results.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));json(200,{scope:filters,total:results.length,batches:results.slice(0,limit),truncated:results.length>limit,note:'Only received OTLP facts; not a Teams task progress or completion record.'});return;
    }
    const id=url.pathname.split('/')[3],batch=await load(id),spans=batch.spans.filter(matches);if(!spans.length)throw new TraceError('Trace batch not found in this scope',404);
    if(url.pathname.endsWith('/raw')){
     if(spans.length!==batch.spans.length)throw new TraceError('Raw batch contains other scopes; request scoped decoded facts instead',409);
     const wire=Buffer.from(batch.wireBodyBase64,'base64');if(hash(wire)!==batch.wireSha256)throw new TraceError('Trace raw data is corrupted',503);
     response.writeHead(200,{'Content-Type':'application/x-protobuf',...(batch.encoding==='gzip'?{'Content-Encoding':'gzip'}:{}),'X-Trace-Body-Sha256':batch.sha256});response.end(wire);return;
    }
    json(200,{id:batch.id,receivedAt:batch.receivedAt,sha256:batch.sha256,scope:filters,spans,document:scopedTraceDocument(batch.document,spans),sensitiveContent:true});return;
   }
   throw new TraceError('Trace endpoint not found',404);
  }catch(error){const status=error instanceof TraceError?error.status:503;if(status>=500)storageFailed=true;lastError=status>=500?'Local trace storage or receiver failure':(error as Error).message;json(status,{error:lastError});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 await new Promise<void>((resolveReady,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);const address=server.address();if(!address||typeof address==='string'){reject(new Error('Trace server address unavailable'));return;}origin='http://127.0.0.1:'+address.port;resolveReady();});});
 return{server,origin,close:()=>new Promise<void>((resolveClosed,reject)=>{server.close(error=>error?reject(error):resolveClosed());server.closeIdleConnections();})};
}
