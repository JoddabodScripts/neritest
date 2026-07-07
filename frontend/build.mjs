/**
 * Generates the static docs site in ./frontend from the project's markdown.
 *
 * Output is plain .html + styles.css with no runtime dependencies - host it
 * anywhere (GitHub Pages, Netlify, an S3 bucket, `python -m http.server`).
 * Re-run `node frontend/build.mjs` whenever the markdown changes.
 */
import { marked } from "marked";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "frontend");
mkdirSync(out, { recursive: true });

// page slug -> { title, source markdown path, short label for the sidebar }
const PAGES = [
  { slug: "index", title: "Overview", nav: "Overview", src: "README.md", hero: true },
  { slug: "getting-started", title: "Getting started", nav: "Getting started", src: "docs/getting-started.md" },
  { slug: "cookbook", title: "Testing cookbook", nav: "Cookbook", src: "docs/cookbook.md" },
  { slug: "api-reference", title: "API reference", nav: "API reference", src: "docs/api-reference.md" },
  { slug: "fixtures", title: "Fixtures", nav: "Fixtures", src: "docs/fixtures.md" },
  { slug: "debugging", title: "Debugging", nav: "Debugging", src: "docs/debugging.md" },
  { slug: "architecture", title: "Architecture", nav: "Architecture", src: "docs/architecture.md" },
  { slug: "migration", title: "Migration", nav: "Migration", src: "docs/migration.md" },
  { slug: "examples", title: "Examples", nav: "Examples", src: "examples/README.md" },
];

// Map a markdown href to a site href.
const LINK_MAP = {
  "README.md": "index.html",
  "../README.md": "index.html",
  "docs/getting-started.md": "getting-started.html",
  "docs/cookbook.md": "cookbook.html",
  "docs/api-reference.md": "api-reference.html",
  "docs/fixtures.md": "fixtures.html",
  "docs/debugging.md": "debugging.html",
  "docs/architecture.md": "architecture.html",
  "docs/migration.md": "migration.html",
  "getting-started.md": "getting-started.html",
  "cookbook.md": "cookbook.html",
  "api-reference.md": "api-reference.html",
  "fixtures.md": "fixtures.html",
  "debugging.md": "debugging.html",
  "architecture.md": "architecture.html",
  "migration.md": "migration.html",
  "examples/README.md": "examples.html",
  "examples/": "examples.html",
};

const LANG_LABEL = {
  ts: "TypeScript",
  typescript: "TypeScript",
  js: "JavaScript",
  javascript: "JavaScript",
  bash: "Shell",
  sh: "Shell",
  shell: "Shell",
  json: "JSON",
  diff: "Diff",
  text: "",
  "": "",
};

const GITHUB = "https://github.com/Nerimity/nerimity.js";

function rewriteLinks(html) {
  return html.replace(/href="([^"]+)"/g, (m, href) => {
    if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return m;
    // split off any anchor
    const [path, anchor] = href.split("#");
    if (LINK_MAP[path]) {
      return `href="${LINK_MAP[path]}${anchor ? "#" + anchor : ""}"`;
    }
    // Links into source files (examples/bots/*, test/*, src/*) -> point to the
    // markdown page for examples, otherwise drop the link but keep the text.
    if (path.startsWith("examples/")) return `href="examples.html"`;
    return m;
  });
}

function enhanceCodeBlocks(html) {
  return html.replace(
    /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_m, lang = "", code) => {
      const label = LANG_LABEL[lang] ?? lang;
      let body = code;
      if (lang === "diff") {
        body = code
          .split("\n")
          .map((line) => {
            if (/^\+(?!\+)/.test(line)) return `<span class="diff-add">${line}</span>`;
            if (/^-(?!-)/.test(line)) return `<span class="diff-del">${line}</span>`;
            return line;
          })
          .join("\n");
      }
      const header = label
        ? `<div class="code-head"><span class="code-lang">${label}</span><button class="copy" type="button" aria-label="Copy code">Copy</button></div>`
        : `<div class="code-head"><span class="code-lang"></span><button class="copy" type="button" aria-label="Copy code">Copy</button></div>`;
      return `<div class="code-block">${header}<pre><code>${body}</code></pre></div>`;
    },
  );
}

function wrapTables(html) {
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
}

function sidebar(activeSlug) {
  const items = PAGES.map((p) => {
    const href = p.slug === "index" ? "index.html" : `${p.slug}.html`;
    const active = p.slug === activeSlug ? " class=\"active\"" : "";
    return `<li><a${active} href="${href}">${p.nav}</a></li>`;
  }).join("\n        ");
  return `<ul class="nav">
        ${items}
      </ul>`;
}

function heroBlock() {
  return `<header class="hero">
    <div class="hero-inner">
      <div class="badge">testing toolkit</div>
      <h1>Neri<span class="mark">Test</span></h1>
      <p class="lede">A local sandbox that emulates the Nerimity runtime, so you can build and
        test <code>nerimity.js</code> bots against a real gateway and REST API without ever
        touching production.</p>
      <div class="cta-row">
        <a class="btn primary" href="getting-started.html">Get started</a>
        <a class="btn ghost" href="cookbook.html">Cookbook</a>
        <a class="btn ghost" href="${GITHUB}">nerimity.js</a>
      </div>
      <div class="hero-term" aria-hidden="true">
        <div class="term-bar"><span></span><span></span><span></span></div>
        <pre><code><span class="c-key">const</span> sandbox = <span class="c-fn">createSandbox</span>();
<span class="c-key">const</span> channel = server.<span class="c-fn">createChannel</span>({ name: <span class="c-str">"general"</span> });

<span class="c-cmt">// a real nerimity.js Client, wired to the sandbox</span>
<span class="c-key">const</span> client = <span class="c-key">await</span> sandbox.<span class="c-fn">createClient</span>();
channel.<span class="c-fn">send</span>(alice, <span class="c-str">"!ping"</span>);

<span class="c-fn">expect</span>(channel.lastMessage?.content).<span class="c-fn">toBe</span>(<span class="c-str">"Pong!"</span>);</code></pre>
      </div>
    </div>
  </header>`;
}

// Inline, blocking, and tiny: promotes a stored "light" preference before first
// paint. Dark needs no script since it's the CSS default (:root, no attribute).
const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("neritest-theme")==="light"){document.documentElement.setAttribute("data-theme","light");}}catch(e){}})();`;

const SUN_ICON = `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>`;
const MOON_ICON = `<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

function page({ slug, title, contentHtml, hero }) {
  const isIndex = slug === "index";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · NeriTest</title>
  <meta name="description" content="NeriTest - a local sandbox for testing nerimity.js bots." />
  <script>${THEME_INIT_SCRIPT}</script>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <div class="topbar">
    <button class="menu-toggle" id="menuToggle" aria-label="Toggle navigation">≡</button>
    <a class="brand" href="index.html">Neri<span class="mark">Test</span></a>
    <div class="top-links">
      <a href="getting-started.html">Docs</a>
      <a href="cookbook.html">Cookbook</a>
      <a href="${GITHUB}">SDK</a>
    </div>
    <button class="theme-toggle" id="themeToggle" aria-label="Toggle color theme" title="Toggle color theme">
      ${SUN_ICON}
      ${MOON_ICON}
    </button>
  </div>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <nav>
        <div class="nav-title">Documentation</div>
        ${sidebar(slug)}
      </nav>
    </aside>
    <main id="content">
      ${hero ? heroBlock() : ""}
      <article class="doc${isIndex ? " doc-index" : ""}">
        ${contentHtml}
      </article>
      <footer class="foot">
        <span>NeriTest docs</span>
        <span><a href="${GITHUB}">nerimity.js</a></span>
      </footer>
    </main>
  </div>
  <script>
    document.getElementById("menuToggle")?.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.toggle("open");
    });
    document.getElementById("themeToggle")?.addEventListener("click", () => {
      const root = document.documentElement;
      const isLight = root.getAttribute("data-theme") === "light";
      if (isLight) {
        root.removeAttribute("data-theme");
        try { localStorage.setItem("neritest-theme", "dark"); } catch (e) {}
      } else {
        root.setAttribute("data-theme", "light");
        try { localStorage.setItem("neritest-theme", "light"); } catch (e) {}
      }
    });
    document.querySelectorAll(".copy").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = btn.closest(".code-block")?.querySelector("code")?.innerText ?? "";
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1400);
        } catch {
          btn.textContent = "Copy failed";
        }
      });
    });
  </script>
</body>
</html>
`;
}

marked.setOptions({ mangle: false, headerIds: true, gfm: true });

for (const p of PAGES) {
  const md = readFileSync(join(root, p.src), "utf8");
  // On the index/hero page, drop the leading H1 + tagline (the hero covers it).
  let source = md;
  if (p.hero) {
    source = md.replace(/^# NeriTest[\s\S]*?(?=\n## )/, "");
  }
  let html = marked.parse(source);
  html = rewriteLinks(html);
  html = enhanceCodeBlocks(html);
  html = wrapTables(html);
  const outName = p.slug === "index" ? "index.html" : `${p.slug}.html`;
  writeFileSync(join(out, outName), page({ slug: p.slug, title: p.title, contentHtml: html, hero: p.hero }));
  console.log("wrote", outName);
}

console.log("Docs site generated in frontend/");
