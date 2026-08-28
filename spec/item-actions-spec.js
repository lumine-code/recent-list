describe("recent-list item actions", () => {
  let main, list;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    // No activation commands here, so a plain activation resolves; it also
    // loads the package keymap the actions list reads.
    main = (await lumine.packages.activatePackage("recent-list")).mainModule;
    list = main.recentList;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("recent-list");
  });

  it("derives its actions from the command registrations and the keymap", () => {
    spyOn(list.selectList, "getSelectedItem").and.returnValue({ paths: [__dirname] });
    spyOn(lumine.history, "getProjects").and.returnValue([{ paths: [__dirname] }]);
    const actions = list.selectList.itemActions();
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
    expect(clear.scope).toBe("list");

    // Every action explains itself with more than a restated title.
    for (const action of actions) {
      expect(action.description).toBeTruthy();
    }

    // Chrome and global commands stay out.
    expect(byCommand.has("core:confirm")).toBe(false);
    expect(byCommand.has("select-list:actions")).toBe(false);
    expect(byCommand.has("recent-list:toggle")).toBe(false);
  });

  it("keeps Clear Project History available without a match until history is empty", () => {
    spyOn(list.selectList, "getSelectedItem").and.returnValue(null);
    const getProjects = spyOn(lumine.history, "getProjects").and.returnValue([
      { paths: [__dirname] },
    ]);

    expect(list.selectList.itemActions().map(({ command }) => command)).toEqual([
      "recent-list:refresh",
      "application:clear-project-history",
    ]);

    getProjects.and.returnValue([]);
    expect(list.selectList.itemActions().map(({ command }) => command)).toEqual([
      "recent-list:refresh",
    ]);
  });

  it("refreshes an open picker as soon as project history changes", () => {
    spyOn(list.selectList, "isVisible").and.returnValue(true);
    const spy = spyOn(list, "refresh");

    lumine.history.didChangeProjects();

    expect(spy).toHaveBeenCalled();
  });

  it("shows the actions as a flow step and runs one against the master list", async () => {
    spyOn(list.selectList, "getSelectedItem").and.returnValue({ paths: [__dirname] });
    list.selectList.show();

    await list.selectList.showItemActions();

    expect(list.selectList.itemActionsList.isVisible()).toBeTruthy();
    expect(lumine.workspace.getModalTrail()).toEqual(["Recent", "Actions"]);
    // The actions list wears the package class, so the package keymap
    // resolves action keystrokes inside it too.
    expect(list.selectList.itemActionsList.element.classList.contains("recent-list")).toBe(true);

    const spy = spyOn(list, "performAction");
    const index = list.selectList.itemActionsList.items.findIndex(
      (item) => item.command === "recent-list:add-to-project",
    );
    list.selectList.itemActionsList.selectIndex(index);
    list.selectList.itemActionsList.confirmSelection();

    expect(spy).toHaveBeenCalledWith("add-to-project");
    expect(list.selectList.isVisible()).toBeTruthy();
    expect(list.selectList.itemActionsList.isVisible()).toBeFalsy();
  });

  it("hands the paths to the project when opening in this window", () => {
    spyOn(lumine.project, "setState");
    spyOn(lumine.application, "openWindow");
    spyOn(lumine.window, "close");
    spyOn(list.selectList, "getSelectedItem").and.returnValue({ paths: [__dirname] });

    list.performAction("open-in-this-window");

    expect(lumine.project.setState).toHaveBeenCalledWith([__dirname]);
    expect(lumine.application.openWindow).not.toHaveBeenCalled();
    expect(lumine.window.close).not.toHaveBeenCalled();
  });
});
