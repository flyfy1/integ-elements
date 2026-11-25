# Say the Elements · 元素怎么读

https://elements.integ.life — a periodic table that talks: tap any element to hear its English name in an American and a British voice (normal, slow, example sentence), with dictionary IPA, stressed-syllable respelling, Chinese name and pinyin, a tricky-names list, listen-and-repeat and a hear-it-tap-it quiz.

- IPA is shown only when two independent sources agree (Oxford Learner's, Longman, Wiktionary, CMUdict); otherwise it says "not verified".
- `npm run build` uses only committed data and assets (no network, no ffmpeg). Generation scripts in `scripts/` (`data:*`, `gen:*`, `qa:*`) cache every call and record it in `data/*-manifest.json`, so re-runs cost nothing.
- Deploy: push to `main` → `.github/workflows/deploy.yml` builds and publishes `dist/` to `gh-pages`.
