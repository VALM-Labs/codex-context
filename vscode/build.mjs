import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { providers, generatedAt } from '@opencode-ai/models/snapshot'

const root=dirname(fileURLToPath(import.meta.url)),repo=dirname(root)
await mkdir(join(root,'dist'),{recursive:true})
await mkdir(join(root,'media'),{recursive:true})
await copyFile(join(repo,'icon.svg'),join(root,'media','context.svg'))
await copyFile(join(repo,'LICENSE'),join(root,'LICENSE'))
const common={bundle:true,logLevel:'info',nodePaths:[join(root,'node_modules')],legalComments:'eof'}
const alias=Object.fromEntries(['react','react-dom','@deepseek-ai/dsh-client-ui-primitives','@deepseek-ai/dsh-util-workspace-path','@opencode-ai/models','simple-icons'].map(name=>[name,join(root,'node_modules',name)]))
alias['@opencode-ai/models']=join(root,'node_modules/@opencode-ai/models/dist/index.js')
await build({...common,entryPoints:{extension:join(root,'src/extension.ts'),worker:join(root,'src/worker.ts')},outdir:join(root,'dist'),outExtension:{'.js':'.cjs'},platform:'node',format:'cjs',target:'node20',external:['vscode']})
const browser=await build({...common,alias,metafile:true,entryPoints:[join(root,'src/webview/main.tsx')],outfile:join(root,'dist/webview.js'),platform:'browser',format:'iife',target:'chrome120',jsx:'automatic',loader:{'.module.css':'local-css','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.MODE':'"production"','import.meta.env':'{}',__DSH_CTX_VERSION__:'"0.1.0"',__DSH_CTX_REPO__:'"https://github.com/VALM-Labs/codex-context"'},
  plugins:[{name:'upstream-svg',setup(b){b.onResolve({filter:/\.svg\?raw$/},args=>({path:resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'svg-raw'}));b.onLoad({filter:/.*/,namespace:'svg-raw'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}))}},
    {name:'upstream-tailwind',setup(b){b.onLoad({filter:/[\\/]tailwind\.css$/},async args=>{const compiler=await compile(await readFile(args.path,'utf8'),{base:dirname(args.path)});const scanner=new Scanner({sources:compiler.sources});return {contents:compiler.build(scanner.scan()),loader:'css',resolveDir:dirname(args.path)}})}},
    {name:'codex-host-capabilities',setup(b){
      b.onLoad({filter:/[\\/]src[\\/]client[\\/]meta\.ts$/},async args=>({contents:(await readFile(args.path,'utf8')).replace("export const PLUGIN_NAME = 'dsh-context'","export const PLUGIN_NAME = 'codex-context'"),loader:'ts'}))
      b.onLoad({filter:/[\\/]src[\\/]client[\\/]components[\\/]settingsCard\.tsx$/},async args=>{
        let count=0
        const contents=(await readFile(args.path,'utf8')).replace(/(<PromptTextRow\b[\s\S]*?disabled=\{)disabled(\})/g,(_match,a,z)=>{count++;return a+'true'+z})
        if(count!==2)throw new Error('Upstream prompt controls changed; review Codex read-only capability mapping.')
        return {contents,loader:'tsx'}
      })
    }}]
})
const imported=[]
for(const input of Object.keys(browser.metafile.inputs))if(input.replaceAll('\\','/').includes('../src/client/')){
  const name=resolve(root,input),data=await readFile(name)
  imported.push({file:input.replaceAll('\\','/').replace(/^\.\.\//,''),sha256:createHash('sha256').update(data).digest('hex')})
}
await writeFile(join(root,'dist','upstream-provenance.json'),JSON.stringify({upstream:'bowenliang123/dsh-context',revision:'dd45d3c6485677f625d8bfbaa0751ef77d5c1879',imported},null,2))
const prices={}
for(const [id,p]of Object.entries(providers))prices[id]={models:Object.fromEntries(Object.entries(p.models).filter(([,m])=>m.cost).map(([name,m])=>[name,{id:name,cost:m.cost,canonical_model_id:m.canonical_model_id}]))}
await writeFile(join(root,'dist','model-prices.json'),JSON.stringify(prices))
await writeFile(join(root,'dist','pricing-source.json'),JSON.stringify({source:'@opencode-ai/models/snapshot',generatedAt}))
console.log('Built original dsh-context components for VS Code.')
