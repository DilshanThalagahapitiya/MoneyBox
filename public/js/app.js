const MIN_COLOR_RULES = 3;
const MAX_COLOR_RULES = 5;

const DEFAULT_COLOR_RULES = [
  { min_value: 5000, color: "#dc2626" },
  { min_value: 1000, color: "#16a34a" },
  { min_value: 0, color: "#eab308" },
];

const EXTRA_DEFAULT_COLORS = ["#f97316", "#8b5cf6"];

const DEFAULT_CONFIG = {
  start_value: 40,
  gap_value: 40,
  button_count: 100,
  columns: 10,
  same_value: false,
  color_rules: DEFAULT_COLOR_RULES,
};

const gridEl = document.getElementById("grid");
const totalEl = document.getElementById("total");
const selectedCountEl = document.getElementById("selected-count");
const allValuesCountEl = document.getElementById("all-values-count");
const expectedTotalEl = document.getElementById("expected-total");
const saveStatusEl = document.getElementById("save-status");
const clearBtn = document.getElementById("clear-btn");
const logoutBtn = document.getElementById("logout-btn");
const userNameEl = document.getElementById("user-name");
const userEmailEl = document.getElementById("user-email");
const settingsForm = document.getElementById("settings-form");
const colorSettingsForm = document.getElementById("color-settings-form");
const colorRulesList = document.getElementById("color-rules-list");
const addColorRuleBtn = document.getElementById("add-color-rule");
const colorSaveMessageEl = document.getElementById("color-save-message");
const startValueInput = document.getElementById("start-value");
const gapValueInput = document.getElementById("gap-value");
const buttonCountInput = document.getElementById("button-count");
const columnsInput = document.getElementById("columns");
const sameValueInput = document.getElementById("same-value");

const openSettingsBtn = document.getElementById("open-settings-btn");
const openColorSettingsBtn = document.getElementById("open-color-settings-btn");
const openLockSettingsBtn = document.getElementById("open-lock-settings-btn");
const settingsModal = document.getElementById("settings-modal");
const colorSettingsModal = document.getElementById("color-settings-modal");
const lockSettingsModal = document.getElementById("lock-settings-modal");
const lockSettingsForm = document.getElementById("lock-settings-form");
const lockTimeMinutesInput = document.getElementById("lock-time-minutes");
const closeModalBtns = document.querySelectorAll(".close-modal-btn");

const selected = new Set();
const cellByIndex = new Map();
let config = structuredClone(DEFAULT_CONFIG);

function formatNumber(value) {
  return value.toLocaleString();
}

function sortColorRules(rules) {
  return [...rules].sort((a, b) => b.min_value - a.min_value);
}

function prepareColorRules(rules) {
  if (!Array.isArray(rules) || rules.length < MIN_COLOR_RULES) {
    return structuredClone(DEFAULT_COLOR_RULES);
  }

  const prepared = rules.slice(0, MAX_COLOR_RULES).map((rule, index) => ({
    min_value: Number(rule.min_value ?? 0),
    color:
      rule.color ||
      DEFAULT_COLOR_RULES[index]?.color ||
      EXTRA_DEFAULT_COLORS[index - DEFAULT_COLOR_RULES.length] ||
      DEFAULT_COLOR_RULES[2].color,
  }));

  const sorted = sortColorRules(prepared);
  sorted[sorted.length - 1].min_value = 0;
  return sorted;
}

function validateColorRules(rules) {
  if (!Array.isArray(rules) || rules.length < MIN_COLOR_RULES || rules.length > MAX_COLOR_RULES) {
    return {
      ok: false,
      error: `Color rules must be between ${MIN_COLOR_RULES} and ${MAX_COLOR_RULES}`,
    };
  }

  const prepared = rules.map((rule) => ({
    min_value: Number(rule.min_value),
    color: String(rule.color || "").trim(),
  }));

  const sorted = sortColorRules(prepared);
  sorted[sorted.length - 1].min_value = 0;

  for (let index = 0; index < sorted.length - 1; index++) {
    if (sorted[index].min_value <= sorted[index + 1].min_value) {
      return {
        ok: false,
        error: "Each range value must be greater than the next lower range",
      };
    }
  }

  for (const rule of sorted) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(rule.color)) {
      return {
        ok: false,
        error: "All colors must be valid hex values",
      };
    }
  }

  return { ok: true, rules: sorted };
}

function getSortedColorRules(currentConfig) {
  return sortColorRules(prepareColorRules(currentConfig.color_rules));
}

function getColorForValue(value, currentConfig) {
  for (const rule of getSortedColorRules(currentConfig)) {
    if (value >= rule.min_value) {
      return rule.color;
    }
  }
  return DEFAULT_COLOR_RULES[2].color;
}

function getValueAtIndex(currentConfig, index) {
  if (currentConfig.same_value) {
    return currentConfig.start_value;
  }
  return currentConfig.start_value + index * currentConfig.gap_value;
}

function getGridValues(currentConfig) {
  const values = [];
  for (let index = 0; index < currentConfig.button_count; index++) {
    values.push(getValueAtIndex(currentConfig, index));
  }
  return values;
}

function getAllValuesTotal(currentConfig) {
  return getGridValues(currentConfig).reduce((sum, value) => sum + value, 0);
}

function isCellLocked(index) {
  if (!config.lock_time_minutes || config.lock_time_minutes <= 0) return false;
  if (!config.selected_timestamps || !config.selected_timestamps[index]) return false;
  
  const elapsedMs = Date.now() - config.selected_timestamps[index];
  const elapsedMinutes = elapsedMs / 60000;
  return elapsedMinutes > config.lock_time_minutes;
}

function clearCellStyle(cell) {
  cell.classList.remove("selected", "cell-partial", "cell-locked", "show-timer");
  cell.style.backgroundColor = "";
  cell.style.borderColor = "";
  cell.style.color = "";
  cell.setAttribute("aria-pressed", "false");
  
  const timerEl = cell.querySelector('.cell-timer-overlay');
  if (timerEl) timerEl.remove();

  const index = cell.dataset.index;
  if (index !== undefined) {
    const valueEl = cell.querySelector('.cell-value');
    if (valueEl) valueEl.textContent = formatNumber(getValueAtIndex(config, Number(index)));
    else cell.innerHTML = `<span class="cell-value">${formatNumber(getValueAtIndex(config, Number(index)))}</span>`;
  }
}

function applyCellStyle(cell, index) {
  let valueEl = cell.querySelector('.cell-value');
  if (!valueEl) {
    cell.innerHTML = `<span class="cell-value"></span>`;
    valueEl = cell.querySelector('.cell-value');
  }

  if (config.partial_payments && config.partial_payments[index]) {
    cell.classList.remove("selected");
    cell.classList.add("cell-partial");
    valueEl.textContent = formatNumber(config.partial_payments[index]);
    cell.style.backgroundColor = "";
    cell.style.borderColor = "";
    cell.style.color = "";
    cell.setAttribute("aria-pressed", "mixed");
    return;
  }

  const value = getValueAtIndex(config, index);
  const color = getColorForValue(value, config);
  cell.classList.remove("cell-partial");
  cell.classList.add("selected");
  valueEl.textContent = formatNumber(value);
  cell.style.backgroundColor = color;
  cell.style.borderColor = color;
  cell.style.color = "#ffffff";
  cell.setAttribute("aria-pressed", "true");
  
  if (isCellLocked(index)) {
    cell.classList.add("cell-locked");
  } else {
    cell.classList.remove("cell-locked");
  }
}

function refreshSelectedCellColors() {
  for (const index of selected) {
    const cell = cellByIndex.get(index);
    if (cell) {
      applyCellStyle(cell, index);
    }
  }
}

function updateSummary() {
  let selectedTotal = 0;
  for (const index of selected) {
    selectedTotal += getValueAtIndex(config, index);
  }

  if (config.partial_payments) {
    for (const amount of Object.values(config.partial_payments)) {
      selectedTotal += Number(amount);
    }
  }

  totalEl.textContent = formatNumber(selectedTotal);
  selectedCountEl.textContent = formatNumber(selected.size);
  allValuesCountEl.textContent = formatNumber(config.button_count);
  expectedTotalEl.textContent = formatNumber(getAllValuesTotal(config));

  const footerSelectedCountEl = document.getElementById("footer-selected-count");
  const footerTotalEl = document.getElementById("footer-total");
  if (footerSelectedCountEl) footerSelectedCountEl.textContent = formatNumber(selected.size);
  if (footerTotalEl) footerTotalEl.textContent = formatNumber(selectedTotal);
}

function setSaveStatus(message, isError = false) {
  if (!saveStatusEl) {
    return;
  }

  saveStatusEl.textContent = message;
  saveStatusEl.classList.toggle("error", isError);
}

function setColorSaveMessage(message, isError = false) {
  if (!colorSaveMessageEl) {
    return;
  }

  colorSaveMessageEl.textContent = message;
  colorSaveMessageEl.classList.toggle("error", isError);
  colorSaveMessageEl.classList.toggle("success", !isError && Boolean(message));
}

function updateGapFieldState() {
  gapValueInput.disabled = sameValueInput.checked;
}

function previewColorRulesOnGrid() {
  config.color_rules = prepareColorRules(readColorRulesFromForm());
  refreshSelectedCellColors();
}

function updateRulePreview(row) {
  const swatch = row.querySelector(".color-swatch");
  const colorInput = row.querySelector(".color-rule-color");
  if (swatch && colorInput) {
    swatch.style.backgroundColor = colorInput.value;
  }
}

function createColorRuleRow(rule, index, totalRules) {
  const isLast = index === totalRules - 1;
  const row = document.createElement("div");
  row.className = "color-rule-row";
  if (isLast) {
    row.dataset.isLowest = "true";
  }

  const swatch = document.createElement("span");
  swatch.className = "color-swatch";
  swatch.style.backgroundColor = rule.color;

  const label = document.createElement("label");
  if (isLast) {
    label.innerHTML = `Lowest range<span class="color-rule-note">Value &lt; previous range</span>`;
  } else {
    label.innerHTML = `Range ${index + 1} (value &gt;= )`;
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.min = "1";
    minInput.step = "1";
    minInput.required = true;
    minInput.value = rule.min_value;
    minInput.className = "color-rule-min";
    label.appendChild(minInput);
  }

  const colorLabel = document.createElement("label");
  colorLabel.textContent = "Color";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.required = true;
  colorInput.value = rule.color;
  colorInput.className = "color-rule-color";
  colorLabel.appendChild(colorInput);

  row.appendChild(swatch);
  row.appendChild(label);
  row.appendChild(colorLabel);

  if (!isLast && totalRules > MIN_COLOR_RULES) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove-rule";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const rules = readColorRulesFromForm();
      rules.splice(index, 1);
      config.color_rules = rules;
      renderColorRulesList(rules);
      previewColorRulesOnGrid();
    });
    row.appendChild(removeBtn);
  }

  return row;
}

function renderColorRulesList(colorRules) {
  const rules = prepareColorRules(colorRules);
  config.color_rules = rules;
  colorRulesList.innerHTML = "";

  rules.forEach((rule, index) => {
    colorRulesList.appendChild(createColorRuleRow(rule, index, rules.length));
  });

  addColorRuleBtn.hidden = rules.length >= MAX_COLOR_RULES;
}

function suggestNewMinValue(rules) {
  const sorted = sortColorRules(rules);
  if (sorted.length < 2) {
    return 500;
  }

  const upper = sorted[sorted.length - 2].min_value;
  const lower = sorted[sorted.length - 1].min_value;
  return Math.max(lower + 1, Math.floor((upper + lower) / 2));
}

function addColorRule() {
  const rules = readColorRulesFromForm();
  if (rules.length >= MAX_COLOR_RULES) {
    return;
  }

  const newColor = EXTRA_DEFAULT_COLORS[rules.length - MIN_COLOR_RULES] || "#6366f1";
  const newRule = {
    min_value: suggestNewMinValue(rules),
    color: newColor,
  };

  rules.splice(rules.length - 1, 0, newRule);
  config.color_rules = rules;
  renderColorRulesList(rules);
  previewColorRulesOnGrid();
}

function readColorRulesFromForm() {
  const rows = [...colorRulesList.querySelectorAll(".color-rule-row")];

  if (rows.length === 0) {
    return structuredClone(config.color_rules || DEFAULT_COLOR_RULES);
  }

  return sortColorRules(
    rows.map((row) => {
      const isLowest = row.dataset.isLowest === "true";
      const colorInput = row.querySelector(".color-rule-color");
      const minInput = row.querySelector(".color-rule-min");

      return {
        min_value: isLowest ? 0 : Number(minInput?.value || 0),
        color: colorInput?.value || DEFAULT_COLOR_RULES[2].color,
      };
    })
  );
}

function applyColorRulesToForm(colorRules) {
  renderColorRulesList(colorRules);
}

function applyConfigToForm(currentConfig) {
  startValueInput.value = currentConfig.start_value;
  gapValueInput.value = currentConfig.gap_value;
  buttonCountInput.value = currentConfig.button_count;
  columnsInput.value = currentConfig.columns;
  sameValueInput.checked = Boolean(currentConfig.same_value);
  lockTimeMinutesInput.value = currentConfig.lock_time_minutes || 0;
  applyColorRulesToForm(currentConfig.color_rules);
  updateGapFieldState();
}

function applySelections(indices) {
  selected.clear();

  for (const cell of cellByIndex.values()) {
    clearCellStyle(cell);
  }

  for (const index of indices) {
    const cell = cellByIndex.get(Number(index));
    if (!cell) {
      continue;
    }

    selected.add(Number(index));
    applyCellStyle(cell, Number(index));
  }

  if (config.partial_payments) {
    for (const indexStr of Object.keys(config.partial_payments)) {
      const idx = Number(indexStr);
      const cell = cellByIndex.get(idx);
      if (cell) applyCellStyle(cell, idx);
    }
  }

  updateSummary();
}

function rebuildGrid(currentConfig, selectedIndices) {
  gridEl.innerHTML = "";
  cellByIndex.clear();
  const rows = Math.ceil(currentConfig.button_count / currentConfig.columns);
  gridEl.style.gridTemplateColumns = `repeat(${currentConfig.columns}, minmax(0, 1fr))`;
  gridEl.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

  for (let index = 0; index < currentConfig.button_count; index++) {
    const value = getValueAtIndex(currentConfig, index);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.innerHTML = `<span class="cell-value">${formatNumber(value)}</span>`;
    cell.dataset.index = index;
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-pressed", "false");
    cell.setAttribute("aria-label", `Amount ${formatNumber(value)}`);
    
    let pressTimer = null;
    cell.addEventListener("contextmenu", (e) => { e.preventDefault(); });

    const startPress = () => {
      pressTimer = setTimeout(() => {
        handleLongPress(cell, index);
        pressTimer = null;
      }, 500);
    };

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    cell.addEventListener("mousedown", (e) => {
      if (e.button === 0) startPress();
    });
    cell.addEventListener("mouseup", (e) => {
      if (pressTimer && e.button === 0) {
        cancelPress();
        handleCellClick(cell, index);
      }
    });
    cell.addEventListener("mouseleave", cancelPress);
    
    cell.addEventListener("touchstart", (e) => {
      startPress();
    });
    cell.addEventListener("touchend", (e) => {
      if (pressTimer) {
        cancelPress();
        handleCellClick(cell, index);
        e.preventDefault();
      }
    });
    cell.addEventListener("touchcancel", cancelPress);

    cellByIndex.set(index, cell);
    gridEl.appendChild(cell);
  }

  applySelections(selectedIndices);
}

function mergeConfigFromServer(data) {
  const serverConfig = data.config || {};
  const serverRules = serverConfig.color_rules;

  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...serverConfig,
    color_rules:
      Array.isArray(serverRules) && serverRules.length >= MIN_COLOR_RULES
        ? serverRules.map((rule) => ({
            min_value: Number(rule.min_value),
            color: rule.color,
          }))
        : structuredClone(DEFAULT_COLOR_RULES),
  };
}

async function loadData() {
  setSaveStatus("Loading...");

  try {
    const response = await fetch("/api/data");
    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    if (!response.ok) {
      throw new Error("Failed to load data");
    }

    const data = await response.json();
    config = mergeConfigFromServer(data);
    applyConfigToForm(config);
    rebuildGrid(config, data.selected || []);
    setSaveStatus("Saved");
    setColorSaveMessage("");
  } catch (error) {
    setSaveStatus("Could not load saved data", true);
  }
}

async function saveState(payload) {
  setSaveStatus("Saving...");

  try {
    const response = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      window.location.href = "/login.html";
      return null;
    }
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to save data");
    }

    const data = await response.json();
    setSaveStatus("Saved");
    return data;
  } catch (error) {
    setSaveStatus(error.message || "Save failed", true);
    return null;
  }
}

async function saveData() {
  await saveState({
    selected: [...selected].sort((a, b) => a - b),
    config: { 
      partial_payments: config.partial_payments || {},
      selected_timestamps: config.selected_timestamps || {}
    }
  });
}

function getCollectionConfigForSave() {
  return {
    start_value: Number(startValueInput.value),
    gap_value: Number(gapValueInput.value),
    button_count: Number(buttonCountInput.value),
    columns: Number(columnsInput.value),
    same_value: sameValueInput.checked,
  };
}

function readConfigFromForm() {
  return {
    ...config,
    ...getCollectionConfigForSave(),
    color_rules: readColorRulesFromForm(),
  };
}

function handleCellClick(cell, index) {
  if (isCellLocked(index)) {
    alert("This button is locked.");
    return;
  }

  if (config.partial_payments && Object.keys(config.partial_payments).length > 0) {
    if (!config.partial_payments[index]) {
      alert("Please complete full amount for the partially paid cell first.");
      return;
    } else {
      delete config.partial_payments[index];
      selected.add(index);
      applyCellStyle(cell, index);
      updateSummary();
      saveData();
      return;
    }
  }
  toggleCell(cell, index);
}

function handleLongPress(cell, index) {
  if (isCellLocked(index)) {
    alert("This button is locked.");
    return;
  }

  if (selected.has(index)) return;
  
  if (config.partial_payments && Object.keys(config.partial_payments).length > 0) {
    if (!config.partial_payments[index]) {
      alert("Please complete full amount for the partially paid cell first.");
      return;
    }
  }

  const fullValue = getValueAtIndex(config, index);
  const amountStr = prompt(`Enter partial amount (Full value: ${fullValue}):`, Math.floor(fullValue / 2));
  if (!amountStr) return;
  const amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount <= 0 || amount >= fullValue) {
    alert("Invalid partial amount.");
    return;
  }

  if (!config.partial_payments) config.partial_payments = {};
  config.partial_payments[index] = amount;
  
  if (!config.selected_timestamps) config.selected_timestamps = {};
  config.selected_timestamps[index] = Date.now();
  
  applyCellStyle(cell, index);
  updateSummary();
  saveData();
}

function toggleCell(cell, index) {
  if (selected.has(index)) {
    selected.delete(index);
    if (config.selected_timestamps) {
      delete config.selected_timestamps[index];
    }
    clearCellStyle(cell);
  } else {
    selected.add(index);
    if (!config.selected_timestamps) config.selected_timestamps = {};
    config.selected_timestamps[index] = Date.now();
    applyCellStyle(cell, index);
  }

  updateSummary();
  saveData();
}

function applyCollectionConfig(data) {
  config = mergeConfigFromServer(data);
  applyConfigToForm(config);
  rebuildGrid(config, data.selected || []);
}

async function saveColorRules() {
  const validation = validateColorRules(readColorRulesFromForm());
  if (!validation.ok) {
    setColorSaveMessage(validation.error, true);
    return false;
  }

  setColorSaveMessage("Saving color ranges...");

  try {
    const response = await fetch("/api/color-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color_rules: validation.rules }),
    });

    if (response.status === 401) {
      window.location.href = "/login.html";
      return false;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to save color ranges");
    }

    const savedRules = data.color_rules || validation.rules;
    config.color_rules = savedRules.map((rule) => ({
      min_value: Number(rule.min_value),
      color: rule.color,
    }));

    applyColorRulesToForm(config.color_rules);
    refreshSelectedCellColors();
    setColorSaveMessage(
      data.message || `Successfully saved ${savedRules.length} color ranges`,
      false
    );
    setSaveStatus("Saved");
    return true;
  } catch (error) {
    setColorSaveMessage(error.message || "Failed to save color ranges", true);
    return false;
  }
}

clearBtn.addEventListener("click", async () => {
  if (window.confirm("Are you sure you want to clear all selections? This action cannot be undone.")) {
    config.partial_payments = {};
    config.selected_timestamps = {};
    applySelections([]);
    await saveData();
  }
});

sameValueInput.addEventListener("change", updateGapFieldState);
addColorRuleBtn.addEventListener("click", addColorRule);

colorRulesList.addEventListener("input", (event) => {
  if (!event.target.matches(".color-rule-color, .color-rule-min")) {
    return;
  }

  const row = event.target.closest(".color-rule-row");
  if (row) {
    updateRulePreview(row);
  }
  previewColorRulesOnGrid();
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = await saveState({
    selected: [...selected],
    config: getCollectionConfigForSave(),
  });

  if (data) {
    applyCollectionConfig(data);
    refreshSelectedCellColors();
    closeModal(settingsModal);
  }
});

colorSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const success = await saveColorRules();
  if (success) {
    closeModal(colorSettingsModal);
  }
});

lockSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  config.lock_time_minutes = parseInt(lockTimeMinutesInput.value, 10);
  
  const data = await saveState({
    selected: [...selected],
    config: config
  });

  if (data) {
    applyCollectionConfig(data);
    refreshSelectedCellColors();
    closeModal(lockSettingsModal);
  }
});

function openModal(modal) {
  modal.classList.remove("hidden");
}

function closeModal(modal) {
  modal.classList.add("hidden");
}

openSettingsBtn.addEventListener("click", () => {
  if (selected.size > 0 || (config.partial_payments && Object.keys(config.partial_payments).length > 0)) {
    alert("You cannot change collection settings while buttons are selected. Please clear all selections first.");
    return;
  }
  openModal(settingsModal);
});

openColorSettingsBtn.addEventListener("click", () => {
  if (selected.size > 0 || (config.partial_payments && Object.keys(config.partial_payments).length > 0)) {
    alert("You cannot change color rules while buttons are selected. Please clear all selections first.");
    return;
  }
  openModal(colorSettingsModal);
});

openLockSettingsBtn.addEventListener("click", () => {
  openModal(lockSettingsModal);
});

closeModalBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const modal = e.target.closest(".modal-overlay");
    if (modal) closeModal(modal);
  });
});

window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    closeModal(e.target);
  }
});

logoutBtn.addEventListener("click", logout);

async function initApp() {
  const user = await requireAuth();
  if (!user) {
    return;
  }

  userNameEl.textContent = user.name;
  userEmailEl.textContent = user.email;
  
  const avatarEl = document.getElementById("user-avatar-initials");
  if (user.profile_picture) {
    avatarEl.style.backgroundImage = `url(${user.profile_picture})`;
    avatarEl.style.backgroundSize = "cover";
    avatarEl.style.backgroundPosition = "center";
    avatarEl.textContent = "";
  } else {
    const initials = user.name.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }

  const picInput = document.getElementById("main-profile-pic-input");
  if (avatarEl && picInput) {
    avatarEl.addEventListener("click", () => picInput.click());
    picInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const base64 = ev.target.result;
          avatarEl.style.backgroundImage = `url(${base64})`;
          avatarEl.style.backgroundSize = "cover";
          avatarEl.style.backgroundPosition = "center";
          avatarEl.textContent = "";
          
          try {
            await fetch("/api/user/profile-picture", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profile_picture: base64 })
            });
          } catch (err) {
            console.error("Failed to update profile picture", err);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  await loadData();
  startTimers();
}

function updateCellTimer(cell, index, remainingMs, isLocked, lockTimeMs = 1) {
  let timerEl = cell.querySelector('.cell-timer-overlay');
  
  if (isLocked) {
    if (timerEl) timerEl.remove();
    cell.classList.remove("show-timer");
    return;
  }
  
  if (!timerEl) {
    timerEl = document.createElement('div');
    timerEl.className = 'cell-timer-overlay';
    timerEl.innerHTML = `<span class="cell-timer-text"></span>`;
    cell.appendChild(timerEl);
    cell.classList.add("show-timer");
  }

  const textEl = timerEl.querySelector('.cell-timer-text');
  
  const totalSecs = Math.ceil(remainingMs / 1000);
  const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
  const secs = (totalSecs % 60).toString().padStart(2, '0');
  textEl.textContent = `${mins}:${secs}`;
  
  const progressPercent = Math.max(0, (remainingMs / lockTimeMs) * 100);
  timerEl.style.setProperty('--progress', `${progressPercent}%`);
}

function startTimers() {
  const globalTimerContainer = document.getElementById("global-lock-timer");
  const globalTimerText = document.getElementById("global-lock-text");
  const globalTimerIcon = document.getElementById("global-lock-icon");

  setInterval(() => {
    let maxRemainingMs = -1;
    let anyLocked = false;
    let anyActiveTimers = false;

    if (!config.lock_time_minutes || config.lock_time_minutes <= 0) {
       for (const index of selected) {
         const cell = cellByIndex.get(index);
         if (cell) updateCellTimer(cell, index, 0, true);
       }
       if (globalTimerContainer) globalTimerContainer.classList.add("hidden");
       return;
    }

    const lockTimeMs = config.lock_time_minutes * 60000;
    const now = Date.now();

    for (const index of selected) {
      if (!config.selected_timestamps || !config.selected_timestamps[index]) continue;
      
      const elapsedMs = now - config.selected_timestamps[index];
      const remainingMs = lockTimeMs - elapsedMs;
      const cell = cellByIndex.get(index);

      if (remainingMs <= 0) {
        anyLocked = true;
        if (cell) {
          updateCellTimer(cell, index, 0, true);
          if (!cell.classList.contains("cell-locked")) cell.classList.add("cell-locked");
        }
      } else {
        anyActiveTimers = true;
        if (remainingMs > maxRemainingMs) {
          maxRemainingMs = remainingMs;
        }
        if (cell) updateCellTimer(cell, index, remainingMs, false, lockTimeMs);
      }
    }

    // Update Global Timer
    if (globalTimerContainer && globalTimerText && globalTimerIcon) {
      if (selected.size === 0 || (!anyLocked && !anyActiveTimers)) {
        globalTimerContainer.classList.add("hidden");
      } else {
        globalTimerContainer.classList.remove("hidden");
        if (anyActiveTimers && maxRemainingMs > 0) {
          const totalSecs = Math.ceil(maxRemainingMs / 1000);
          const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
          const secs = (totalSecs % 60).toString().padStart(2, '0');
          globalTimerText.textContent = `${mins}:${secs}`;
          globalTimerIcon.textContent = "⏱️";
          globalTimerContainer.style.background = "rgba(239, 68, 68, 0.1)";
          globalTimerContainer.style.color = "#fca5a5";
        } else if (anyLocked) {
          globalTimerText.textContent = "Locked";
          globalTimerIcon.textContent = "🔒";
          globalTimerContainer.style.background = "rgba(107, 114, 128, 0.2)";
          globalTimerContainer.style.color = "#9ca3af";
        }
      }
    }
  }, 100);
}

initApp();
