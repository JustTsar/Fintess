# Настройка Supabase sync

## 1. Создать проект Supabase

1. Откройте https://supabase.com.
2. Создайте новый project.
3. В `Project Settings -> API` скопируйте:
   - `Project URL`
   - `anon public` key
4. Вставьте их в `supabase-config.js`.

```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_ANON_KEY",
};
```

## 2. Создать таблицу

Откройте `SQL Editor` в Supabase и выполните содержимое `supabase-schema.sql`.

Таблица хранит один JSON-дневник на пользователя. RLS разрешает пользователю читать и менять только свою строку.

## 3. Включить Google login

1. В Supabase откройте `Authentication -> Providers -> Google`.
2. Включите Google provider.
3. Создайте OAuth Client в Google Cloud Console.
4. В Google OAuth callback добавьте URL из Supabase Google provider.
5. В Supabase `Authentication -> URL Configuration` добавьте GitHub Pages URL в Redirect URLs.

## 4. GitHub Pages

Опубликуйте файлы проекта как статический сайт. После входа через Google данные будут храниться в Supabase и подтягиваться на других устройствах после входа в тот же Google-аккаунт.
