import {
  graphViewAvailabilityLine,
  graphViewIsAvailable,
  graphViewRequirementLine,
  type GraphViewDefinition,
} from "./graphViews";
import { createIcon } from "./uiIconService";
import { element, text } from "./graphViewControls";

/*
 * D4's DOM: the View chip and its dropdown (a sibling of the File menu, same
 * family), the tutorial card, the gallery, and the save panel. No graph
 * state lives here; every decision arrives through a callback.
 */

export interface GraphViewsMenuOptions {
  document: Document;
  shipped: readonly GraphViewDefinition[];
  listSaved: () => GraphViewDefinition[];
  onChoose: (view: GraphViewDefinition) => void;
  onEdit: (view: GraphViewDefinition) => void;
  onSaveCurrent: () => void;
  onImport: () => void;
  onOpenGallery: () => void;
  /**
   * The dropdown is about to be drawn. The service drops its active-view
   * memo here, so a rename or a delete made in another tab shows on the
   * next open rather than on the next render.
   */
  onOpen?: () => void;
}

export interface GraphViewsMenu {
  wrap: HTMLElement;
  button: HTMLButtonElement;
  menu: HTMLElement;
  setLabel(name: string | null, edited: boolean): void;
  /** Which row wears the tick next time the menu is drawn. Draws nothing now. */
  setActive(id: string | null): void;
  close(): void;
  open(): void;
  refresh(activeID: string | null): void;
}

function row(
  document: Document,
  view: GraphViewDefinition,
  active: boolean,
  onChoose: () => void,
  onEdit: (() => void) | null,
): HTMLElement {
  const available = graphViewIsAvailable(view);
  const button = element(document, "button", "cm-view-row");
  button.type = "button";
  button.dataset.viewId = view.id;
  button.setAttribute("role", "menuitemradio");
  button.setAttribute("aria-checked", String(active));
  if (!available) {
    button.classList.add("cm-view-row--unavailable");
    button.setAttribute("aria-disabled", "true");
  }
  button.append(createIcon(document, view.icon, 16));
  const body = element(document, "span", "cm-view-row-body");
  body.append(
    text(document, "span", view.name, "cm-view-row-name"),
    text(document, "span", view.summary, "cm-view-row-summary"),
  );
  button.append(body);
  const note =
    graphViewAvailabilityLine(view) ?? graphViewRequirementLine(view);
  if (note) button.append(text(document, "span", note, "cm-view-row-note"));
  if (active) button.append(text(document, "span", "✓", "cm-view-row-tick"));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!available) return;
    onChoose();
  });
  if (!onEdit) return button;
  const wrap = element(document, "div", "cm-view-row-wrap");
  const edit = element(document, "button", "cm-view-row-edit");
  edit.type = "button";
  edit.textContent = "edit";
  edit.title = `Edit ${view.name}`;
  edit.addEventListener("click", (event) => {
    event.stopPropagation();
    onEdit();
  });
  wrap.append(button, edit);
  return wrap;
}

export function createGraphViewsMenu(o: GraphViewsMenuOptions): GraphViewsMenu {
  const { document } = o;
  const wrap = element(document, "div", "cm-menu-wrapper cm-view-menu-wrap");
  const button = element(document, "button", "cm-toolbar-button cm-view-chip");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "meristema-view-menu");
  button.title = "Choose a named way to look at this graph.";
  button.append(createIcon(document, "view", 16));
  const label = text(document, "span", "View", "cm-view-chip-label");
  const name = text(document, "span", "", "cm-view-chip-name");
  const caret = text(document, "span", "▾", "cm-view-chip-caret");
  button.append(label, name, caret);
  const menu = element(document, "div", "cm-export-menu cm-view-menu");
  menu.id = "meristema-view-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  wrap.append(button, menu);

  /*
   * The rows are rebuilt when the menu opens, not on every change behind it:
   * a `replaceChildren` under an open menu drops focus, forgets the hover and
   * swallows the click whose `pointerdown` landed on a row. The tick's owner
   * is kept here so opening can redraw from it.
   */
  let activeID: string | null = null;
  const refresh = (nextActiveID: string | null): void => {
    activeID = nextActiveID;
    menu.replaceChildren();
    for (const view of o.shipped) {
      menu.append(
        row(
          document,
          view,
          view.id === activeID,
          () => {
            close();
            o.onChoose(view);
          },
          null,
        ),
      );
    }
    const saved = o.listSaved();
    if (saved.length) {
      menu.append(text(document, "div", "My views", "cm-graph-menu-heading"));
      for (const view of saved) {
        menu.append(
          row(
            document,
            view,
            view.id === activeID,
            () => {
              close();
              o.onChoose(view);
            },
            () => {
              close();
              o.onEdit(view);
            },
          ),
        );
      }
    }
    menu.append(
      text(document, "div", "", "cm-graph-menu-heading cm-view-menu-rule"),
    );
    for (const [labelText, handler] of [
      ["Save current as view…", o.onSaveCurrent],
      ["Import view JSON…", o.onImport],
      ["Choose a view…", o.onOpenGallery],
    ] as const) {
      const action = element(document, "button", "cm-view-action");
      action.type = "button";
      action.setAttribute("role", "menuitem");
      action.textContent = labelText;
      action.addEventListener("click", (event) => {
        event.stopPropagation();
        close();
        handler();
      });
      menu.append(action);
    }
  };

  const close = (): void => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = (): void => {
    // Saved views, their names and the tick are as of this moment, and the
    // reader cannot be mid-click on a row that is about to be replaced.
    o.onOpen?.();
    refresh(activeID);
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };
  button.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });

  return {
    wrap,
    button,
    menu,
    setLabel(viewName, edited) {
      name.textContent = viewName
        ? `${viewName}${edited ? " (edited)" : ""}`
        : "";
      name.hidden = !viewName;
      button.setAttribute(
        "aria-label",
        viewName ? `View: ${viewName}${edited ? ", edited" : ""}` : "View",
      );
    },
    setActive(id) {
      activeID = id;
    },
    close,
    open,
    refresh,
  };
}

// ----------------------------------------------------------- tutorial card

export interface TutorialCard {
  root: HTMLElement;
  show(view: GraphViewDefinition, chips: string[], footnote: string): void;
  hide(): void;
}

export function createTutorialCard(
  document: Document,
  onDismissForever: (id: string) => void,
): TutorialCard {
  const root = element(document, "aside", "cm-view-card");
  root.hidden = true;
  root.setAttribute("role", "note");
  const head = element(document, "div", "cm-view-card-head");
  const title = text(document, "span", "", "cm-view-card-title");
  const closeButton = element(document, "button", "cm-view-card-close");
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close");
  head.append(title, closeButton);
  const body = text(document, "p", "", "cm-view-card-body");
  const chipRow = element(document, "div", "cm-view-card-chips");
  const foot = text(document, "p", "", "cm-view-card-foot");
  const actions = element(document, "div", "cm-view-card-actions");
  const never = element(document, "button", "cm-link-button");
  never.type = "button";
  never.textContent = "Don't show for this view again";
  const got = element(document, "button", "cm-secondary-button");
  got.type = "button";
  got.textContent = "Got it";
  actions.append(never, got);
  root.append(head, body, chipRow, foot, actions);
  let current: string | null = null;
  const hide = (): void => {
    root.hidden = true;
    current = null;
  };
  closeButton.addEventListener("click", hide);
  got.addEventListener("click", hide);
  never.addEventListener("click", () => {
    if (current) onDismissForever(current);
    hide();
  });
  return {
    root,
    show(view, chips, footnote) {
      current = view.id;
      title.textContent = view.name;
      body.textContent = view.paragraph;
      chipRow.replaceChildren(
        ...chips.map((chip) =>
          text(document, "span", chip, "cm-view-chip-tag"),
        ),
      );
      foot.textContent = footnote;
      root.hidden = false;
    },
    hide,
  };
}

// ----------------------------------------------------------------- gallery

export interface ViewGallery {
  root: HTMLElement;
  show(count: number): void;
  hide(): void;
}

export function createViewGallery(
  document: Document,
  o: {
    shipped: readonly GraphViewDefinition[];
    onChoose: (view: GraphViewDefinition) => void;
    onBlank: () => void;
    onImport: () => void;
  },
): ViewGallery {
  const root = element(document, "section", "cm-view-gallery");
  root.hidden = true;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Choose a view");
  const heading = text(document, "h2", "", "cm-view-gallery-heading");
  const sub = text(
    document,
    "p",
    "Scope stays as it is.",
    "cm-view-gallery-sub",
  );
  const grid = element(document, "div", "cm-view-gallery-grid");
  for (const view of o.shipped) {
    const card = element(document, "button", "cm-view-gallery-card");
    card.type = "button";
    card.dataset.viewId = view.id;
    const available = graphViewIsAvailable(view);
    if (!available) {
      card.classList.add("cm-view-gallery-card--unavailable");
      card.setAttribute("aria-disabled", "true");
    }
    card.append(createIcon(document, view.icon, 28));
    card.append(text(document, "span", view.name, "cm-view-gallery-name"));
    card.append(text(document, "span", view.paragraph, "cm-view-gallery-para"));
    const note =
      graphViewAvailabilityLine(view) ?? graphViewRequirementLine(view);
    if (note) card.append(text(document, "span", note, "cm-view-gallery-note"));
    card.addEventListener("click", () => {
      if (available) o.onChoose(view);
    });
    grid.append(card);
  }
  const last = element(
    document,
    "div",
    "cm-view-gallery-card cm-view-gallery-last",
  );
  const blank = element(document, "button", "cm-secondary-button");
  blank.type = "button";
  blank.textContent = "Start blank";
  blank.addEventListener("click", o.onBlank);
  const importButton = element(document, "button", "cm-link-button");
  importButton.type = "button";
  importButton.textContent = "Import view JSON…";
  importButton.addEventListener("click", o.onImport);
  last.append(blank, importButton);
  grid.append(last);
  root.append(heading, sub, grid);
  return {
    root,
    show(count) {
      const line = `How do you want to look at these ${count.toLocaleString()} papers?`;
      // `maybeShowGallery` runs at the end of every filter pass. Writing the
      // same heading into a gallery that is already up would re-invalidate
      // its blurred compositing layer each time, so an unchanged show is a
      // no-op.
      if (!root.hidden && heading.textContent === line) return;
      heading.textContent = line;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}

// -------------------------------------------------------------- save panel

export interface SavePanelResult {
  name: string;
  paragraph: string;
}

export interface SavePanelOpenOptions {
  name: string;
  paragraph: string;
  captures: { regions: number; filters: boolean };
  existing: GraphViewDefinition | null;
  nameTaken: (name: string) => boolean;
  onCopyJSON: (result: SavePanelResult) => void;
  onSave: (result: SavePanelResult) => void;
  onDelete: (() => void) | null;
}

export interface SavePanel {
  root: HTMLElement;
  open(o: SavePanelOpenOptions): void;
  close(): void;
}

export function createSavePanel(document: Document): SavePanel {
  const root = element(document, "div", "cm-view-save");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Save view");
  root.tabIndex = -1;
  const title = text(
    document,
    "h2",
    "Save current as view",
    "cm-view-save-title",
  );
  const nameLabel = element(document, "label", "cm-view-save-field");
  nameLabel.append(text(document, "span", "Name"));
  const nameInput = element(document, "input", "cm-view-save-input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameLabel.append(nameInput);
  const nameError = text(document, "p", "", "cm-view-save-error");
  nameError.hidden = true;
  const explainLabel = element(document, "label", "cm-view-save-field");
  explainLabel.append(text(document, "span", "Explain it"));
  const explain = element(document, "textarea", "cm-view-save-textarea");
  explain.rows = 4;
  explainLabel.append(explain);
  const captures = element(document, "ul", "cm-view-save-captures");
  const footer = element(document, "div", "cm-view-save-footer");
  const note = text(
    document,
    "span",
    "Views are stored in your Zotero profile.",
    "cm-view-save-note",
  );
  const copyButton = element(document, "button", "cm-secondary-button");
  copyButton.type = "button";
  copyButton.textContent = "Copy JSON";
  const deleteButton = element(
    document,
    "button",
    "cm-secondary-button cm-view-save-delete",
  );
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  const cancel = element(document, "button", "cm-secondary-button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const save = element(document, "button", "cm-primary-button");
  save.type = "button";
  save.textContent = "Save";
  footer.append(note, copyButton, deleteButton, cancel, save);
  root.append(
    title,
    nameLabel,
    nameError,
    explainLabel,
    text(document, "p", "Captures", "cm-view-save-captures-title"),
    captures,
    footer,
  );

  let current: SavePanelOpenOptions | null = null;
  const result = (): SavePanelResult => ({
    name: nameInput.value.trim(),
    paragraph: explain.value.trim(),
  });
  const validate = (): boolean => {
    const { name } = result();
    let error = "";
    if (!name) error = "Give the view a name.";
    else if (
      current?.nameTaken(name) &&
      !(
        current.existing &&
        current.existing.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      error = "A view with that name already exists.";
    }
    nameError.textContent = error;
    nameError.hidden = !error;
    save.disabled = Boolean(error);
    return !error;
  };
  nameInput.addEventListener("input", validate);
  const close = (): void => {
    root.hidden = true;
    current = null;
  };
  cancel.addEventListener("click", close);
  copyButton.addEventListener("click", () => {
    if (current && validate()) current.onCopyJSON(result());
  });
  save.addEventListener("click", () => {
    if (!current || !validate()) return;
    const o = current;
    close();
    o.onSave(result());
  });
  deleteButton.addEventListener("click", () => {
    const o = current;
    close();
    o?.onDelete?.();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  const captureRow = (
    label: string,
    ticked: boolean,
    dashed = false,
  ): HTMLElement => {
    const li = element(document, "li", "cm-view-save-capture");
    if (dashed) li.classList.add("cm-view-save-capture--never");
    const box = element(document, "input");
    box.type = "checkbox";
    box.checked = ticked;
    box.disabled = true;
    li.append(box, text(document, "span", label));
    return li;
  };

  return {
    root,
    open(o) {
      current = o;
      title.textContent = o.existing
        ? `Edit ${o.existing.name}`
        : "Save current as view";
      nameInput.value = o.name;
      explain.value = o.paragraph;
      captures.replaceChildren(
        captureRow("Axes", true),
        captureRow("Colour", true),
        captureRow("Size", true),
        captureRow("Labels", true),
        captureRow(
          o.captures.regions
            ? `Regions: ${o.captures.regions} folder${o.captures.regions === 1 ? "" : "s"}`
            : "Regions: none",
          true,
        ),
        captureRow("Filters", true),
        captureRow(
          "Explore (hops, floor, shared citers) — not yet available",
          false,
        ),
        captureRow("Scope (seeds, collections) — never saved", false, true),
      );
      deleteButton.hidden = !o.onDelete;
      root.hidden = false;
      validate();
      nameInput.focus();
      nameInput.select();
    },
    close,
  };
}
