const path = require("path");

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

  it("describes its declared actions through the command registry and keymap", async () => {
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
    spyOn(list.selectList, "isVisible").and.returnValue(true);
    const spy = spyOn(list.selectList, "reload");

    lumine.history.didChangeProjects();

    expect(spy).toHaveBeenCalled();
  });

  it("shows the centralized actions picker and runs an action on the model", async () => {
    spyOn(lumine.history, "getProjects").and.returnValue([{ paths: [__dirname] }]);
    await list.selectList.show();
    const item = list.selectList.getSelectedItem();

    expect(await list.selectList.showActions()).toBe(true);

    expect(lumine.workspace.getModalTrail()).toEqual(["Recent", "Actions"]);
    expect(lumine.workspace.popModal()).toBe(true);

    const spy = spyOn(list, "performAction").and.returnValue(true);
    await list.selectList.runAction("recent-list:add-to-project");

    expect(spy).toHaveBeenCalledWith(item, "add-to-project");
    expect(list.selectList.isVisible()).toBeFalse();
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
});
