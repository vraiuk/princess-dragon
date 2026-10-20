# Круг 4: финальные правки

Правила те же, что в `qa/ROUND2.md`. По каждой находке: сначала воспроизвести, потом написать тест, который падает, и только потом чинить. Каждая зона владеет своими файлами. Коммиты и пуш делает ведущий.

Вход: все находки `qa/findings/r3-*.json`. Особенно важен аудит `r3-01.json`: в нём перечислены still-broken, regressed и missing. Сюда же относятся открытые (open) находки круга 1, на которые указывает круг 3. Вердикты пиши в `qa/findings/r4-<id>.json`, формат как в круге 2.

## Решения ведущего по вопросам продукта
- **Железножопая жаба** (`iron_butt`): порог = min(120 мин, 0.9 × время до каменной смерти). Ачивка должна быть достижима при любых настройках, хардкор включён или нет.
- **«Позже»**: повтор напоминания приходит через nagEvery и без системного уведомления: только облачко и тихий режим.
- **Возраст жабы** (alive3/7/30): считается по календарю, как у тамагочи. Это не баг. В тексте ачивки можно честно написать «жаба живёт N дней».
- **Род в текстах** («Я попил»): не трогать, это решит пользователь.
- **Длина short** (80 с): оставить. В docs/shorts.md прямо рекомендовать water и stone для TikTok и Reels с лимитом 45–60 с.

## Зоны
| id | файлы |
|---|---|
| G1 | `app/core.js`, `test/core.test.js` |
| G2 | `app/main.js`, `app/preload*.js`, `qa/e2e/*` |
| G3 | `app/renderer/pet.js`, `style.css`, `index.html` |
| G4 | `app/renderer/death.js`, `toast.js`, `toast.css` |
| G5 | `app/showcase.js`, `app/renderer/demo.js`, `test/showcase.test.js`, `docs/shorts.md` |
| G6 | `app/renderer/trophies.*` |
| G7 | `app/renderer/settings.*`, `welcome.*`, `ui.css` |
| G8 | `test/fuzz.test.js`, `qa/ui-check.js`, `qa/README.md` |
| G9 | `package.json`, `package-lock.json`, `.github/workflows/frog-pet.yml`, `build/*` |
| G10 | `app/achievements.js`, `test/achievements.test.js`, `README.md`, `index.html` (лендинг) |
