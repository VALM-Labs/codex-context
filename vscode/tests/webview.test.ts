import { it,expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { JSDOM,VirtualConsole } from 'jsdom'
import { bundle,createParsed,fold } from '../src/codex/parser'
import { DICTS } from '../../src/client/i18n'

const wait=()=>new Promise(resolve=>setTimeout(resolve,100))
it.each(['zh','en','ja','es','fr','de','ru','pt'] as const)('adapts original pages and host controls to Codex in %s',async(language)=>{
  const dictionary=DICTS[language] as Record<string,string>
  const text=(key:string)=>dictionary[key]
  const s=createParsed()
  const add=(type:string,payload:unknown)=>{s.seq++;fold(s,{type,payload,timestamp:'2026-11-08T08:00:00Z'})}
  add('session_meta',{id:'one',cwd:'F:/fixture',base_instructions:'Be helpful.',context_window:100000})
  add('event_msg',{type:'task_started',turn_id:'t'})
  add('turn_context',{model:'gpt-5',turn_id:'t'})
  add('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic test question'}]})
  for(let i=0;i<4;i++){
    add('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic test answer '+i}]})
    add('token_usage_record',{thread_id:'one',response_id:'r'+i,usage:{input_tokens:1000+i*200,cached_input_tokens:800,output_tokens:100,reasoning_output_tokens:10,total_tokens:1100+i*200}})
  }
  add('event_msg',{type:'task_complete',turn_id:'t',duration_ms:2000,time_to_first_token_ms:200})
  const b=bundle(s),byId={one:{id:'one',title:'Fixture',cwd:'F:/fixture',updatedAt:Date.now(),projectionValues:{contextTimeline:b.timeline,contextActivity:b.activity,contextPressure:b.pressure,tokenUsage:b.usage}}}
  const errors:string[]=[]
  const console=new VirtualConsole();console.on('jsdomError',(error:Error)=>{if(!/Not implemented: window.computedStyle/.test(error.message))errors.push(error.message)})
  const dom=new JSDOM('<!doctype html><html><body data-ds-dark-theme><div id="root"></div></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://codex-context.test/',virtualConsole:console})
  const w=dom.window
  Object.assign(w,{CODEX_CONTEXT_BOOT:{sidebar:false,language},Response,Request,Headers,TextDecoder,TextEncoder})
  const routes:string[]=[]
  const send=(data:unknown)=>w.dispatchEvent(new w.MessageEvent('message',{data}))
  const state={type:'state',sessions:[{id:'one',title:'Fixture',cwd:'F:/fixture'}],selected:'one',bundle:b,rows:{byId,ids:['one'],currentId:'one'},workspaces:{items:[]},compressed:0}
  Object.assign(w,{acquireVsCodeApi:()=>({getState:()=>({}),setState:()=>{},postMessage:(message:Record<string,unknown>)=>{
    if(message.type==='ready')queueMicrotask(()=>send(state))
    if(message.type==='request'){
      let value:unknown={}
      const args=message.args as Record<string,unknown>
      if(message.method==='prices')value={openai:{models:{'gpt-5':{cost:{input:1,output:2,cache_read:.1}}}}}
      if(message.method==='route'){
        const route=String(args.route)
        routes.push(route)
        value=route.endsWith('/snapshot')?{one:{contextTimeline:b.timeline,contextActivity:b.activity}}:route.endsWith('/balance')?{isAvailable:false,balances:[]}:route.endsWith('/fleet')?b.fleet:route.endsWith('/heads')?{}:null
      }
      if(message.method==='page')value={records:[]}
      queueMicrotask(()=>send({type:'response',id:message.id,value}))
    }
  }})})
  try{
    w.eval(await readFile('dist/webview.js','utf8'))
    const requestedUrls:string[]=[],fetch=w.fetch.bind(w)
    w.fetch=(input,init)=>{requestedUrls.push(String(input));return fetch(input,init)}
    await wait();await wait()
    expect(w.document.querySelectorAll('.lc-card').length).toBeGreaterThan(5)
    expect(w.document.querySelector('.lc-recom-brand')?.textContent).toBe('codex-context')
    expect(w.document.querySelector('.lc-recom')?.getAttribute('href')).toBe('https://github.com/VALM-Labs/codex-context')
    const tooltip=w.document.querySelector('.lc-recom')?.getAttribute('aria-describedby')
    expect(tooltip).toBeTruthy();expect(w.document.getElementById(tooltip!)?.getAttribute('role')).toBe('tooltip')
    const click=(label:string)=>{
      const buttons=[...w.document.querySelectorAll<HTMLButtonElement>('button')]
      const button=buttons.find(b=>b.textContent?.trim()===label)
      expect(button,`Expected original button: ${label}`).toBeTruthy();button!.click();return button!
    }
    const dna=click(text('trend.dna'));await wait();expect(dna.classList.contains('lc-gran-on')).toBe(true)
    const delta=click(text('gran.delta'));await wait();expect(delta.classList.contains('lc-gran-on')).toBe(true)
    click(text('gran.turn'));await wait()
    const tabs=[...w.document.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    for(const index of [1,2,3,0]){
      tabs[index].click();await wait();await wait();expect(w.document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(tabs[index].textContent)
      expect(w.document.body.textContent).not.toMatch(/DeepSeek|Harness|\bDSH\b/i)
      expect([...w.document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).join(' ')).not.toMatch(/deepseek|npmjs\.com|npmmirror/i)
      if(index===2){const card=w.document.querySelector<HTMLButtonElement>('.lc-ov-session');expect(card).toBeTruthy();card!.click();await wait();expect(w.document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(text('tab.context'))}
      if(index===3){
        expect(w.document.querySelectorAll('textarea').length).toBe(0)
        expect(w.document.body.textContent).not.toContain(text('settings.placement'))
        const setVisibility=async(field:string,value:string)=>{
          const row=[...w.document.querySelectorAll('.lc-settings-row')].find(row=>row.querySelector('.lc-settings-label')?.textContent===text(field))
          expect(row).toBeTruthy();row!.querySelector<HTMLButtonElement>('button')!.click();await wait()
          const item=[...w.document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find(item=>item.textContent?.trim()===text('showHide.'+value))
          expect(item).toBeTruthy();item!.click();await wait()
        }
        await setVisibility('settings.fleetTab','hide');expect(w.document.querySelectorAll('[role=tab]').length).toBe(3)
        await setVisibility('settings.insightsEntry','hide');expect(w.document.querySelectorAll('[role=tab]').length).toBe(2)
        await setVisibility('settings.fleetTab','show');await setVisibility('settings.insightsEntry','show')
        expect(w.document.querySelectorAll('[role=tab]').length).toBe(4)
      }
    }
    expect(routes.some(route=>/\/(recom|balance)$/.test(route))).toBe(false)
    expect(requestedUrls.filter(url=>/^https?:/.test(url))).toEqual([])
    expect(errors).toEqual([])
  }finally{w.close()}
})
