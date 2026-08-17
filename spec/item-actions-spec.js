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

    // Every action explains itself with more than a restated title.
    for (const action of actions) {
      expect(action.description).toBeTruthy();
    }

    // Chrome and global commands stay out.
    expect(byCommand.has("core:confirm")).toBe(false);
    expect(byCommand.has("select-list:actions")).toBe(false);
    expect(byCommand.has("recent-list:toggle")).toBe(false);
  });

  it("shows the actions as a flow step and runs one against the master list", async () => {
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
