# recent-list

Quick access to recently opened projects.

## Features

- **Recent list**: browse and open recently opened projects.
- **Multiple open modes**: open in a new window, open here restoring the project's own editors, or add to the current window.
- **Dev and safe mode**: open projects in dev mode or safe mode directly from the list.
- **Visual indicators**: items configured with dev mode or safe mode are marked with distinct icons.
- **Recency-aware filtering**: fuzzy matching adjusts scores with a recency bonus and a shallower-path bonus.

## Installation

To install `recent-list` search for _recent-list_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/recent-list`.

## Commands

Commands available in `lumine-workspace`:

- `recent-list:toggle`: open the recent list.

Commands available in `.recent-list`, all listed with their keybindings in the item-actions list (F12):

- `recent-list:open-in-new-window`: open a new window with the selected project,
- `recent-list:open-in-this-window`: open the selected project here, restoring the editors it was last left with,
- `recent-list:add-to-project`: add the selected project's folders to the active window,
- `recent-list:insert-paths`: paste paths into the active text editor,
- `recent-list:open-in-dev-mode`: open a new window with the selected project in dev mode,
- `recent-list:open-in-safe-mode`: open a new window with the selected project in safe mode,
- `recent-list:open-external`: open folders externally,
- `recent-list:show-in-folder`: show folders in the explorer,
- `recent-list:refresh`: update the recent list,
- `recent-list:remove-from-history`: remove the selected project from the recent list.

Opening in this window keeps the same renderer, so packages, themes and grammars stay loaded. The current project's editors are saved before the new project's are restored, unsaved changes included, so returning to a project finds it as you left it. Only the workspace center changes — a tree view, a terminal or any other dock keeps running.

## Services

- **[recent-list](docs/recent-list.md)** (`1.0.0`): provided to expose the recent projects list manager so other packages can open the list without depending on the toggle command.
- **open-external** (`^1.0.0`): consumed to open folders externally and shows them in the explorer.

## Customization

Resize the results panel by adding CSS to your `styles.css`:

```css
.recent-list {
  font-size: 14px;
  .list-group {
    max-height: 20em;
  }
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
