<p align="center">
  <img src="branding/banner.png" alt="tg-game-overlay: чат Telegram поверх игры" width="100%">
</p>

<p align="center">
  <a href="https://github.com/wyrtensi/tg-game-overlay/releases/latest"><img alt="Последний релиз" src="https://img.shields.io/github/v/release/wyrtensi/tg-game-overlay?filter=v*&label=app&color=5b8cff"></a>
  <a href="https://github.com/wyrtensi/tg-game-overlay/releases?q=server"><img alt="Relay-сервер" src="https://img.shields.io/github/v/release/wyrtensi/tg-game-overlay?filter=server-v*&label=relay%20server&color=8a5cff"></a>
  <a href="https://github.com/wyrtensi/tg-game-overlay/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/wyrtensi/tg-game-overlay/ci.yml?branch=main&label=ci"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4">
  <img alt="Tauri v2" src="https://img.shields.io/badge/Tauri-v2-24c8db">
  <img alt="Сквозное шифрование" src="https://img.shields.io/badge/relay-end--to--end%20encrypted-2ea44f">
  <a href="LICENSE"><img alt="Лицензия MIT" src="https://img.shields.io/github/license/wyrtensi/tg-game-overlay?color=lightgrey"></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>Русский</b> · <a href="README.zh-CN.md">简体中文</a></p>

**tg-game-overlay** выводит чат поверх игр, в которых своего чата нет.
Сообщения появляются прямо над игрой, отвечать можно без Alt+Tab, а друзья
видят переписку в своём оверлее или в обычном клиенте Telegram.

Чат может идти одним из двух путей:

- **Telegram** (основной режим): вход под своим аккаунтом и трансляция любого
  чата, группы или темы форума.
- **Свой relay-сервер**: маленький сервис в Docker, который вы поднимаете сами.
  Сообщения шифруются сквозным шифрованием на каждом компьютере, сервер только
  пересылает шифротекст и раздаёт общий каталог стикеров.

> Интерфейс доступен на английском, русском и упрощённом китайском и по
> умолчанию следует языку Windows; сменить его можно в **Настройки → Запуск**.
> Только Windows 10 и 11.

## Возможности

- Прозрачный чат, через который проходят клики, рисуется внутри окна игры в
  зонах, которые вы задаёте для каждой игры; он переживает смену разрешения и
  прячется вместе с игрой.
- Горячая клавиша, чтобы писать, не выходя из игры; Esc или Enter возвращают
  фокус обратно.
- Стикеры, включая анимированные (TGS, WebP, WebM), и вставка картинок.
- **Колесо фраз**: зажмите клавишу, мотните мышью, отпустите, и фраза ушла.
- **Указатели направления**: стрелки на клавиатуре показывают всем в чате
  большую стрелку.
- Живёт в трее и никогда не забирает фокус; для каждой игры режимы «показ»,
  «скрыт» и «блок».
- Настраиваемый вид: размер текста, цвета, пузыри, тени, тайминги.
- Интерфейс на английском, русском и упрощённом китайском.

## Установка

1. Скачайте `tg-game-overlay_<версия>_x64-setup.exe` из
   [последнего релиза](https://github.com/wyrtensi/tg-game-overlay/releases/latest)
   и запустите. WebView2 входит в Windows 11; на Windows 10 установщик сам
   скачает его, если его нет.
2. Приложение запускается в трее. Левый клик по иконке открывает настройки.
3. Следуйте карточке **Готовность к игре** вверху: она всегда показывает
   следующий шаг.

### Режим Telegram

В релизных сборках **нет ключей Telegram API**. Каждый пользователь вводит
свои, это занимает пару минут:

1. Откройте [my.telegram.org](https://my.telegram.org), войдите и выберите
   **API development tools**.
2. Создайте приложение (любое название, платформа *Desktop*) и скопируйте
   `api_id` и `api_hash`.
3. В приложении откройте **Telegram → Свои ключи Telegram**, вставьте оба
   значения и сохраните. Они хранятся только для вашего пользователя Windows
   (DPAPI) и не покидают компьютер.
4. Войдите по номеру телефона и коду из Telegram, затем выберите чат для
   трансляции.

Сессия Telegram и ключи зашифрованы Windows DPAPI под вашей учётной записью.
Приложение общается с Telegram напрямую, никакого нашего сервера между ними нет.

### Режим своего сервера

1. Кто-то из вашей компании поднимает relay-сервер (см. ниже) и сообщает
   адрес и **ключ доступа**.
2. В разделе **Способ связи** выберите **Свой сервер**, укажите адрес
   (например, `203.0.113.10:8790`), ключ доступа, название комнаты, пароль
   комнаты и имя, которое увидят остальные.
3. Все, кто ввёл одинаковые название и пароль комнаты, попадают в один чат.
   С неверным паролем просто откроется другая, пустая комната.

## Relay-сервер

Сервис на Node.js примерно на тысячу строк с одной зависимостью (`ws`). В
простое занимает около 20 МиБ памяти и спокойно уживается с другими сервисами
на VPS с 1 ГБ.

```sh
mkdir tg-overlay-relay && cd tg-overlay-relay
curl -LO https://raw.githubusercontent.com/wyrtensi/tg-game-overlay/main/server/docker-compose.yml
curl -LO https://raw.githubusercontent.com/wyrtensi/tg-game-overlay/main/server/.env.example
cp .env.example .env
openssl rand -base64 32   # вставьте как ACCESS_KEY и передайте друзьям
openssl rand -base64 32   # вставьте как ADMIN_KEY и оставьте себе
docker compose up -d
curl http://localhost:8790/health   # ok
```

Те же файлы вместе со скриптом загрузки стикеров приложены к каждому
[релизу `server-v*`](https://github.com/wyrtensi/tg-game-overlay/releases?q=server)
как `tg-game-overlay-server-<версия>.tar.gz`. Образ публикуется как
`ghcr.io/wyrtensi/tg-game-overlay-server`. Порт по умолчанию 8790, порты 80 и
443 не нужны. Стикеры загружаются скриптом `server/scripts/upload-stickers.mjs`
с ключом администратора, а каждый клиент кэширует их у себя по хешу
содержимого. Полное руководство для администратора — в
[server/README.md](server/README.md).

### Как устроено шифрование

- Каждый клиент выводит ключ из названия и пароля комнаты
  (PBKDF2-SHA256, 600 000 итераций, затем HKDF) и шифрует каждое сообщение
  AES-256-GCM со свежим случайным nonce и id комнаты в качестве связанных
  данных. Сообщения дополняются до блоков по 256 байт.
- Сервер видит только id комнаты (хеш), размеры шифротекста и время. Текст,
  имена, стикеры и картинки в сообщениях он прочитать не может.
- Ключ доступа никогда не передаётся: клиент отвечает на случайный вызов
  HMAC-подписью.
- Что стоит знать: без TLS-прокси перед сервером метаданные видны в сети; все в
  комнате используют один ключ, поэтому комнаты рассчитаны на друзей; каталог
  стикеров защищён ключом доступа, но не зашифрован.

Сетевой протокол описан в [server/PROTOCOL.md](server/PROTOCOL.md).

## Сборка из исходников

Нужны Windows, Rust (MSVC) с Visual Studio Build Tools (нагрузка C++) и
Node.js 20+.

```sh
npm install
npm run tauri dev       # разработка
npm run tauri build     # установщик в src-tauri/target/release/bundle
```

По желанию, чтобы встроить свои ключи Telegram в личную сборку, положите
`{"apiId": 123, "apiHash": "..."}` в `src-tauri/credentials.json` (он в
.gitignore) или задайте `TG_API_ID` / `TG_API_HASH`. Публичные релизы
собираются с `TGO_NO_EMBEDDED_KEYS=1`, поэтому ключи в них попасть не могут.

```sh
npm test                          # интерфейс и relay-клиент (vitest)
cd src-tauri && cargo test        # бэкенд (Rust)
cd server && npm test             # relay-сервер (node:test)
```

## Как это работает

- `src-tauri/` — бэкенд на Rust: машина состояний оверлея, отслеживание
  активного окна, горячие клавиши, трей, настройки и секреты под DPAPI.
- `src/overlay/` — прозрачная страница поверх игры.
- `src/main/` — окно настроек.
- `src/telegram/` — скрытый воркер с клиентом MTProto (GramJS).
- `src/relay/` — скрытый воркер транспорта через свой сервер: WebCrypto,
  клиент WebSocket и кэш стикеров.
- `src/i18n/` — английский и китайский словари, ключами служат русские строки;
  тест падает, если у видимой строки нет перевода.
- `server/` — relay-сервер.

Страницы не общаются друг с другом напрямую, шина — Rust. События и команды
описаны в [CONTRACT.md](CONTRACT.md).

## Известные ограничения

- В эксклюзивном полноэкранном режиме (старые игры на DX9–DX11) окна поверх
  не видны; такие игры запускайте в режиме окна без рамки.
- Игры сопоставляются по имени исполняемого файла; защищённые процессы могут
  его не сообщать.

## Лицензия

[MIT](LICENSE)
