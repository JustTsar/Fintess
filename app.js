const STORAGE_KEY = "fitness-diary-v1";
const SYNC_STATUS = {
  local: "Локальное сохранение",
  saved: "Сохранено",
  syncing: "Синхронизация...",
  offline: "Нет сети",
  error: "Ошибка синхронизации",
  configMissing: "Supabase не настроен",
  restoring: "Восстановление входа...",
};

const fixedMeals = [
  { key: "breakfast", label: "Завтрак" },
  { key: "lunch", label: "Обед" },
  { key: "dinner", label: "Ужин" },
];

const macroLabels = {
  calories: "Ккал",
  protein: "Белки",
  fat: "Жиры",
  carbs: "Углеводы",
};

const defaultState = {
  settings: {
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    water: 0,
  },
  theme: {
    bg: "#fff1f5",
    surface: "#ffffff",
    surfaceStrong: "#fff7fa",
    text: "#2b2025",
    muted: "#7a626b",
    accent: "#c45a7a",
    accentStrong: "#a94767",
    accentSoft: "#fff7fa",
    line: "#f1c6d4",
    water: "#3975a8",
    warn: "#b35b32",
  },
  savedProducts: [],
  days: [],
};

let state = loadState();
let currentUser = null;
let supabaseClient = null;
let syncTimer = null;
let isApplyingRemoteState = false;

const settingsForm = document.querySelector("#settings-form");
const savedProductForm = document.querySelector("#saved-product-form");
const themeForm = document.querySelector("#theme-form");
const dayForm = document.querySelector("#day-form");
const editorPanel = document.querySelector("#editor-panel");
const editorTitle = document.querySelector("#editor-title");
const mealFields = document.querySelector("#meal-fields");
const daysList = document.querySelector("#days-list");
const daysPanel = document.querySelector(".days-panel");
const daysSummary = document.querySelector("#days-summary");
const addDayButton = document.querySelector("#add-day-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const addSnackButton = document.querySelector("#add-snack-button");
const resetThemeButton = document.querySelector("#reset-theme-button");
const loginButton = document.querySelector("#login-button");
const logoutButton = document.querySelector("#logout-button");
const userLabel = document.querySelector("#user-label");
const syncStatus = document.querySelector("#sync-status");
const nutritionPreviewList = document.querySelector("#nutrition-preview-list");
const savedProductsList = document.querySelector("#saved-products-list");
const savedProductsOptions = document.createElement("datalist");
savedProductsOptions.id = "saved-products-options";
document.body.appendChild(savedProductsOptions);

applyTheme();
renderSettings();
renderSavedProducts();
renderThemeSettings();
updateNutritionPreview();
renderDays();
initializeSupabaseSync();

loginButton.addEventListener("click", () => {
  signInWithGoogle();
});

logoutButton.addEventListener("click", () => {
  signOut();
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.settings = readSettingsForm();
  saveState();
  updateNutritionPreview();
  renderDays();
});

savedProductForm.addEventListener("submit", (event) => {
  event.preventDefault();
  upsertSavedProduct(readSavedProductForm());
  savedProductForm.reset();
  saveState();
  renderSavedProducts();
  applySavedProductsToRows();
  updateNutritionPreview();
});

savedProductsList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-action='remove-saved-product']");

  if (!removeButton) {
    return;
  }

  state.savedProducts = state.savedProducts.filter((product) => product.id !== removeButton.dataset.id);
  saveState();
  renderSavedProducts();
  applySavedProductsToRows();
  updateNutritionPreview();
});

settingsForm.addEventListener("input", () => {
  updateNutritionPreview(getEditorTotals(), readSettingsForm());
});

themeForm.addEventListener("input", () => {
  state.theme = readThemeForm();
  applyTheme();
  saveState();
});

resetThemeButton.addEventListener("click", () => {
  state.theme = structuredClone(defaultState.theme);
  renderThemeSettings();
  applyTheme();
  saveState();
});

addDayButton.addEventListener("click", () => {
  openEditor(createEmptyDay());
});

cancelEditButton.addEventListener("click", () => {
  closeEditor();
});

addSnackButton.addEventListener("click", () => {
  const snackNumber = mealFields.querySelectorAll('[data-section="snack"]').length + 1;
  mealFields.appendChild(createMealSection({
    section: "snack",
    key: createId(),
    label: `Перекус ${snackNumber}`,
    items: [createEmptyItem()],
    removable: true,
  }));
  updateSnackLabels();
  updateNutritionPreview();
});

dayForm.addEventListener("input", (event) => {
  const row = event.target.closest(".product-row");
  const field = event.target.dataset.field;

  if (row && ["product", "grams", "unit"].includes(field)) {
    applySavedProductToRow(row);
  }

  updateNutritionPreview();
});

dayForm.addEventListener("click", (event) => {
  const addProduct = event.target.closest("[data-action='add-product']");
  const removeProduct = event.target.closest("[data-action='remove-product']");
  const removeSnack = event.target.closest("[data-action='remove-snack']");
  const navigateDay = event.target.closest("[data-action='navigate-day']");

  if (addProduct) {
    const section = addProduct.closest("[data-meal-card]");
    section.querySelector(".product-list").appendChild(createProductRow(createEmptyItem()));
    updateNutritionPreview();
  }

  if (removeProduct) {
    const list = removeProduct.closest(".product-list");
    removeProduct.closest(".product-row").remove();

    if (!list.children.length) {
      list.appendChild(createProductRow(createEmptyItem()));
    }

    updateNutritionPreview();
  }

  if (removeSnack) {
    removeSnack.closest("[data-meal-card]").remove();
    updateSnackLabels();
    updateNutritionPreview();
  }

  if (navigateDay) {
    navigateEditorDay(Number(navigateDay.dataset.offset));
  }
});

dayForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applySavedProductsToRows();
  const day = readDayForm();
  upsertDay(day);
  saveState();
  closeEditor();
  renderDays();
});

daysList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const id = button.dataset.id;
  const action = button.dataset.action;
  const day = state.days.find((item) => item.id === id);

  if (action === "edit" && day) {
    openEditor(day);
  }

  if (action === "delete" && day) {
    const confirmed = window.confirm(`Удалить запись за ${formatDate(day.date)}?`);

    if (confirmed) {
      state.days = state.days.filter((item) => item.id !== id);
      saveState();
      renderDays();
    }
  }
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return structuredClone(defaultState);
    }

    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    console.warn("Не удалось загрузить дневник, будет создано новое состояние.", error);
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (!currentUser || isApplyingRemoteState) {
    return;
  }

  queueCloudSave();
}

async function initializeSupabaseSync() {
  const config = window.SUPABASE_CONFIG || {};
  const isConfigured = Boolean(config.url && config.anonKey);

  if (!isConfigured || !window.supabase?.createClient) {
    setSyncStatus(SYNC_STATUS.configMissing);
    renderAuthState();
    return;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "fitness-diary-supabase-auth",
      storage: getAuthStorage(),
      flowType: "pkce",
    },
  });

  setSyncStatus(SYNC_STATUS.restoring);
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.warn("Не удалось получить Supabase session.", error);
    setSyncStatus(SYNC_STATUS.error);
    return;
  }

  currentUser = data.session?.user || null;
  renderAuthState();

  if (currentUser) {
    await loadCloudState();
  } else {
    setSyncStatus(SYNC_STATUS.local);
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    renderAuthState();

    if (currentUser) {
      await loadCloudState();
    } else {
      setSyncStatus(SYNC_STATUS.local);
    }
  });
}

async function signInWithGoogle() {
  if (!supabaseClient) {
    setSyncStatus(SYNC_STATUS.configMissing);
    return;
  }

  setSyncStatus(SYNC_STATUS.syncing);
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthRedirectUrl(),
    },
  });

  if (error) {
    console.warn("Не удалось начать Google вход.", error);
    setSyncStatus(SYNC_STATUS.error);
  }
}

async function signOut() {
  if (!supabaseClient) {
    return;
  }

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    console.warn("Не удалось выйти.", error);
    setSyncStatus(SYNC_STATUS.error);
  }
}

async function loadCloudState() {
  if (!supabaseClient || !currentUser) {
    return;
  }

  setSyncStatus(SYNC_STATUS.syncing);
  const { data, error } = await supabaseClient
    .from("diary_state")
    .select("state, updated_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.warn("Не удалось загрузить облачное состояние.", error);
    setSyncStatus(navigator.onLine ? SYNC_STATUS.error : SYNC_STATUS.offline);
    return;
  }

  if (data?.state) {
    applyRemoteState(data.state);
    setSyncStatus(SYNC_STATUS.saved);
    return;
  }

  await saveStateToCloud();
}

function applyRemoteState(remoteState) {
  isApplyingRemoteState = true;
  state = normalizeState(remoteState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyTheme();
  renderSettings();
  renderSavedProducts();
  renderThemeSettings();
  updateNutritionPreview();
  renderDays();
  isApplyingRemoteState = false;
}

function queueCloudSave() {
  clearTimeout(syncTimer);
  setSyncStatus(SYNC_STATUS.syncing);
  syncTimer = setTimeout(() => {
    saveStateToCloud();
  }, 450);
}

async function saveStateToCloud() {
  if (!supabaseClient || !currentUser) {
    return;
  }

  const { error } = await supabaseClient
    .from("diary_state")
    .upsert({
      user_id: currentUser.id,
      state,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (error) {
    console.warn("Не удалось сохранить в Supabase.", error);
    setSyncStatus(navigator.onLine ? SYNC_STATUS.error : SYNC_STATUS.offline);
    return;
  }

  setSyncStatus(SYNC_STATUS.saved);
}

function normalizeState(value) {
  return {
    settings: { ...defaultState.settings, ...(value.settings || {}) },
    theme: { ...defaultState.theme, ...(value.theme || {}) },
    savedProducts: Array.isArray(value.savedProducts) ? value.savedProducts.map(normalizeSavedProduct).filter(hasSavedProductContent) : [],
    days: Array.isArray(value.days) ? value.days.map(normalizeDay) : [],
  };
}

function renderAuthState() {
  const isLoggedIn = Boolean(currentUser);
  loginButton.hidden = isLoggedIn;
  logoutButton.hidden = !isLoggedIn;
  userLabel.textContent = isLoggedIn
    ? currentUser.email || currentUser.user_metadata?.full_name || "Пользователь"
    : "Без входа";
}

function setSyncStatus(text) {
  syncStatus.textContent = text;
  syncStatus.dataset.status = text;
}

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getAuthStorage() {
  try {
    const testKey = "__fitness_auth_storage_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (error) {
    console.warn("localStorage недоступен, вход не сохранится после закрытия браузера.", error);
    return undefined;
  }
}

function renderSettings() {
  Object.entries(state.settings).forEach(([key, value]) => {
    const input = settingsForm.elements[key];

    if (input) {
      input.value = value || "";
    }
  });
}

function renderThemeSettings() {
  Object.entries(state.theme).forEach(([key, value]) => {
    const input = themeForm.elements[key];

    if (input) {
      input.value = value;
    }
  });
}

function readThemeForm() {
  return {
    bg: themeForm.elements.bg.value,
    surface: themeForm.elements.surface.value,
    surfaceStrong: themeForm.elements.surfaceStrong.value,
    text: themeForm.elements.text.value,
    muted: themeForm.elements.muted.value,
    accent: themeForm.elements.accent.value,
    accentStrong: themeForm.elements.accentStrong.value,
    accentSoft: themeForm.elements.accentSoft.value,
    line: themeForm.elements.line.value,
    water: themeForm.elements.water.value,
    warn: themeForm.elements.warn.value,
  };
}

function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty("--bg", state.theme.bg);
  root.style.setProperty("--surface", state.theme.surface);
  root.style.setProperty("--surface-strong", state.theme.surfaceStrong);
  root.style.setProperty("--text", state.theme.text);
  root.style.setProperty("--muted", state.theme.muted);
  root.style.setProperty("--accent", state.theme.accent);
  root.style.setProperty("--accent-strong", state.theme.accentStrong);
  root.style.setProperty("--accent-soft", state.theme.accentSoft);
  root.style.setProperty("--line", state.theme.line);
  root.style.setProperty("--water", state.theme.water);
  root.style.setProperty("--warn", state.theme.warn);
}

function readSettingsForm() {
  return {
    calories: readNumber(settingsForm.elements.calories.value),
    protein: readNumber(settingsForm.elements.protein.value),
    fat: readNumber(settingsForm.elements.fat.value),
    carbs: readNumber(settingsForm.elements.carbs.value),
    water: readNumber(settingsForm.elements.water.value),
  };
}

function readSavedProductForm() {
  return normalizeSavedProduct({
    product: savedProductForm.elements.product.value,
    grams: savedProductForm.elements.grams.value,
    calories: savedProductForm.elements.calories.value,
    protein: savedProductForm.elements.protein.value,
    fat: savedProductForm.elements.fat.value,
    carbs: savedProductForm.elements.carbs.value,
  });
}

function normalizeSavedProduct(product = {}) {
  return {
    id: product.id || createId(),
    product: String(product.product || "").trim(),
    grams: readNumber(product.grams),
    calories: readNumber(product.calories),
    protein: readNumber(product.protein),
    fat: readNumber(product.fat),
    carbs: readNumber(product.carbs),
  };
}

function hasSavedProductContent(product) {
  return Boolean(product.product && product.grams);
}

function upsertSavedProduct(product) {
  if (!hasSavedProductContent(product)) {
    return;
  }

  const key = getProductKey(product.product);
  const existingIndex = state.savedProducts.findIndex((item) => getProductKey(item.product) === key);

  if (existingIndex >= 0) {
    state.savedProducts[existingIndex] = { ...product, id: state.savedProducts[existingIndex].id };
    return;
  }

  state.savedProducts.push(product);
}

function renderSavedProducts() {
  savedProductsList.innerHTML = "";
  savedProductsOptions.innerHTML = "";

  const sortedProducts = [...state.savedProducts].sort((a, b) => a.product.localeCompare(b.product, "ru"));

  sortedProducts.forEach((product) => {
    const option = document.createElement("option");
    option.value = product.product;
    savedProductsOptions.appendChild(option);
    savedProductsList.appendChild(createSavedProductRow(product));
  });

  if (!sortedProducts.length) {
    const empty = document.createElement("p");
    empty.className = "saved-products-empty";
    empty.textContent = "Пока пусто.";
    savedProductsList.appendChild(empty);
  }
}

function createSavedProductRow(product) {
  const row = document.createElement("article");
  row.className = "saved-product-row";
  row.innerHTML = `
    <div>
      <strong>${escapeHtml(product.product)}</strong>
      <span>${formatNumber(product.grams)} г · ${formatNumber(product.calories)} ккал · Б ${formatNumber(product.protein)} · Ж ${formatNumber(product.fat)} · У ${formatNumber(product.carbs)}</span>
    </div>
    <button type="button" class="icon-action" data-action="remove-saved-product" data-id="${product.id}" aria-label="Удалить сохраненный продукт">×</button>
  `;
  return row;
}

function createEmptyDay() {
  const today = new Date().toISOString().slice(0, 10);

  return normalizeDay({
    id: createId(),
    date: today,
    meals: {},
    snacks: [],
  });
}

function normalizeDay(day) {
  const normalizedMeals = {};

  fixedMeals.forEach((meal) => {
    normalizedMeals[meal.key] = normalizeMeal(day.meals?.[meal.key]);
  });

  const normalizedSnacks = Array.isArray(day.snacks)
    ? day.snacks.map((snack) => normalizeMeal(snack, true))
    : [];

  if (!normalizedSnacks.length && day.meals?.snacks) {
    const oldSnack = normalizeMeal(day.meals.snacks, true);

    if (oldSnack.items.length) {
      normalizedSnacks.push(oldSnack);
    }
  }

  return {
    id: day.id || String(Date.now()),
    date: day.date || new Date().toISOString().slice(0, 10),
    water: readNumber(day.water),
    meals: normalizedMeals,
    snacks: normalizedSnacks,
  };
}

function normalizeMeal(meal, isSnack = false) {
  if (!meal) {
    return { id: createId(), items: [] };
  }

  if (Array.isArray(meal.items)) {
    return {
      id: meal.id || createId(),
      items: meal.items.map(normalizeItem).filter(hasItemContent),
    };
  }

  const migratedItem = normalizeItem({
    product: meal.note || "",
    grams: 0,
    unit: "g",
    calories: meal.calories,
    protein: meal.protein,
    fat: meal.fat,
    carbs: meal.carbs,
  });

  return {
    id: meal.id || createId(),
    items: hasItemContent(migratedItem) || isSnack ? [migratedItem].filter(hasItemContent) : [],
  };
}

function normalizeItem(item = {}) {
  return {
    product: String(item.product || "").trim(),
    grams: readNumber(item.grams),
    unit: item.unit === "ml" ? "ml" : "g",
    calories: readNumber(item.calories),
    protein: readNumber(item.protein),
    fat: readNumber(item.fat),
    carbs: readNumber(item.carbs),
  };
}

function hasItemContent(item) {
  return Boolean(item.product || item.grams || item.calories || item.protein || item.fat || item.carbs);
}

function createEmptyItem() {
  return {
    product: "",
    grams: 0,
    unit: "g",
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
  };
}

function openEditor(day) {
  editorPanel.hidden = false;
  daysPanel.hidden = true;
  editorTitle.textContent = state.days.some((item) => item.id === day.id) ? "Редактировать день" : "Новый день";
  dayForm.elements.id.value = day.id;
  dayForm.elements.date.value = day.date;
  dayForm.elements.water.value = day.water || "";
  renderMealSections(day);
  updateNutritionPreview();
  editorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  dayForm.reset();
  mealFields.innerHTML = "";
  editorPanel.hidden = true;
  daysPanel.hidden = false;
  updateNutritionPreview({ calories: 0, protein: 0, fat: 0, carbs: 0, water: 0 });
}

function navigateEditorDay(offset) {
  const currentDay = readDayForm();
  upsertDay(currentDay);

  const nextDate = shiftDate(currentDay.date, offset);
  const targetDay = state.days.find((day) => day.date === nextDate) || normalizeDay({
    id: createId(),
    date: nextDate,
    meals: {},
    snacks: [],
  });

  saveState();
  renderDays();
  openEditor(targetDay);
}

function renderMealSections(day) {
  mealFields.innerHTML = "";

  fixedMeals.forEach((meal) => {
    mealFields.appendChild(createMealSection({
      section: "fixed",
      key: meal.key,
      label: meal.label,
      items: getEditableItems(day.meals[meal.key].items),
      removable: false,
    }));
  });

  day.snacks.forEach((snack, index) => {
    mealFields.appendChild(createMealSection({
      section: "snack",
      key: snack.id,
      label: `Перекус ${index + 1}`,
      items: getEditableItems(snack.items),
      removable: true,
    }));
  });
}

function getEditableItems(items) {
  return items.length ? items : [createEmptyItem()];
}

function createMealSection({ section, key, label, items, removable }) {
  const details = document.createElement("details");
  details.open = false;
  details.className = "meal-card editable-meal";
  details.dataset.mealCard = "";
  details.dataset.section = section;
  details.dataset.key = key;

  const summary = document.createElement("summary");
  summary.textContent = label;

  const productList = document.createElement("div");
  productList.className = "product-list";

  items.forEach((item) => {
    productList.appendChild(createProductRow(item));
  });

  const actions = document.createElement("div");
  actions.className = "meal-actions";

  const addProductButton = document.createElement("button");
  addProductButton.type = "button";
  addProductButton.className = "secondary-action";
  addProductButton.dataset.action = "add-product";
  addProductButton.textContent = "+ Продукт";
  actions.appendChild(addProductButton);

  if (removable) {
    const removeSnackButton = document.createElement("button");
    removeSnackButton.type = "button";
    removeSnackButton.className = "danger-action";
    removeSnackButton.dataset.action = "remove-snack";
    removeSnackButton.textContent = "Удалить перекус";
    actions.appendChild(removeSnackButton);
  }

  details.append(summary, productList, actions);
  return details;
}

function createProductRow(item) {
  const row = document.createElement("div");
  row.className = "product-row";
  row.innerHTML = `
    <label class="product-name">
      Продукт
      <input type="text" data-field="product" list="saved-products-options" placeholder="Творог, банан, курица" value="${escapeAttribute(item.product)}">
    </label>
    <label>
      Кол-во
      <input type="number" min="0" step="any" inputmode="decimal" data-field="grams" value="${item.grams || ""}">
    </label>
    <label>
      Ед.
      <select data-field="unit">
        <option value="g"${item.unit === "ml" ? "" : " selected"}>г</option>
        <option value="ml"${item.unit === "ml" ? " selected" : ""}>мл</option>
      </select>
    </label>
    <label>
      Ккал
      <input type="number" min="0" step="any" inputmode="decimal" data-field="calories" value="${item.calories || ""}">
    </label>
    <label>
      Белки
      <input type="number" min="0" step="any" inputmode="decimal" data-field="protein" value="${item.protein || ""}">
    </label>
    <label>
      Жиры
      <input type="number" min="0" step="any" inputmode="decimal" data-field="fat" value="${item.fat || ""}">
    </label>
    <label>
      Углеводы
      <input type="number" min="0" step="any" inputmode="decimal" data-field="carbs" value="${item.carbs || ""}">
    </label>
    <button type="button" class="icon-action" data-action="remove-product" aria-label="Удалить продукт">×</button>
  `;
  return row;
}

function readDayForm() {
  const day = {
    id: dayForm.elements.id.value || createId(),
    date: dayForm.elements.date.value,
    water: readNumber(dayForm.elements.water.value),
    meals: {},
    snacks: [],
  };

  fixedMeals.forEach((meal) => {
    const section = mealFields.querySelector(`[data-section="fixed"][data-key="${meal.key}"]`);
    day.meals[meal.key] = {
      id: meal.key,
      items: readItems(section),
    };
  });

  mealFields.querySelectorAll('[data-section="snack"]').forEach((section) => {
    const items = readItems(section);

    if (items.length) {
      day.snacks.push({
        id: section.dataset.key || createId(),
        items,
      });
    }
  });

  return normalizeDay(day);
}

function readItems(section) {
  if (!section) {
    return [];
  }

  return [...section.querySelectorAll(".product-row")]
    .map((row) => normalizeItem({
      product: row.querySelector('[data-field="product"]').value,
      grams: row.querySelector('[data-field="grams"]').value,
      unit: row.querySelector('[data-field="unit"]').value,
      calories: row.querySelector('[data-field="calories"]').value,
      protein: row.querySelector('[data-field="protein"]').value,
      fat: row.querySelector('[data-field="fat"]').value,
      carbs: row.querySelector('[data-field="carbs"]').value,
    }))
    .filter(hasItemContent);
}

function applySavedProductsToRows() {
  mealFields.querySelectorAll(".product-row").forEach(applySavedProductToRow);
}

function applySavedProductToRow(row) {
  const productInput = row.querySelector('[data-field="product"]');
  const gramsInput = row.querySelector('[data-field="grams"]');
  const savedProduct = findSavedProduct(productInput.value);

  if (!savedProduct) {
    return;
  }

  const grams = readNumber(gramsInput.value);
  const ratio = savedProduct.grams ? grams / savedProduct.grams : 0;

  ["calories", "protein", "fat", "carbs"].forEach((field) => {
    const input = row.querySelector(`[data-field="${field}"]`);
    input.value = ratio ? roundMacro(savedProduct[field] * ratio) : "";
  });
}

function findSavedProduct(productName) {
  const key = getProductKey(productName);

  if (!key) {
    return null;
  }

  return state.savedProducts.find((product) => getProductKey(product.product) === key) || null;
}

function getProductKey(productName) {
  return String(productName || "").trim().toLocaleLowerCase("ru-RU");
}

function roundMacro(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function renderDays() {
  const sortedDays = [...state.days].sort((a, b) => b.date.localeCompare(a.date));

  daysSummary.textContent = sortedDays.length
    ? `${sortedDays.length} ${pluralize(sortedDays.length, "запись", "записи", "записей")}`
    : "Записей пока нет.";

  daysList.innerHTML = "";

  if (!sortedDays.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Добавьте первый день, чтобы начать вести дневник.";
    daysList.appendChild(empty);
    return;
  }

  sortedDays.forEach((day) => {
    daysList.appendChild(createDayCard(day));
  });
}

function upsertDay(day) {
  const existingIndex = state.days.findIndex((item) => item.id === day.id);

  if (existingIndex >= 0) {
    state.days[existingIndex] = day;
  } else {
    state.days.push(day);
  }
}

function createDayCard(day) {
  const card = document.createElement("article");
  const totals = getDayTotals(day);
  const waterPercent = getPercent(day.water, state.settings.water);
  card.className = "day-card";

  const dateColumn = document.createElement("div");
  dateColumn.className = "day-date";
  dateColumn.innerHTML = `
    <p class="date-label">${escapeHtml(formatDate(day.date))}</p>
    <div class="day-actions">
      <button type="button" class="secondary-action" data-action="edit" data-id="${day.id}">Редактировать</button>
      <button type="button" class="danger-action" data-action="delete" data-id="${day.id}">Удалить</button>
    </div>
  `;

  const mealsColumn = document.createElement("div");
  mealsColumn.className = "meal-summary";

  fixedMeals.forEach((meal) => {
    mealsColumn.appendChild(createMealSummary(meal.label, day.meals[meal.key].items));
  });

  day.snacks.forEach((snack, index) => {
    mealsColumn.appendChild(createMealSummary(`Перекус ${index + 1}`, snack.items));
  });

  if (!day.snacks.length) {
    mealsColumn.appendChild(createMealSummary("Перекусы", [], "Нет"));
  }

  const metricsColumn = document.createElement("div");
  metricsColumn.className = "metrics";

  Object.keys(macroLabels).forEach((macro) => {
    const amount = totals[macro];
    const norm = state.settings[macro];
    metricsColumn.appendChild(createMetricRow(macroLabels[macro], amount, norm, getPercent(amount, norm), "", false, true));
  });

  metricsColumn.appendChild(createMetricRow("Вода", day.water, state.settings.water, waterPercent, "мл", true, true));

  card.append(dateColumn, mealsColumn, metricsColumn);
  return card;
}

function createMealSummary(label, items, emptyText = "Не заполнено") {
  const article = document.createElement("article");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const list = document.createElement("ul");

  details.open = true;
  details.className = "meal-summary-details";
  summary.textContent = label;
  list.className = "product-summary";

  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = emptyText;
    list.appendChild(empty);
  }

  items.forEach((item) => {
    const row = document.createElement("li");
    const product = document.createElement("span");
    const grams = document.createElement("span");

    product.textContent = item.product || "Без названия";
    grams.textContent = item.grams ? `${formatNumber(item.grams)} ${getUnitLabel(item.unit)}` : "—";
    row.append(product, grams);
    list.appendChild(row);
  });

  details.append(summary, list);
  article.appendChild(details);
  return article;
}

function createMetricRow(label, amount, norm, percent, unit = "", isWater = false, isLeveled = false) {
  const row = document.createElement("div");
  const suffix = unit ? ` ${unit}` : "";
  const factText = `${formatNumber(amount)}${suffix}`;
  const normText = norm ? ` / ${formatNumber(norm)}${suffix}` : "";
  const levelClass = isLeveled ? ` ${getProgressLevel(percent, norm)}` : "";
  const visualPercent = getVisualPercent(amount, norm, percent);
  row.className = "metric-row";
  row.innerHTML = `
    <div class="metric-head">
      <span>${label}</span>
      <span>${factText}${normText} · ${percent}%</span>
    </div>
    <div class="progress${isWater ? " water" : ""}${levelClass}">
      <span style="width: ${visualPercent}%"></span>
    </div>
  `;
  return row;
}

function getVisualPercent(amount, norm, percent) {
  if (norm) {
    return Math.min(percent, 100);
  }

  return amount ? 100 : 0;
}

function getProgressLevel(percent, norm) {
  if (!norm) {
    return "progress-unknown";
  }

  if (percent < 35) {
    return "progress-low";
  }

  if (percent < 75) {
    return "progress-mid";
  }

  return "progress-high";
}

function updateNutritionPreview(totals = getEditorTotals(), settings = state.settings) {
  nutritionPreviewList.innerHTML = "";

  Object.keys(macroLabels).forEach((macro) => {
    const amount = totals[macro];
    const norm = settings[macro];
    nutritionPreviewList.appendChild(createMetricRow(macroLabels[macro], amount, norm, getPercent(amount, norm)));
  });

  nutritionPreviewList.appendChild(
    createMetricRow("Вода", totals.water, settings.water, getPercent(totals.water, settings.water), "мл", true),
  );
}

function getEditorTotals() {
  const day = {
    water: readNumber(dayForm.elements.water.value),
    meals: {},
    snacks: [],
  };

  fixedMeals.forEach((meal) => {
    const section = mealFields.querySelector(`[data-section="fixed"][data-key="${meal.key}"]`);
    day.meals[meal.key] = { items: readItems(section) };
  });

  mealFields.querySelectorAll('[data-section="snack"]').forEach((section) => {
    day.snacks.push({ items: readItems(section) });
  });

  return { ...getDayTotals(day), water: day.water };
}

function getDayTotals(day) {
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const addItems = (items) => {
    items.forEach((item) => {
      totals.calories += item.calories;
      totals.protein += item.protein;
      totals.fat += item.fat;
      totals.carbs += item.carbs;
    });
  };

  fixedMeals.forEach((meal) => {
    addItems(day.meals?.[meal.key]?.items || []);
  });

  (day.snacks || []).forEach((snack) => {
    addItems(snack.items || []);
  });

  return totals;
}

function updateSnackLabels() {
  mealFields.querySelectorAll('[data-section="snack"]').forEach((section, index) => {
    section.querySelector("summary").textContent = `Перекус ${index + 1}`;
  });
}

function getPercent(amount, norm) {
  if (!norm) {
    return 0;
  }

  return Math.round((amount / norm) * 100);
}

function readNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatDate(value) {
  if (!value) {
    return "Без даты";
  }

  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function shiftDate(value, offset) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + offset);

  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value || 0);
}

function getUnitLabel(unit) {
  return unit === "ml" ? "мл" : "г";
}

function pluralize(number, one, few, many) {
  const last = number % 10;
  const lastTwo = number % 100;

  if (last === 1 && lastTwo !== 11) {
    return one;
  }

  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return few;
  }

  return many;
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
