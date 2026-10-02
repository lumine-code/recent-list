const path = require("path");
const { Icon } = require("lumine");

describe("recent-list", () => {
  let main, view, list;
  let iconRegistration;

  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("recent-list")).mainModule;
    view = main.recentList;
  });

  afterEach(async () => {
    if (list) await list.destroy();
    list = null;
    iconRegistration?.dispose();
    iconRegistration = null;
    await lumine.packages.deactivatePackage("recent-list");
  });

  // The package computes its own match indices in filter(), so the row renderer
  // passes them to highlight explicitly rather than letting it use the built-in
  // matcher's. Render through a real list to prove that path end to end.
  function renderRow(item) {
    list = lumine.workspace.buildSelectList({
      items: [item],
      getItemId: (i) => JSON.stringify(i.paths),
      search: { getFilterText: (i) => i.paths[0] },
      renderItem: (i, options) => view.renderItem(i, options),
    });
    return list.getElement().querySelector("li");
  }

  describe("activation", () => {
    it("keeps the select-list DOM out of activation", () => {
      expect(view.selectListHost).toBeNull();
      expect(view.selectList).toBeNull();
    });

    it("defers the select list until its synchronous toggle command is used", async () => {
      const workspaceElement = lumine.views.getView(lumine.workspace);
      const host = { toggle: jasmine.createSpy("toggle") };
      const ensureSelectList = spyOn(view, "ensureSelectList").and.returnValue(host);

      await lumine.commands.dispatch(workspaceElement, "recent-list:toggle");

      expect(ensureSelectList).toHaveBeenCalled();
      expect(host.toggle).toHaveBeenCalled();
      expect(view.selectListHost).toBeNull();
    });
  });

  it("keeps a newer service edge when an older edge for the same provider is disposed", () => {
    const service = jasmine.createSpyObj("OpenExternal", ["openExternal", "showInFolder"]);
    const first = main.consumeOpenExternal(service);
    const second = main.consumeOpenExternal(service);

    first.dispose();

    expect(view.openExternalService).toBe(service);
    second.dispose();
    expect(view.openExternalService).toBeNull();
  });

  describe("renderItem", () => {
    it("renders one line per project path", () => {
      const row = renderRow({
        paths: ["one" + path.sep, "two" + path.sep, "three" + path.sep],
        ibest: 0,
        matchIndices: [],
      });

      const lines = row.querySelectorAll(".primary-line");
      expect(lines.length).toBe(3);
      expect(lines[0].textContent).toBe("one" + path.sep);
      // Only the lines after the first carry the continuation class.
      expect(lines[0].classList.contains("icon-line")).toBe(false);
      expect(lines[1].classList.contains("icon-line")).toBe(true);
    });

    it("routes project paths through the shared icon registry", () => {
      const row = renderRow({
        paths: ["one" + path.sep],
        ibest: 0,
        matchIndices: [],
      });
      const line = row.querySelector(".primary-line");
      expect(line.classList.contains("icon-file-directory")).toBe(true);

      iconRegistration = lumine.icons.addProvider(
        {
          id: "recent-list-spec",
          handles: ["path"],
          usesContext: true,
          iconFor(target) {
            return target.context === "recent-list" ? Icon.classes(["icon-flame"]) : null;
          },
        },
        { priority: 100 },
      );
      expect(line.classList.contains("icon-flame")).toBe(true);
    });

    it("highlights only the best-matching line, using the package's own indices", () => {
      const row = renderRow({
        paths: ["one" + path.sep, "two" + path.sep],
        ibest: 1,
        matchIndices: [0, 1, 2],
      });

      const lines = row.querySelectorAll(".primary-line");
      expect(lines[0].querySelectorAll(".character-match").length).toBe(0);

      const matched = lines[1].querySelectorAll(".character-match");
      expect(matched.length).toBe(1);
      expect(matched[0].textContent).toBe("two");
    });

    it("renders plain text when there is nothing matched", () => {
      const row = renderRow({
        paths: ["one" + path.sep],
        ibest: 0,
        matchIndices: [],
      });

      expect(row.querySelectorAll(".character-match").length).toBe(0);
      expect(row.querySelector(".primary-line").textContent).toBe("one" + path.sep);
    });
  });

  describe("filter", () => {
    const cases = [
      { title: "an emoji prefix", text: "😀alpha", query: "alpha", highlighted: "alpha" },
      { title: "a matched emoji", text: "test/😀alpha", query: "😀", highlighted: "😀" },
      { title: "a CJK prefix", text: "中alpha", query: "alpha", highlighted: "alpha" },
      { title: "a matched CJK character", text: "中alpha", query: "中", highlighted: "中" },
      { title: "a combining accent", text: "e\u0301clair", query: "clair", highlighted: "clair" },
      {
        title: "a matched decomposed accent",
        text: "cafe\u0301",
        query: "cafe",
        highlighted: "cafe\u0301",
      },
      {
        title: "a matched family emoji",
        text: "👨‍👩‍👧‍👦alpha",
        query: "👧",
        highlighted: "👨‍👩‍👧‍👦",
      },
      { title: "Latin accents", text: "café", query: "cafe", highlighted: "café" },
      { title: "Polish accents", text: "Łódź", query: "lodz", highlighted: "Łódź" },
      { title: "an expanding sharp s", text: "Straße", query: "strasse", highlighted: "Straße" },
      { title: "an expanding ligature", text: "Ægis", query: "aegis", highlighted: "Ægis" },
    ];

    for (const { title, text, query, highlighted } of cases) {
      it(`preserves the displayed path and highlight offsets with ${title}`, () => {
        const item = { paths: [text + path.sep] };
        const matches = view.filter([item], query);

        expect(matches).toEqual([item]);
        const row = renderRow(matches[0]);
        const line = row.querySelector(".primary-line");
        const spans = Array.from(line.querySelectorAll(".character-match"));
        expect(line.textContent).toBe(text + path.sep);
        expect(spans.map((span) => span.textContent).join("")).toBe(highlighted);
        expect(new Set(item.matchIndices).size).toBe(item.matchIndices.length);
      });
    }

    it("highlights only the best path selected by the real matcher", () => {
      const item = { paths: ["other" + path.sep, "café" + path.sep] };

      expect(view.filter([item], "cafe")).toEqual([item]);
      const row = renderRow(item);
      const lines = row.querySelectorAll(".primary-line");
      expect(item.ibest).toBe(1);
      expect(lines[0].querySelectorAll(".character-match").length).toBe(0);
      expect(lines[1].querySelector(".character-match").textContent).toBe("café");
    });

    it("clears old highlights when the picker query is cleared", async () => {
      jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
      spyOn(lumine.history, "getProjects").and.returnValue([{ paths: ["😀alpha" + path.sep] }]);
      view.ensureSelectList();
      await view.selectListHost.show();
      const model = view.selectList;
      const item = model.getSelectedItem();
      await model.setQuery("alpha");
      expect(model.getElement().querySelector(".character-match").textContent).toBe("alpha");

      await model.setQuery("");

      expect(item.ibest).toBe(-1);
      expect(item.matchIndices).toBeNull();
      expect(model.getElement().querySelectorAll(".character-match").length).toBe(0);
      expect(model.getElement().querySelector(".primary-line").textContent).toBe(item.paths[0]);
    });

    it("prefers the more recent entry when path scores and depths tie", () => {
      const recent = { paths: [`one${path.sep}target${path.sep}`] };
      const older = { paths: [`two${path.sep}target${path.sep}`] };

      expect(view.filter([recent, older], "target")).toEqual([recent, older]);
      expect(recent.score).toBeGreaterThan(older.score);
    });

    it("prefers a shallower path when matching scores tie, even if it is older", () => {
      const recent = { paths: [`a${path.sep}b${path.sep}target${path.sep}`] };
      const older = { paths: [`one${path.sep}target${path.sep}`] };

      expect(view.filter([recent, older], "target")).toEqual([older, recent]);
      expect(older.score).toBeGreaterThan(recent.score);
    });
  });

  describe("service lifecycle", () => {
    it("keeps an old provided facade from opening UI in a new generation", async () => {
      const facade = main.provideRecentList();
      const previousView = view;
      await lumine.packages.deactivatePackage("recent-list");
      main = (await lumine.packages.activatePackage("recent-list")).mainModule;
      view = main.recentList;
      const host = { toggle: jasmine.createSpy("toggle") };
      const ensureSelectList = spyOn(view, "ensureSelectList").and.returnValue(host);

      facade.toggle();

      expect(ensureSelectList).not.toHaveBeenCalled();
      expect(previousView.selectListHost).toBeNull();
      expect(view.selectListHost).toBeNull();
      main.provideRecentList().toggle();
      expect(ensureSelectList).toHaveBeenCalled();
      expect(host.toggle).toHaveBeenCalled();
    });

    it("disposes only the external provider edge that is still current", () => {
      const first = {};
      const second = {};
      const firstEdge = main.consumeOpenExternal(first);
      const secondEdge = main.consumeOpenExternal(second);

      firstEdge.dispose();

      expect(view.openExternalService).toBe(second);
      secondEdge.dispose();
      expect(view.openExternalService).toBeNull();
    });

    it("keeps late edge disposal from clearing the same provider in a new generation", async () => {
      const provider = {};
      const previousView = view;
      const previousEdge = main.consumeOpenExternal(provider);
      await lumine.packages.deactivatePackage("recent-list");
      main = (await lumine.packages.activatePackage("recent-list")).mainModule;
      view = main.recentList;
      const currentEdge = main.consumeOpenExternal(provider);

      previousEdge.dispose();

      expect(previousView.openExternalService).toBeNull();
      expect(view.openExternalService).toBe(provider);
      expect(view.selectListHost).toBeNull();
      currentEdge.dispose();
      expect(view.openExternalService).toBeNull();
    });
  });
});
