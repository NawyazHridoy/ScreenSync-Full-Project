const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const wwwHtmlPath = path.join(rootDir, "www", "index.html");
const cssPath = path.join(rootDir, "src", "styles", "main.css");
const jsPath = path.join(rootDir, "src", "js", "app.js");

if (fs.existsSync(wwwHtmlPath) && fs.existsSync(cssPath) && fs.existsSync(jsPath)) {
  let html = fs.readFileSync(wwwHtmlPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const js = fs.readFileSync(jsPath, "utf8");
  html = html.replace(/<style>[\s\S]*?<\/style>/, () => `<style>\n${css}\n  </style>`);
  html = html.replace(/<script>[\s\S]*?<\/script>/, () => `<script>\n${js}\n  </script>`);
  fs.writeFileSync(wwwHtmlPath, html, "utf8");
}

const targets = [
  path.join(rootDir, "src", "index.html"),
  path.join(rootDir, "android", "app", "src", "main", "assets", "public", "index.html"),
  path.join(rootDir, "ios", "App", "App", "public", "index.html")
];

for (const dest of targets) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(wwwHtmlPath, dest);
  console.log("Synced web bundle to:", dest);
}
