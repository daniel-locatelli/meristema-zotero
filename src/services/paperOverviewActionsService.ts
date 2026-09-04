const HTML_NS = "http://www.w3.org/1999/xhtml";
import { createIcon } from "./uiIconService";

type Action = () => void | Promise<void>;

export interface PaperOverviewOpenAction {
  label: string;
  title?: string;
  action: Action;
}

export interface PaperOverviewActionOptions {
  document: Document;
  actionsClass: string;
  primaryButtonClass: string;
  secondaryButtonClass?: string;
  /** Drawn as plain buttons at the start of the bar, in order. */
  openActions: readonly PaperOverviewOpenAction[];
  onSimilar: Action;
  onRefresh: Action;
}

export interface PaperOverviewActionBar {
  root: HTMLDivElement;
  openButtons: HTMLButtonElement[];
  similarButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElementNS(
    HTML_NS,
    tag,
  ) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  return node;
}

function invoke(button: HTMLButtonElement, action: Action): void {
  if (button.disabled) return;
  button.disabled = true;
  void Promise.resolve(action())
    .catch((error: unknown) => {
      Zotero.logError(
        error instanceof Error
          ? error
          : new Error(`Meristema overview action failed: ${String(error)}`),
      );
    })
    .finally(() => {
      if (button.isConnected) button.disabled = false;
    });
}

export function createPaperOverviewActionBar(
  options: PaperOverviewActionOptions,
): PaperOverviewActionBar {
  const {
    document,
    actionsClass,
    primaryButtonClass,
    secondaryButtonClass = "",
  } = options;
  const root = element(document, "div", actionsClass);
  root.style.display = "flex";
  root.style.flexWrap = "wrap";
  root.style.alignItems = "center";
  root.style.justifyContent = "space-between";
  root.style.gap = "6px";
  root.style.width = "100%";

  const left = element(document, "div", actionsClass);
  left.style.margin = "0";
  left.style.minWidth = "0";
  const right = element(document, "div", actionsClass);
  right.style.margin = "0";
  right.style.minWidth = "0";
  /*
   * `space-between` only holds the two groups apart while they share a line.
   * In a narrow item pane they do not, and the second group came to rest at
   * the left of its own row, reading as a third group rather than the end of
   * the bar. An auto start margin puts it at the right edge on whichever line
   * it lands on.
   */
  right.style.marginInlineStart = "auto";

  const openButtons = options.openActions.map((entry) => {
    const button = element(document, "button", secondaryButtonClass);
    button.type = "button";
    button.textContent = entry.label;
    button.title = entry.title ?? entry.label;
    button.addEventListener("click", () => invoke(button, entry.action));
    left.appendChild(button);
    return button;
  });

  const similarButton = element(document, "button", primaryButtonClass);
  similarButton.type = "button";
  similarButton.append(
    createIcon(document, "similar"),
    document.createTextNode("Similar"),
  );
  similarButton.title =
    "Find papers similar to this work using scholarly-data providers. Results are shown for review and are not added to Zotero automatically.";
  similarButton.setAttribute("aria-label", similarButton.title);
  similarButton.addEventListener("click", () =>
    invoke(similarButton, options.onSimilar),
  );
  right.appendChild(similarButton);

  const refreshButton = element(
    document,
    "button",
    `${secondaryButtonClass} cm-icon-button`.trim(),
  );
  refreshButton.type = "button";
  refreshButton.appendChild(createIcon(document, "refresh"));
  refreshButton.title =
    "Check scholarly-data providers online and update the citation metrics, reference metrics, open-access and retraction status, journal metrics, and stored cited-by/reference lists for this paper.";
  refreshButton.setAttribute("aria-label", refreshButton.title);
  refreshButton.addEventListener("click", () =>
    invoke(refreshButton, options.onRefresh),
  );
  right.appendChild(refreshButton);

  root.append(left, right);
  return {
    root,
    openButtons,
    similarButton,
    refreshButton,
  };
}
