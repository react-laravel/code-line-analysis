# Web Deployment

This project can now run as a static web app in addition to the Electron desktop build.

## What the Web Build Supports

- Drag a local folder into the Workspace page and analyze it in the browser.
- Open a folder through the browser picker when drag and drop is not convenient.
- Browse Dashboard, Tree, Files, Tags, Functions, Heatmap, and Duplicates views.
- Edit files inside the browser session and immediately refresh analysis results.

## Web-Mode Limits

- Analysis data lives in memory for the current browser tab.
- Git metadata is unavailable.
- Native desktop context menus are unavailable.
- Browser edits do not write back to the original files on disk.
- Directory drag and drop works best in Chromium-based browsers.

## Build

```bash
npm install
npm run build:web
```

The static site is generated in `dist/renderer`.

To preview it locally:

```bash
npm run preview:web
```

## Deploy to Static Hosting

Upload the contents of `dist/renderer` to any static hosting platform.

Common choices:

1. Nginx
2. GitHub Pages
3. Netlify
4. Vercel
5. Cloudflare Pages

The app uses `HashRouter`, so routes are encoded after `#`. That means you do not need special SPA rewrite rules.

## Example: Nginx

```nginx
server {
  listen 80;
  server_name your-domain.example;

  root /var/www/code-line-analysis;
  index index.html;

  location / {
    try_files $uri $uri/ =404;
  }
}
```

Copy `dist/renderer/*` into `/var/www/code-line-analysis`.

## Example: GitHub Pages

1. Run `npm run build:web`.
2. Publish the contents of `dist/renderer` from your CI pipeline or a Pages deployment branch.
3. Open the published site and drag a folder into the Workspace page.

## Browser Notes

- Chromium, Edge, and other Chromium-based browsers provide the best folder import support.
- Safari and Firefox may need the folder picker fallback instead of direct folder drag and drop.
- The application processes files in the browser. Your deployment platform may still log requests at the HTTP level, but the app itself does not upload folder contents to a backend service.