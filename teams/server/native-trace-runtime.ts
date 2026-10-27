import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {nativeSkillEnvironment} from './native-skill-reader.js';
import {root} from './config.js';
const execute=promisify(execFile);
/** Verify the real selected runtime, not another Python on PATH. Does not install anything. */
export async function nativeTraceRuntime(){
 const native=await nativeSkillEnvironment(),script=join(root,'scripts/native/check-trace-runtime.py');
 const check=JSON.parse((await execute(native.python,['-I',script],{timeout:15000,maxBuffer:65536})).stdout);
 if(check.ready!==true)throw new Error(`当前 iCode 缺少匹配的 OTLP HTTP 依赖（SDK ${check.sdkVersion??'未安装'}）。请按快速启动说明为此 iCode Python 安装相同版本 exporter；未关闭 trace 或改用其他运行时。`);
 return {python:native.python,configDirectory:native.configDirectory,script,nativeVersion:native.version,sdkVersion:String(check.sdkVersion),exporterVersion:String(check.exporterVersion)};
}
