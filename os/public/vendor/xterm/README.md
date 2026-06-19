# Vendored third-party assets

This directory ships pre-downloaded copies of open-source frontend
dependencies. **Nothing in this directory is fetched at runtime.** All
runtime fetches resolve to files under `os/public/`, satisfying the
"local, isolated, portable" requirement — NocoOS can run on a machine
with no internet access.

## Contents

| File | Source | License |
|------|--------|---------|
| `lib/xterm.js` | `xterm@5.3.0` (npm) | MIT |
| `lib/xterm-addon-fit.js` | `xterm-addon-fit@0.8.0` (npm) | MIT |
| `lib/xterm-addon-web-links.js` | `xterm-addon-web-links@0.9.0` (npm) | MIT |
| `css/xterm.css` | `xterm@5.3.0` (npm) | MIT |

The `xterm-addon-fit` and `xterm-addon-web-links` packages ship no CSS
files — only the main `xterm` package provides a stylesheet.

## How to update

When upgrading xterm or its addons:

1. Download the new versions into this directory (same paths).
2. Update the version numbers in the `<script>` tags in
   `os/public/desktop.html`.
3. Run `pnpm lint` to verify the vendored JS parses cleanly.

```bash
curl -fsSL -o os/public/vendor/xterm/lib/xterm.js \
  https://cdn.jsdelivr.net/npm/xterm@<NEW_VERSION>/lib/xterm.js
# ... etc
```

## License texts

The upstream license files are not duplicated here to save space; they
are short and identical for all three packages. The MIT License text:

> Copyright (c) 2017 The xterm.js authors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.