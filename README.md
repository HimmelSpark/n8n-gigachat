# n8n-nodes-gigachat

Неофициальный пакет community-нод для [n8n](https://n8n.io), добавляющий поддержку [GigaChat](https://developers.sber.ru/docs/ru/gigachat/overview) — языковой модели от Сбера.

> **Внимание:** это неофициальный проект, не аффилированный со Сбером. Используйте на свой страх и риск.

## Ноды

| Нода | Тип | Описание |
|------|-----|----------|
| **GigaChat** | Обычная нода | Чат с поддержкой памяти, инструментов и function calling |
| **GigaChat Model** | LangChain `AiLanguageModel` | Подключает GigaChat как языковую модель к AI Agent, Summarize Chain и другим LangChain-нодам |
| **GigaChat Embeddings** | LangChain `AiEmbedding` | Генерирует эмбеддинги для Vector Store и других потребителей |

### GigaChat (чат-нода)

- Многоходовый диалог с настраиваемым числом итераций function calling
- Опциональное подключение памяти (`AiMemory`)
- Опциональное подключение инструментов (`AiTool`)
- Два режима вывода: упрощённый и полный (с usage-статистикой)

### GigaChat Model

- LangChain-совместимая обёртка над GigaChat
- Подключается к любой n8n AI-ноде через выход `AiLanguageModel`
- Параметры: модель, температура, top_p, max_tokens, repetition_penalty

### GigaChat Embeddings

- LangChain-совместимые эмбеддинги
- Подключается к Vector Store нодам через выход `AiEmbedding`

## Установка

### Через n8n Community Nodes (рекомендуется)

1. Откройте **Settings → Community Nodes**
2. Нажмите **Install**
3. Введите `n8n-nodes-gigachat`
4. Подтвердите установку

### Вручную

```bash
cd ~/.n8n
npm install n8n-nodes-gigachat
```

После установки перезапустите n8n.

## Получение ключа API

1. Зарегистрируйтесь на [developers.sber.ru/studio](https://developers.sber.ru/studio)
2. Создайте проект и получите **Client ID** и **Client Secret**
3. Закодируйте `ClientId:ClientSecret` в Base64:
   ```bash
   echo -n "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" | base64
   ```
4. Используйте полученную строку как **Authorization Key** в настройках credential

## Настройка credential

В n8n создайте credential типа **GigaChat**:

| Поле | Описание |
|------|----------|
| **Authorization Key** | Base64-строка `ClientId:ClientSecret` |
| **Scope** | Тип аккаунта: `GIGACHAT_API_PERS` (физлицо), `GIGACHAT_API_B2B` (бизнес с пакетами), `GIGACHAT_API_CORP` (бизнес pay-as-you-go) |
| **Auth Base URL** | URL OAuth-сервера (по умолчанию: `https://ngw.devices.sberbank.ru:9443`) |
| **API Base URL** | URL GigaChat API (по умолчанию: `https://gigachat.devices.sberbank.ru/api/v1`) |
| **Debug** | Включить подробное логирование в консоль n8n |

## Разработка

### Требования

- Node.js 18+
- npm

### Установка зависимостей

```bash
npm install
```

### Сборка

```bash
npm run build
```

### Режим разработки (watch)

```bash
npm run dev
```

### Тесты

```bash
npm test
npm run test:coverage
```

### Линтинг и форматирование

```bash
npm run lint
npm run format
```

### Структура проекта

```
credentials/
  GigaChatApi.credentials.ts   # Тип credential для n8n
nodes/
  GigaChat/                    # Чат-нода
  LmGigaChat/                  # LangChain LLM supply-нода
  EmGigaChat/                  # LangChain Embeddings supply-нода
  shared/
    client/                    # HTTP-клиент, token store, типы
    modelLoader.ts             # Загрузка списка моделей для дропдаунов
    descriptions.ts            # Общие описания и дисклеймеры
__tests__/                     # Unit-тесты для клиента
```

## Лицензия

[MIT](LICENSE)
