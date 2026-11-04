/**
 * «Задачник» — логика приложения (этап 2, MVP).
 *
 * Архитектура простая и «инженерная» (в духе заказа «главное чтоб работал»
 * и «можно понять, где что происходит»):
 *   1. Всё состояние приложения — два значения: массив задач `tasks`
 *      и текущий фильтр `filter`.
 *   2. Любое действие пользователя меняет состояние и вызывает `renderAll()` —
 *      экран каждый раз полностью перерисовывается из состояния.
 *      Данных немного (десятки задач), поэтому полная перерисовка
 *      быстрее пишется, легче читается и не содержит ошибок рассинхронизации.
 *   3. Данные хранятся в localStorage браузера (аналог UserDefaults из
 *      исходного заказа на Swift). Если localStorage недоступен
 *      (приватный режим, запрет cookies) — приложение работает в памяти:
 *      данные живут до перезагрузки страницы.
 *
 * Карта файла (каждый раздел помечен заголовком-разделителем):
 *   Константы → Состояние → Утилиты → Хранилище → Демо-данные →
 *   → Вычисления → Рендер → Действия → Ближайшая задача → События → Запуск
 */

'use strict';

/* ===================== Константы ===================== */

// Ключ localStorage (v1 — версия схемы данных; при изменении структуры
// задачи в будущем ключ меняется, чтобы старые данные не ломали приложение)
const STORAGE_KEY = 'zadachnik.tasks.v1';

// Порядок статусов задачи: «новая» → «в процессе» → «выполнено».
// Используется для select'ов (карточка и модалка) и подписей бейджей.
const STATUS_ORDER = ['new', 'in_progress', 'done'];

// Подписи статусов для интерфейса (бейджи, select'ы, пустые состояния)
const STATUS_LABELS = {
  new: 'Новая',
  in_progress: 'В процессе',
  done: 'Выполнено',
};

// Подписи фильтров — совпадают с data-атрибутами кнопок фильтра в index.html
const FILTER_LABELS = {
  all: 'Все',
  new: 'Новые',
  in_progress: 'В процессе',
  done: 'Выполненные',
};

// Ограничения на длину полей:
// заголовок из вставленного текста обрезается до 120 символов (ТЗ 6.4),
// заметка из вставки — до 1000 (защита от случайной вставки простыни текста)
const MAX_PASTED_TITLE = 120;
const MAX_PASTED_NOTE = 1000;

// Русские названия месяцев в родительном падеже — для дат вида «5 ноября»
const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/* ===================== Состояние ===================== */

// Массив задач — единственный источник данных для всего интерфейса
let tasks = [];

// Активный фильтр списка: 'all' | 'new' | 'in_progress' | 'done'
let filter = 'all';

// id задачи, открытой в модальном окне редактирования (null — окно закрыто)
let editingId = null;

// id задачи, у которой «взведена» кнопка удаления (двухшаговое подтверждение).
// Первый клик — кнопка меняется на «Точно удалить?», второй клик — удаление.
let deleteArmedId = null;
let deleteArmTimer = null; // таймер, автоматически «разряжающий» кнопку через 3 сек

// id задачи, карточка которой подсвечивается после перехода
// из блока «Ближайшая задача» (подсветка снимается через 1,5 сек)
let highlightCardId = null;

/* ===================== Утилиты ===================== */

// Сегодняшняя дата в формате ISO «YYYY-MM-DD» (локальная, не UTC —
// иначе вечером даты «уедут» на день вперёд). Сравнивать даты-строки
// этого формата можно напрямую: '2026-11-05' < '2026-11-06'.
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0'); // месяц с ведущим нулём
  const day = String(d.getDate()).padStart(2, '0');    // день с ведущим нулём
  return `${d.getFullYear()}-${m}-${day}`;
}

// Дата на N дней вперёд (или назад при отрицательном N) от сегодняшней.
// Нужна для генерации демо-данных (вчера / завтра / через 3 дня).
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Человекочитаемая дата для бейджа карточки: «сегодня», «завтра»,
// «5 ноября» (плюс год, если дата не в текущем году).
function formatDateRu(isoDate) {
  if (isoDate === todayStr()) return 'сегодня';
  if (isoDate === addDays(1)) return 'завтра';
  const [y, m, d] = isoDate.split('-').map(Number);
  const month = MONTHS_RU[m - 1]; // месяцы в массиве с нуля
  return y === new Date().getFullYear() ? `${d} ${month}` : `${d} ${month} ${y}`;
}

// Уникальный id задачи: текущее время + случайный суффикс.
// Суффикс страхует от коллизии, если две задачи созданы в одну миллисекунду.
function uid() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Экранирование HTML-символов в пользовательском тексте (заголовок, заметка).
// Без этого вставка в текст задачи чего-то вроде <img …> превратилась бы
// в реальный HTML — открыта дверь к поломке вёрстки и XSS.
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ===================== Хранилище ===================== */

// Проверяем доступность localStorage один раз при загрузке.
// try/catch нужен потому, что обращение к localStorage в приватном
// режиме некоторых браузеров бросает исключение, а не возвращает null.
function detectStorage() {
  try {
    const probe = '__zadachnik_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const storageOK = detectStorage();

// Запасное хранилище в памяти: используется, только если localStorage недоступен
const memoryStore = {};

// Единая точка чтения: localStorage, а при его отсутствии — память
function readStore(key) {
  return storageOK ? localStorage.getItem(key) : (key in memoryStore ? memoryStore[key] : null);
}

// Единая точка записи — по той же логике
function writeStore(key, value) {
  if (storageOK) localStorage.setItem(key, value);
  else memoryStore[key] = value;
}

// Загружает задачи из хранилища при старте приложения.
// - ключа нет (самый первый запуск) → создаём демо-данные;
// - ключ есть, но JSON повреждён (вмешательство руками) → считаем список пустым,
//   а не падаем: «главное чтоб работал».
function loadTasks() {
  const raw = readStore(STORAGE_KEY);
  if (raw === null) {
    tasks = seedDemoTasks();
    saveTasks();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    tasks = Array.isArray(parsed) ? parsed : [];
  } catch {
    tasks = [];
  }
}

// Сохраняет текущий массив задач в хранилище (вызывается после каждого изменения)
function saveTasks() {
  writeStore(STORAGE_KEY, JSON.stringify(tasks));
}

/* ===================== Демо-данные ===================== */

// Демо-задачи для самого первого запуска (бриф: первый запуск не должен
// выглядеть пустым). Набор подобран так, чтобы сразу были видны все
// возможности: все три статуса, просрочка, блок «Ближайшая задача».
// Даты считаются относительно сегодняшнего дня — демо-данные всегда «живые».
function seedDemoTasks() {
  const now = Date.now();
  // createdAt у задач разный (ступенька в минуту), чтобы при равных датах
  // сортировка была стабильной и повторяемой
  return [
    {
      id: uid(), title: 'Отправить отчёт по проекту',
      date: addDays(-1), status: 'new',
      note: 'Разделы 1–3 готовы, осталось приложение',
      createdAt: now - 60000, updatedAt: now - 60000,
    },
    {
      id: uid(), title: 'Оплатить хостинг сайта',
      date: todayStr(), status: 'new',
      note: 'До конца недели, иначе отключат',
      createdAt: now - 120000, updatedAt: now - 120000,
    },
    {
      id: uid(), title: 'Созвон с командой',
      date: todayStr(), status: 'in_progress',
      note: 'Обсудить план на неделю',
      createdAt: now - 180000, updatedAt: now - 180000,
    },
    {
      id: uid(), title: 'Забрать посылку с почты',
      date: addDays(1), status: 'new',
      note: 'Пункт выдачи до 20:00',
      createdAt: now - 240000, updatedAt: now - 240000,
    },
    {
      id: uid(), title: 'Начать готовить презентацию',
      date: addDays(3), status: 'in_progress',
      note: 'Черновик структуры — 8 слайдов',
      createdAt: now - 300000, updatedAt: now - 300000,
    },
    {
      id: uid(), title: 'Купить продукты',
      date: todayStr(), status: 'done',
      note: 'Крупа, молоко, кофе',
      createdAt: now - 360000, updatedAt: now - 360000,
    },
    {
      id: uid(), title: 'Ответить на письма',
      date: addDays(-1), status: 'done',
      note: '',
      createdAt: now - 420000, updatedAt: now - 420000,
    },
  ];
}

/* ===================== Вычисления ===================== */

// Счётчики задач по статусам — для строки в шапке и кнопок фильтра.
// Возвращает объект вида { all: 7, new: 3, in_progress: 2, done: 2 }.
function getStatusCounts() {
  const counts = { all: tasks.length, new: 0, in_progress: 0, done: 0 };
  for (const t of tasks) counts[t.status] += 1;
  return counts;
}

// Невыполненная задача с прошедшей датой — «просрочена».
function isOverdue(task) {
  return task.status !== 'done' && task.date < todayStr();
}

// Задача для блока «Ближайшая по сроку невыполненная» (аналог today-extension):
// среди всех задач со статусом ≠ «выполнено» берём ту, у которой ближайшая дата;
// при равных датах — созданную раньше. Если невыполненных нет — null.
function getNearestTask() {
  let nearest = null;
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (!nearest || t.date < nearest.date || (t.date === nearest.date && t.createdAt < nearest.createdAt)) {
      nearest = t;
    }
  }
  return nearest;
}

// Задачи, которые нужно показать при текущем фильтре, в нужном порядке:
// невыполненные сверху, внутри — по дате по возрастанию (ближайшие сверху),
// при равных датах — по времени создания; выполненные — в самом низу.
function getVisibleTasks() {
  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  return filtered.slice().sort((a, b) => {
    const aDone = a.status === 'done' ? 1 : 0;
    const bDone = b.status === 'done' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;      // выполненные — вниз
    if (a.date !== b.date) return a.date < b.date ? -1 : 1; // дата по возрастанию
    return a.createdAt - b.createdAt;               // стабильность при равных датах
  });
}

/* ===================== Рендер ===================== */

// Короткие псевдонимы поиска элементов DOM (по CSS-селектору и по id)
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

// Полная перерисовка всех динамических частей экрана.
// Вызывается после каждого изменения состояния.
function renderAll() {
  renderCounts();
  renderNearest();
  renderFilterBar();
  renderList();
}

// Счётчик в шапке: «Всего N · новых M · в процессе K · выполнено L»
function renderCounts() {
  const c = getStatusCounts();
  byId('appCounts').textContent =
    `Всего ${c.all} · новых ${c.new} · в процессе ${c.in_progress} · выполнено ${c.done}`;
}

// Блок «Ближайшая по сроку невыполненная задача».
// Заполняет заголовок и бейджи, показывает блок; если такой задачи нет — скрывает.
function renderNearest() {
  const box = byId('nearestCard');
  const t = getNearestTask();
  if (!t) {
    box.hidden = true; // все задачи выполнены — блок не нужен
    return;
  }
  box.hidden = false;
  byId('nearestTitle').textContent = t.title;

  // Бейдж даты: для просрочки — красная версия с пометкой (см. CSS .badge-overdue)
  const dateBadge = byId('nearestDate');
  dateBadge.textContent = isOverdue(t) ? `просрочена · ${formatDateRu(t.date)}` : formatDateRu(t.date);
  dateBadge.classList.toggle('badge-overdue', isOverdue(t));

  // Бейдж статуса: цвет определяется классом badge-new / badge-in_progress / badge-done
  const statusBadge = byId('nearestStatus');
  statusBadge.textContent = STATUS_LABELS[t.status];
  statusBadge.className = `badge badge-${t.status}`;
}

// Кнопки фильтра: обновляем счётчики в скобках и подсвечиваем активную.
// Счётчики считаются по всему списку задач, а не по текущему фильтру (ТЗ 6.1).
function renderFilterBar() {
  const c = getStatusCounts();
  byId('countAll').textContent = c.all;
  byId('countNew').textContent = c.new;
  byId('countInProgress').textContent = c.in_progress;
  byId('countDone').textContent = c.done;
  for (const btn of document.querySelectorAll('.filter-btn')) {
    btn.classList.toggle('is-active', btn.dataset.filter === filter);
  }
}

// Отрисовка списка задач и переключение пустых состояний
function renderList() {
  const list = byId('taskList');
  const visible = getVisibleTasks();

  // Пустые состояния: задач нет вообще / фильтр ничего не нашёл.
  // Показываем ровно одно из двух, либо ни одного, если список непуст.
  byId('emptyAll').hidden = tasks.length !== 0;
  byId('emptyFiltered').hidden = !(tasks.length !== 0 && visible.length === 0);

  // Собираем карточки в DocumentFragment (временный контейнер в памяти)
  // и вставляем одной операцией — так быстрее, чем добавлять по одной.
  const fragment = document.createDocumentFragment();
  for (const t of visible) fragment.appendChild(buildCard(t));
  list.replaceChildren(fragment); // заменяем всё содержимое списка разом
}

// Создаёт DOM-узел карточки задачи со всеми элементами и обработчиками.
// Каждый блок карточки подписан комментарием — прямое требование заказа
// («//Описание элемента и что он делает»), здесь оно применено к веб-верстке.
function buildCard(task) {
  // Корневой элемент карточки; data-id используется для поиска карточки
  // при переходе из блока «Ближайшая задача», is-done приглушает заголовок
  // выполненных задач, is-highlighted — подсветка перехода из «ближайшей»
  const card = document.createElement('article');
  card.className = 'card'
    + (task.id === highlightCardId ? ' is-highlighted' : '')
    + (task.status === 'done' ? ' is-done' : '');
  card.dataset.id = task.id;

  // Строка 1: бейдж статуса + бейдж даты (с пометкой о просрочке)
  const badges = document.createElement('div');
  badges.className = 'card-badges';
  badges.innerHTML =
    `<span class="badge badge-${task.status}">${STATUS_LABELS[task.status]}</span>` +
    `<span class="badge ${isOverdue(task) ? 'badge-overdue' : 'badge-date'}">` +
    `${isOverdue(task) ? 'просрочена · ' : ''}${formatDateRu(task.date)}</span>`;
  card.appendChild(badges);

  // Строка 2: заголовок задачи
  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = task.title;
  card.appendChild(title);

  // Строка 3: заметка (показывается только если она есть)
  if (task.note) {
    const note = document.createElement('p');
    note.className = 'card-note';
    note.textContent = task.note;
    card.appendChild(note);
  }

  // Строка 4: панель управления — select статуса, «Редактировать», «Удалить».
  // Смена статуса прямо на карточке — самое частое действие (ТЗ, вопрос 2),
  // поэтому вынесено из модалки.
  const controls = document.createElement('div');
  controls.className = 'card-controls';

  // select статуса: текущее значение отмечено, при смене — setStatus()
  const statusSelect = document.createElement('select');
  statusSelect.className = 'status-select';
  statusSelect.setAttribute('aria-label', 'Статус задачи');
  for (const s of STATUS_ORDER) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = STATUS_LABELS[s];
    if (s === task.status) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusSelect.addEventListener('change', () => setStatus(task.id, statusSelect.value));
  controls.appendChild(statusSelect);

  // Кнопка редактирования: открывает модальное окно с этой задачей
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-ghost btn-small';
  editBtn.textContent = 'Редактировать';
  editBtn.addEventListener('click', () => openModal(task.id));
  controls.appendChild(editBtn);

  // Кнопка удаления с двухшаговым подтверждением (ТЗ 6.1):
  // первый клик «взводит» её на 3 секунды, второй — удаляет.
  // Это защищает от случайного удаления одним промахом.
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-small btn-danger';
  if (task.id === deleteArmedId) {
    delBtn.textContent = 'Точно удалить?';
    delBtn.classList.add('is-armed');
  } else {
    delBtn.textContent = 'Удалить';
  }
  delBtn.addEventListener('click', () => requestDelete(task.id));
  controls.appendChild(delBtn);

  card.appendChild(controls);
  return card;
}

/* ===================== Действия ===================== */

// Создание задачи (из формы добавления или из вставленного текста).
// Возвращает созданную задачу или null, если заголовок пуст.
function addTask(title, date, note = '') {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;
  const now = Date.now();
  const task = {
    id: uid(),
    title: cleanTitle,
    date: date || todayStr(), // дата не пришла — берём «сегодня»
    status: 'new',            // любая новая задача начинается со статуса «новая»
    note,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  saveTasks();
  renderAll();
  return task;
}

// Разбор вставленного текста (веб-аналог шаринга текста извне, ТЗ 6.4):
// - первая непустая строка → заголовок (обрезается до 120 символов);
// - всё, что после неё → заметка (до 1000 символов);
// - нет ни одной непустой строки → null (создавать нечего).
function parsePastedText(raw) {
  // Разбиваем на строки и находим первую непустую — она станет заголовком
  const lines = String(raw).split(/\r?\n/);
  let titleIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') { titleIndex = i; break; }
  }
  if (titleIndex === -1) return null;

  const title = lines[titleIndex].trim().slice(0, MAX_PASTED_TITLE);
  // Заметка — всё, что ниже заголовка; пустые строки в начале отбрасываем
  const note = lines.slice(titleIndex + 1).join('\n').trim().slice(0, MAX_PASTED_NOTE);
  return { title, note };
}

// Смена статуса задачи (select на карточке или select в модалке).
// updatedAt фиксирует время последнего изменения — поле на будущее,
// для сортировок и возможного экспорта.
function setStatus(id, status) {
  const t = tasks.find((x) => x.id === id);
  if (!t || !STATUS_ORDER.includes(status)) return;
  t.status = status;
  t.updatedAt = Date.now();
  saveTasks();
  renderAll();
}

// Удаление с двухшаговым подтверждением.
// Шаг 1: «взводим» кнопку (id запоминается, экран перерисовывается —
// на карточке появляется «Точно удалить?») и ставим таймер на 3 секунды.
// Шаг 2: повторный клик в течение 3 секунд — задача удаляется.
function requestDelete(id) {
  if (deleteArmedId !== id) {
    deleteArmedId = id;
    clearTimeout(deleteArmTimer);
    deleteArmTimer = setTimeout(() => {  // без второго клика кнопка «разряжается»
      deleteArmedId = null;
      renderAll();
    }, 3000);
    renderAll();
    return;
  }
  // Шаг 2: подтверждено — снимаем «взведение» и удаляем задачу из массива
  clearTimeout(deleteArmTimer);
  deleteArmedId = null;
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  renderAll();
}

/* ===================== Ближайшая задача ===================== */

// Переход из блока «Ближайшая задача» к карточке (аналог перехода
// из today-extension в основное приложение, ТЗ 6.3):
//   1. Если активный фильтр прячет эту задачу — переключаемся на «Все».
//   2. Полная перерисовка — карточка гарантированно есть в DOM.
//   3. Плавная прокрутка к карточке + подсветка на 1,5 секунды.
function scrollToNearest() {
  const t = getNearestTask();
  if (!t) return;

  // Проверяем, попадает ли задача в текущий фильтр
  const visibleNow = getVisibleTasks().some((x) => x.id === t.id);
  if (!visibleNow) {
    filter = 'all';
    renderAll();
  }

  // Ищем карточку в DOM по data-id и подсвечиваем её
  const card = document.querySelector(`.card[data-id="${t.id}"]`);
  if (card) {
    highlightCardId = t.id;
    card.classList.add('is-highlighted');
    // Плавная прокрутка, если пользователь не просил систему «меньше движения»
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => {
      highlightCardId = null;
      card.classList.remove('is-highlighted'); // снимаем класс точечно,
    }, 1500);                                  // без полной перерисовки
  }
}

/* ===================== Модальное окно ===================== */

// Ссылки на модальное окно и его поля (элементы описаны в index.html)
const modal = byId('taskModal');
const modalTitleInput = byId('taskTitle');
const modalDateInput = byId('taskDate');
const modalStatusSelect = byId('taskStatus');
const modalNoteInput = byId('taskNote');

// Открывает модальное окно и заполняет поля данными задачи.
// Валидация полей — ручная (см. saveModal): у форм с method="dialog"
// нативная required-проверка НЕ блокирует отправку, поэтому полагаться
// на неё нельзя — required оставлен только для семантики.
function openModal(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  modalTitleInput.value = t.title;
  modalDateInput.value = t.date;
  modalStatusSelect.value = t.status;
  modalNoteInput.value = t.note;
  clearModalErrors();
  modal.showModal();
  modalTitleInput.focus(); // сразу можно править заголовок
}

// Сбрасывает подсветку ошибок модалки (при открытии и после исправления)
function clearModalErrors() {
  byId('titleError').hidden = true;
  byId('dateError').hidden = true;
  modalTitleInput.classList.remove('is-invalid');
  modalDateInput.classList.remove('is-invalid');
}

// Сохранение модалки. Возвращает true, если данные прошли проверку
// и сохранены. Пустой заголовок или пустая дата — ошибка: окно остаётся
// открытым, под полями появляется кирпичное сообщение (CSS .field-error).
function saveModal() {
  const t = tasks.find((x) => x.id === editingId);
  if (!t) return false;

  const title = modalTitleInput.value.trim();
  const date = modalDateInput.value;
  const titleOk = title !== '';
  const dateOk = date !== '';

  // Показываем ошибки только под проблемными полями
  byId('titleError').hidden = titleOk;
  modalTitleInput.classList.toggle('is-invalid', !titleOk);
  byId('dateError').hidden = dateOk;
  modalDateInput.classList.toggle('is-invalid', !dateOk);
  if (!titleOk || !dateOk) return false;

  t.title = title;
  t.date = date;
  t.status = modalStatusSelect.value;
  t.note = modalNoteInput.value.trim();
  t.updatedAt = Date.now();
  saveTasks();
  renderAll();
  return true;
}

/* ===================== События ===================== */

// Единая точка привязки всех обработчиков — вызывается один раз при старте.
function wireEvents() {
  // Форма быстрого добавления: заголовок + срок → новая задача.
  // После добавления поле очищается, срок возвращается к «сегодня» —
  // дефолт каждой новой задачи предсказуем.
  byId('addForm').addEventListener('submit', (e) => {
    e.preventDefault(); // отменяем перезагрузку страницы — это SPA без сервера
    addTask(byId('addTitle').value, byId('addDate').value);
    byId('addTitle').value = '';
    byId('addDate').value = todayStr();
    byId('addTitle').focus(); // можно сразу вводить следующую задачу
  });

  // Создание задачи из вставленного текста.
  // Ctrl/Cmd+Enter в textarea — то же действие, что и кнопка.
  function createFromPaste() {
    const parsed = parsePastedText(byId('pasteText').value);
    if (!parsed) {
      // Нечего создавать: просим вставить текст и не закрываем панель
      byId('pasteHint').textContent = 'Вставьте текст задачи — первая строка станет заголовком';
      return;
    }
    addTask(parsed.title, todayStr(), parsed.note);
    byId('pasteText').value = '';               // панель очищаем и сворачиваем —
    byId('pastePanel').open = false;            // задача уже в списке
    byId('pasteHint').textContent = 'Первая строка → заголовок, остальное → заметка';
  }
  byId('pasteCreateBtn').addEventListener('click', createFromPaste);
  byId('pasteText').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') createFromPaste();
  });

  // Фильтр по статусу: клик по кнопке-сегменту меняет активный фильтр
  byId('filterBar').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    filter = btn.dataset.filter;
    renderAll();
  });

  // Клик по блоку «Ближайшая задача» — переход к карточке
  byId('nearestCard').addEventListener('click', scrollToNearest);

  // Кнопка «Отмена» в модалке: просто закрываем окно без сохранения
  byId('cancelModalBtn').addEventListener('click', () => modal.close());

  // Отправка формы модалки. Форма обычная (без method="dialog"), поэтому
  // без preventDefault браузер пытался бы отправить её на сервер и
  // перезагрузил страницу. Всегда отменяем отправку и закрываем окно
  // сами — только если saveModal вернул true (поля прошли валидацию).
  byId('taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveModal()) modal.close();
  });

  // После закрытия модалки (Сохранить / Отмена / Esc) сбрасываем
  // редактируемый id и подсветку ошибок — окно готово к следующему открытию
  modal.addEventListener('close', () => {
    editingId = null;
    clearModalErrors();
  });
}

/* ===================== Запуск ===================== */

// Инициализация приложения при загрузке страницы:
// 1) загружаем задачи (или создаём демо-данные при первом запуске),
// 2) ставим в форму добавления дефолтный срок «сегодня»,
// 3) привязываем обработчики,
// 4) рисуем экран.
loadTasks();
byId('addDate').value = todayStr();
wireEvents();
renderAll();
