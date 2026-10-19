# Жабка v2 — общий контракт для параллельной разработки

Цель: продукт, готовый к съёмке шортсов и демо для YouTube. Всё по-русски, юмор программистский, жаба милая.
Существующий код: `app/core.js` (логика), `app/main.js` (Electron), `app/preload.js`, `app/renderer/{index.html,style.css,pet.js,demo.js}`.
Сначала прочитай этот файл, `README.md` и код, который тебе нужен. Тесты: `cd frog-pet && npm test` (node:test).

## Правила
- Правь ТОЛЬКО свои файлы (таблица ниже). Чужие файлы — только читать. Нужна правка в чужом файле — опиши её в отчёте.
- Не делай git commit / push. Не устанавливай новые npm-зависимости.
- Никаких внешних ресурсов (CDN, шрифты из сети) в приложении: CSP `default-src 'self'`. Всё рисуется кодом (canvas/SVG/CSS), эмодзи можно.
- Стиль кода как в существующих файлах: 2 пробела, `'use strict'`, комментарии по-русски, коротко.
- Все модули логики — UMD как `core.js` (работают и в Node/Electron main, и в браузере через `<script>`).

## Владельцы файлов
| Агент | Файлы |
|---|---|
| A1 core-death | `app/core.js`, `test/core.test.js` |
| A2 achievements | `app/achievements.js`, `test/achievements.test.js` |
| A3 pet-visuals | `app/renderer/pet.js`, `app/renderer/death.js`, `app/renderer/style.css`, `app/renderer/index.html` |
| A4 toast | `app/renderer/toast.js`, `app/renderer/toast.css` |
| A5 trophies-window | `app/renderer/trophies.html`, `app/renderer/trophies.js`, `app/renderer/trophies.css` |
| A6 settings+onboarding | `app/renderer/settings.html`, `app/renderer/settings.js`, `app/renderer/welcome.html`, `app/renderer/welcome.js`, `app/renderer/ui.css` (общая тема окон) |
| A7 main-integration | `app/main.js`, `app/preload.js`, `app/preload-app.js`, `package.json` |
| A8 film-mode | `app/showcase.js`, `app/renderer/demo.js`, `test/showcase.test.js` |
| A9 landing+promo | `frog-pet/index.html` (лендинг продукта), `frog-pet/README.md`, `frog-pet/docs/*` |

## 1. Жизнь и смерть (core.js, A1)
Пороги (константы в core, экспортировать): `DEATH_WATER = 3.0` (waterRatio, ~2ч15м без воды при 45 мин), `DEATH_STONE = 2.4` (sitRatio, ~2ч сидения при 50 мин), `CRITICAL = 0.8` (доля пути до смерти, когда жаба «при смерти»).
Настройка `deathEnabled` (по умолчанию `true`): если `false`, жаба не умирает, но всё остальное работает.

Новые поля `view(t)`:
```
life: 'alive' | 'dead'
cause: null | 'dry' | 'stone'      // причина смерти
diedAt: number | 0
generation: number                 // номер жабы, с 1
bornAt: number
ageMin: number                     // возраст текущей жабы, мин
doom: { water: 0..1, move: 0..1 }  // прогресс к смерти: ratio / DEATH_*
critical: { water: bool, move: bool }
totals: { drinks, breaks, autoBreaks, deaths, deathsDry, deathsStone, codingMs, maxSitMs, longestLifeMin, days }
graveyardCount: number
```
Новые события из `tick()` и действий:
```
{ type: 'critical', kind: 'water'|'move', text }       // один раз при входе в зону critical
{ type: 'death', cause: 'dry'|'stone', generation, ageMin, text }
{ type: 'reborn', generation, text }                    // после revive() или утром
```
Новые методы: `revive(t)` → событие `reborn` (новая жаба, generation+1, счётчики воды и сидения сброшены). Утреннее событие `morning` у мёртвой жабы автоматически возрождает (сначала `reborn`, потом `morning`).
Пока жаба мертва: напоминаний нет, `drink()/stretch()` засчитываются в статистику, но не оживляют. Время до смерти не тикает.
Состояние хранит `graveyard: [{ generation, cause, bornAt, diedAt, ageMin }]` (последние 50) и `totals` (за всё время). `state.history` — дни (уже есть).

## 2. Ачивки (achievements.js, A2)
```js
const A = FrogAchievements.createAchievements(saved)   // saved = A.serialize() или null
A.check({ now, events, view, state, settings })        // -> массив новых разблокировок [{ id, title, desc, icon, kind, rarity, at }]
A.list()   // все: [{ id, title, desc, icon, kind, rarity, hidden, unlocked, at, progress: { cur, max } | null }]
A.serialize()
FrogAchievements.DEFS  // описания
```
`kind`: `'good'` | `'bad'` | `'secret'` (секретные скрыты до получения). `rarity`: `'common'|'rare'|'epic'|'legendary'`.
`check` вызывается main-процессом каждый тик (events — события этого тика, включая `drink`, `stretch`, `death`, `reborn`, `back`, `poke` и т.п.), `state` = `pet.serialize()`.
Нужно 30–40 ачивок. Обязательно: «Железножопая жаба» (2 ч без перерыва), «Нефритовая жаба» (окаменела насмерть), «Изюм» (засохла насмерть). Остальное придумай: хорошие (гидратация, разминки, серии дней), плохие (смерти, игнор напоминаний, ночной кодинг), секретные (тыкнул жабу 50 раз, перетащил её, и т.д.).
События для «пальпации»: `poke` (клик по жабе), `dragged` (main шлёт `{type:'dragged'}` после перетаскивания), `snooze` (main шлёт `{type:'snooze', kind}`).

## 3. Окно жабы (A3 + A4)
Новые события, приходящие в рендер через `bridge.onEvent`: `critical`, `death`, `reborn`, `achievement` (`{type:'achievement', id, title, desc, icon, kind, rarity}`).
- A3: смерть от окаменения — трещины, дрожь, жаба раскалывается на мелкие камушки, они падают кучкой, потом рассыпаются в пыль, пыль сдувает. Смерть от жажды — жаба сморщивается в изюм, трескается и рассыпается песком/пылью на ветру. После — маленькое надгробие «RIP Жабка #N» и кнопка «🥚 Новая жаба» (`bridge.action('revive')`). Возрождение: яйцо, трещит, вылупляется головастик → жаба в наушниках. Состояние critical: заметно страшнее (дрожь, красноватые блики, тревожная иконка). Плюс общий UX-полиш окна жабы. Отрисовка смерти/возрождения — в `death.js` (`window.FrogDeath`), `pet.js` её вызывает.
- A4: `window.FrogToast.show({ icon, title, desc, kind, rarity })` — всплывашка «Ачивка получена!» внутри окна жабы (окно 260×320, учесть облачко сверху). Хорошие — золото/зелень, плохие — красно-фиолетовые «позорные», секретные — радужные. Очередь, если пришло несколько. Звук через WebAudio (если `settings.sound`), API: `FrogToast.setSound(bool)`. `index.html` уже подключает `toast.css` и `toast.js` перед `pet.js`.
Кнопки на `bridge.action(type, opts)`: `drink`, `stretch`, `snooze`, `poke`, `revive`, `openTrophies`, `openSettings`.

## 4. Окна приложения (A5, A6, A7)
Все окна грузят `preload-app.js`, API `window.frogApp`:
```
getData(): Promise<{ settings, view, state, achievements: A.list(), graveyard, version }>
onUpdate(cb)              // те же данные, main пушит раз в 2 с и при изменениях
setSetting(key, value)
action(type, opts)        // как в окне жабы
open(name)                // 'trophies' | 'settings' | 'welcome'
finishOnboarding()
close()
```
- A5 «Трофеи»: вкладки «Ачивки» (сетка, хорошие/позорные/секретные, прогресс, редкость, дата), «Статистика» (последние 14 дней: стаканы, разминки, время за компом — графики на canvas/SVG, рекорды), «Кладбище» (жабы с причиной смерти, сколько прожили, эпитафии с юмором).
- A6 «Настройки» (все ключи: `waterEvery`, `moveEvery`, `breakAfter`, `nagEvery`, `scale`, `sound`, `notify`, `launchAtLogin`, `deathEnabled`) и «Добро пожаловать» (онбординг при первом запуске: 3–4 экрана, что делает жаба, какие тайминги, выбрать хардкор со смертью или без, кнопка «Поехали»). `ui.css` — общая тема (её подключают и трофеи): светлая/тёмная (`prefers-color-scheme`), токены `--bg #fffdf5`, `--ink #1f2a22`, `--green #3fae5a`, `--blue #2f8de4`, `--line #1d3b26`, `--bad #b5487a`, системный шрифт, окна в стиле macOS (заголовок прозрачный, `-webkit-app-region: drag` у шапки).
- A7 main: окна (frameless/`titleBarStyle: 'hiddenInset'`, размеры: трофеи 720×560, настройки 520×560, приветствие 560×520), IPC для `frogApp`, ачивки (создать, check каждый тик, хранить в `frog.json`, слать `achievement` в окно жабы + системное уведомление для редких), события `dragged`/`snooze`, действие `revive`, пункты меню-бара «🏆 Трофеи и статистика», «⚙️ Настройки…», «🎬 Режим съёмки», онбординг при первом запуске, режим съёмки (см. ниже). Уведомление о смерти жабы.

## 5. Режим съёмки (A8 + A7)
`app/showcase.js` (UMD, `FrogShowcase`):
```js
FrogShowcase.SCRIPTS   // { short: { title, duration, steps: [...] }, ... }
FrogShowcase.createDirector(script, ctl) // -> { start(), stop(), onEnd(cb) }
// ctl (реализуют main.js и demo.js):
//   ctl.reset()                         — новая жаба, чистая статистика (для съёмки)
//   ctl.ff(minutes, idleSec)            — промотать симулированное время (tick шагами по 20 с), события уходят в рендер
//   ctl.action(type, opts)              — drink/stretch/revive/poke...
//   ctl.say(text)                       — реплика в облачке ({type:'say', text})
//   ctl.event(ev)                       — произвольное событие в рендер
// шаг: { t: секунды от старта, cmd: 'reset'|'ff'|'action'|'say'|'event', ...args }
```
Сценарии: `short` (~50 с, вертикальный шортс: кодит → стакан пустеет → игнор → сохнет → при смерти → рассыпается в пыль → ачивка «Изюм» → яйцо → новая жаба → сидит → каменеет → рассыпается на камушки → «Нефритовая жаба», «Железножопая жаба» → возрождение → попил → счастлива), `water` и `stone` (короткие по одной механике), `tour` (~90 с демо всех фич для YouTube).
`ff` должен идти плавно (несколько вызовов подряд), чтобы трансформация была видна глазом.
В браузерном демо (`demo.js`): кнопка «🎬 Сценарий» с выбором сценария; параметр `?film=short` запускает сразу; `?ratio=9:16` — вертикальная сцена для шортсов (жаба крупно по центру, без карточки управления); `?clean=1` прячет UI демо. В демо нужен свой экземпляр `FrogAchievements` (если подключён), чтобы ачивки всплывали.

## 6. Лендинг (A9)
`frog-pet/index.html` — продающая страница продукта для GitHub Pages (`https://vraiuk.github.io/princess-dragon/frog-pet/`): герой с живой жабой (iframe на `app/renderer/index.html?clean=1`), фичи, механики смерти, ачивки, тайминги, скачать (Releases), FAQ про Gatekeeper. `docs/shorts.md` — 5 сценариев шортсов (хук в первые 2 секунды, текст на экране, озвучка) и сценарий 2–3-минутного демо для YouTube. Обнови `README.md` под новые фичи.
