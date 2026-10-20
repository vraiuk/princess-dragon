# Круг 2: перепроверка и исправление

Находки круга 1 лежат в `qa/findings/r1-*.json` (102 штуки). Каждая находка — утверждение, а не приказ. Ты не автор находок, поэтому проверяй их независимо.

## Порядок для каждой находки твоей зоны
1. **Воспроизведи** на текущем коде: шагами из `repro`, тестом, скриншотом или замером. Запиши вердикт в `qa/findings/r2-<твой id>.json`:
   `{ "finding": "<id>", "verdict": "confirmed|rejected|unknown", "why": "...", "fix": "что сделано / почему не делаем", "test": "файл теста или null" }`.
   - `rejected` — не воспроизводится или это не баг (объясни).
   - `unknown` — не можешь проверить в этой среде, например только на настоящем Mac.
   - Вопрос продукта, а не баг: не чини, вердикт `unknown`, в `why` напиши варианты.
2. **Сначала тест, потом фикс.** Где можно, добавь регрессионный тест, который падает до фикса и проходит после.
3. **Фикс минимальный**, в стиле окружающего кода. Не переписывай работающее.
4. **Цена фикса.** Если путь до бага надуманный, а фикс дороже пользы, ставь `rejected` с объяснением.

## Правила
- Правь ТОЛЬКО файлы своей зоны. Нужна правка в чужом файле — опиши её в r2-файле (`"handoff": "файл: что сделать"`).
- Не делай git commit/push. Не ставь npm-пакеты.
- Перед завершением прогони всё, что касается твоей зоны: `npm test`, `npm run qa:ui`, а если трогал main/preload — `npm run qa:e2e`. Всё должно быть зелёным. Если падает из-за чужой зоны — укажи в отчёте.
- Тесты не ослабляй, чтобы прошли. Нельзя менять чужие тесты и пороги проверок.

## Зоны
| id | файлы |
|---|---|
| F1 | `app/core.js`, `test/core.test.js` |
| F2 | `app/achievements.js`, `test/achievements.test.js` |
| F3 | `app/main.js`, `app/preload.js`, `app/preload-app.js`, `qa/e2e/*` |
| F4 | `app/renderer/pet.js`, `app/renderer/style.css`, `app/renderer/index.html` |
| F5 | `app/renderer/death.js`, `app/renderer/toast.js`, `app/renderer/toast.css` |
| F6 | `app/showcase.js`, `app/renderer/demo.js`, `test/showcase.test.js`, `docs/shorts.md` |
| F7 | `app/renderer/trophies.*` |
| F8 | `app/renderer/settings.*`, `app/renderer/welcome.*`, `app/renderer/ui.css` |
| F9 | `index.html` (лендинг), `README.md` |
| F10 | `test/fuzz.test.js`, `qa/ui-check.js`, `qa/README.md`, `package.json`, `package-lock.json`, `.github/workflows/frog-pet.yml` |
