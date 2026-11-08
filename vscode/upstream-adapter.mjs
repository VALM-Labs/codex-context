import { readFile } from 'node:fs/promises'
import { dirname,join } from 'node:path'

function replaceOnce(source,from,to){
  const parts=source.split(from)
  if(parts.length!==2)throw new Error('Upstream host surface changed; review the Codex adapter: '+from)
  return parts.join(to)
}

export function codexHostPlugin(root){
  return {name:'codex-host-capabilities',setup(build){
    build.onLoad({filter:/[\\/]src[\\/]client[\\/](?:meta\.ts|latestVersion\.ts|components[\\/](?:settingsCard|pluginInfo|recomCard|balanceCapsule)\.tsx)$/},async args=>{
      let contents=await readFile(args.path,'utf8')
      const name=args.path.replaceAll('\\','/').split('/').at(-1)
      if(name==='meta.ts')contents=replaceOnce(contents,"export const PLUGIN_NAME = 'dsh-context'","export const PLUGIN_NAME = 'codex-context'")
      if(name==='latestVersion.ts')contents='export const useNewerVersion = () => null'
      if(name==='recomCard.tsx')contents='export { makeRecomCard } from '+JSON.stringify(join(root,'src/webview/hostCards.tsx'))
      if(name==='balanceCapsule.tsx')contents='export const makeBalanceCapsule = () => () => null'
      if(name==='pluginInfo.tsx'){
        contents=replaceOnce(contents,'siDeepseek, siGithub','siGithub')
        contents=replaceOnce(contents,'<SiteMark icon={siDeepseek} />','<IconPlugin size={12} className="lc-pi-labelicon" />')
      }
      if(name==='settingsCard.tsx'){
        const placement=contents.match(/        <PrefRow\s+label=\{t\('settings\.placement'\)\}[\s\S]*?        \/>/)?.[0]
        const prompts=contents.match(/      <Group title=\{t\('settings\.group\.prompt'\)\}>[\s\S]*?      <\/Group>/)?.[0]
        if(!placement||!prompts)throw new Error('Upstream settings changed; review Codex-only preferences.')
        contents=replaceOnce(replaceOnce(contents,placement,''),prompts,'')
      }
      return {contents,loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:dirname(args.path)}
    })
  }}
}
