/* global clearTimeout, document, setTimeout, Zotero */

(() => {
  const PREF_PREFIX = "__prefsPrefix__.";
  let initialized = false;
  let notificationTimer = null;

  const byID = (id) => document.getElementById(id);
  const providerInputs = () =>
    Array.from(document.querySelectorAll("input[data-provider-pref]"));
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

  function updateProviderStatus(inputs) {
    const status = byID("zotero-prefpane-meristema-provider-status");
    if (!status) return;
    const selected = inputs.filter((input) => input.checked).length;
    status.textContent =
      selected === inputs.length
        ? `All ${inputs.length} providers on, and combined.`
        : `${selected} of ${inputs.length} providers on.`;
  }

  /**
   * `providerAutomatic` now only means nobody has chosen yet: every provider
   * reads as ticked, and the first untick writes the whole list.
   */
  function renderProviderMode() {
    const inputs = providerInputs();
    if (!inputs.length) return;

    if (readBoolean("providerAutomatic", true)) {
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

    updateProviderStatus(inputs);
  }

  function handleProviderChildChange(input) {
    const inputs = providerInputs();
    if (!inputs.some((candidate) => candidate.checked)) {
      input.checked = true;
    }
    for (const candidate of inputs) {
      writeInputState(candidate, "data-provider-pref");
    }
    writeBoolean("providerAutomatic", false);
    updateProviderStatus(inputs);
    notifyProviderChange();
  }

  function handleResetAll() {
    if (!Zotero.__addonInstance__.api.resetAllSettings()) return;
    renderProviderMode();
    renderUpdateMode();
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
    const providers = providerInputs();
    const updateMode = updateParent();
    const updates = updateInputs();
    if (!providers.length || !updateMode || !updates.length) {
      return false;
    }

    byID("zotero-prefpane-meristema-reset-all")?.addEventListener(
      "click",
      handleResetAll,
    );
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
