/* global clearTimeout, document, setTimeout, Zotero */

(() => {
  const PREF_PREFIX = "__prefsPrefix__.";
  let initialized = false;
  let notificationTimer = null;

  const byID = (id) => document.getElementById(id);
  const providerParent = () => byID("zotero-prefpane-meristema-provider-all");
  const providerInputs = () =>
    Array.from(document.querySelectorAll("input[data-provider-pref]"));
  const providerChildren = () =>
    document.querySelector(".meristema-provider-children");
  const updateParent = () =>
    byID("zotero-prefpane-meristema-automatic-updates");
  const updateInputs = () =>
    Array.from(document.querySelectorAll("input[data-update-pref]"));
  const updateChildren = () =>
    document.querySelector(".meristema-pref-children");

  function prefKey(name) {
    return PREF_PREFIX + name;
  }

  function readBoolean(name, fallback = true) {
    const value = Zotero.Prefs.get(prefKey(name), true);
    return value === undefined || value === null ? fallback : Boolean(value);
  }

  function writeBoolean(name, value) {
    Zotero.Prefs.set(prefKey(name), Boolean(value), true);
  }

  function inputPreference(input, attribute) {
    return input.getAttribute(attribute) || "";
  }

  function writeInputState(input, attribute) {
    const name = inputPreference(input, attribute);
    if (name) writeBoolean(name, input.checked);
  }

  function setInputStates(inputs, attribute, checked) {
    for (const input of inputs) {
      input.checked = checked;
      writeInputState(input, attribute);
    }
  }

  function notifyProviderChange() {
    if (notificationTimer !== null) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      notificationTimer = null;
      Zotero.__addonInstance__.api.providerSelectionChanged();
    }, 0);
  }

  function updateProviderStatus(inputs, automatic) {
    const status = byID("zotero-prefpane-meristema-provider-status");
    if (!status) return;
    const selected = inputs.filter((input) => input.checked).length;
    status.textContent = automatic
      ? `Automatic selection: all ${inputs.length} providers enabled.`
      : `Custom selection: ${selected} of ${inputs.length} providers enabled.`;
  }

  function renderProviderMode() {
    const parent = providerParent();
    const inputs = providerInputs();
    if (!parent || !inputs.length) return;

    const automatic = readBoolean("providerAutomatic", true);
    parent.checked = automatic;
    parent.indeterminate = false;

    if (automatic) {
      setInputStates(inputs, "data-provider-pref", true);
    } else {
      for (const input of inputs) {
        input.checked = readBoolean(
          inputPreference(input, "data-provider-pref"),
          true,
        );
      }
      if (!inputs.some((input) => input.checked)) {
        inputs[0].checked = true;
        writeInputState(inputs[0], "data-provider-pref");
      }
    }

    for (const input of inputs) input.disabled = automatic;
    providerChildren()?.classList.toggle("meristema-options-locked", automatic);
    updateProviderStatus(inputs, automatic);
  }

  function handleProviderParentChange() {
    const parent = providerParent();
    const inputs = providerInputs();
    if (!parent || !inputs.length) return;

    const automatic = parent.checked;
    writeBoolean("providerAutomatic", automatic);
    if (automatic) setInputStates(inputs, "data-provider-pref", true);
    renderProviderMode();
    notifyProviderChange();
  }

  function handleProviderChildChange(input) {
    if (readBoolean("providerAutomatic", true)) {
      renderProviderMode();
      return;
    }

    const inputs = providerInputs();
    if (!inputs.some((candidate) => candidate.checked)) {
      input.checked = true;
    }
    writeInputState(input, "data-provider-pref");
    updateProviderStatus(inputs, false);
    notifyProviderChange();
  }

  function renderUpdateMode() {
    const parent = updateParent();
    const inputs = updateInputs();
    if (!parent || !inputs.length) return;

    const automatic = readBoolean("automaticUpdates", true);
    parent.checked = automatic;
    parent.indeterminate = false;

    if (automatic) {
      setInputStates(inputs, "data-update-pref", true);
    } else {
      for (const input of inputs) {
        input.checked = readBoolean(
          inputPreference(input, "data-update-pref"),
          true,
        );
      }
    }

    for (const input of inputs) input.disabled = automatic;
    updateChildren()?.classList.toggle("meristema-options-locked", automatic);
  }

  function handleUpdateParentChange() {
    const parent = updateParent();
    const inputs = updateInputs();
    if (!parent || !inputs.length) return;

    const automatic = parent.checked;
    writeBoolean("automaticUpdates", automatic);
    if (automatic) setInputStates(inputs, "data-update-pref", true);
    renderUpdateMode();
  }

  function handleUpdateChildChange(input) {
    if (readBoolean("automaticUpdates", true)) {
      renderUpdateMode();
      return;
    }
    writeInputState(input, "data-update-pref");
  }

  function bindControls() {
    const parent = providerParent();
    const providers = providerInputs();
    const updateMode = updateParent();
    const updates = updateInputs();
    if (!parent || !providers.length || !updateMode || !updates.length) {
      return false;
    }

    parent.addEventListener("change", handleProviderParentChange);
    for (const input of providers) {
      input.addEventListener("change", () => handleProviderChildChange(input));
    }

    updateMode.addEventListener("change", handleUpdateParentChange);
    for (const input of updates) {
      input.addEventListener("change", () => handleUpdateChildChange(input));
    }

    renderProviderMode();
    renderUpdateMode();
    return true;
  }

  function initialize(attempt = 0) {
    if (initialized) return;
    if (!bindControls()) {
      if (attempt < 40) setTimeout(() => initialize(attempt + 1), 50);
      return;
    }
    initialized = true;
  }

  initialize();
})();
