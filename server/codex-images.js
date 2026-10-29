import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {runImageTurn} from './chatgpt-local.js';

export class ImageGenerationError extends Error {
  constructor(code,message,status=400){super(message);this.name='ImageGenerationError';this.code=code;this.status=status;}
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=20*1024*1024;
const pngMagic=Buffer.from([137,80,78,71,13,10,26,10]);
function requireId(id){if(!UUID.test(id||''))throw new ImageGenerationError('invalid_job','无效的图片任务。');return id;}
function safeFileExtension(bytes,mime){
 if(mime==='image/png'&&bytes.subarray(0,8).equals(pngMagic))return 'png';
 if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
 if(mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'webp';
 throw new ImageGenerationError('invalid_reference','参考图片内容与格式不匹配，请使用 PNG、JPG 或 WebP。');
}
function references(input){
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>9)throw new ImageGenerationError('invalid_references','最多使用 9 张参考图。');
 let total=0;
 return input.map((ref,index)=>{
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(ref?.dataUrl||'');
  if(!match)throw new ImageGenerationError('invalid_reference','参考必须是本机上传的图片数据。');
  const bytes=Buffer.from(match[2],'base64');total+=bytes.length;
  if(!bytes.length||bytes.length>8*1024*1024||total>MAX_BYTES)throw new ImageGenerationError('reference_too_large','每张参考最多 8MB，总计最多 20MB。',413);
  const ext=safeFileExtension(bytes,match[1]);
  return {name:`reference-${index+1}.${ext}`,bytes,purpose:['portrait','wardrobe','style'].includes(ref.type||ref.kind)?(ref.type||ref.kind):'style'};
 });
}
export function createImageService({chatgptService,rootDirectory=path.resolve('server/local-data/images'),runTurn=runImageTurn,now=Date.now,timeoutMs=12*60_000}={}){
 const root=path.resolve(rootDirectory),jobs=new Map();let active=null;
 const publicJob=job=>({id:job.id,assetId:job.assetId,projectId:job.projectId,status:job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,...(job.status==='succeeded'?{imageUrl:`/api/chatgpt/image-jobs/${job.id}/image.png`,width:job.width,height:job.height,reviewStatus:'pending',provider:'codex-local'}:{}),...(job.error?{error:job.error}:{})});
 async function readiness(){const s=await chatgptService.status();if(!s.session?.sharing)throw new ImageGenerationError('login_required','请先在本机 Codex 中登录自己的 ChatGPT 账号。',401);if(s.capabilities?.images!==true)throw new ImageGenerationError('image_tool_unavailable','当前本机 Codex 未检测到可用的原生图片工具。',503);}
 async function execute(job,prepared){
  job.status='running';job.updatedAt=new Date(now()).toISOString();
  const controller=new AbortController();job.controller=controller;const timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  try{
   const dir=path.join(root,job.id);await mkdir(dir,{recursive:true,mode:0o700});
   const refPaths=[];
   for(const ref of prepared){const file=path.join(dir,ref.name);await writeFile(file,ref.bytes,{mode:0o600});refPaths.push(file);}
   const referenceNote=prepared.map((r,i)=>`${i+1}. ${r.name}：${r.purpose==='portrait'?'人物身份参考，只沿用脸部、发型和体态':r.purpose==='wardrobe'?'服装结构参考，不沿用商品模特脸':'风格光色参考，不自动沿用人物身份'}`).join('\n');
   const prompt=`Use the built-in image generation tool to produce exactly one genuine raster image for the following asset. Do not draw or synthesize the requested image using SVG, canvas, Python, Pillow, CSS, or code. Do not call a separately billed image API. If the built-in tool is unavailable, stop with an explicit error; do not create a placeholder. Save or copy the actual generated PNG to the working directory as asset.png. Never report visual review as passed; only the human can approve it.\n\n资产要求：${job.prompt}\n\n参考用途（先实际查看所列图片，再传给图像工具）：\n${referenceNote||'无上传参考，按虚构原创设计。'}\n\n只在本任务目录写入最终asset.png与必要的本机临时文件；不得读取认证文件、其他项目或账户秘密，不提交代码，不安装程序，不启动视频任务。`;
   const result=await runTurn({cliPath:chatgptService.cliPath,cwd:dir,prompt,referencePaths:refPaths,signal:controller.signal});
   if(controller.signal.aborted||job.status==='cancelled')throw new ImageGenerationError('cancelled','图片任务已取消。',409);
   // A real native image-generation completion is required in addition to a file.
   if(result?.imageGenerated!==true)throw new ImageGenerationError('no_image_tool_result','Codex 没有返回原生图片生成结果。未将任何占位文件视为成品。',502);
   const output=path.join(dir,'asset.png');const details=await lstat(output);if(!details.isFile()||details.isSymbolicLink()||details.size>32*1024*1024)throw new ImageGenerationError('invalid_image','生成图片文件无效。',502);
   const actual=await realpath(output);if(!actual.startsWith((await realpath(dir))+path.sep))throw new ImageGenerationError('invalid_image','图片不在本任务目录。',502);
   const bytes=await readFile(actual);if(bytes.length<24||!bytes.subarray(0,8).equals(pngMagic))throw new ImageGenerationError('invalid_image','Codex 未交付有效 PNG 图片。',502);
   const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(width<64||height<64||width>16384||height>16384)throw new ImageGenerationError('invalid_image','生成图片尺寸无效。',502);
   job.status='succeeded';job.width=width;job.height=height;job.updatedAt=new Date(now()).toISOString();
   await writeFile(path.join(dir,'result.json'),JSON.stringify(publicJob(job),null,2),{mode:0o600});
  }catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.error={code:controller.signal.aborted?'cancelled':error instanceof ImageGenerationError?error.code:'image_generation_failed',message:controller.signal.aborted?'图片任务已取消或超时。':error instanceof ImageGenerationError?error.message:'本机 Codex 图片生成失败，请检查登录、额度与工具可用性后重试。'};job.updatedAt=new Date(now()).toISOString();}
  finally{clearTimeout(timer);delete job.controller;if(active===job.id)active=null;}
 }
 return {
  async start(input={}){
   await readiness();if(active)throw new ImageGenerationError('image_busy','已有一个图片任务正在运行，请等待或取消后再试。',409);
   if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>24000)throw new ImageGenerationError('invalid_prompt','请输入不超过 24000 字的资产提示词。');
   if(!/^[CPL]\d{3,4}$/.test(input.assetId||''))throw new ImageGenerationError('invalid_asset','无效的资产编号。');
   const prepared=references(input.references);const id=randomUUID();const createdAt=new Date(now()).toISOString();
   const job={id,assetId:input.assetId,projectId:typeof input.projectId==='string'?input.projectId.slice(0,160):null,prompt:input.prompt.trim(),status:'queued',createdAt,updatedAt:createdAt};
   if(jobs.size>=200){for(const [key,value] of jobs){if(!['queued','running'].includes(value.status)){jobs.delete(key);break}}if(jobs.size>=200)throw new ImageGenerationError('job_capacity','任务记录已满，请重启本地服务。',503);}
   jobs.set(id,job);active=id;void execute(job,prepared);return publicJob(job);
  },
  get(id){const job=jobs.get(requireId(id));if(!job)throw new ImageGenerationError('job_not_found','未找到图片任务。',404);return publicJob(job);},
  cancel(id){const job=jobs.get(requireId(id));if(!job)throw new ImageGenerationError('job_not_found','未找到图片任务。',404);if(['queued','running'].includes(job.status)){job.status='cancelled';job.controller?.abort();job.updatedAt=new Date(now()).toISOString();}return publicJob(job);},
  async image(id){requireId(id);const file=path.join(root,id,'asset.png');try{const dir=await realpath(path.join(root,id)),real=await realpath(file);if(!real.startsWith(dir+path.sep))throw Error();const details=await lstat(file);if(details.isSymbolicLink()||!details.isFile()||details.size>32*1024*1024)throw Error();const bytes=await readFile(file);if(!bytes.subarray(0,8).equals(pngMagic))throw Error();const record=JSON.parse(await readFile(path.join(root,id,'result.json'),'utf8'));if(record.status!=='succeeded')throw Error();return bytes}catch{throw new ImageGenerationError('image_not_found','图片尚未生成或已不存在。',404);}},
  async close(){for(const job of jobs.values())job.controller?.abort();},
 };
}
