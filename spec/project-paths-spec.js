const fs = require("fs");
const os = require("os");
const path = require("path");

describe("recent-list project paths", () => {
  let list, fixtureRoot, fixtureParent;

  beforeEach(async () => {
    fixtureParent = fs.realpathSync.native(os.tmpdir());
    fixtureRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(fixtureParent, "recent-list-paths-")),
    );
    const pack = await lumine.packages.activatePackage("recent-list");
    list = pack.mainModule.recentList;
  });

  afterEach(async () => {
    try {
      await lumine.packages.deactivatePackage("recent-list");
    } finally {
      removeFixture();
    }
  });

  function removeFixture() {
    const relative = path.relative(fixtureParent, fixtureRoot);
    if (
      !path.isAbsolute(fixtureRoot) ||
      !relative ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative) ||
      !path.basename(fixtureRoot).startsWith("recent-list-paths-")
    ) {
      throw new Error("The recent-list fixture escaped its temporary directory.");
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }

  function loadProject(paths) {
    spyOn(lumine.history, "getProjects").and.returnValue([{ paths }]);
    return list.loadItems()[0];
  }

  it("keeps a filesystem root absolute when loading and opening a recent project", async () => {
    const root = path.parse(fixtureRoot).root;
    const item = loadProject([root]);
    spyOn(lumine.project, "setState").and.resolveTo(true);

    expect(item.paths).toEqual([root]);
    expect(list.prepareData(item)).toEqual({ pathsToOpen: [root], errs: [] });
    expect(await list.performAction(item, "open-in-this-window")).toBe(true);
    expect(lumine.project.setState).toHaveBeenCalledWith([root]);
  });

  it("normalizes dot segments and repeated roots without duplicating open paths", () => {
    const dotted = `${fixtureRoot}${path.sep}.${path.sep}child${path.sep}..${path.sep}`;
    const item = loadProject([dotted, fixtureRoot, fixtureRoot + path.sep]);

    expect(item.paths).toEqual([fixtureRoot + path.sep]);
    expect(list.prepareData(item)).toEqual({ pathsToOpen: [fixtureRoot], errs: [] });
  });

  if (process.platform === "win32") {
    it("normalizes a lowercase drive letter from history", () => {
      if (!/^[A-Z]:/.test(fixtureRoot)) {
        pending("The temporary directory does not use a drive letter.");
        return;
      }
      const lowercase = fixtureRoot[0].toLowerCase() + fixtureRoot.slice(1);
      const item = loadProject([lowercase, fixtureRoot]);

      expect(item.paths).toEqual([fixtureRoot + path.sep]);
      expect(list.prepareData(item)).toEqual({ pathsToOpen: [fixtureRoot], errs: [] });
    });
  } else {
    it("preserves a literal trailing backslash in a recent directory name", () => {
      const literal = path.join(fixtureRoot, "literal") + "\\";
      fs.mkdirSync(literal);
      const item = loadProject([literal]);

      expect(item.paths).toEqual([literal + path.sep]);
      expect(list.prepareData(item)).toEqual({ pathsToOpen: [literal], errs: [] });
    });
  }

  it("copies the exact history paths while normalizing the paths used to open", () => {
    const originalPaths = [fixtureRoot + path.sep, `${fixtureRoot}${path.sep}.${path.sep}`];
    const item = loadProject(originalPaths);

    expect(item.originalPaths).toEqual(originalPaths);
    expect(item.originalPaths).not.toBe(originalPaths);
    expect(list.projectId(item)).toBe(JSON.stringify(originalPaths));
    expect(item.paths).toEqual([fixtureRoot + path.sep]);
    originalPaths.push(path.join(fixtureRoot, "later"));
    expect(item.originalPaths.length).toBe(2);
  });

  it("removes a normalized entry from history using its original paths", async () => {
    const originalPaths = [fixtureRoot + path.sep, `${fixtureRoot}${path.sep}.${path.sep}`];
    const item = loadProject(originalPaths);
    spyOn(lumine.history, "removeProject").and.callFake(async () => {
      lumine.history.getProjects.and.returnValue([]);
    });
    list.ensureSelectList();
    await list.selectList.setItems([item]);

    await list.deleteSelected(item);

    expect(lumine.history.removeProject).toHaveBeenCalledWith(originalPaths);
    expect(list.items).toEqual([]);
  });

  it("accepts a directory link without requiring a trailing separator", () => {
    const target = path.join(fixtureRoot, "target");
    const link = path.join(fixtureRoot, "link");
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

    expect(list.prepareData({ paths: [link] })).toEqual({ pathsToOpen: [link], errs: [] });
  });

  it("reports unavailable directories while retaining valid paths for other actions", () => {
    const missing = path.join(fixtureRoot, "missing");
    spyOn(lumine.notifications, "addError");

    expect(list.prepareData({ paths: [fixtureRoot, missing] })).toEqual({
      pathsToOpen: [fixtureRoot],
      errs: [missing],
    });
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });

  it("rejects an existing file as a project directory", () => {
    const file = path.join(fixtureRoot, "loose.txt");
    fs.writeFileSync(file, "Not a directory.\n");
    spyOn(lumine.notifications, "addError");

    expect(list.prepareData({ paths: [file] })).toEqual({ pathsToOpen: [], errs: [file] });
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });

  it("reports a filesystem access failure instead of throwing from validation", () => {
    const originalStat = fs.statSync;
    spyOn(fs, "statSync").and.callFake((target, ...args) => {
      if (target === fixtureRoot) throw new Error("Access denied");
      return originalStat(target, ...args);
    });
    spyOn(lumine.notifications, "addError");

    expect(list.prepareData({ paths: [fixtureRoot] })).toEqual({
      pathsToOpen: [],
      errs: [fixtureRoot],
    });
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });

  it("refuses to switch this window to only the surviving part of a project", () => {
    const missing = path.join(fixtureRoot, "missing");
    const item = loadProject([fixtureRoot, missing]);
    spyOn(lumine.project, "setState").and.resolveTo(true);
    spyOn(lumine.application, "openWindow");
    spyOn(lumine.notifications, "addError");

    expect(list.performAction(item, "open-in-this-window")).toBe(false);
    expect(lumine.project.setState).not.toHaveBeenCalled();
    expect(lumine.application.openWindow).not.toHaveBeenCalled();
    expect(lumine.notifications.addError).toHaveBeenCalled();
  });
});
