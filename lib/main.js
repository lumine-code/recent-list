const { Disposable, CompositeDisposable } = require("lumine");
const path = require("path");
const fs = require("fs");

class RecentList {
  constructor() {
    this.items = [];
    this.selectList = lumine.workspace.buildSelectList({
      className: "recent-list",
      crumb: "Recent",
      emptyMessage: "No matches found",
      items: [],
      getItemId: (item) => this.projectId(item),
      search: { filter: (items, query) => this.filter(items, query) },
      renderItem: (item, options) => this.renderItem(item, options),
      source: {
        mode: "snapshot",
        loadingMessage: "Indexing project…",
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
    });
    this.disposables = new CompositeDisposable();
    this.disposables.add(
      lumine.history.onDidChangeProjects(() => {
        if (this.selectList.isVisible()) this.selectList.reload();
      }),
      lumine.commands.add("lumine-workspace", {
        "recent-list:toggle": () => this.toggle(),
      }),
    );
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
    this.disposables.dispose();
    this.selectList.destroy();
  }

  toggle() {
    this.selectList.toggle();
  }

  projectId(item) {
    return JSON.stringify(item.originalPaths);
  }

  refresh() {
    return this.selectList.reload();
  }

  loadItems() {
    this.items = lumine.history.getProjects().map((project) => ({
      paths: project.paths.map(
        (projectPath) =>
          projectPath
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/g)
            .join(path.sep) + path.sep,
      ),
      texts: project.paths.map((projectPath) =>
        lumine.tools.removeDiacritics(
          projectPath
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/g)
            .join(path.sep) + path.sep,
        ),
      ),
      originalPaths: project.paths,
    }));
    return this.items;
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

  renderItem(item, { highlight }) {
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
    if (!item) return false;
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
      lumine.project.setState(data.pathsToOpen);
    } else if (mode === "add-to-project") {
      for (let projectPath of data.pathsToOpen) {
        lumine.project.addPath(projectPath, { mustExist: true });
      }
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
    if (!item) return;
    const currentIdx = Math.max(this.selectList.getSelectedIndex(), 0);
    const scrollTop = this.selectList.getScrollTop();
    const newFilteredLength = this.selectList.getFilteredItems().length - 1;
    const clampedIdx = newFilteredLength > 0 ? Math.min(currentIdx, newFilteredLength - 1) : 0;
    const idx = this.items.indexOf(item);
    if (idx !== -1) {
      this.items.splice(idx, 1);
    }
    await this.selectList.setItems(this.items);
    if (this.selectList.getDisplayedItems().length > 0) {
      await this.selectList.selectIndex(clampedIdx);
    }
    this.selectList.setScrollTop(scrollTop);
    await lumine.history.removeProject(item.originalPaths);
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
