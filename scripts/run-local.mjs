import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
if(Number(process.versions.node.split('.')[0])<22){console.error('Central.ai 本机版需要 Node.js 22 或更新版本。');process.exit(1);}
const build=spawn(process.execPath,['scripts/build.mjs'],{cwd:root,stdio:'inherit',shell:false});
await new Promise((resolve,reject)=>{build.on('exit',code=>code===0?resolve():reject(Error('Build failed')));build.on('error',reject)});
const child=spawn(process.execPath,['--env-file-if-exists=server/.env','server/index.js'],{cwd:root,stdio:['inherit','pipe','inherit'],shell:false});
let opened=false;child.stdout.on('data',chunk=>{process.stdout.write(chunk);if(!opened&&chunk.toString().includes('server listening')){opened=true;const url='http://localhost:3000';const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const browser=spawn(command,args,{stdio:'ignore',shell:false});browser.on('error',()=>console.log(`请手动打开 ${url}`));browser.unref();}});
child.on('error',error=>{console.error(error.message);process.exitCode=1});child.on('exit',code=>{process.exitCode=code||0});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
