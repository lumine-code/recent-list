const path = require("path");

describe("recent-list item actions", () => {
  let main, list;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    // No activation commands here, so a plain activation resolves; it also
    // loads the package keymap the actions list reads.
    main = (await lumine.packages.activatePackage("recent-list")).mainModule;
    list = main.recentList;
    list.ensureSelectList();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("recent-list");
  });

  it("describes its declared actions through the command registry and keymap", async () => {
    list.selectListHost.getPanel();
    const item = {
      paths: [__dirname + path.sep],
      texts: [__dirname],
      originalPaths: [__dirname],
    };
    await list.selectList.setItems([item]);
    const getProjects = spyOn(lumine.history, "getProjects").and.returnValue([
      { paths: [__dirname] },
    ]);
    const actions = list.selectList.getAvailableActions();
    const byCommand = new Map(actions.map((action) => [action.command, action]));

    const here = byCommand.get("recent-list:open-in-this-window");
    expect(here.name).toBe("Open In This Window");
    expect(here.description).toBe(
      "Open the project here, restoring the editors it was last left with.",
    );
    expect(here.keystrokes).toEqual(["alt-enter"]);

    expect(byCommand.get("recent-list:add-to-project").keystrokes).toEqual(["shift-enter"]);
    expect(byCommand.get("recent-list:remove-from-history").keystrokes).toEqual(["alt-delete"]);
    expect(byCommand.get("recent-list:open-in-new-window").keystrokes).toEqual(["enter"]);

    const clear = byCommand.get("application:clear-project-history");
    expect(clear.description).toBe("Forget the projects offered by the Reopen Project menu.");
    expect(clear.context).toBe("dialog");

    // Every action explains itself with more than a restated title.
    for (const action of actions) {
      expect(action.description).toBeTruthy();
    }

    // Chrome and global commands stay out.
    expect(byCommand.has("core:confirm")).toBe(false);
    expect(byCommand.has("select-list:actions")).toBe(false);
    expect(byCommand.has("recent-list:toggle")).toBe(false);

    await list.selectList.selectNone();
    expect(list.selectList.getAvailableActions().map(({ command }) => command)).toEqual([
      "recent-list:refresh",
      "application:clear-project-history",
    ]);

    getProjects.and.returnValue([]);
    expect(list.selectList.getAvailableActions().map(({ command }) => command)).toEqual([
      "recent-list:refresh",
    ]);
  });

  it("refreshes an open picker as soon as project history changes", () => {
    spyOn(list.selectListHost, "isVisible").and.returnValue(true);
    const spy = spyOn(list.selectList, "reload");

    lumine.history.didChangeProjects();

    expect(spy).toHaveBeenCalled();
  });

  it("shows the centralized actions picker and runs an action on the model", async () => {
    spyOn(lumine.history, "getProjects").and.returnValue([{ paths: [__dirname] }]);
    await list.selectListHost.show();
    const item = list.selectList.getSelectedItem();

    expect(await list.selectListHost.showActions()).toBe(true);

    expect(lumine.workspace.getModalTrail()).toEqual(["Recent", "Actions"]);
    expect(lumine.workspace.popModal()).toBe(true);

    const spy = spyOn(list, "performAction").and.returnValue(true);
    await list.selectList.runAction("recent-list:add-to-project");

    expect(spy).toHaveBeenCalledWith(item, "add-to-project");
    expect(list.selectListHost.isVisible()).toBeFalse();
  });

  it("hands the paths to the project when opening in this window", () => {
    spyOn(lumine.project, "setState");
    spyOn(lumine.application, "openWindow");
    spyOn(lumine.window, "close");
    const item = { paths: [__dirname] };

    list.performAction(item, "open-in-this-window");

    expect(lumine.project.setState).toHaveBeenCalledWith([__dirname]);
    expect(lumine.application.openWindow).not.toHaveBeenCalled();
    expect(lumine.window.close).not.toHaveBeenCalled();
  });

  describe("opening in this window", () => {
    beforeEach(() => {
      spyOn(lumine.project, "setState").and.resolveTo(true);
      spyOn(lumine.application, "openWindow");
    });

    async function showProject() {
      spyOn(lumine.history, "getProjects").and.returnValue([{ paths: [__dirname] }]);
      await list.selectListHost.show();
      return list.selectList.getSelectedItem();
    }

    it("forwards the pending switch promise and its cancellation result", async () => {
      let finish;
      const switching = new Promise((resolve) => (finish = resolve));
      lumine.project.setState.and.returnValue(switching);

      const result = list.performAction({ paths: [__dirname] }, "open-in-this-window");

      expect(result).toBe(switching);
      finish(false);
      expect(await result).toBe(false);
    });

    it("propagates a restoration failure", async () => {
      const error = new Error("Unable to restore this project");
      lumine.project.setState.and.rejectWith(error);

      await expectAsync(
        list.performAction({ paths: [__dirname] }, "open-in-this-window"),
      ).toBeRejectedWith(error);
    });

    it("waits for the switch and deduplicates repeated picker actions", async () => {
      let finish;
      lumine.project.setState.and.returnValue(new Promise((resolve) => (finish = resolve)));
      await showProject();

      const first = list.selectList.runAction("recent-list:open-in-this-window");
      const second = list.selectList.runAction("recent-list:open-in-this-window");
      await conditionPromise(() => lumine.project.setState.calls.count() === 1);

      expect(list.selectListHost.isVisible()).toBeTrue();
      finish(true);
      await Promise.all([first, second]);
      expect(lumine.project.setState).toHaveBeenCalledTimes(1);
      expect(list.selectListHost.isVisible()).toBeFalse();
    });

    it("returns an unchanged-window result and applies the picker's close disposition", async () => {
      lumine.project.setState.and.resolveTo(false);
      spyOn(lumine.window, "close");
      await showProject();

      const completed = await list.selectList.runAction("recent-list:open-in-this-window");

      expect(completed.status).toBe("success");
      expect(completed.value).toEqual([false]);
      expect(lumine.project.setState).toHaveBeenCalledOnceWith([__dirname]);
      expect(lumine.application.openWindow).not.toHaveBeenCalled();
      expect(lumine.window.close).not.toHaveBeenCalled();
      expect(list.selectListHost.isVisible()).toBeFalse();
    });

    it("keeps the picker open when restoration fails", async () => {
      const error = new Error("Project restoration failed");
      lumine.project.setState.and.rejectWith(error);
      await showProject();

      await expectAsync(
        list.selectList.runAction("recent-list:open-in-this-window"),
      ).toBeRejectedWith(error);

      expect(list.selectListHost.isVisible()).toBeTrue();
    });

    it("dispatches alt-enter from the picker's mini editor", async () => {
      await showProject();
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "target", {
        value: list.selectList.getQueryEditor().getElement(),
      });

      lumine.keymaps.handleKeyboardEvent(event);

      await conditionPromise(() => lumine.project.setState.calls.count() === 1);
      expect(lumine.project.setState).toHaveBeenCalledWith([__dirname]);
      expect(lumine.application.openWindow).not.toHaveBeenCalled();
    });
  });

  it("adds all selected project roots in one path change", () => {
    spyOn(lumine.project, "addPaths");
    spyOn(lumine.project, "addPath");
    const roots = [__dirname, path.dirname(__dirname)];

    expect(list.performAction({ paths: roots }, "add-to-project")).toBe(true);

    expect(lumine.project.addPaths).toHaveBeenCalledOnceWith(roots, { mustExist: true });
    expect(lumine.project.addPath).not.toHaveBeenCalled();
  });

  describe("removing a recent project", () => {
    let projects, model, completeRemoval;

    beforeEach(async () => {
      projects = ["outside", "kept-a", "kept-b", "kept-c", "kept-d"].map((name) => ({
        paths: [path.join(__dirname, name)],
      }));
      spyOn(lumine.history, "getProjects").and.callFake(() => projects);
      spyOn(lumine.history, "removeProject").and.callFake(
        (paths) =>
          new Promise((resolve) => {
            completeRemoval = () => {
              projects = projects.filter(
                (project) => !project.paths.every((p) => paths.includes(p)),
              );
              lumine.history.didChangeProjects();
              resolve();
            };
          }),
      );
      await list.selectListHost.show();
      model = list.selectList;
      await model.setQuery("kept");
      await model.selectIndex(1);
    });

    it("coalesces the history event and preserves the filtered position and scroll", async () => {
      const item = model.getSelectedItem();
      const next = model.getFilteredItems()[2];
      spyOn(model, "getScrollTop").and.returnValue(137);
      spyOn(model, "setScrollTop").and.callThrough();
      spyOn(model, "setItems").and.callThrough();
      spyOn(model, "reload").and.callThrough();

      const removal = list.deleteSelected(item);
      expect(model.getSelectedItem()).toBe(item);
      expect(model.setItems).not.toHaveBeenCalled();
      completeRemoval();
      await removal;

      expect(lumine.history.removeProject).toHaveBeenCalledOnceWith(item.originalPaths);
      expect(model.reload).not.toHaveBeenCalled();
      expect(model.setItems).toHaveBeenCalledTimes(1);
      expect(model.getQuery()).toBe("kept");
      expect(model.getSelectedIndex()).toBe(1);
      expect(model.getSelectedItem().originalPaths).toEqual(next.originalPaths);
      expect(model.setScrollTop).toHaveBeenCalledWith(137);
      expect(list.selectListHost.isVisible()).toBeTrue();
    });

    it("selects the preceding filtered row when deleting the last match", async () => {
      await model.selectIndex(model.getFilteredItems().length - 1);
      const item = model.getSelectedItem();
      const previous = model.getFilteredItems().at(-2);

      const removal = list.deleteSelected(item);
      completeRemoval();
      await removal;

      expect(model.getSelectedItem().originalPaths).toEqual(previous.originalPaths);
      expect(model.getSelectedIndex()).toBe(model.getFilteredItems().length - 1);
    });

    it("finishes the history removal after the package is deactivated", async () => {
      const item = model.getSelectedItem();
      spyOn(model, "setItems").and.callThrough();
      spyOn(list, "loadItems").and.callThrough();
      const removal = list.deleteSelected(item);

      await lumine.packages.deactivatePackage("recent-list");
      completeRemoval();
      await removal;

      expect(lumine.history.removeProject).toHaveBeenCalledOnceWith(item.originalPaths);
      expect(projects.some((project) => project.paths[0] === item.originalPaths[0])).toBeFalse();
      expect(list.loadItems).not.toHaveBeenCalled();
      expect(model.setItems).not.toHaveBeenCalled();
    });

    it("finishes the history removal without updating a destroyed picker model", async () => {
      const item = model.getSelectedItem();
      spyOn(model, "setItems").and.callThrough();
      spyOn(list, "loadItems").and.callThrough();
      const removal = list.deleteSelected(item);

      await model.destroy();
      completeRemoval();
      await removal;

      expect(projects.some((project) => project.paths[0] === item.originalPaths[0])).toBeFalse();
      expect(list.loadItems).not.toHaveBeenCalled();
      expect(model.setItems).not.toHaveBeenCalled();
    });

    it("keeps the original rows and selection when history removal fails", async () => {
      const item = model.getSelectedItem();
      const originalRows = model.getFilteredItems().slice();
      const error = new Error("Unable to persist recent-project history");
      lumine.history.removeProject.and.rejectWith(error);
      spyOn(model, "setItems").and.callThrough();
      spyOn(model, "setScrollTop").and.callThrough();

      await expectAsync(list.deleteSelected(item)).toBeRejectedWith(error);

      expect(model.getFilteredItems()).toEqual(originalRows);
      expect(model.getSelectedItem()).toBe(item);
      expect(model.setItems).not.toHaveBeenCalled();
      expect(model.setScrollTop).not.toHaveBeenCalled();
    });

    it("keeps a changed query and its selected result while removal is pending", async () => {
      const item = model.getSelectedItem();
      const removal = list.deleteSelected(item);
      await model.setQuery("kept-d");
      const chosen = model.getSelectedItem();
      spyOn(model, "selectIndex").and.callThrough();
      spyOn(model, "setScrollTop").and.callThrough();

      completeRemoval();
      await removal;

      expect(model.getQuery()).toBe("kept-d");
      expect(model.getSelectedItem().originalPaths).toEqual(chosen.originalPaths);
      expect(model.selectIndex).not.toHaveBeenCalled();
      expect(model.setScrollTop).not.toHaveBeenCalled();
    });

    it("keeps a user's newer selection while removal is pending", async () => {
      const item = model.getSelectedItem();
      const removal = list.deleteSelected(item);
      await model.selectIndex(3);
      const chosen = model.getSelectedItem();
      spyOn(model, "selectIndex").and.callThrough();
      spyOn(model, "setScrollTop").and.callThrough();

      completeRemoval();
      await removal;

      expect(model.getSelectedItem().originalPaths).toEqual(chosen.originalPaths);
      expect(model.selectIndex).not.toHaveBeenCalled();
      expect(model.setScrollTop).not.toHaveBeenCalled();
    });

    it("keeps a user's selection and scroll while the refreshed rows render", async () => {
      const item = model.getSelectedItem();
      const setItems = model.setItems.bind(model);
      let finishRender;
      const pendingRender = new Promise((resolve) => (finishRender = resolve));
      spyOn(model, "setItems").and.callFake((...args) =>
        Promise.all([setItems(...args), pendingRender]),
      );
      spyOn(model, "getScrollTop").and.returnValue(137);
      spyOn(model, "setScrollTop").and.callThrough();

      const removal = list.deleteSelected(item);
      completeRemoval();
      await conditionPromise(() => model.setItems.calls.count() === 1);
      await model.selectIndex(0);
      const chosen = model.getSelectedItem();
      finishRender();
      await removal;

      expect(model.getSelectedItem().originalPaths).toEqual(chosen.originalPaths);
      expect(model.setScrollTop).not.toHaveBeenCalled();
    });

    it("keeps a changed query while the refreshed rows render", async () => {
      const item = model.getSelectedItem();
      const setItems = model.setItems.bind(model);
      let finishRender;
      const pendingRender = new Promise((resolve) => (finishRender = resolve));
      spyOn(model, "setItems").and.callFake((...args) =>
        Promise.all([setItems(...args), pendingRender]),
      );
      spyOn(model, "setScrollTop").and.callThrough();

      const removal = list.deleteSelected(item);
      completeRemoval();
      await conditionPromise(() => model.setItems.calls.count() === 1);
      await model.setQuery("kept-d");
      const chosen = model.getSelectedItem();
      finishRender();
      await removal;

      expect(model.getQuery()).toBe("kept-d");
      expect(model.getSelectedItem().originalPaths).toEqual(chosen.originalPaths);
      expect(model.setScrollTop).not.toHaveBeenCalled();
    });

    it("includes a history change received while the removal's refreshed rows render", async () => {
      const item = model.getSelectedItem();
      const next = model.getFilteredItems()[2];
      const setItems = model.setItems.bind(model);
      let finishRender;
      const pendingRender = new Promise((resolve) => (finishRender = resolve));
      spyOn(model, "setItems").and.callFake((...args) =>
        Promise.all([setItems(...args), pendingRender]),
      );
      spyOn(model, "reload").and.callThrough();

      const removal = list.deleteSelected(item);
      completeRemoval();
      await conditionPromise(() => model.setItems.calls.count() === 1);
      const lateProject = { paths: [path.join(__dirname, "kept-late")] };
      projects = [lateProject, ...projects];
      lumine.history.didChangeProjects();
      finishRender();
      await removal;

      expect(model.getFilteredItems().map((entry) => entry.originalPaths)).toContain(
        lateProject.paths,
      );
      expect(model.setItems).toHaveBeenCalledTimes(2);
      expect(model.reload).not.toHaveBeenCalled();
      expect(model.getQuery()).toBe("kept");
      expect(model.getSelectedItem().originalPaths).toEqual(next.originalPaths);
    });
  });
});
