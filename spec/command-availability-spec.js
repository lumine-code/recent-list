describe("Recent picker insertion availability", () => {
  let view, editor;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const main = (await lumine.packages.activatePackage("recent-list")).mainModule;
    view = main.forWindow(lumine.workspace.getMainWindow());
    editor = await lumine.workspace.open();
  });
  it("requires a live editable captured editor", () => {
    const action = view
      .projectActions()
      .find((action) => action.command === "recent-list:insert-paths");
    view.openingEditor = null;
    expect(action.enabled()).toBe(false);
    view.openingEditor = editor;
    expect(action.enabled()).toBe(true);
    editor.setReadOnly(true);
    expect(action.enabled()).toBe(false);
  });
});
