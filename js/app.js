/* =====================================================
   Expense & Budget Visualizer — app.js
   Features:
     1. Custom categories
     2. Monthly summary view
     3. Sort & filter transactions
     4. Budget limits with warnings
     5. Dark / Light mode toggle
   ===================================================== */

'use strict';

/* ══════════════════════════════════════════
   STORAGE KEYS
══════════════════════════════════════════ */
const KEY_TX         = 'ebv_transactions';
const KEY_CATS       = 'ebv_custom_categories';
const KEY_BUDGETS    = 'ebv_budgets';
const KEY_THEME      = 'ebv_theme';

/* ══════════════════════════════════════════
   BUILT-IN CATEGORY CONFIG
══════════════════════════════════════════ */
const BUILTIN_CATS = {
  Food:      { emoji: '🍔', color: '#f97316', badgeClass: 'badge-food' },
  Transport: { emoji: '🚌', color: '#3b82f6', badgeClass: 'badge-transport' },
  Fun:       { emoji: '🎉', color: '#a855f7', badgeClass: 'badge-fun' },
};

/* ══════════════════════════════════════════
   STATE
══════════════════════════════════════════ */
let transactions   = [];   // { id, name, amount, category, dateISO, dateLabel }
let customCats     = {};   // { Name: { emoji, color } }
let budgets        = {};   // { Category: limitAmount }
let currentSort    = 'date-desc';
let currentFilter  = 'all';
let viewMonth      = null; // { year, month } — null = current month

/* ── Derived: all categories (built-in + custom) ── */
function allCats() {
  const result = { ...BUILTIN_CATS };
  for (const [name, cfg] of Object.entries(customCats)) {
    result[name] = { emoji: cfg.emoji, color: cfg.color, badgeClass: 'badge-custom' };
  }
  return result;
}

/* ══════════════════════════════════════════
   DOM REFS
══════════════════════════════════════════ */
const form            = document.getElementById('transactionForm');
const itemNameInput   = document.getElementById('itemName');
const amountInput     = document.getElementById('amount');
const categorySelect  = document.getElementById('category');
const nameError       = document.getElementById('nameError');
const amountError     = document.getElementById('amountError');
const categoryError   = document.getElementById('categoryError');
const totalBalanceEl  = document.getElementById('totalBalance');
const categoryPills   = document.getElementById('categoryPills');
const transactionList = document.getElementById('transactionList');
const emptyState      = document.getElementById('emptyState');
const clearAllBtn     = document.getElementById('clearAllBtn');
const chartCanvas     = document.getElementById('spendingChart');
const chartWrapper    = document.getElementById('chartWrapper');
const chartEmpty      = document.getElementById('chartEmpty');
const sortSelect      = document.getElementById('sortSelect');
const filterSelect    = document.getElementById('filterSelect');
const themeToggle     = document.getElementById('themeToggle');
const themeIcon       = document.getElementById('themeIcon');
const themeLabel      = document.getElementById('themeLabel');

// Custom category modal
const addCategoryBtn    = document.getElementById('addCategoryBtn');
const categoryModal     = document.getElementById('categoryModal');
const customCatEmoji    = document.getElementById('customCatEmoji');
const customCatName     = document.getElementById('customCatName');
const customCatColor    = document.getElementById('customCatColor');
const customCatError    = document.getElementById('customCatError');
const saveCategoryBtn   = document.getElementById('saveCategoryBtn');
const cancelCategoryBtn = document.getElementById('cancelCategoryBtn');

// Monthly summary tab
const prevMonthBtn  = document.getElementById('prevMonth');
const nextMonthBtn  = document.getElementById('nextMonth');
const monthLabel    = document.getElementById('monthLabel');
const monthlyStats  = document.getElementById('monthlyStats');
const monthlyList   = document.getElementById('monthlyList');
const monthlyEmpty  = document.getElementById('monthlyEmpty');

// Budget tab
const budgetList = document.getElementById('budgetList');

// Chart instances
let spendingChart = null;
let monthlyChart  = null;

/* ══════════════════════════════════════════
   LOCAL STORAGE
══════════════════════════════════════════ */
function loadAll() {
  try { transactions = JSON.parse(localStorage.getItem(KEY_TX))   || []; } catch { transactions = []; }
  try { customCats   = JSON.parse(localStorage.getItem(KEY_CATS)) || {}; } catch { customCats = {}; }
  try { budgets      = JSON.parse(localStorage.getItem(KEY_BUDGETS)) || {}; } catch { budgets = {}; }
}

function saveTx()      { localStorage.setItem(KEY_TX,      JSON.stringify(transactions)); }
function saveCats()    { localStorage.setItem(KEY_CATS,    JSON.stringify(customCats)); }
function saveBudgets() { localStorage.setItem(KEY_BUDGETS, JSON.stringify(budgets)); }

/* ══════════════════════════════════════════
   THEME  (Feature 5)
══════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY_THEME, theme);
  if (theme === 'dark') {
    themeIcon.textContent  = '☀️';
    themeLabel.textContent = 'Light';
  } else {
    themeIcon.textContent  = '🌙';
    themeLabel.textContent = 'Dark';
  }
  // Re-render chart so Chart.js picks up new colours
  if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
  if (monthlyChart)  { monthlyChart.destroy();  monthlyChart  = null; }
  renderPieChart();
  renderMonthlyChart();
}

function initTheme() {
  const saved = localStorage.getItem(KEY_THEME) || 'light';
  applyTheme(saved);
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
function formatCurrency(v) {
  return '$' + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

function chartTextColor() { return isDark() ? '#cbd5e1' : '#374151'; }
function chartGridColor() { return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'; }

/* ══════════════════════════════════════════
   CATEGORY HELPERS
══════════════════════════════════════════ */
function getCatCfg(name) {
  return allCats()[name] || { emoji: '🏷️', color: '#6b7280', badgeClass: 'badge-custom' };
}

function rebuildCategorySelects() {
  // Rebuild the form's <select> options
  const cats = allCats();
  categorySelect.innerHTML = '<option value="" disabled>Select a category</option>';
  for (const [name, cfg] of Object.entries(cats)) {
    const opt = document.createElement('option');
    opt.value       = name;
    opt.textContent = `${cfg.emoji} ${name}`;
    categorySelect.appendChild(opt);
  }

  // Rebuild the filter <select>
  const prev = filterSelect.value;
  filterSelect.innerHTML = '<option value="all">All categories</option>';
  for (const name of Object.keys(cats)) {
    const opt = document.createElement('option');
    opt.value       = name;
    opt.textContent = `${getCatCfg(name).emoji} ${name}`;
    filterSelect.appendChild(opt);
  }
  filterSelect.value = prev || 'all';
}

/* ══════════════════════════════════════════
   CUSTOM CATEGORIES  (Feature 1)
══════════════════════════════════════════ */
addCategoryBtn.addEventListener('click', () => {
  customCatEmoji.value = '';
  customCatName.value  = '';
  customCatColor.value = '#10b981';
  customCatError.textContent = '';
  categoryModal.classList.remove('hidden');
  customCatName.focus();
});

cancelCategoryBtn.addEventListener('click', () => categoryModal.classList.add('hidden'));

categoryModal.addEventListener('click', e => {
  if (e.target === categoryModal) categoryModal.classList.add('hidden');
});

saveCategoryBtn.addEventListener('click', () => {
  const name  = customCatName.value.trim();
  const emoji = customCatEmoji.value.trim() || '🏷️';
  const color = customCatColor.value;

  customCatError.textContent = '';

  if (!name) {
    customCatError.textContent = 'Category name is required.';
    customCatName.focus();
    return;
  }
  if (allCats()[name]) {
    customCatError.textContent = `"${escapeHtml(name)}" already exists.`;
    return;
  }

  customCats[name] = { emoji, color };
  saveCats();
  rebuildCategorySelects();
  renderBudgetList();
  categoryModal.classList.add('hidden');
});

/* ══════════════════════════════════════════
   VALIDATION
══════════════════════════════════════════ */
function clearErrors() {
  nameError.textContent = amountError.textContent = categoryError.textContent = '';
  itemNameInput.classList.remove('error');
  amountInput.classList.remove('error');
  categorySelect.classList.remove('error');
}

function validate() {
  clearErrors();
  let ok = true;
  const name   = itemNameInput.value.trim();
  const amount = amountInput.value.trim();
  const cat    = categorySelect.value;

  if (!name) {
    nameError.textContent = 'Item name is required.';
    itemNameInput.classList.add('error');
    ok = false;
  }
  if (!amount || isNaN(+amount) || +amount <= 0) {
    amountError.textContent = 'Enter a valid amount greater than 0.';
    amountInput.classList.add('error');
    ok = false;
  }
  if (!cat) {
    categoryError.textContent = 'Please select a category.';
    categorySelect.classList.add('error');
    ok = false;
  }
  return ok;
}

/* ══════════════════════════════════════════
   ADD / DELETE TRANSACTIONS
══════════════════════════════════════════ */
function addTransaction(name, amount, category) {
  const now = new Date();
  transactions.unshift({
    id:         crypto.randomUUID(),
    name,
    amount:     parseFloat((+amount).toFixed(2)),
    category,
    dateISO:    now.toISOString(),
    dateLabel:  now.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }),
  });
  saveTx();
  render();
}

function deleteTransaction(id) {
  transactions = transactions.filter(tx => tx.id !== id);
  saveTx();
  render();
}

function clearAll() {
  if (!transactions.length) return;
  if (!confirm('Delete all transactions? This cannot be undone.')) return;
  transactions = [];
  saveTx();
  render();
}

/* ══════════════════════════════════════════
   SORT & FILTER  (Feature 3)
══════════════════════════════════════════ */
function getDisplayList() {
  let list = [...transactions];

  // Filter
  if (currentFilter !== 'all') {
    list = list.filter(tx => tx.category === currentFilter);
  }

  // Sort
  switch (currentSort) {
    case 'date-desc':    list.sort((a,b) => b.dateISO.localeCompare(a.dateISO)); break;
    case 'date-asc':     list.sort((a,b) => a.dateISO.localeCompare(b.dateISO)); break;
    case 'amount-desc':  list.sort((a,b) => b.amount - a.amount); break;
    case 'amount-asc':   list.sort((a,b) => a.amount - b.amount); break;
    case 'category-az':  list.sort((a,b) => a.category.localeCompare(b.category)); break;
  }

  return list;
}

/* ══════════════════════════════════════════
   BUDGET HELPERS  (Feature 4)
══════════════════════════════════════════ */
function spentByCategory() {
  const totals = {};
  transactions.forEach(tx => {
    totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
  });
  return totals;
}

function spentThisMonthByCategory() {
  const now = new Date();
  const totals = {};
  transactions.forEach(tx => {
    const d = new Date(tx.dateISO);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
    }
  });
  return totals;
}

function isOverLimit(category) {
  const limit = budgets[category];
  if (!limit) return false;
  const spent = spentThisMonthByCategory()[category] || 0;
  return spent > limit;
}

function isNearLimit(category) {
  const limit = budgets[category];
  if (!limit) return false;
  const spent = spentThisMonthByCategory()[category] || 0;
  return spent >= limit * 0.8 && spent <= limit;
}

/* ══════════════════════════════════════════
   RENDER — BALANCE CARD
══════════════════════════════════════════ */
function renderBalance() {
  const total = transactions.reduce((s,tx) => s + tx.amount, 0);
  totalBalanceEl.textContent = formatCurrency(total);

  const cats = allCats();
  const totals = spentByCategory();
  categoryPills.innerHTML = '';

  for (const [cat, cfg] of Object.entries(cats)) {
    const val = totals[cat];
    if (!val) continue;
    const pill = document.createElement('span');
    const over = isOverLimit(cat);
    pill.className = `pill ${over ? 'over-limit' : ''}`;
    pill.style.background = over ? '' : hexToRgba(cfg.color, 0.35);
    pill.textContent = `${cfg.emoji} ${cat}: ${formatCurrency(val)}${over ? ' ⚠️' : ''}`;
    categoryPills.appendChild(pill);
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ══════════════════════════════════════════
   RENDER — TRANSACTION LIST
══════════════════════════════════════════ */
function renderList() {
  transactionList.innerHTML = '';
  const list = getDisplayList();
  const monthlySpent = spentThisMonthByCategory();

  if (!list.length) {
    emptyState.classList.add('visible');
    clearAllBtn.disabled  = true;
    clearAllBtn.style.opacity = '0.4';
    return;
  }

  emptyState.classList.remove('visible');
  clearAllBtn.disabled  = false;
  clearAllBtn.style.opacity = '1';

  list.forEach(tx => {
    const cfg   = getCatCfg(tx.category);
    const over  = isOverLimit(tx.category);
    const near  = isNearLimit(tx.category);
    const isCustom = !!customCats[tx.category];

    const li = document.createElement('li');
    li.className = `transaction-item${over ? ' over-limit-item' : ''}`;
    li.dataset.category = tx.category;
    li.style.borderLeftColor = cfg.color;

    // Badge style for custom categories
    const badgeStyle = isCustom
      ? `style="background:${hexToRgba(cfg.color,0.12)};color:${cfg.color}"`
      : '';

    // Warning tag
    const warningTag = over
      ? `<span class="item-warning">⚠️ Over limit</span>`
      : near
      ? `<span class="item-warning" style="color:var(--clr-warning)">🔶 Near limit</span>`
      : '';

    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${escapeHtml(tx.name)}</span>
        <div class="item-meta">
          <span class="item-category-badge ${isCustom ? '' : cfg.badgeClass}" ${badgeStyle}>
            ${escapeHtml(cfg.emoji)} ${escapeHtml(tx.category)}
          </span>
          <span class="item-date">${tx.dateLabel}</span>
          ${warningTag}
        </div>
      </div>
      <span class="item-amount">${formatCurrency(tx.amount)}</span>
      <button class="btn-delete" aria-label="Delete ${escapeHtml(tx.name)}" data-id="${tx.id}" title="Delete">✕</button>
    `;
    transactionList.appendChild(li);
  });
}

/* ══════════════════════════════════════════
   RENDER — PIE CHART
══════════════════════════════════════════ */
function renderPieChart() {
  const cats   = allCats();
  const totals = spentByCategory();
  const labels = Object.keys(totals);
  const data   = Object.values(totals);
  const colors = labels.map(l => cats[l]?.color || '#6b7280');

  if (!data.length) {
    chartWrapper.style.display = 'none';
    chartEmpty.classList.add('visible');
    if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
    return;
  }

  chartWrapper.style.display = 'flex';
  chartEmpty.classList.remove('visible');

  const chartData = {
    labels,
    datasets: [{
      data,
      backgroundColor: colors.map(c => c + 'cc'),
      borderColor:     colors,
      borderWidth:     2,
      hoverOffset:     8,
      hoverBorderWidth: 3,
    }],
  };

  if (spendingChart) {
    spendingChart.data = chartData;
    spendingChart.update('active');
  } else {
    spendingChart = new Chart(chartCanvas, {
      type: 'pie',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 14,
              color: chartTextColor(),
              font: { size: 12, family: "'Segoe UI', system-ui, sans-serif" },
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const val   = ctx.parsed;
                const total = ctx.dataset.data.reduce((a,b) => a+b, 0);
                return ` ${formatCurrency(val)}  (${((val/total)*100).toFixed(1)}%)`;
              },
            },
          },
        },
      },
    });
  }
}

/* ══════════════════════════════════════════
   MONTHLY SUMMARY  (Feature 2)
══════════════════════════════════════════ */
function initViewMonth() {
  const now = new Date();
  viewMonth = { year: now.getFullYear(), month: now.getMonth() };
}

function monthlyTxs() {
  return transactions.filter(tx => {
    const d = new Date(tx.dateISO);
    return d.getFullYear() === viewMonth.year && d.getMonth() === viewMonth.month;
  });
}

function renderMonthlyTab() {
  // Label
  const d = new Date(viewMonth.year, viewMonth.month, 1);
  monthLabel.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const list  = monthlyTxs();
  const total = list.reduce((s,tx) => s + tx.amount, 0);
  const avg   = list.length ? total / list.length : 0;
  const max   = list.length ? Math.max(...list.map(tx => tx.amount)) : 0;

  // Stats
  monthlyStats.innerHTML = `
    <div class="stat-card">
      <p class="stat-label">Total Spent</p>
      <p class="stat-value">${formatCurrency(total)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Transactions</p>
      <p class="stat-value">${list.length}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Avg per Item</p>
      <p class="stat-value">${formatCurrency(avg)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Highest Single</p>
      <p class="stat-value">${formatCurrency(max)}</p>
    </div>
  `;

  // Monthly list
  monthlyList.innerHTML = '';
  if (!list.length) {
    monthlyEmpty.classList.add('visible');
  } else {
    monthlyEmpty.classList.remove('visible');
    [...list].sort((a,b) => b.dateISO.localeCompare(a.dateISO)).forEach(tx => {
      const cfg = getCatCfg(tx.category);
      const isCustom = !!customCats[tx.category];
      const badgeStyle = isCustom ? `style="background:${hexToRgba(cfg.color,0.12)};color:${cfg.color}"` : '';
      const li = document.createElement('li');
      li.className = 'transaction-item';
      li.dataset.category = tx.category;
      li.style.borderLeftColor = cfg.color;
      li.innerHTML = `
        <div class="item-info">
          <span class="item-name">${escapeHtml(tx.name)}</span>
          <div class="item-meta">
            <span class="item-category-badge ${isCustom ? '' : cfg.badgeClass}" ${badgeStyle}>
              ${escapeHtml(cfg.emoji)} ${escapeHtml(tx.category)}
            </span>
            <span class="item-date">${tx.dateLabel}</span>
          </div>
        </div>
        <span class="item-amount">${formatCurrency(tx.amount)}</span>
      `;
      monthlyList.appendChild(li);
    });
  }

  renderMonthlyChart();
}

function renderMonthlyChart() {
  const cats   = allCats();
  const list   = monthlyTxs();
  const totals = {};
  list.forEach(tx => { totals[tx.category] = (totals[tx.category] || 0) + tx.amount; });
  const labels = Object.keys(totals);
  const data   = Object.values(totals);
  const colors = labels.map(l => cats[l]?.color || '#6b7280');

  const canvas = document.getElementById('monthlyChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const textColor = chartTextColor();
  const gridColor = chartGridColor();

  if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }

  if (!data.length) return;

  monthlyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Spent ($)',
        data,
        backgroundColor: colors.map(c => c + 'bb'),
        borderColor:     colors,
        borderWidth:     2,
        borderRadius:    6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${formatCurrency(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: {
          ticks: { color: textColor, callback: v => '$' + v },
          grid:  { color: gridColor },
          beginAtZero: true,
        },
      },
    },
  });
}

prevMonthBtn.addEventListener('click', () => {
  viewMonth.month--;
  if (viewMonth.month < 0) { viewMonth.month = 11; viewMonth.year--; }
  renderMonthlyTab();
});

nextMonthBtn.addEventListener('click', () => {
  viewMonth.month++;
  if (viewMonth.month > 11) { viewMonth.month = 0; viewMonth.year++; }
  renderMonthlyTab();
});

/* ══════════════════════════════════════════
   BUDGET LIMITS  (Feature 4)
══════════════════════════════════════════ */
function renderBudgetList() {
  budgetList.innerHTML = '';
  const cats         = allCats();
  const monthlySpent = spentThisMonthByCategory();

  for (const [name, cfg] of Object.entries(cats)) {
    const spent = monthlySpent[name] || 0;
    const limit = budgets[name] || 0;

    let statusClass = '', badgeClass = 'badge-no-limit', badgeText = 'No limit set';
    let fillClass   = 'fill-ok';
    let pct         = 0;

    if (limit > 0) {
      pct = Math.min((spent / limit) * 100, 100);
      if (spent > limit)        { statusClass = 'is-over'; badgeClass = 'badge-over'; badgeText = '⚠️ Over limit'; fillClass = 'fill-over'; }
      else if (spent >= limit * 0.8) { statusClass = 'is-warn'; badgeClass = 'badge-warn'; badgeText = '🔶 Near limit'; fillClass = 'fill-warn'; }
      else                           { statusClass = 'is-ok';   badgeClass = 'badge-ok';   badgeText = '✅ On track';   fillClass = 'fill-ok';  }
    }

    const isCustom    = !!customCats[name];
    const badgeStyle  = isCustom ? `style="background:${hexToRgba(cfg.color,0.12)};color:${cfg.color}"` : '';

    const row = document.createElement('div');
    row.className = `budget-row ${statusClass}`;
    row.innerHTML = `
      <div class="budget-row-top">
        <span class="budget-cat-label">${escapeHtml(cfg.emoji)} ${escapeHtml(name)}</span>
        <span class="budget-status-badge ${badgeClass}">${badgeText}</span>
      </div>
      ${limit > 0 ? `
      <div class="budget-progress-wrap">
        <div class="budget-amounts">
          <span>Spent: <strong>${formatCurrency(spent)}</strong></span>
          <span>Limit: <strong>${formatCurrency(limit)}</strong></span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${fillClass}" style="width:${pct}%"></div>
        </div>
      </div>` : `
      <div class="budget-amounts" style="font-size:0.78rem;color:var(--clr-muted)">
        This month: ${formatCurrency(spent)}
      </div>`}
      <div class="budget-input-row">
        <label>Monthly limit ($)</label>
        <input
          class="budget-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g. 200"
          value="${limit || ''}"
          data-cat="${escapeHtml(name)}"
        />
        <button class="btn-save-budget" data-cat="${escapeHtml(name)}">Save</button>
      </div>
    `;
    budgetList.appendChild(row);
  }

  // Save budget event (delegation)
  budgetList.querySelectorAll('.btn-save-budget').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const input = budgetList.querySelector(`.budget-input[data-cat="${CSS.escape(cat)}"]`);
      const val = parseFloat(input.value);
      if (input.value === '' || isNaN(val) || val < 0) {
        delete budgets[cat];
      } else {
        budgets[cat] = parseFloat(val.toFixed(2));
      }
      saveBudgets();
      render();
    });
  });
}

/* ══════════════════════════════════════════
   TABS
══════════════════════════════════════════ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`tab-${target}`).classList.remove('hidden');

    if (target === 'monthly') renderMonthlyTab();
    if (target === 'budgets') renderBudgetList();
  });
});

/* ══════════════════════════════════════════
   MASTER RENDER
══════════════════════════════════════════ */
function render() {
  rebuildCategorySelects();
  renderBalance();
  renderList();
  renderPieChart();

  // Re-render active tab if not transactions
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'monthly') renderMonthlyTab();
  if (activeTab === 'budgets') renderBudgetList();
}

/* ══════════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════════ */
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!validate()) return;
  addTransaction(itemNameInput.value.trim(), amountInput.value.trim(), categorySelect.value);
  form.reset();
  clearErrors();
  itemNameInput.focus();
});

transactionList.addEventListener('click', e => {
  const btn = e.target.closest('.btn-delete');
  if (btn) deleteTransaction(btn.dataset.id);
});

clearAllBtn.addEventListener('click', clearAll);

sortSelect.addEventListener('change', () => { currentSort = sortSelect.value; renderList(); });
filterSelect.addEventListener('change', () => { currentFilter = filterSelect.value; renderList(); });

// Live error clear
itemNameInput.addEventListener('input',   () => { nameError.textContent     = ''; itemNameInput.classList.remove('error'); });
amountInput.addEventListener('input',     () => { amountError.textContent   = ''; amountInput.classList.remove('error'); });
categorySelect.addEventListener('change', () => { categoryError.textContent = ''; categorySelect.classList.remove('error'); });

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
(function init() {
  loadAll();
  initTheme();
  initViewMonth();
  render();
})();
