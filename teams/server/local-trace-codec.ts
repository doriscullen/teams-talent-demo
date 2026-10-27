import protobuf from 'protobufjs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Upstream schema with whitespace-only normalization; source/local hashes and fixed commit are in otlp/source.json.
const directory=fileURLToPath(new URL('./otlp/',import.meta.url));
const schema=new protobuf.Root();
schema.resolvePath=(_origin,target)=>join(directory,target);
schema.loadSync('opentelemetry/proto/collector/trace/v1/trace_service.proto');
schema.resolveAll();
export const traceRequestType=schema.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
export const traceResponseType=schema.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse');
type Json=Record<string,any>;
export interface TraceScope {projectId:string|null;taskId:string|null;nodeId:string|null;runId:string|null;sessionId:string|null}
export interface TraceSpanSummary extends TraceScope {
 resourceIndex:number;scopeIndex:number;spanIndex:number;traceId:string;spanId:string;parentSpanId:string|null;
 startTimeUnixNano:string|null;endTimeUnixNano:string|null;kind:string|null;statusCode:string|null;
}
function attributes(items:Json[]|undefined):Record<string,string>{
 return Object.fromEntries((items??[]).filter(item=>typeof item.key==='string'&&typeof item.value?.stringValue==='string').map(item=>[item.key,item.value.stringValue]));
}
function scopeValue(value:unknown):string|null{return typeof value==='string'&&/^[A-Za-z0-9_.:@%/-]{1,256}$/.test(value)?value:null;}
export function decodeTraceRequest(body:Buffer):{document:Json;spans:TraceSpanSummary[]}{
 const message=traceRequestType.decode(body);
 const document=traceRequestType.toObject(message,{longs:String,bytes:String,enums:String,arrays:true,objects:true});
 const spans:TraceSpanSummary[]=[];
 for(const [resourceIndex,resource]of (document.resourceSpans??[]).entries()){
  const resourceAttrs=attributes(resource.resource?.attributes);
  for(const [scopeIndex,instrumentation]of (resource.scopeSpans??[]).entries())for(const [spanIndex,span]of (instrumentation.spans??[]).entries()){
   if(spans.length>=5000)throw new Error('A trace batch exceeds 5000 spans');
   const bytes=(value:unknown,length:number)=>{const raw=Buffer.from(typeof value==='string'?value:'','base64');if(raw.length!==length||raw.every(byte=>byte===0))throw new Error('OTLP trace/span ID is invalid');return raw.toString('hex');};
   const own=attributes(span.attributes),field=(key:string)=>scopeValue(resourceAttrs[key]??own[key]);
   const session=scopeValue(own['chrys.session_id']??own['gen_ai.conversation.id']??own['session.id']??own['teams.session.id']??resourceAttrs['chrys.session_id']??resourceAttrs['gen_ai.conversation.id']??resourceAttrs['session.id']??resourceAttrs['teams.session.id']);
   spans.push({resourceIndex,scopeIndex,spanIndex,projectId:field('trace2.project.id'),taskId:field('teams.task.id'),nodeId:field('teams.node.id'),runId:field('teams.run.id'),sessionId:session,traceId:bytes(span.traceId,16),spanId:bytes(span.spanId,8),parentSpanId:span.parentSpanId?bytes(span.parentSpanId,8):null,startTimeUnixNano:span.startTimeUnixNano??null,endTimeUnixNano:span.endTimeUnixNano??null,kind:span.kind??null,statusCode:span.status?.code??null});
  }
 }
 return {document,spans};
}
export function scopedTraceDocument(document:Json,spans:TraceSpanSummary[]):Json{
 const positions=new Set(spans.map(span=>[span.resourceIndex,span.scopeIndex,span.spanIndex].join('/')));
 return {...document,resourceSpans:(document.resourceSpans??[]).flatMap((resource:Json,ri:number)=>{
  const scopes=(resource.scopeSpans??[]).flatMap((scope:Json,si:number)=>{const selected=(scope.spans??[]).filter((_span:Json,pi:number)=>positions.has([ri,si,pi].join('/')));return selected.length?[{...scope,spans:selected}]:[];});
  return scopes.length?[{...resource,scopeSpans:scopes}]:[];
 })};
}
