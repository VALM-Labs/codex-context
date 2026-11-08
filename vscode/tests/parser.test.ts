import { describe,it,expect } from 'vitest'
import { mkdtemp,writeFile,appendFile,rm,mkdir } from 'node:fs/promises'
import path from 'node:path'
import { bundle,createParsed,fold,union } from '../src/codex/parser'
import { update,CodexStore,translated } from '../src/codex/store'

const row=(type:string,payload:unknown,timestamp='2026-11-08T08:00:00Z')=>({type,payload,timestamp})
const u=(i:number,c=0,o=0,r=0)=>({input_tokens:i,cached_input_tokens:c,output_tokens:o,reasoning_output_tokens:r,total_tokens:i+o})
const consume=(s:ReturnType<typeof createParsed>,r:unknown)=>{s.seq++;fold(s,r)}
const fixture=[row('session_meta',{id:'one',cwd:'F:/fixture',base_instructions:{text:'You are a helpful agent.'},context_window:100000}),row('event_msg',{type:'task_started',turn_id:'turn'}),row('turn_context',{turn_id:'turn',model:'gpt-5',effort:'high'}),row('response_item',{type:'additional_tools',tools:[{type:'function',name:'read_file',parameters:{type:'object'}}]}),row('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'Read the fixture'}]}),row('response_item',{type:'function_call',name:'read_file',call_id:'call',arguments:'{"path":"file.txt"}'}),row('token_usage_record',{thread_id:'one',response_id:'request',usage:u(100,60,20,5)}),row('event_msg',{type:'token_count',info:{total_token_usage:u(100,60,20,5),model_context_window:100000}}),row('response_item',{type:'function_call_output',call_id:'call',output:'Full text of fixture'},'2026-11-08T08:00:03Z'),row('response_item',{type:'message',role:'assistant',content:[{type:'output_text',text:'The fixture was read.'}]}),row('event_msg',{type:'task_complete',turn_id:'turn',duration_ms:10000,time_to_first_token_ms:1000},'2026-11-08T08:00:10Z')]

describe('Codex measurement adapter',()=>{
  it('uses native per-response counters without counting paired events or inherited parent usage',()=>{
    const s=createParsed();fixture.forEach(r=>consume(s,r));
    consume(s,row('token_usage_record',{thread_id:'one',response_id:'request',usage:u(100,60,20,5)}))
    consume(s,row('token_usage_record',{thread_id:'parent',response_id:'parent',usage:u(99999)}))
    const b=bundle(s)
    expect(b.usage).toEqual({uncachedInputTokens:40,cacheReadTokens:60,outputTokens:20,cacheWriteTokens:0})
    expect(b.timeline.requests).toHaveLength(1);expect(b.timeline.generatedReasoning).toBe(5)
    expect(b.pressure).toEqual({projectedTokens:120,contextWindow:100000})
    expect(b.timeline.fileOps?.[0].path).toBe('file.txt')
    expect(b.timeline.nodes.at(-1)?.answerTokens).toBeGreaterThan(0)
  })
  it('treats cached input and reasoning as subsets and accepts reversed paired event order',()=>{
    const s=createParsed();consume(s,row('session_meta',{id:'one'}))
    consume(s,row('event_msg',{type:'token_count',info:{total_token_usage:u(100,80,10,5)}}))
    consume(s,row('token_usage_record',{thread_id:'one',response_id:'r',usage:u(100,80,10,5)}))
    expect(s.usage.total_tokens).toBe(110);expect(s.requests).toHaveLength(1)
  })
  it('keeps complete history metadata and reconstructs pre-compaction surfaces',()=>{
    const s=createParsed();fixture.forEach(r=>consume(s,r))
    const old=s.nodes.length
    consume(s,row('compacted',{message:'A condensed summary'}))
    expect(s.archive).toHaveLength(old);expect(s.archive.every(n=>n.gone===s.seq)).toBe(true)
    expect(s.nodes).toHaveLength(1);expect(s.current.system).toBeGreaterThan(0)
    expect(s.current.user).toBe(0)
  })
  it('uses interval unions for parallel tool time and keeps missing generation timing unclassified',()=>{
    expect(union([{start:1,end:5},{start:3,end:7},{start:9,end:10}])).toEqual([{start:1,end:7},{start:9,end:10}])
    const s=createParsed();fixture.forEach(r=>consume(s,r));s.intervals.push({start:Date.parse('2026-11-08T08:00:02Z'),end:Date.parse('2026-11-08T08:00:05Z'),turn:'turn',name:'another'})
    const b=bundle(s)
    expect(b.timeline.timing?.toolBusyMs).toBe(4000);expect(b.timeline.timing?.genMs).toBe(0)
    expect(b.timeline.spans?.reduce((n,s)=>n+s.end-s.start,0)).toBe(10000)
  })
  it('does not retain a multi-megabyte tool body in indexed surface nodes',()=>{
    const s=createParsed();consume(s,row('response_item',{type:'custom_tool_call_output',output:'X'.repeat(4*1024*1024)}))
    expect(JSON.stringify(s.nodes).length).toBeLessThan(1000);expect(s.nodes[0].tokens).toBeGreaterThan(1e6)
  })
  it('maps legacy counters and inherited baselines without replay inflation',()=>{
    const s=createParsed();consume(s,row('session_meta',{id:'child',parent_thread_id:'parent'}))
    consume(s,row('event_msg',{type:'token_count',info:{total_token_usage:u(1000,800,100)}}))
    consume(s,row('event_msg',{type:'task_started',turn_id:'child'}))
    consume(s,row('event_msg',{type:'token_count',info:{total_token_usage:u(1120,880,110)}}))
    expect(s.usage).toEqual(u(120,80,10))
  })
  it('preserves visible reasoning summaries without exposing encrypted reasoning payloads',()=>{
    const s=createParsed(),r=row('response_item',{type:'reasoning',summary:[{type:'summary_text',text:'Visible reasoning summary'}],encrypted_content:'opaque-ciphertext'})
    consume(s,r)
    expect(s.nodes[0].reasoning).toBeGreaterThan(0)
    const page=JSON.stringify(translated(r,1))
    expect(page).toContain('Visible reasoning summary');expect(page).not.toContain('opaque-ciphertext')
  })
})

describe('read-only session store',()=>{
  it('preserves partial UTF-8 lines across append and fetches full content only on demand',async()=>{
    await mkdir('.tmp',{recursive:true})
    const dir=await mkdtemp(path.resolve('.tmp/test-'))
    try{
      const sessions=path.join(dir,'sessions','2026');await mkdir(sessions,{recursive:true})
      const file=path.join(sessions,'rollout-one.jsonl')
      const first=fixture.map(r=>JSON.stringify(r)).join('\n')+'\n';await writeFile(file,first)
      const line=Buffer.from(JSON.stringify(row('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'你好，保留完整原文'}]}))+'\n')
      const cut=line.indexOf(Buffer.from('好'))+1
      await appendFile(file,line.subarray(0,cut));let s=await update(file,createParsed());const old=s.nodes.length
      await appendFile(file,line.subarray(cut));s=await update(file,s)
      expect(s.nodes).toHaveLength(old+1);expect(s.malformed).toBe(0)
      const store=new CodexStore(dir),list=await store.list();expect(list).toHaveLength(1)
      const b=await store.get('one');expect(b.timeline.nodes.at(-1)?.text).toBe('你好，保留完整原文')
      const page=await store.page('one',9)
      expect(JSON.stringify(page)).toContain('Full text of fixture');expect(JSON.stringify(page)).toContain('read_file')
      const overview=await store.overview();expect(overview).toHaveProperty('one')
      expect((await store.sessionRows('one')).currentId).toBe('one')
      expect(await store.route('api/dsh-context/balance',{})).toEqual({isAvailable:false,balances:[]})
    }finally{await rm(dir,{recursive:true,force:true})}
  })
  it('returns no executable actions from malformed or unknown transcript records',()=>{
    const s=createParsed()
    for(const r of [null,42,{},row('unknown',{command:'malicious'}),row('response_item',{type:'message',content:[]})])expect(()=>consume(s,r)).not.toThrow()
    expect(s.commands).toHaveLength(0)
    expect(translated(row('unknown',{}),1)).toEqual([])
  })
  it('delivers Fleet messages to the recorded recipient and retains recorded delegation ids',async()=>{
    await mkdir('.tmp',{recursive:true});const dir=await mkdtemp(path.resolve('.tmp/fleet-'))
    try{
      await mkdir(path.join(dir,'sessions'))
      const parent=[row('session_meta',{id:'parent'}),row('response_item',{type:'function_call',name:'send_message',call_id:'m',arguments:JSON.stringify({id:'child',message:'Check the fixture'})}),row('response_item',{type:'function_call',name:'spawn_agent',call_id:'s',arguments:'{"task_name":"Reviewer"}'}),row('response_item',{type:'function_call_output',call_id:'s',output:'{"agent_id":"child"}'})]
      const child=[row('session_meta',{id:'child',parent_thread_id:'parent'})]
      for(const [id,rows]of [['parent',parent],['child',child]] as const)await writeFile(path.join(dir,'sessions',`rollout-${id}.jsonl`),rows.map(r=>JSON.stringify(r)).join('\n')+'\n')
      const store=new CodexStore(dir)
      const received=await store.route('api/dsh-context/fleet',{sessionId:'child'}) as {messages:{from:string;text:string}[]}
      expect(received.messages).toEqual([expect.objectContaining({from:'parent',text:'Check the fixture'})])
      const sender=await store.route('api/dsh-context/fleet',{sessionId:'parent'}) as {messages:unknown[];delegations:{to:string}[]}
      expect(sender.messages).toHaveLength(0);expect(sender.delegations[0].to).toBe('child')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
})
