import { useId,type ReactElement } from 'react'
import type { ClientCtx } from '../../../src/client/services'
import type { ViewKit } from '../../../src/client/viewkit'
import { IconShare } from '../../../src/client/primitives'
import { PLUGIN_NAME, PLUGIN_REPO } from '../../../src/client/meta'
import { hostText } from './hostCopy'

export function makeRecomCard(kit:ViewKit,ctx:ClientCtx):()=>ReactElement{
  return function CodexCard():ReactElement{
    kit.useLocaleTick()
    const tooltipId=useId()
    const text=(key:string)=>hostText(ctx.locale.getLocale?.().active??'en',key)
    return <a className="lc-card lc-recom" href={PLUGIN_REPO} target="_blank" rel="noreferrer" aria-describedby={tooltipId}>
      <div className="lc-recom-link">
        <div className="lc-recom-main">
          <div className="lc-recom-mark"><span className="lc-recom-fallback" aria-hidden="true">C</span></div>
          <div className="lc-recom-copy">
            <div className="lc-recom-brand"><span>{PLUGIN_NAME}</span></div>
            <div className="lc-recom-slogan">{text('card.slogan')}</div>
          </div>
        </div>
        <div className="lc-recom-promo"><span className="lc-recom-spark" aria-hidden="true">✦</span><span>{text('card.promotion')}</span></div>
        <IconShare size={14} className="lc-recom-arrow"/>
      </div>
      <div className="lc-recom-tooltip" role="tooltip" id={tooltipId}>{text('card.tooltip')}</div>
    </a>
  }
}
