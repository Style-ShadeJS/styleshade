# StyleShade — Complete Hosting Guide

How to get StyleShade live on the web. Three paths: GitHub Pages (free, recommended), jsDelivr CDN, or Netlify/Vercel.

---

## Path 1 — GitHub Pages (Recommended, Free)

GitHub Pages hosts static sites directly from a repo. Zero cost, custom domain support, HTTPS included.

### Step 1: Install Git

If you don't have Git: https://git-scm.com/downloads

Verify:
```bash
git --version
```

---

### Step 2: Create a GitHub Account

Go to https://github.com and sign up. Choose any username — it will appear in your URL:
`https://yourusername.github.io/styleshade`

---

### Step 3: Create the Repository

1. Click the **+** button (top-right) → **New repository**
2. Repository name: `styleshade`
3. Set to **Public** (required for free GitHub Pages)
4. **Do NOT** check "Add a README" (you already have files)
5. Click **Create repository**

GitHub shows you a page with setup commands. Keep it open.

---

### Step 4: Push Your Files

Open a terminal in the `styleshade/` folder you downloaded, then run:

```bash
# Initialize git
git init

# Stage all files
git add .

# First commit
git commit -m "feat: initial StyleShade release"

# Connect to your GitHub repo (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/styleshade.git

# Push
git push -u origin main
```

If asked for credentials: use your GitHub username and a **Personal Access Token** (not your password).
To create one: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate.

---

### Step 5: Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** (top tab)
3. Scroll to **Pages** (left sidebar)
4. Under **Source**: select **Deploy from a branch**
5. Branch: `main` | Folder: `/docs`
6. Click **Save**

Wait ~60 seconds. Your site is live at:
```
https://YOUR_USERNAME.github.io/styleshade
```

The sandbox demo is at:
```
https://YOUR_USERNAME.github.io/styleshade/sandbox.html
```

---

### Step 6 (Optional): Custom Domain

Buy a domain (Namecheap, Cloudflare, etc.), then:

1. In your repo's `docs/` folder, create a file called `CNAME` with one line:
   ```
   styleshade.dev
   ```
2. At your DNS provider, add a CNAME record:
   - Name: `www`
   - Value: `YOUR_USERNAME.github.io`
3. Back in GitHub Pages settings, enter your domain and enable **Enforce HTTPS**

---

## Path 2 — jsDelivr CDN (For the Library Itself)

Once your repo is on GitHub, jsDelivr auto-serves it as a CDN with zero config.

Your files are instantly available at:
```
https://cdn.jsdelivr.net/gh/YOUR_USERNAME/styleshade@main/src/core/StyleShade.js
```

Or pin to a version tag:
```bash
git tag v1.0.0
git push --tags
```
```
https://cdn.jsdelivr.net/gh/YOUR_USERNAME/styleshade@v1.0.0/dist/styleshade.esm.js
```

Users can then import StyleShade in their projects with no npm install:
```html
<script type="module">
  import { StyleShade } from 'https://cdn.jsdelivr.net/gh/YOUR_USERNAME/styleshade@main/src/core/StyleShade.js';
</script>
```

---

## Path 3 — Netlify (Easiest, if you don't want git CLI)

1. Go to https://netlify.com and sign up (free)
2. Click **Add new site** → **Deploy manually**
3. Drag and drop the entire `docs/` folder into the upload box
4. Netlify gives you a URL instantly: `https://random-name.netlify.app`
5. Rename it in Site settings → General → Site name

To update: drag and drop again. Done.

For a custom domain: Site settings → Domain management → Add custom domain.

---

## Path 4 — Vercel (Best for future npm package)

```bash
npm install -g vercel
cd styleshade
vercel
```

Follow the prompts. Vercel auto-detects the `/docs` folder and deploys. Every `git push` auto-redeploys.

---

## Updating Your Site

After any change to your files:

```bash
git add .
git commit -m "update: your change description"
git push
```

GitHub Pages redeploys automatically within ~30 seconds.

---

## Directory Structure Reference

```
styleshade/
├── docs/                  ← GitHub Pages root
│   ├── index.html         ← Main documentation site
│   └── sandbox.html       ← Live shader sandbox demo
├── src/
│   ├── core/
│   │   ├── StyleShade.js       ← Main engine
│   │   ├── RenderGraph.js      ← Vulkan-style render graph
│   │   ├── ShaderCompiler.js   ← WGSL/GLSL chunk system
│   │   ├── PerformanceMonitor.js
│   │   ├── MaterialSystem.js
│   │   └── CapabilityDetector.js
│   ├── adapters/
│   │   ├── ThreeAdapter.js
│   │   ├── BabylonAdapter.js
│   │   └── RawWebGPUAdapter.js
│   └── utils/
│       └── EventEmitter.js
├── package.json
└── README.md
```

---

## Quick Checklist

- [ ] Git installed
- [ ] GitHub account created
- [ ] Repo created (public)
- [ ] Files pushed with `git push`
- [ ] Pages enabled: Settings → Pages → `/docs` branch
- [ ] Visit `https://YOUR_USERNAME.github.io/styleshade`
- [ ] Sandbox at `.../sandbox.html` works
