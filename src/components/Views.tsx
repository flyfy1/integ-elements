import { useEffect, useState } from 'react'
import { CATS, ELS, bothNames, loadDetail, type Accent, type Detail, type El, type Lang } from '../data'
import { t } from '../i18n'
import { PlayIcon, SlowIcon, Respell } from './Stage'
import { Repeat } from './Detail'

export function Tricky({ lang, accent, onPlay, onOpen }: { lang: Lang; accent: Accent; onPlay: (el: El) => void; onOpen: (el: El) => void }) {
  const [d, setD] = useState<Record<number, Detail> | null>(null)
  useEffect(() => { void loadDetail().then(setD) }, [])
  const list = ELS.filter(e => e.t >= 2).sort((a, b) => b.t - a.t || a.z - b.z)
  const a = accent === 'us' ? 0 : 1
  return (
    <div className="list-view">
      <p className="lv-intro">{t(lang, 'trickyIntro')}</p>
      <ul className="tricky-list">
        {list.map(e => {
          const tr = d?.[e.z]?.traps?.[0]
          return (
            <li key={e.z} style={{ ['--c' as string]: CATS[e.c].hex }}>
              <button type="button" className="rbtn main sm" onClick={() => onPlay(e)} aria-label={`${t(lang, 'play')} ${accent === 'us' ? e.us : e.uk}`}><PlayIcon /></button>
              <button type="button" className="tr-body" onClick={() => onOpen(e)}>
                <span className="tr-head"><span className="sym-chip">{e.s}</span><b lang="en">{bothNames(e)}</b><span className="zh-ch">{e.zh}</span><span className="lvl" aria-label={`level ${e.t}`}>{'●'.repeat(e.t)}<span className="muted">{'●'.repeat(3 - e.t)}</span></span></span>
                <span className="tr-ipa" lang="en">{e.ipa[a] ? `/${e.ipa[a]}/` : t(lang, 'unverified')} {e.rs[a] ? <span className="muted">{e.rs[a]}</span> : null}</span>
                {tr ? <span className="tr-trap"><s lang="en">{tr.wrong}</s> {lang === 'zh' ? tr.why_zh : tr.why_en}</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function About({ lang, onReset }: { lang: Lang; onReset: () => void }) {
  const zh = lang === 'zh'
  return (
    <div className="list-view about">
      <h2>{t(lang, 'aboutTitle')}</h2>
      {zh ? (
        <>
          <p>这是一张会发音的元素周期表：点任意元素，听它的英文名怎么读，有美音和英音、正常和慢速，还有一句例句。适合学化学的中文学生和英语学习者。</p>
          <h3>读音从哪里来</h3>
          <p>每个音标都来自词典，不靠猜：牛津高阶（Oxford Learner's Dictionaries）、朗文（Longman）、维基词典（Wiktionary，经 kaikki.org）和 CMU 发音词典。只有两个独立来源一致时，才把音标标为已核实并显示出来；没有核实的口音只显示「未核实」，录音是语音直接读出名字。录音由 ElevenLabs 生成，并逐条转写回文字检查。</p>
          <h3>中文名和拼音</h3>
          <p>中文名来自 Wikidata 并与维基词典核对；拼音来自 Unicode Unihan（《通用规范汉字字典》2013、《现代汉语词典》读音）并与维基词典核对；113、115、117、118 号元素依据全国科学技术名词审定委员会 2017 年的定名。</p>
          <h3>其他数据</h3>
          <p>熔点、沸点、分类和电子排布来自 PubChem（美国国立卫生研究院，公共领域）。「你知道吗」和「名字的来历」根据维基百科对应条目撰写，每一句都保存了原文出处并经过核对。图片为 AI 生成的示意图，不是实物照片。</p>
        </>
      ) : (
        <>
          <p>A periodic table that talks: tap any element to hear its English name in an American and a British voice, at normal and slow speed, with an example sentence. Made for chemistry students and English learners, especially Chinese speakers.</p>
          <h3>Where the pronunciations come from</h3>
          <p>Every IPA transcription comes from a dictionary, never from guesswork: Oxford Learner's Dictionaries, Longman, Wiktionary (via kaikki.org) and the CMU Pronouncing Dictionary. A pronunciation is marked verified and shown only when two independent sources agree. Where an accent is not verified the site says so, and the recording is the voice reading the name. Audio is generated with ElevenLabs and every clip was transcribed back to check it.</p>
          <h3>Chinese names and pinyin</h3>
          <p>Chinese names come from Wikidata, checked against Wiktionary; pinyin from the Unicode Unihan database (通用规范汉字字典 2013 and 现代汉语词典 readings), checked against Wiktionary. Elements 113, 115, 117 and 118 follow the 2017 naming by 全国科学技术名词审定委员会.</p>
          <h3>Other data</h3>
          <p>Melting and boiling points, categories and electron configurations come from PubChem (NIH, public domain). "Did you know" and "Where the name comes from" are written from each element's Wikipedia article; every line keeps its source quote and was checked against it. Pictures are AI-generated illustrations, not photographs.</p>
        </>
      )}
      <h3>{zh ? '来源与许可' : 'Sources and licences'}</h3>
      <ul className="credits">
        <li><a href="https://pubchem.ncbi.nlm.nih.gov/periodic-table/" rel="noopener">PubChem Periodic Table</a> (public domain)</li>
        <li><a href="https://www.oxfordlearnersdictionaries.com/" rel="noopener">Oxford Learner's Dictionaries</a> · <a href="https://www.ldoceonline.com/" rel="noopener">Longman Dictionary of Contemporary English</a></li>
        <li><a href="https://en.wiktionary.org/" rel="noopener">Wiktionary</a> via <a href="https://kaikki.org/" rel="noopener">kaikki.org</a> (CC BY-SA 4.0) · <a href="https://en.wikipedia.org/" rel="noopener">Wikipedia</a> (CC BY-SA 4.0)</li>
        <li><a href="https://github.com/cmusphinx/cmudict" rel="noopener">CMU Pronouncing Dictionary</a> · <a href="https://www.wikidata.org/" rel="noopener">Wikidata</a> (CC0) · <a href="https://www.unicode.org/charts/unihan.html" rel="noopener">Unicode Unihan</a></li>
        <li><a href="http://www.cnterm.cn/news/zhxw/202410/t20241010_762166.html" rel="noopener">全国科学技术名词审定委员会：113、115、117、118 号元素中文定名</a></li>
        <li>{t(lang, 'speakNote')} {zh ? '图片由 OpenAI 图像模型生成。' : 'Pictures generated with an OpenAI image model.'}</li>
        <li><a href="/elements.json">elements.json</a> · <a href="/llms.txt">llms.txt</a></li>
      </ul>
      <p className="muted">{zh ? '进度（已听、收藏、测验成绩）只保存在你的浏览器里。' : 'Progress (heard, starred, quiz scores) is kept only in your browser.'} <button type="button" className="linkish" onClick={onReset}>{t(lang, 'resetProgress')}</button></p>
      <p className="muted"><a href="https://integ.life/">integ.life</a></p>
    </div>
  )
}

/** Listen & repeat: one name at a time, big; play (normal/slow), record yourself, compare, next. */
export function Practice({ lang, accent, onPlay, onAccent, onOpen }: { lang: Lang; accent: Accent; onPlay: (el: El, k: 'name' | 'slow') => void; onAccent: (a: Accent) => void; onOpen: (el: El) => void }) {
  const [set, setSet] = useState<'tricky' | 'all'>('tricky')
  const list = set === 'tricky' ? ELS.filter(e => e.t >= 2).sort((a, b) => b.t - a.t || a.z - b.z) : ELS
  const [i, setI] = useState(0)
  const el = list[Math.min(i, list.length - 1)]
  const a = accent === 'us' ? 0 : 1
  const [d, setD] = useState<Record<number, Detail> | null>(null)
  useEffect(() => { void loadDetail().then(setD) }, [])
  const tr = d?.[el.z]?.traps?.[0]
  const go = (n: number) => { const j = (i + n + list.length) % list.length; setI(j); onPlay(list[j], 'name') }
  return (
    <div className="list-view practice" style={{ ['--c' as string]: CATS[el.c].hex }}>
      <p className="lv-intro">{t(lang, 'practiceIntro')}</p>
      <div className="pr-top">
        <div className="seg" role="radiogroup">
          {(['tricky', 'all'] as const).map(s => <button key={s} type="button" role="radio" aria-checked={set === s} className={set === s ? 'on' : ''} onClick={() => { setSet(s); setI(0) }}>{t(lang, s === 'tricky' ? 'practiceTricky' : 'practiceAll')}</button>)}
        </div>
        <div className="seg" role="radiogroup" aria-label={t(lang, 'accent')}>
          {(['us', 'uk'] as const).map(x => <button key={x} type="button" role="radio" aria-checked={accent === x} className={accent === x ? 'on' : ''} onClick={() => onAccent(x)}>{t(lang, x)}</button>)}
        </div>
        <span className="muted pr-count">{Math.min(i, list.length - 1) + 1} / {list.length}</span>
      </div>
      <div className="pr-card" key={el.z}>
        <button type="button" className="pr-sym" onClick={() => onOpen(el)} aria-label={`${t(lang, 'details')}: ${bothNames(el)}`}>{el.s}</button>
        <h2 className="pr-name" lang="en">{accent === 'us' ? el.us : el.uk}</h2>
        <Respell rs={el.rs[a]} />
        <div className="pr-ipa" lang="en">{el.ipa[a] ? `/${el.ipa[a]}/` : <span className="unv">{t(lang, 'unverified')}</span>}</div>
        <div className="pr-btns">
          <button type="button" className="rbtn main" onClick={() => onPlay(el, 'name')} aria-label={`${t(lang, 'play')} ${accent === 'us' ? el.us : el.uk}`}><PlayIcon /></button>
          <button type="button" className="rbtn" onClick={() => onPlay(el, 'slow')} aria-label={`${t(lang, 'play')} ${t(lang, 'slow')}`}><SlowIcon /></button>
        </div>
        {tr ? <p className="pr-trap"><s lang="en">{tr.wrong}</s> {lang === 'zh' ? tr.why_zh : tr.why_en}</p> : null}
        <p className="pr-zh"><span className="zh-ch">{el.zh}</span> {el.py}</p>
        <Repeat el={el} accent={accent} lang={lang} />
      </div>
      <div className="pr-nav">
        <button type="button" className="pill ghost" onClick={() => go(-1)}>← {t(lang, 'prev')}</button>
        <button type="button" className="pill" onClick={() => go(1)}>{t(lang, 'next')} →</button>
      </div>
    </div>
  )
}
