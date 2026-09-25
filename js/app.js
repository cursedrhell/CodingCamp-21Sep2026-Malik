/* =====================================================
   Expense & Budget Visualizer — app.js
   All logic: storage, form, transactions, balance, chart
   ===================================================== */

'use strict';

/* ── Constants ── */
const STORAGE_KEY = 'ebv_transactions';

const CATEGORY_CONFIG = {
  Food:      { emoji: '🍔', color: '#f97316', badgeClass: 'badge-food' },
  Transport: { emoji: '🚌', color: '#3b82f6', badgeClass: 'badge-transport' },
  Fun:       { emoji: '🎉', color: '#a855f7', badgeClass: 'badge-fun' },
};

/* ── State ── */
let transactions = [];
let spendingChart = null;

/* ── DOM refs ── */
const form           = document.getElementById('transactionForm');
const itemNameInput  = document.getElementById('itemName');
const amountInput    = document.getElementById('amount');
const categorySelect = document.getElementById('category');
const nameError      = document.getElementById('nameError');
const amountError    = document.getElementById('amountError');
const categoryError  = document.getElementById('categoryError');
const totalBalanceEl = document.getElementById('totalBalance');
const categoryPills  = document.getElementById('categoryPills');
const transactionList = document.getElementById('transactionList');
const emptyState     = document.getElementById('emptyState');
const clearAllBtn    = document.getElementById('clearAllBtn');
const chartCanvas    = document.getElementById('spendingChart');
const chartWrapper   = document.getElementById('chartWrapper');
const chartEmpty     = document.getElementById('chartEmpty');

/* ═══════════════════════════════════════════
   LOCAL STORAGE
═══════════════════════════════════════════ */

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    transactions = raw ? JSON.parse(raw) : [];
  } catch {
    transactions = [];
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

/* ═══════════════════════════════════════════
   VALIDATION
═══════════════════════════════════════════ */

function clearErrors() {
  nameError.textContent     = '';
  amountError.textContent   = '';
  categoryError.textContent = '';
  itemNameInput.classList.remove('error');
  amountInput.classList.remove('error');
  categorySelect.classList.remove('error');
}

function validate() {
  let valid = true;
  clearErrors();

  const name   = itemNameInput.value.trim();
  const amount = amountInput.value.trim();
  const cat    = categorySelect.value;

  if (!name) {
    nameError.textContent = 'Item name is required.';
    itemNameInput.classList.add('error');
    valid = false;
  }

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    amountError.textContent = 'Enter a valid amount greater than 0.';
    amountInput.classList.add('error');
    valid = false;
  }

  if (!cat) {
    categoryError.textContent = 'Please select a category.';
    categorySelect.classList.add('error');
    valid = false;
  }

  return valid;
}

/* ═══════════════════════════════════════════
   ADD / DELETE TRANSACTIONS
═══════════════════════════════════════════ */

function addTransaction(name, amount, category) {
  const tx = {
    id:       crypto.randomUUID(),
    name,
    amount:   parseFloat(parseFloat(amount).toFixed(2)),
    category,
    date:     new Date().toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
              }),
  };
  transactions.unshift(tx); // newest first
  saveToStorage();
  render();
}

function deleteTransaction(id) {
  transactions = transactions.filter(tx => tx.id !== id);
  saveToStorage();
  render();
}

function clearAll() {
  if (transactions.length === 0) return;
  if (!confirm('Delete all transactions? This cannot be undone.')) return;
  transactions = [];
  saveToStorage();
  render();
}

/* ═══════════════════════════════════════════
   RENDERING
═══════════════════════════════════════════ */

function formatCurrency(value) {
  return '$' + value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* Balance + category pills */
function renderBalance() {
  const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  totalBalanceEl.textContent = formatCurrency(total);

  // Per-category totals
  const totals = {};
  for (const cat of Object.keys(CATEGORY_CONFIG)) totals[cat] = 0;
  transactions.forEach(tx => { totals[tx.category] = (totals[tx.category] || 0) + tx.amount; });

  categoryPills.innerHTML = '';
  for (const [cat, val] of Object.entries(totals)) {
    if (val === 0) continue;
    const cfg = CATEGORY_CONFIG[cat];
    const pill = document.createElement('span');
    pill.className = `pill ${cat.toLowerCase()}`;
    pill.textContent = `${cfg.emoji} ${cat}: ${formatCurrency(val)}`;
    categoryPills.appendChild(pill);
  }
}

/* Transaction list */
function renderList() {
  transactionList.innerHTML = '';

  if (transactions.length === 0) {
    emptyState.classList.add('visible');
    clearAllBtn.disabled = true;
    clearAllBtn.style.opacity = '0.4';
    return;
  }

  emptyState.classList.remove('visible');
  clearAllBtn.disabled = false;
  clearAllBtn.style.opacity = '1';

  transactions.forEach(tx => {
    const cfg = CATEGORY_CONFIG[tx.category] || {};
    const li = document.createElement('li');
    li.className = 'transaction-item';
    li.dataset.category = tx.category;
    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${escapeHtml(tx.name)}</span>
        <div class="item-meta">
          <span class="item-category-badge ${cfg.badgeClass || ''}">${tx.category}</span>
          <span class="item-date">${tx.date}</span>
        </div>
      </div>
      <span class="item-amount">${formatCurrency(tx.amount)}</span>
      <button
        class="btn-delete"
        aria-label="Delete ${escapeHtml(tx.name)}"
        data-id="${tx.id}"
        title="Delete"
      >✕</button>
    `;
    transactionList.appendChild(li);
  });
}

/* Pie chart */
function renderChart() {
  const totals = {};
  transactions.forEach(tx => {
    totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
  });

  const labels  = Object.keys(totals);
  const data    = Object.values(totals);
  const colors  = labels.map(l => CATEGORY_CONFIG[l]?.color || '#6b7280');

  if (data.length === 0) {
    chartWrapper.style.display = 'none';
    chartEmpty.classList.add('visible');
    if (spendingChart) {
      spendingChart.destroy();
      spendingChart = null;
    }
    return;
  }

  chartWrapper.style.display = 'flex';
  chartEmpty.classList.remove('visible');

  const chartData = {
    labels,
    datasets: [{
      data,
      backgroundColor:      colors.map(c => c + 'cc'), // slight transparency
      borderColor:          colors,
      borderWidth:          2,
      hoverOffset:          8,
      hoverBorderWidth:     3,
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
        responsive:           true,
        maintainAspectRatio:  true,
        plugins: {
          legend: {
            position:  'bottom',
            labels: {
              padding:   16,
              font:      { size: 13, family: "'Segoe UI', system-ui, sans-serif" },
              usePointStyle: true,
              pointStyle:    'circle',
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const val   = ctx.parsed;
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = ((val / total) * 100).toFixed(1);
                return ` ${formatCurrency(val)}  (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }
}

/* Master render */
function render() {
  renderBalance();
  renderList();
  renderChart();
}

/* ═══════════════════════════════════════════
   SECURITY HELPER
═══════════════════════════════════════════ */

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════ */

/* Form submit */
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!validate()) return;

  addTransaction(
    itemNameInput.value.trim(),
    amountInput.value.trim(),
    categorySelect.value
  );

  // Reset form
  form.reset();
  clearErrors();
  itemNameInput.focus();
});

/* Delete via event delegation on the list */
transactionList.addEventListener('click', e => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  deleteTransaction(btn.dataset.id);
});

/* Clear all */
clearAllBtn.addEventListener('click', clearAll);

/* Live input: clear field-level error on user interaction */
itemNameInput.addEventListener('input',  () => { nameError.textContent     = ''; itemNameInput.classList.remove('error'); });
amountInput.addEventListener('input',    () => { amountError.textContent   = ''; amountInput.classList.remove('error'); });
categorySelect.addEventListener('change',() => { categoryError.textContent = ''; categorySelect.classList.remove('error'); });

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */

(function init() {
  loadFromStorage();
  render();
})();
