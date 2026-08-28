const { Disposable, CompositeDisposable } = require("lumine");
const path = require("path");
const fs = require("fs");

class RecentList {
  constructor() {
    this.items = [];
    this.restart = true;
    this.selectList = lumine.workspace.buildSelectList({
      className: "recent-list",
      crumb: "Recent",
      emptyMessage: "No matches found",
      removeDiacritics: true,
      elementForItem: (item, options) => this.elementForItem(item, options),
      didConfirmSelection: () => this.performAction("open-in-new-window"),
      didCancelSelection: () => this.didCancelSelection(),
      willShow: () => this.onWillShow(),
      filter: (items, query) => this.filter(items, query),
    });
    this.disposables = new CompositeDisposable();
    this.disposables.add(
      lumine.history.onDidChangeProjects(() => {
        this.restart = true;
      }),
      lumine.commands.add("lumine-workspace", {
        "recent-list:toggle": () => this.toggle(),
      }),
      // Registered in the package's own namespace: the item-actions list
      // derives its rows — label, description, keybinding — from these
      // registrations and the keymap, so nothing is documented twice. Every
      // description says something the humanized command name does not.
      lumine.commands.add(this.selectList.element, {
        "recent-list:open-in-new-window": {
          description: "Open the project in a new window.",
          didDispatch: () => this.performAction("open-in-new-window"),
        },
        "recent-list:open-in-this-window": {
          description: "Open the project here, restoring the editors it was last left with.",
          didDispatch: () => this.performAction("open-in-this-window"),
        },
        "recent-list:add-to-project": {
          description: "Add the project paths to the folders of the current window.",
          didDispatch: () => this.performAction("add-to-project"),
        },
        "recent-list:insert-paths": {
          description: "Insert the project paths into the active editor.",
          didDispatch: () => this.performAction("insert-paths"),
        },
        "recent-list:open-in-dev-mode": {
          description: "Open the project in a new window in dev mode.",
          didDispatch: () => this.performAction("open-in-dev-mode"),
        },
        "recent-list:open-in-safe-mode": {
          description: "Open the project in a new window in safe mode.",
          didDispatch: () => this.performAction("open-in-safe-mode"),
        },
        "recent-list:refresh": {
          description: "Read the recent projects from the history again.",
          actionScope: "list",
          didDispatch: () => this.refresh(),
        },
        "recent-list:open-external": {
          description: "Open each project folder in the default external program.",
          didDispatch: () => this.performAction("open-external"),
        },
        "recent-list:show-in-folder": {
          description: "Show each project folder in the system file manager.",
          didDispatch: () => this.performAction("show-in-folder"),
        },
        "recent-list:remove-from-history": {
          description: "Remove the project from the history, keeping the list open.",
          didDispatch: () => this.deleteSelected(),
        },
      }),
    );
  }

  setOpenExternalService(service) {
    this.openExternalService = service;
  }

  destroy() {
    this.disposables.dispose();
    this.selectList.destroy();
  }

  toggle() {
    this.selectList.toggle();
  }

  updateItems() {
    this.selectList.update({
      items: this.items,
      loadingMessage: null,
    });
  }

  updateLoadingMessage() {
    this.selectList.update({
      items: [],
      loadingMessage: "Indexing project\u2026",
    });
  }

  onWillShow() {
    if (this.restart) {
      this.restart = false;
      this.items = [];
      this.updateLoadingMessage();
      this.cache().then(() => {
        this.updateItems();
      });
    }
  }

  refresh() {
    this.restart = true;
    this.onWillShow();
  }

  cache() {
    return new Promise((resolve) => {
      for (let project of lumine.history.getProjects()) {
        this.items.push({
          paths: project.paths.map((ppath) => {
            return (
              ppath
                .replace(/[\\/]+$/, "")
                .split(/[\\/]/g)
                .join(path.sep) + path.sep
            );
          }),
          texts: project.paths.map((ppath) => {
            return lumine.tools.removeDiacritics(
              ppath
                .replace(/[\\/]+$/, "")
                .split(/[\\/]/g)
                .join(path.sep) + path.sep,
            );
          }),
          originalPaths: project.paths,
        });
      }
      resolve();
    });
  }

  filter(items, query) {
    query = lumine.tools.removeDiacritics(query);
    if (query.length === 0) {
      return items;
    }
    const scoredItems = [];
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      item.score = 0;
      item.matchIndices = null;
      for (let i = 0; i < item.texts.length; i++) {
        const result = lumine.tools.fuzzyMatcher.match(item.texts[i], query, {
          recordMatchIndexes: true,
          algorithm: "command-t", // Path-aware matching
        });
        if (result && result.score > item.score) {
          item.score = result.score;
          item.ibest = i;
          item.matchIndices = result.matchIndexes;
        }
      }
      if (item.score > 0) {
        // Recency bonus: earlier items in history are more recent
        const recencyBonus = 1 + (items.length - idx) / (items.length * 10);
        // Depth bonus: shallower paths are often more important
        const bestPath = item.paths[item.ibest] || item.paths[0];
        const depth = (bestPath.match(/[\\/]/g) || []).length;
        const depthBonus = 1 / Math.sqrt(depth || 1);
        item.score *= recencyBonus * depthBonus;
        scoredItems.push(item);
      }
    }
    return scoredItems.sort((a, b) => b.score - a.score);
  }

  elementForItem(item, { highlight }) {
    // Indices come from this package's own filter(), not the built-in matcher,
    // so they are passed explicitly rather than left to highlight's default.
    const indices = item.matchIndices || [];
    const li = document.createElement("li");

    for (let i = 0; i < item.paths.length; i++) {
      const line = document.createElement("div");
      line.classList.add("primary-line", "icon", "icon-file-directory");
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

  performAction(mode) {
    if (!mode) {
      mode = "open-in-new-window";
    }
    let item = this.selectList.getSelectedItem();
    if (!item) {
      return;
    } else {
      this.selectList.hide();
    }
    const data = this.prepareData(item);
    if (!data.pathsToOpen.length) {
      return;
    }
    if (mode === "open-in-new-window") {
      lumine.application.openWindow({ ...data, newWindow: true });
    } else if (mode === "open-in-dev-mode") {
      lumine.application.openWindow({ ...data, newWindow: true, devMode: true });
    } else if (mode === "open-in-safe-mode") {
      lumine.application.openWindow({ ...data, newWindow: true, safeMode: true });
    } else if (mode === "open-in-this-window") {
      lumine.project.setState(data.pathsToOpen);
    } else if (mode === "add-to-project") {
      for (let projectPath of data.pathsToOpen) {
        lumine.project.addPath(projectPath, { mustExist: true });
      }
    } else if (mode === "open-external") {
      if (!this.openExternalService) {
        lumine.notifications.addWarning("The `open-external` package is not available");
        return;
      }
      for (let projectPath of data.pathsToOpen) {
        this.openExternalService.openExternal(projectPath);
      }
    } else if (mode === "show-in-folder") {
      if (!this.openExternalService) {
        lumine.notifications.addWarning("The `open-external` package is not available");
        return;
      }
      for (let projectPath of data.pathsToOpen) {
        this.openExternalService.showInFolder(projectPath);
      }
    } else if (mode === "insert-paths") {
      const editor = lumine.workspace.getActiveTextEditor();
      // No editor behind the picker is already on screen, and nothing failed.
      if (!editor) return;
      editor.insertText(data.pathsToOpen.join("\n"), { selection: true });
    }
  }

  async deleteSelected() {
    const item = this.selectList.getSelectedItem();
    if (!item) return;
    const currentIdx = this.selectList.selectionIndex ?? 0;
    const scrollEl = this.selectList.refs.items;
    const scrollTop = scrollEl?.scrollTop ?? 0;
    const newFilteredLength = this.selectList.items.length - 1;
    const clampedIdx = newFilteredLength > 0 ? Math.min(currentIdx, newFilteredLength - 1) : 0;
    const idx = this.items.indexOf(item);
    if (idx !== -1) {
      this.items.splice(idx, 1);
    }
    await this.selectList.update({
      items: this.items,
      loadingMessage: null,
      initialSelectionIndex: clampedIdx,
    });
    if (scrollEl) scrollEl.scrollTop = scrollTop;
    lumine.history.removeProject(item.originalPaths);
  }

  didCancelSelection() {
    this.selectList.hide();
  }

  prepareData(item) {
    const pathsToOpen = [];
    const errs = [];
    for (let projectPath of item.paths) {
      if (fs.existsSync(projectPath) && fs.lstatSync(projectPath).isDirectory()) {
        pathsToOpen.push(projectPath.replace(/[\\/]+$/, ""));
      } else {
        errs.push(projectPath);
      }
    }
    if (errs.length) {
      lumine.notifications.addError("Directory does not exist", {
        detail: errs.join("\n"),
      });
    }
    return { pathsToOpen };
  }
}

module.exports = {
  activate() {
    this.recentList = new RecentList();
  },

  deactivate() {
    this.recentList.destroy();
  },

  provideRecentList() {
    return {
      toggle: () => this.recentList.toggle(),
    };
  },

  consumeOpenExternal(service) {
    this.recentList.setOpenExternalService(service);
    return new Disposable(() => {
      this.recentList.setOpenExternalService(null);
    });
  },
};
