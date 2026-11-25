// prerender + SEO (after `vite build`, free, no network). Writes into dist/:
//  /, /zh/, /element/<slug>/ ×118 ×2, /tricky/ /quiz/ /about/ (+ /zh/), US-spelling redirects, 404.html,
//  sitemap.xml (with images), robots.txt, manifest.webmanifest, llms.txt, sw.js (build-id cache).
// Each page carries real HTML (name, verified IPA, audio, picture, fact…) that the app replaces.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ROOT } from './lib/manifest.ts'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const SITE = 'https://elements.integ.life'
const DIST = join(ROOT, 'dist')
const tpl = readFileSync(join(DIST, 'index.html'), 'utf8')
const els: Any[] = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8'))
const img: Any = existsSync(join(ROOT, 'data/image-manifest.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/image-manifest.json'), 'utf8')) : { assets: {} }
const today = new Date().toISOString().slice(0, 10)
const CAT: Record<string, [string, string]> = {
  alkali: ['Alkali metal', '碱金属'], 'alkaline-earth': ['Alkaline earth metal', '碱土金属'], transition: ['Transition metal', '过渡金属'], 'post-transition': ['Post-transition metal', '后过渡金属'],
  metalloid: ['Metalloid', '类金属'], nonmetal: ['Nonmetal', '非金属'], halogen: ['Halogen', '卤素'], 'noble-gas': ['Noble gas', '稀有气体'], lanthanide: ['Lanthanide', '镧系元素'], actinide: ['Actinide', '锕系元素'],
}
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const v = (e: Any, a: 'us' | 'uk') => (e.review.ipa[a] === 'two-source' && e.ipa[a] ? e.ipa[a] as string : null)
const both = (e: Any) => (e.name.us !== e.name.uk ? `${e.name.uk} / ${e.name.us}` : e.name.iupac)
const audioUrl = (e: Any, a: string, k = '') => `${SITE}/audio/${a}/${e.slug}${k}.mp3`
const ipaPhrase = (e: Any) => {
  const us = v(e, 'us'), uk = v(e, 'uk')
  if (us && uk && us === uk) return `/${us}/ (US and UK)`
  return [us ? `US /${us}/` : '', uk ? `UK /${uk}/` : ''].filter(Boolean).join(', ')
}

function page(o: { path: string; alt: string; lang: 'en' | 'zh'; title: string; desc: string; og: string; ogAlt: string; jsonld: unknown[]; body: string; keywords?: string }) {
  const url = SITE + o.path
  const en = o.lang === 'en' ? o.path : o.alt, zh = o.lang === 'zh' ? o.path : o.alt
  const head = `<title>${esc(o.title)}</title>
    <meta name="description" content="${esc(o.desc)}" />
    ${o.keywords ? `<meta name="keywords" content="${esc(o.keywords)}" />` : ''}
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="en" href="${SITE}${en}" />
    <link rel="alternate" hreflang="zh-Hans" href="${SITE}${zh}" />
    <link rel="alternate" hreflang="x-default" href="${SITE}${en}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Say the Elements · 元素怎么读" />
    <meta property="og:title" content="${esc(o.title)}" />
    <meta property="og:description" content="${esc(o.desc)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${SITE}${o.og}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(o.ogAlt)}" />
    <meta property="og:locale" content="${o.lang === 'zh' ? 'zh_CN' : 'en_US'}" />
    <meta property="og:locale:alternate" content="${o.lang === 'zh' ? 'en_US' : 'zh_CN'}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script>document.documentElement.classList.add('js')</script>
    ${o.jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n    ')}`
  const html = tpl.replace('<html lang="en">', `<html lang="${o.lang === 'zh' ? 'zh-Hans' : 'en'}">`).replace('<!--HEAD-->', head).replace('<!--STATIC-->', `<main id="static">${o.body}</main>`)
  const dir = join(DIST, o.path)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html)
}

const STATIC_CSS = `<style>.js #static{display:none}#static{max-width:760px;margin:0 auto;padding:24px 20px 60px;font:16px/1.6 system-ui,sans-serif;color:#EAF0FF}#static a{color:#7CF5D4}#static img{max-width:100%;height:auto;border-radius:12px}#static .ipa{font-family:'Noto Sans','Lucida Grande',sans-serif}#static ul.els{columns:3;padding-left:18px}</style>`

// ---------- element pages ----------
const sitemap: { loc: string; img?: string; caption?: string; alt?: string }[] = []
for (const [i, e] of els.entries()) {
  const prev = els[(i + 117) % 118], next = els[(i + 1) % 118]
  const us = v(e, 'us'), uk = v(e, 'uk')
  const cat = CAT[e.category]
  const hasImg = !!img.assets[e.slug]
  for (const lang of ['en', 'zh'] as const) {
    const zh = lang === 'zh'
    const path = `${zh ? '/zh' : ''}/element/${e.slug}/`, alt = `${zh ? '' : '/zh'}/element/${e.slug}/`
    const title = zh
      ? `${e.zh.name} ${both(e)} 英文怎么读：音标、美音英音发音 | 元素怎么读`
      : `How to pronounce ${both(e)} (${e.symbol}): IPA, US & UK audio | Say the Elements`
    const ipaTxt = ipaPhrase(e)
    const fact = e.fact ? (zh ? e.fact.zh : e.fact.en) : ''
    const desc = zh
      ? `${e.zh.name}（${e.zh.pinyin}，${e.z} 号元素 ${e.symbol}）的英文名 ${both(e)} 怎么读：${ipaTxt || '读音待核实'}${e.respell.us && us ? `，读作 ${e.respell.us}` : ''}。美音、英音、慢速和例句录音。${fact}`
      : `How to say ${both(e)}, element ${e.z} (${e.symbol}): ${ipaTxt || 'pronunciation not yet verified'}${us ? `, said ${e.respell.us}` : ''}. American and British audio, slow version and an example sentence. ${fact}`
    const faq = [
      { q: zh ? `${both(e)} 怎么读？` : `How do you pronounce ${both(e)}?`, a: ipaTxt ? (zh ? `${ipaTxt}。${us ? `重音在 ${e.respell.us} 的大写部分。` : ''}` : `${ipaTxt}${us ? `, said ${e.respell.us} (stress on the capital letters)` : ''}.`) : (zh ? '这个元素名的读音还没有两部词典共同确认。' : 'Its pronunciation is not yet confirmed by two dictionaries.') },
      ...(e.tricky?.traps?.[0] && (us || uk) ? [{ q: zh ? `${both(e)} 是读成 ${e.tricky.traps[0].wrong} 吗？` : `Is it ${e.tricky.traps[0].wrong}?`, a: zh ? `不是。${e.tricky.traps[0].why_zh}` : `No. ${e.tricky.traps[0].why_en}` }] : []),
      { q: zh ? `${e.zh.name}的英文是什么？` : `What is ${both(e)} in Chinese?`, a: zh ? `${e.zh.name}（${e.zh.pinyin}）的英文名是 ${both(e)}，元素符号 ${e.symbol}，原子序数 ${e.z}。` : `${e.zh.name} (${e.zh.pinyin}). Symbol ${e.symbol}, atomic number ${e.z}.` },
    ]
    const ld: unknown[] = [
      {
        '@context': 'https://schema.org', '@type': 'DefinedTerm', name: both(e), alternateName: [e.symbol, e.zh.name], termCode: e.symbol,
        description: `${zh ? '原子序数' : 'Chemical element, atomic number'} ${e.z}. ${ipaTxt}`.trim(), url: SITE + path, inLanguage: zh ? 'zh-Hans' : 'en',
        inDefinedTermSet: { '@type': 'DefinedTermSet', name: zh ? '化学元素' : 'Chemical elements', url: SITE + (zh ? '/zh/' : '/') },
        ...(us || uk ? { pronunciation: ipaTxt } : {}),
      },
      ...(['us', 'uk'] as const).map(a => ({ '@context': 'https://schema.org', '@type': 'AudioObject', name: `${a === 'us' ? e.name.us : e.name.uk} (${a === 'us' ? 'American' : 'British'} English)`, contentUrl: audioUrl(e, a), encodingFormat: 'audio/mpeg', inLanguage: a === 'us' ? 'en-US' : 'en-GB', ...(v(e, a) ? { description: `/${v(e, a)}/` } : {}) })),
      ...(hasImg ? [{ '@context': 'https://schema.org', '@type': 'ImageObject', contentUrl: `${SITE}/img/${e.slug}.960.webp`, width: 960, height: 960, caption: zh ? `${e.zh.name}（${e.name.iupac}）示意图` : `Illustration of ${e.name.iupac}`, creditText: 'AI-generated illustration' }] : []),
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: zh ? '元素怎么读' : 'Say the Elements', item: SITE + (zh ? '/zh/' : '/') }, { '@type': 'ListItem', position: 2, name: both(e), item: SITE + path }] },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ]
    const sen = e.sentence
    const body = `${STATIC_CSS}
<nav><a href="${zh ? '/zh/' : '/'}">${zh ? '← 元素怎么读：会发音的元素周期表' : '← Say the Elements: the periodic table that talks'}</a></nav>
<article>
<h1>${esc(zh ? `${e.zh.name} ${both(e)} 英文怎么读` : `How to pronounce ${both(e)}`)}</h1>
<p>${esc(zh ? `${e.z} 号元素，符号 ${e.symbol}，${cat[1]}。中文名 ${e.zh.name}（${e.zh.pinyin}）。` : `Element ${e.z}, symbol ${e.symbol}, ${cat[0].toLowerCase()}. Chinese: ${e.zh.name} (${e.zh.pinyin}).`)}</p>
<ul>
${(['us', 'uk'] as const).map(a => `<li lang="en">${a === 'us' ? 'US' : 'UK'} ${esc(a === 'us' ? e.name.us : e.name.uk)}: ${v(e, a) ? `<span class="ipa">/${esc(v(e, a)!)}/</span> ${esc(e.respell[a])}` : (zh ? '读音未核实' : 'not verified')} <audio controls preload="none" src="/audio/${a}/${e.slug}.mp3"></audio> <a href="/audio/${a}/${e.slug}.slow.mp3">${zh ? '慢速' : 'slow'}</a></li>`).join('\n')}
</ul>
${hasImg ? `<img src="/img/${e.slug}.960.webp" width="480" height="480" alt="${esc(zh ? `${e.zh.name}（${e.name.iupac}）的示意图片` : `Illustration of ${e.name.iupac}`)}" loading="lazy">` : ''}
${sen ? `<h2>${zh ? '例句' : 'Example'}</h2><p lang="en">${esc(sen.us)}</p>${zh ? `<p>${esc(sen.zh)}</p>` : ''}` : ''}
${e.tricky?.traps?.length ? `<h2>${zh ? '容易读错' : 'Watch out'}</h2>${e.tricky.traps.map((t: Any) => `<p><s lang="en">${esc(t.wrong)}</s> ${esc(zh ? t.why_zh : t.why_en)}</p>`).join('')}` : ''}
${e.fact ? `<h2>${zh ? '你知道吗' : 'Did you know'}</h2><p>${esc(zh ? e.fact.zh : e.fact.en)}</p>` : ''}
${e.etymology ? `<h2>${zh ? '名字的来历' : 'Where the name comes from'}</h2><p>${esc(zh ? e.etymology.zh : e.etymology.en)}</p>` : ''}
<h2>${zh ? '常见问题' : 'FAQ'}</h2>${faq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
<p><a href="${zh ? '/zh' : ''}/element/${prev.slug}/">← ${esc(prev.name.iupac)}</a> · <a href="${zh ? '/zh' : ''}/element/${next.slug}/">${esc(next.name.iupac)} →</a> · <a href="${zh ? '/zh/' : '/'}">${zh ? '回到周期表' : 'Back to the table'}</a></p>
</article>`
    page({ path, alt, lang, title, desc: desc.slice(0, 300), og: `/og/${e.slug}.jpg`, ogAlt: `${both(e)} pronunciation card`, jsonld: ld, body,
      keywords: zh ? `${e.zh.name}英文, ${e.name.iupac} 怎么读, ${e.name.iupac} 发音, ${e.name.iupac} 音标, 元素英文读音` : `${e.name.iupac} pronunciation, how to say ${e.name.iupac}, ${e.name.iupac} IPA, ${e.symbol} element` })
    sitemap.push({ loc: SITE + path, img: hasImg ? `${SITE}/img/${e.slug}.960.webp` : undefined, alt: e.name.iupac })
  }
}

// US-spelling redirects
for (const [from, to] of [['aluminum', 'aluminium'], ['cesium', 'caesium'], ['sulphur', 'sulfur']]) for (const pre of ['', '/zh']) {
  const dir = join(DIST, `${pre}/element/${from}`)
  mkdirSync(dir, { recursive: true })
  const target = `${pre}/element/${to}/`
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting…</title><link rel="canonical" href="${SITE}${target}"><meta http-equiv="refresh" content="0; url=${target}"><meta name="robots" content="noindex"><script>location.replace('${target}'+location.search)</script></head><body><a href="${target}">${target}</a></body></html>`)
}

// ---------- home, modes ----------
const listHtml = (zh: boolean) => `<ul class="els">${els.map(e => `<li><a href="${zh ? '/zh' : ''}/element/${e.slug}/">${e.z} ${esc(e.symbol)} ${esc(both(e))} ${esc(e.zh.name)}</a></li>`).join('')}</ul>`
const homeFaq = (zh: boolean) => zh ? [
  ['元素的英文名怎么读？', '点周期表上的任意元素，就能听到它的英文读音：美音和英音、正常和慢速，还有例句。音标来自牛津、朗文等词典，两部词典一致才显示。'],
  ['aluminium 和 aluminum 有什么区别？', '同一种元素：英式拼写 aluminium，美式拼写 aluminum，读音也不同。网站分别提供英音和美音录音。'],
  ['需要注册或付费吗？', '不需要。完全免费，进度只保存在你的浏览器里。'],
] : [
  ['How do you pronounce the names of the chemical elements?', 'Tap any element on the table to hear its name in American and British English, at normal and slow speed, with an example sentence. IPA comes from dictionaries and is shown only when two sources agree.'],
  ['Why are there two spellings of aluminium and caesium?', 'Aluminium and caesium are the IUPAC and British spellings; aluminum and cesium are American. The site has both spellings and both accents.'],
  ['Is it free?', 'Yes. No sign-up; your progress stays in your browser.'],
]
for (const lang of ['en', 'zh'] as const) {
  const zh = lang === 'zh'
  const title = zh ? '元素怎么读：会发音的元素周期表，118 个元素英文读音（美音/英音）' : 'Say the Elements: hear every element of the periodic table, US and UK'
  const desc = zh ? '会发音的元素周期表：点任意元素，听它的英文名怎么读。118 个元素的美音和英音、慢速和例句，词典音标，中文名和拼音，易错读音和听音测验。免费，无需注册。'
    : 'A periodic table that talks: tap any of the 118 elements to hear its English name in American and British voices, slow and normal, with dictionary IPA, Chinese names, tricky-name tips and a listening quiz. Free.'
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: zh ? '元素怎么读' : 'Say the Elements', alternateName: zh ? 'Say the Elements' : '元素怎么读', url: SITE + (zh ? '/zh/' : '/'), inLanguage: zh ? 'zh-Hans' : 'en' },
    { '@context': 'https://schema.org', '@type': 'WebApplication', name: zh ? '元素怎么读' : 'Say the Elements', url: SITE + (zh ? '/zh/' : '/'), applicationCategory: 'EducationalApplication', operatingSystem: 'Any (web browser)', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, inLanguage: ['en', 'zh-Hans'], publisher: { '@type': 'Organization', name: 'Integ Life', url: 'https://integ.life/' } },
    { '@context': 'https://schema.org', '@type': 'LearningResource', name: zh ? '元素英文读音' : 'Pronouncing the chemical elements in English', learningResourceType: ['audio', 'interactive resource', 'quiz'], educationalLevel: ['secondary school', 'English learners B1'], inLanguage: ['en', 'zh-Hans'], isAccessibleForFree: true, url: SITE + (zh ? '/zh/' : '/') },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: homeFaq(zh).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ]
  const body = `${STATIC_CSS}<h1>${zh ? '元素怎么读' : 'Say the Elements'}</h1><p>${esc(desc)}</p>${homeFaq(zh).map(([q, a]) => `<h2>${esc(q)}</h2><p>${esc(a)}</p>`).join('')}<h2>${zh ? '全部 118 个元素' : 'All 118 elements'}</h2>${listHtml(zh)}<p><a href="${zh ? '/zh' : ''}/tricky/">${zh ? '易错元素' : 'Tricky names'}</a> · <a href="${zh ? '/zh' : ''}/quiz/">${zh ? '听音测验' : 'Listening quiz'}</a> · <a href="${zh ? '/zh' : ''}/practice/">${zh ? '跟读练习' : 'Listen and repeat'}</a> · <a href="${zh ? '/zh' : ''}/about/">${zh ? '关于与来源' : 'About and sources'}</a></p>`
  page({ path: zh ? '/zh/' : '/', alt: zh ? '/' : '/zh/', lang, title, desc, og: '/og.png', ogAlt: 'Say the Elements periodic table', jsonld: ld, body,
    keywords: zh ? '元素周期表 英文, 元素英文名 读音, 化学元素 英文怎么读, 元素 音标, 美音 英音, 化学英语' : 'element pronunciation, periodic table pronunciation, how to pronounce elements, chemical element names audio, IPA, US UK' })
  sitemap.push({ loc: SITE + (zh ? '/zh/' : '/') })
  const modes: [string, string, string, string][] = zh
    ? [['tricky', '易错的元素英文名 | 元素怎么读', '中文母语者最容易读错的元素英文名：重音、不发音的字母和容易混淆的名字，附音标和录音。', '易错的元素名'], ['quiz', '元素英文听音测验 | 元素怎么读', '听一个元素的英文名，然后在周期表上点出来。10 道题，可选前 20 个、常见 40 个、易错的或全部 118 个。', '听音测验'], ['practice', '元素英文跟读练习 | 元素怎么读', '一次一个元素：听美音或英音，看音节重音和音标，录下自己的读音再对比。从中文母语者最容易读错的元素开始。', '跟读练习'], ['about', '关于与数据来源 | 元素怎么读', '音标、中文名、拼音和数据的来源：牛津、朗文、维基词典、CMU、PubChem、Unihan、全国科技名词委。', '关于']]
    : [['tricky', 'Tricky element names to pronounce | Say the Elements', 'The element names Chinese speakers and other learners most often get wrong: stress, silent letters and look-alike names, with IPA and audio.', 'Tricky element names'], ['quiz', 'Element pronunciation listening quiz | Say the Elements', 'Hear an element name, then tap it on the periodic table. Ten questions from the first 20, common 40, tricky ones or all 118.', 'Listening quiz'], ['practice', 'Listen and repeat: say the element names | Say the Elements', 'One element at a time: hear it in a US or UK voice, see the stressed syllable and IPA, record yourself and compare. Starts with the hardest names.', 'Listen and repeat'], ['about', 'About and sources | Say the Elements', "Where the IPA, Chinese names, pinyin and data come from: Oxford Learner's, Longman, Wiktionary, CMU, PubChem, Unihan.", 'About']]
  for (const [m, title2, desc2, h1] of modes) {
    page({ path: `${zh ? '/zh' : ''}/${m}/`, alt: `${zh ? '' : '/zh'}/${m}/`, lang, title: title2, desc: desc2, og: '/og.png', ogAlt: 'Say the Elements', jsonld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: title2, description: desc2, url: `${SITE}${zh ? '/zh' : ''}/${m}/` }],
      body: `${STATIC_CSS}<h1>${esc(h1)}</h1><p>${esc(desc2)}</p>${(m === 'tricky' || m === 'practice') ? `<ul>${els.filter(e => e.tricky?.level >= 2).map(e => `<li><a href="${zh ? '/zh' : ''}/element/${e.slug}/">${esc(both(e))}</a>: ${esc(zh ? e.tricky.traps[0].why_zh : e.tricky.traps[0].why_en)}</li>`).join('')}</ul>` : ''}<p><a href="${zh ? '/zh/' : '/'}">${zh ? '回到周期表' : 'Back to the table'}</a></p>` })
    sitemap.push({ loc: `${SITE}${zh ? '/zh' : ''}/${m}/` })
  }
}
writeFileSync(join(DIST, '404.html'), readFileSync(join(DIST, 'index.html'), 'utf8').replace(/<link rel="canonical"[^>]*>/, '').replace('index, follow', 'noindex'))

// ---------- sitemap, robots, manifest, llms.txt ----------
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${sitemap.map(s => `  <url><loc>${s.loc}</loc><lastmod>${today}</lastmod>${s.img ? `<image:image><image:loc>${s.img}</image:loc></image:image>` : ''}</url>`).join('\n')}
</urlset>
`)
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)
writeFileSync(join(DIST, 'manifest.webmanifest'), JSON.stringify({ name: 'Say the Elements · 元素怎么读', short_name: 'Elements', start_url: '/', display: 'standalone', background_color: '#070B14', theme_color: '#070B14', description: 'Hear every element of the periodic table, US and UK', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] }, null, 1))
writeFileSync(join(DIST, 'llms.txt'), `# Say the Elements (元素怎么读)

> A periodic table that talks: the English names of all 118 chemical elements in American and British voices (normal, slow, example sentence), with dictionary IPA, Chinese names and pinyin. ${SITE}

IPA is shown only when two independent dictionaries agree (Oxford Learner's, Longman, Wiktionary, CMUdict); "unverified" marks the rest. Full sourced data: ${SITE}/elements.json

## Elements
${els.map(e => `- ${both(e)} (${e.symbol}, ${e.z}): US ${v(e, 'us') ? '/' + v(e, 'us') + '/' : 'unverified'}; UK ${v(e, 'uk') ? '/' + v(e, 'uk') + '/' : 'unverified'}; 中文 ${e.zh.name} ${e.zh.pinyin}; ${SITE}/element/${e.slug}/`).join('\n')}
`)

writeFileSync(join(DIST, 'indexnow-key.txt'), '2e54bfce938efe206b762b76dd049cd8') // IndexNow key: public/2e54bfce938efe206b762b76dd049cd8.txt
// ---------- service worker with a build-id cache ----------
function hashDir(d: string, h = createHash('sha256')) {
  for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) hashDir(p, h); else if (/\.(js|css)$/.test(f)) h.update(readFileSync(p)) }
  return h
}
const h = hashDir(join(DIST, 'assets'))
for (const m of ['data/audio-manifest.json', 'data/image-manifest.json']) if (existsSync(join(ROOT, m))) h.update(readFileSync(join(ROOT, m)))
const build = h.digest('hex').slice(0, 12)
const assets = readdirSync(join(DIST, 'assets')).map(f => `/assets/${f}`)
writeFileSync(join(DIST, 'sw.js'), `// Say the Elements service worker. Cache name carries the build id; a new deploy drops the old cache.
const CACHE = 'elements-${build}'
const SHELL = ['/', '/zh/', '/data/detail.json', '/fonts/inter.woff2', '/fonts/ipa.woff2', ${assets.map(a => `'${a}'`).join(', ')}]
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const r = e.request
  if (r.method !== 'GET') return
  const u = new URL(r.url)
  if (u.origin !== location.origin) return
  if (r.mode === 'navigate') {
    e.respondWith(Promise.race([
      fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(r, c)); return res }),
      new Promise((_, rej) => setTimeout(rej, 3000)),
    ]).catch(() => caches.match(r).then(m => m || caches.match(u.pathname.startsWith('/zh') ? '/zh/' : '/'))))
    return
  }
  if (/^\\/(audio|img|og|fonts|assets|data)\\//.test(u.pathname)) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(r, c)) } return res })))
  }
})
`)
console.log(`prerendered ${sitemap.length} pages; build ${build}`)
