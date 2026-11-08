import { it,expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { JSDOM,VirtualConsole } from 'jsdom'
import { bundle,createParsed,fold } from '../src/codex/parser'

const wait=()=>new Promise(resolve=>setTimeout(resolve,100))
it('runs the bundled original interface and retains DNA, delta, Fleet, Insights and Settings interactions',async()=>{
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
  Object.assign(w,{CODEX_CONTEXT_BOOT:{sidebar:false,language:'zh'},Response,Request,Headers,TextDecoder,TextEncoder})
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
        value=route.endsWith('/snapshot')?{one:{contextTimeline:b.timeline,contextActivity:b.activity}}:route.endsWith('/balance')?{isAvailable:false,balances:[]}:route.endsWith('/fleet')?b.fleet:route.endsWith('/heads')?{}:null
      }
      if(message.method==='page')value={records:[]}
      queueMicrotask(()=>send({type:'response',id:message.id,value}))
    }
  }})})
  try{
    w.eval(await readFile('dist/webview.js','utf8'))
    await wait();await wait()
    expect(w.document.querySelectorAll('.lc-card').length).toBeGreaterThan(5)
    const click=(label:string)=>{
      const buttons=[...w.document.querySelectorAll<HTMLButtonElement>('button')]
      const button=buttons.find(b=>b.textContent?.trim()===label)
      expect(button,`Expected original button: ${label}`).toBeTruthy();button!.click();return button!
    }
    const dna=click('DNA 模式');await wait();expect(dna.classList.contains('lc-gran-on')).toBe(true)
    const delta=click('增量');await wait();expect(delta.classList.contains('lc-gran-on')).toBe(true)
    click('轮次');await wait()
    const tabs=[...w.document.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    for(const index of [1,2,3,0]){
      tabs[index].click();await wait();await wait();expect(w.document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe(tabs[index].textContent)
      if(index===2){const card=w.document.querySelector<HTMLButtonElement>('.lc-ov-session');expect(card).toBeTruthy();card!.click();await wait();expect(w.document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('上下文')}
      if(index===3)expect([...w.document.querySelectorAll<HTMLTextAreaElement>('textarea')].every(t=>t.disabled)).toBe(true)
    }
    expect(errors).toEqual([])
  }finally{w.close()}
})
