const { Disposable, CompositeDisposable } = require("lumine");
const path = require("path");
const fs = require("fs");

const WINDOWS_SEPARATORS = path.sep === "\\";
const TRAILING_SEPARATOR = WINDOWS_SEPARATORS ? /[\\/]+$/ : /\/+$/;
const SEPARATORS = WINDOWS_SEPARATORS ? /[\\/]/g : /\//g;
let graphemeSegmenter;

function completeMatchIndices(text, indices) {
  const matches = [...new Set(indices)].sort((a, b) => a - b);
  const completed = [];
  let next = 0;
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  // Native matching maps folded text back to original UTF-16 indexes. Cover
  // whole graphemes so surrogate pairs, combining marks and emoji stay intact.
  for (const { index, segment } of graphemeSegmenter.segment(text)) {
    while (next < matches.length && matches[next] < index) next++;
    if (next < matches.length && matches[next] < index + segment.length) {
      for (let offset = 0; offset < segment.length; offset++) completed.push(index + offset);
    }
  }
  return completed;
}

function normalizeProjectPath(projectPath) {
  let normalized = path.normalize(projectPath);
  if (WINDOWS_SEPARATORS)
    normalized = normalized.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
  const root = path.parse(normalized).root;
  const trimmed = normalized.replace(TRAILING_SEPARATOR, "");
  return trimmed.length < root.length ? root : trimmed;
}

function withTrailingSeparator(projectPath) {
  const normalized = normalizeProjectPath(projectPath);
  return normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
}

class RecentList {
  constructor() {
    this.items = [];
    this.destroyed = false;
    this.historyMutationCount = 0;
    this.historyChangedDuringMutation = false;
    this.selectListHost = null;
    this.selectList = null;
    this.disposables = new CompositeDisposable();
    this.disposables.add(
      lumine.history.onDidChangeProjects(() => {
        if (this.destroyed) return;
        if (this.historyMutationCount > 0) {
          this.historyChangedDuringMutation = true;
          return;
        }
        if (this.selectListHost?.isVisible()) this.selectList.reload();
      }),
      lumine.commands.add("lumine-workspace", {
        "recent-list:toggle": () => this.toggle(),
      }),
    );
  }

  ensureSelectList() {
    if (this.destroyed) return null;
    if (this.selectListHost) return this.selectListHost;

    const selectListOptions = {
      emptyMessage: "No matches found",
      items: [],
      getItemId: (item) => this.projectId(item),
      search: { filter: (items, query) => this.filter(items, query) },
      renderItem: (item, options) =>
        this.renderItem(item, options, this.selectList?.getQuery() ?? ""),
      source: {
        mode: "snapshot",
        loadingMessage: "Loading recent projects…",
        load: () => this.loadItems(),
      },
      commands: {
        "recent-list:open-in-new-window": {
          description: "Open the project in a new window.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "open-in-new-window"),
        },
        "recent-list:open-in-this-window": {
          description: "Open the project here, restoring the editors it was last left with.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "open-in-this-window"),
        },
        "recent-list:add-to-project": {
          description: "Add the project paths to the folders of the current window.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "add-to-project"),
        },
        "recent-list:insert-paths": {
          description: "Insert the project paths into the active editor.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "insert-paths"),
        },
        "recent-list:open-in-dev-mode": {
          description: "Open the project in a new window in dev mode.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "open-in-dev-mode"),
        },
        "recent-list:open-in-safe-mode": {
          description: "Open the project in a new window in safe mode.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "open-in-safe-mode"),
        },
        "recent-list:refresh": {
          description: "Read the recent projects from the history again.",
          didDispatch: () => this.refresh(),
        },
        "recent-list:open-external": {
          description: "Open each project folder in the default external program.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "open-external"),
        },
        "recent-list:show-in-folder": {
          description: "Show each project folder in the system file manager.",
          didDispatch: ({ detail }) => this.performAction(detail.item, "show-in-folder"),
        },
        "recent-list:remove-from-history": {
          description: "Remove the project from the history, keeping the list open.",
          didDispatch: ({ detail }) => this.deleteSelected(detail.item),
        },
      },
      actions: this.projectActions(),
    };
    this.selectListHost = lumine.workspace.addSelectList(selectListOptions, {
      className: "recent-list",
      crumb: "Recent",
    });
    this.selectList = this.selectListHost.getModel();
    return this.selectListHost;
  }

  projectActions() {
    const itemAction = (command, group, options = {}) => ({
      command,
      context: "item",
      group,
      disposition: "close",
      dispatch: "local",
      ...options,
    });
    return [
      itemAction("recent-list:open-in-new-window", "Open", { primary: true }),
      itemAction("recent-list:open-in-this-window", "Open"),
      itemAction("recent-list:open-in-dev-mode", "Open"),
      itemAction("recent-list:open-in-safe-mode", "Open"),
      itemAction("recent-list:open-external", "Open", {
        enabled: () => Boolean(this.openExternalService),
        disabledReason: "The open-external package is not available.",
      }),
      itemAction("recent-list:show-in-folder", "Open", {
        enabled: () => Boolean(this.openExternalService),
        disabledReason: "The open-external package is not available.",
      }),
      itemAction("recent-list:add-to-project", "Use"),
      itemAction("recent-list:insert-paths", "Use", {
        enabled: () => Boolean(lumine.workspace.getActiveTextEditor()),
        disabledReason: "There is no active text editor.",
      }),
      {
        command: "recent-list:remove-from-history",
        context: "item",
        group: "History",
        disposition: "stay",
        dispatch: "local",
      },
      {
        command: "recent-list:refresh",
        context: "dialog",
        group: "History",
        disposition: "stay",
        dispatch: "local",
      },
      {
        command: "application:clear-project-history",
        context: "dialog",
        group: "History",
        disposition: "stay",
        dispatch: "workspace",
        when: () => lumine.history.getProjects().length > 0,
      },
    ];
  }

  setOpenExternalService(service) {
    this.openExternalService = service;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disposables.dispose();
    this.selectListHost?.destroy();
    this.selectListHost = null;
    this.selectList = null;
  }

  toggle() {
    this.ensureSelectList()?.toggle();
  }

  projectId(item) {
    return JSON.stringify(item.originalPaths);
  }

  refresh() {
    this.ensureSelectList();
    return this.selectList?.reload();
  }

  loadItems() {
    this.items = lumine.history.getProjects().map((project) => ({
      paths: [...new Set(project.paths.map(withTrailingSeparator))],
      // History removal uses its exact original spelling and folder order.
      originalPaths: project.paths.slice(),
    }));
    return this.items;
  }

  filter(items, query) {
    for (const item of items) {
      item.score = 0;
      item.ibest = -1;
      item.matchIndices = null;
    }
    if (query.length === 0) {
      return items;
    }
    const scoredItems = [];
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      for (let i = 0; i < item.paths.length; i++) {
        const result = lumine.tools.fuzzyMatcher.match(item.paths[i], query, {
          recordMatchIndexes: true,
          algorithm: "command-t", // Path-aware matching
          ignoreDiacritics: true,
        });
        if (result && result.score > item.score) {
          item.score = result.score;
          item.ibest = i;
          // Expanding folds such as ß → ss can match one character twice.
          item.matchIndices = completeMatchIndices(item.paths[i], result.matchIndexes);
        }
      }
      if (item.score > 0) {
        // Recency bonus: earlier items in history are more recent
        const recencyBonus = 1 + (items.length - idx) / (items.length * 10);
        // Depth bonus: shallower paths are often more important
        const bestPath = item.paths[item.ibest] || item.paths[0];
        const depth = (bestPath.match(SEPARATORS) || []).length;
        const depthBonus = 1 / Math.sqrt(depth || 1);
        item.score *= recencyBonus * depthBonus;
        scoredItems.push(item);
      }
    }
    return scoredItems.sort((a, b) => b.score - a.score);
  }

  renderItem(item, { highlight }, query) {
    // SelectList deliberately skips custom filtering for an empty query.
    // Rendering must therefore discard highlights from the preceding search.
    if (query === "") {
      item.score = 0;
      item.ibest = -1;
      item.matchIndices = null;
    }
    // Indices come from this package's own filter(), not the built-in matcher,
    // so they are passed explicitly rather than left to highlight's default.
    const indices = item.matchIndices || [];
    const li = document.createElement("li");

    for (let i = 0; i < item.paths.length; i++) {
      const line = document.createElement("div");
      line.classList.add("primary-line");
      lumine.icons.applyTo(
        line,
        {
          path: item.paths[i],
          context: "recent-list",
          hints: { directory: true },
        },
        { setData: false },
      );
      if (i > 0) {
        line.classList.add("icon-line");
      }
      if (i === item.ibest && indices.length > 0) {
        line.appendChild(highlight(item.paths[i], indices));
      } else {
        line.textContent = item.paths[i];
      }
      li.appendChild(line);
    }

    return li;
  }

  performAction(item, mode = "open-in-new-window") {
    if (this.destroyed || !item) return false;
    const data = this.prepareData(item);
    if (!data.pathsToOpen.length) {
      return false;
    }
    if (mode === "open-in-new-window") {
      lumine.application.openWindow({ ...data, newWindow: true });
    } else if (mode === "open-in-dev-mode") {
      lumine.application.openWindow({ ...data, newWindow: true, devMode: true });
    } else if (mode === "open-in-safe-mode") {
      lumine.application.openWindow({ ...data, newWindow: true, safeMode: true });
    } else if (mode === "open-in-this-window") {
      // A partial folder set has a different session key from this history entry.
      if (data.errs.length) return false;
      return lumine.project.setState(data.pathsToOpen);
    } else if (mode === "add-to-project") {
      lumine.project.addPaths(data.pathsToOpen, { mustExist: true });
    } else if (mode === "open-external") {
      if (!this.openExternalService) {
        lumine.notifications.addWarning("The `open-external` package is not available");
        return false;
      }
      for (let projectPath of data.pathsToOpen) {
        this.openExternalService.openExternal(projectPath);
      }
    } else if (mode === "show-in-folder") {
      if (!this.openExternalService) {
        lumine.notifications.addWarning("The `open-external` package is not available");
        return false;
      }
      for (let projectPath of data.pathsToOpen) {
        this.openExternalService.showInFolder(projectPath);
      }
    } else if (mode === "insert-paths") {
      const editor = lumine.workspace.getActiveTextEditor();
      // No editor behind the picker is already on screen, and nothing failed.
      if (!editor) return false;
      editor.insertText(data.pathsToOpen.join("\n"), { selection: true });
    }
    return true;
  }

  async deleteSelected(item) {
    if (this.destroyed || !item || !this.selectList) return;
    const model = this.selectList;
    const currentIdx = Math.max(model.getSelectedIndex(), 0);
    const scrollTop = model.getScrollTop();
    const query = model.getQuery();
    const selected = model.getSelectedItem();
    const selectedId = selected ? this.projectId(selected) : null;
    const isCurrent = () => !this.destroyed && !model.destroyed && this.selectList === model;
    this.historyMutationCount++;
    try {
      // Persist the requested removal even if the package closes in the meantime.
      // The history event is coalesced with this update so it cannot reset selection.
      await lumine.history.removeProject(item.originalPaths);
      if (!isCurrent()) return;
      const currentSelection = model.getSelectedItem();
      const preservePosition =
        model.getQuery() === query &&
        (currentSelection ? this.projectId(currentSelection) : null) === selectedId;
      // This snapshot consumes all history events seen so far. A later event
      // while the rows render must still publish a fresh snapshot in finally.
      this.historyChangedDuringMutation = false;
      const updating = model.setItems(this.loadItems());
      let selecting;
      if (preservePosition && model.getQuery() === query) {
        const length = model.getFilteredItems().length;
        if (length > 0) selecting = model.selectIndex(Math.min(currentIdx, length - 1));
      }
      const intendedSelection = model.getSelectedItem();
      const intendedId = intendedSelection ? this.projectId(intendedSelection) : null;
      await Promise.all([updating, selecting]);
      if (!isCurrent()) return;
      const latestSelection = model.getSelectedItem();
      if (
        preservePosition &&
        model.getQuery() === query &&
        (latestSelection ? this.projectId(latestSelection) : null) === intendedId
      ) {
        model.setScrollTop(scrollTop);
      }
    } finally {
      this.historyMutationCount--;
      if (this.historyMutationCount === 0 && this.historyChangedDuringMutation) {
        this.historyChangedDuringMutation = false;
        if (isCurrent() && this.selectListHost.isVisible()) {
          await model.setItems(this.loadItems());
        }
      }
    }
  }

  prepareData(item) {
    const pathsToOpen = [];
    const errs = [];
    for (let projectPath of item.paths) {
      try {
        if (!fs.statSync(projectPath).isDirectory()) throw new Error("Not a directory");
        pathsToOpen.push(normalizeProjectPath(projectPath));
      } catch {
        errs.push(projectPath);
      }
    }
    if (errs.length) {
      lumine.notifications.addError("Project directory is unavailable", {
        detail: errs.join("\n"),
      });
    }
    return { pathsToOpen, errs };
  }
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "recent-list",
      tips: [
        "You can reopen a project you worked on earlier with {{ 'recent-list:toggle' | keystroke }}",
      ],
    };
  },

  activate() {
    this.recentList = new RecentList();
  },

  deactivate() {
    this.recentList.destroy();
  },

  provideRecentList() {
    const recentList = this.recentList;
    return {
      toggle: () => recentList.toggle(),
    };
  },

  consumeOpenExternal(service) {
    const recentList = this.recentList;
    recentList.setOpenExternalService(service);
    return new Disposable(() => {
      if (recentList.openExternalService === service) recentList.setOpenExternalService(null);
    });
  },
};
