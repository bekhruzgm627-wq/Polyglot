# Polyglot

Полноценная полнофункциональная Node.js/HTTP платформа с регистрацией, входом и Google OAuth.

## Запуск

```bash
npm install
npm start
```

После запуска откройте:

- http://localhost:3000

## Переменные окружения

```bash
GOOGLE_CLIENT_ID=your-google-client-id
PORT=3000
```

## Что есть

- Регистрация по email/password
- Вход по email/password
- Google OAuth через `credential`
- Личный прогресс пользователя
- Статический фронтенд в `public/`
- Сохранение пользователей в `data/users.json`
