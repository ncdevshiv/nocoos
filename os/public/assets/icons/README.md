# NocoOS Default Icon Set

This directory ships the canonical NocoOS SVG icon set. Icons follow the
[Lucide icon conventions](https://lucide.dev): 24x24 viewBox, currentColor
stroke, ~2px stroke width, no fill.

Each icon is available as a standalone SVG file. The icon name (without
`.svg`) matches the keys exposed by `os/public/js/core/icons.js`.

## Currently shipped icons

| Name        | File           | Used by                                       |
| ----------- | -------------- | --------------------------------------------- |
| terminal    | terminal.svg   | Terminal app, taskbar                         |
| folder      | folder.svg     | Files app, File Manager                       |
| code        | code.svg       | Code Editor app                               |
| package     | package.svg    | App Installer app                             |
| settings    | settings.svg   | Settings app                                  |
| cpu         | cpu.svg        | System section, taskbar tray                  |
| activity    | activity.svg   | System Monitor app                            |
| globe       | globe.svg      | Browser app                                   |
| info        | info.svg       | About app                                     |
| user        | user.svg       | Accounts section                              |
| star        | star.svg       | Hello sample app, Favorites                   |
| apps        | apps.svg       | Start menu default tile                       |
| wifi        | wifi.svg       | Tray icon                                     |
| battery     | battery.svg    | Tray icon                                     |
| search      | search.svg     | Start menu search                             |
| lock        | lock.svg       | Lock screen                                   |
| shutdown    | shutdown.svg   | Shutdown / power button                       |
| restart     | restart.svg    | Restart button                                |

## Adding new icons

1. Drop a 24x24 SVG file into this directory using `kebab-case.svg`.
2. Add the icon name (without `.svg`) to the table above.
3. Reference it by name in app manifests (e.g. `"icon": "my-icon"`).
4. The `core/icons.js` registry will pick it up automatically if you extend
   the `ICONS` map there.

## Why both this directory AND inline SVG in core/icons.js?

The frontend bundles an inline fallback set in `core/icons.js` so the app
works even if this directory is empty. The SVG files here are the canonical
source of truth — a future build step can extract them, replace the inline
registry, and ship a smaller bundle.