import {rm,mkdir,cp,readFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await cp('index.html','dist/index.html');await cp('src','dist/src',{recursive:true});await cp('public','dist',{recursive:true});
console.log('Central.ai static build ready in dist/');
