# 🏢 ПРОСТІР КОШТУЄ — Оренда комерційної нерухомості

Повноцінний мобільний PWA-застосунок для оренди комерційної нерухомості в Одесі.

## 🚀 Технологічний стек

- **Next.js 14** (App Router)
- **React 18** + TypeScript
- **Tailwind CSS** (через CSS variables)
- **PWA** (встановлення на телефон)
- Без зовнішньої бази даних (mock дані, легко замінити на Supabase)

## 📁 Структура проекту

```
prostir-full/
├── public/
│   ├── logo-main.png       # Головний логотип (splash screen)
│   ├── logo-192.png        # PWA іконка
│   ├── logo-512.png        # PWA іконка великий
│   └── manifest.json       # PWA конфіг
├── src/
│   ├── app/
│   │   ├── layout.tsx      # Root layout + PWA meta
│   │   ├── page.tsx        # Головний стан застосунку
│   │   └── globals.css     # Глобальні стилі
│   ├── components/
│   │   ├── SplashScreen    # Стартовий екран
│   │   ├── AuthScreen      # Вхід / Реєстрація
│   │   ├── BottomNav       # Навігація знизу
│   │   ├── HomeScreen      # Головна з фідом
│   │   ├── SearchScreen    # Пошук + фільтри
│   │   ├── FavoritesScreen # Збережені
│   │   ├── ChatsScreen     # Чати
│   │   ├── RequestsScreen  # Мої оголошення
│   │   ├── ProfileScreen   # Профіль
│   │   ├── DetailScreen    # Деталі об'єкту
│   │   ├── AddListingScreen# Додати об'єкт
│   │   ├── ImageGallery    # Слайдер фото
│   │   ├── PropertyCard    # Картка об'єкту
│   │   └── FeedbackScreen  # Зворотній зв'язок
│   ├── lib/
│   │   └── mockData.ts     # Дані об'єктів + фід
│   └── types/
│       └── index.ts        # TypeScript типи + утиліти
└── package.json
```

## ⚡ Запуск локально

```bash
# 1. Встанови залежності
npm install

# 2. Запусти dev-сервер
npm run dev

# Відкрий: http://localhost:3000
```

## 🌐 Деплой на Vercel (безкоштовно, ~2 хвилини)

### Варіант 1 — через GitHub (рекомендовано)
1. Завантаж проект на GitHub
2. Зайди на [vercel.com](https://vercel.com) → "Add New Project"
3. Підключи репозиторій → "Deploy"
4. Vercel автоматично визначить Next.js і задеплоїть

### Варіант 2 — через CLI
```bash
npm install -g vercel
vercel login
vercel --prod
```

## ✏️ Як редагувати

### Змінити дані об'єктів:
Файл: `src/lib/mockData.ts` → масив `MOCK_LISTINGS`

### Додати новий об'єкт в дані:
```typescript
{
  id: 9,
  title: 'Новий офіс',
  type: 'Офіс',
  price: 30000,
  area: 100,
  district: 'Приморський',
  address: 'вул. Дерибасівська, 1, Одеса',
  // ...
}
```

### Змінити кольори типів:
Файл: `src/types/index.ts` → об'єкт `TYPE_COLORS`

### Змінити райони/типи нерухомості:
Файл: `src/types/index.ts` → `DISTRICTS`, `PROPERTY_TYPES`, `CATEGORIES`

### Підключити реальну базу даних (Supabase):
1. Встанови: `npm install @supabase/supabase-js`
2. Замінити `MOCK_LISTINGS` на запити до Supabase в `page.tsx`

## 📱 Встановлення PWA на телефон

- **Android (Chrome)**: меню → "Додати на головний екран"
- **iOS (Safari)**: поділитися → "На початковий екран"

## 🔧 Наступні кроки

| Функція | Рішення |
|---------|---------|
| Реальна БД + Auth | Supabase |
| Завантаження фото | Cloudinary / Supabase Storage |
| Чати реального часу | Supabase Realtime |
| Push-сповіщення | Web Push API |
| Пошук по карті | Google Maps API |
