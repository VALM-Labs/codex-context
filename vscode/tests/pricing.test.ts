import { it,expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { pricesBookOf } from '../../src/client/modelPrices'
import { estimateSessionCost,priceFaceOf } from '../../src/client/cost'
import { kpisOf } from '../../src/client/overviewStats'
import { dayRangeWindow } from '../../src/client/overviewQuery'
import type { OverviewRow } from '../../src/client/overviewModel'
import { bundle,createParsed,fold } from '../src/codex/parser'

const priceData=JSON.parse(await readFile('dist/model-prices.json','utf8'))
const book=pricesBookOf(priceData)

it.each([
  ['gpt-6.1-sol',2,.1,2.5,10,3.2],
  ['gpt-6.1-terra',1,.05,1.25,5,1.6],
] as const)('prices logged %s with its verified provider-specific rates', (model,input,hit,write,output,expected)=>{
  expect(priceFaceOf(book,'openai',model)).toMatchObject({pid:'openai',mid:model,via:'direct',rate:{miss:input,hit,write,out:output}})
  const usage={openai:{[model]:{off:{uncached:1e6,cacheRead:2e6,cacheWrite:0,output:100000}}}}
  expect(estimateSessionCost(usage,book,'usd')).toBeCloseTo(expected,8)
  expect(estimateSessionCost(usage,book,'cny')).toBeCloseTo(expected/.15,8)
})

it('restores today pricing for three sessions without including yesterday or changing token usage',()=>{
  const rows:OverviewRow[]=Array.from({length:3},(_,index)=>{
    const s=createParsed(),id='session-'+index
    const add=(type:string,payload:unknown,day=8)=>{s.seq++;fold(s,{type,payload,timestamp:new Date(2026,10,day,12).toISOString()})}
    add('session_meta',{id,model_provider:'openai'})
    add('turn_context',{model:'gpt-6.1-sol'})
    add('token_usage_record',{thread_id:id,response_id:'yesterday',usage:{input_tokens:10000,cached_input_tokens:5000,output_tokens:1000}},7)
    add('token_usage_record',{thread_id:id,response_id:'today',usage:{input_tokens:200,cached_input_tokens:100,output_tokens:20}})
    const b=bundle(s)
    return {id,title:id,updatedAt:0,running:false,current:false,archived:index===2,timeline:b.timeline,activity:b.activity,family:[b.timeline],familyActivity:[b.activity],familyCost:b.timeline.cost??null}
  })
  const scope=dayRangeWindow({from:'2026-11-08',to:'2026-11-08'})!
  const staleData=JSON.parse(JSON.stringify(priceData))
  delete staleData.openai.models['gpt-6.1-sol']
  const before=kpisOf(rows,pricesBookOf(staleData),'usd',scope),after=kpisOf(rows,book,'usd',scope)
  expect(before.cost).toBeNull();expect(before.costSessions).toBe(0)
  expect(after.tokens).toBe(before.tokens);expect(after.tokens).toBe(660)
  expect(after.sessions).toBe(3);expect(after.costSessions).toBe(3)
  expect(after.cost).toBeCloseTo(.00123,10)
  expect(kpisOf(rows,book,'usd').cost).toBeGreaterThan(after.cost!)
})

it('retains snapshot provenance and official supplemental sources without guessing unknown prices',async()=>{
  const source=JSON.parse(await readFile('dist/pricing-source.json','utf8'))
  expect(source.source).toBe('@opencode-ai/models/snapshot')
  expect(source.generatedAt).toBe('2026-09-27T05:30:14.484Z')
  expect(source.supplement.verifiedAt).toBe('2026-11-08')
  expect(source.supplement.openai['gpt-6.1-sol'].source).toBe('https://developers.openai.com/api/docs/models/gpt-6.1-sol')
  expect(source.supplement.openai['gpt-6.1-terra'].source).toBe('https://developers.openai.com/api/docs/models/gpt-6.1-terra')
  expect(estimateSessionCost({openai:{'gpt-unknown-fixture':{off:{uncached:100,cacheRead:0,cacheWrite:0,output:10}}}},book,'usd')).toBeNull()
})
