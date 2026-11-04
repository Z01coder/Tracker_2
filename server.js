/**
 * «Задачник» — минималистичный трекер задач (Tracker_2).
 *
 * Сервер максимально простой: только раздаёт статику из папки public/.
 * Вся логика приложения (задачи, статусы, фильтры, ближайшая задача)
 * живёт на клиенте в public/js/app.js, данные — в localStorage браузера,
 * поэтому бэкенду не нужны ни база данных, ни API-роуты.
 *
 * Запуск: npm start (или node server.js). Порт 3002, слушать на 0.0.0.0,
 * чтобы приложение было доступно и с других устройств в локальной сети.
 */

'use strict';

const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3002; // PORT задаёт Railway при деплое, локально — 3002

// Раздаём статику (index.html, css/, js/, assets/) из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница: express.static сам отдаёт index.html, но оставим
// явный роут, чтобы поведение было очевидным при чтении кода
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ «Задачник» запущен: http://localhost:${PORT}`);
});
