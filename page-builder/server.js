const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const fssync = require('fs');
const matter = require('gray-matter');
const { marked } = require('marked');
const TurndownService = require('turndown');
const YAML = require('yaml');
const multer = require('multer');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, '_posts');
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const CONFIG_PATH = path.join(ROOT, '_config.yml');
const INDEX_PATH = path.join(ROOT, 'index.html');

const PAGES = [
  { id: 'aboutme', file: 'aboutme.md', label: 'About Me' },
  { id: 'networking', file: 'networking.md', label: 'Networking' },
  { id: 'resume', file: 'resume.md', label: 'Resume' },
];

const CONFIG_FIELDS = ['title', 'author', 'avatar', 'gtag', 'rss-description'];
const COLOR_FIELDS = [
  'page-col', 'text-col', 'link-col', 'hover-col',
  'navbar-col', 'navbar-text-col', 'navbar-border-col',
  'footer-col', 'footer-text-col', 'footer-link-col', 'footer-hover-col',
];

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/quill', express.static(path.join(__dirname, 'node_modules', 'quill', 'dist')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));

// ---------- helpers ----------

// Broad but safe: matches any real Jekyll post filename (including ones this
// tool didn't create itself, which may use mixed case, underscores, spaces,
// etc). It only needs to be safe against path traversal, not stylistically
// clean - that's enforced separately when *generating* new filenames.
const EXISTING_POST_FILENAME_RE = /^\d{4}-\d{2}-\d{2}-.+\.md$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function isSafeFilenameSegment(name) {
  return typeof name === 'string' && name.length > 0 && name.length < 255
    && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

function assertSafePostFilename(name) {
  if (!isSafeFilenameSegment(name) || !EXISTING_POST_FILENAME_RE.test(name)) {
    throw httpError(400, 'Invalid post filename');
  }
}

function buildFrontMatter({ title, subtitle, tags, coverImg, thumbnailImg, comments }) {
  const data = {};
  data.title = String(title || '').trim();
  if (subtitle && String(subtitle).trim()) data.subtitle = String(subtitle).trim();
  if (Array.isArray(tags) && tags.length) data.tags = tags.filter(Boolean);
  if (coverImg) data['cover-img'] = coverImg;
  if (thumbnailImg) data['thumbnail-img'] = thumbnailImg;
  if (comments === false) data.comments = false;
  return data;
}

function htmlToMarkdown(html) {
  return turndown.turndown(html || '').trim() + '\n';
}

// ---------- posts ----------

app.get('/api/posts', async (req, res, next) => {
  try {
    await fs.mkdir(POSTS_DIR, { recursive: true });
    const files = (await fs.readdir(POSTS_DIR)).filter((f) => EXISTING_POST_FILENAME_RE.test(f));
    const posts = await Promise.all(
      files.map(async (f) => {
        const raw = await fs.readFile(path.join(POSTS_DIR, f), 'utf8');
        const { data } = matter(raw);
        return {
          filename: f,
          title: data.title || '',
          subtitle: data.subtitle || '',
          date: data.date ? String(data.date) : f.slice(0, 10),
          tags: data.tags || [],
        };
      })
    );
    posts.sort((a, b) => b.filename.localeCompare(a.filename));
    res.json(posts);
  } catch (e) {
    next(e);
  }
});

app.get('/api/posts/:filename', async (req, res, next) => {
  try {
    assertSafePostFilename(req.params.filename);
    const full = path.join(POSTS_DIR, req.params.filename);
    if (!fssync.existsSync(full)) throw httpError(404, 'Post not found');
    const raw = await fs.readFile(full, 'utf8');
    const parsed = matter(raw);
    res.json({
      filename: req.params.filename,
      data: parsed.data,
      bodyHtml: marked.parse(parsed.content || ''),
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/posts', async (req, res, next) => {
  try {
    const { title, date, bodyHtml } = req.body || {};
    if (!title || !String(title).trim()) throw httpError(400, 'Title is required');
    const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    const filename = `${d}-${slugify(title)}.md`;
    const full = path.join(POSTS_DIR, filename);
    if (fssync.existsSync(full)) throw httpError(409, 'A post with this date and title already exists');

    const data = buildFrontMatter(req.body || {});
    const out = matter.stringify(htmlToMarkdown(bodyHtml), data);
    await fs.mkdir(POSTS_DIR, { recursive: true });
    await fs.writeFile(full, out, 'utf8');
    res.status(201).json({ filename });
  } catch (e) {
    next(e);
  }
});

app.put('/api/posts/:filename', async (req, res, next) => {
  try {
    assertSafePostFilename(req.params.filename);
    const full = path.join(POSTS_DIR, req.params.filename);
    if (!fssync.existsSync(full)) throw httpError(404, 'Post not found');

    const { bodyHtml } = req.body || {};
    const data = buildFrontMatter(req.body || {});
    const out = matter.stringify(htmlToMarkdown(bodyHtml), data);
    await fs.writeFile(full, out, 'utf8');
    res.json({ filename: req.params.filename });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/posts/:filename', async (req, res, next) => {
  try {
    assertSafePostFilename(req.params.filename);
    const full = path.join(POSTS_DIR, req.params.filename);
    if (!fssync.existsSync(full)) throw httpError(404, 'Post not found');
    await fs.unlink(full);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---------- static pages (About Me, Networking, Resume) ----------

function pageById(id) {
  const p = PAGES.find((p) => p.id === id);
  if (!p) throw httpError(404, 'Unknown page');
  return p;
}

app.get('/api/pages', (req, res) => {
  res.json(PAGES.map(({ id, label, file }) => ({ id, label, file })));
});

app.get('/api/pages/:id', async (req, res, next) => {
  try {
    const p = pageById(req.params.id);
    const raw = await fs.readFile(path.join(ROOT, p.file), 'utf8');
    const parsed = matter(raw);
    res.json({
      id: p.id,
      label: p.label,
      data: parsed.data,
      bodyHtml: marked.parse(parsed.content || ''),
    });
  } catch (e) {
    next(e);
  }
});

app.put('/api/pages/:id', async (req, res, next) => {
  try {
    const p = pageById(req.params.id);
    const full = path.join(ROOT, p.file);
    const raw = await fs.readFile(full, 'utf8');
    const existing = matter(raw).data || {};
    const { title, subtitle, bigimg, bodyHtml } = req.body || {};

    const data = { ...existing };
    if (title !== undefined) data.title = title;
    if (subtitle !== undefined) {
      if (subtitle) data.subtitle = subtitle;
      else delete data.subtitle;
    }
    if (bigimg !== undefined) {
      if (bigimg) data.bigimg = bigimg;
      else delete data.bigimg;
    }

    const out = matter.stringify(htmlToMarkdown(bodyHtml), data);
    await fs.writeFile(full, out, 'utf8');
    res.json({ id: p.id });
  } catch (e) {
    next(e);
  }
});

// ---------- homepage (index.html) intro text ----------
// index.html mixes a hand-written intro with Liquid templating for the post
// list, so we only ever touch the front matter and the disclaimer paragraph
// text, leaving the Liquid loop below it untouched.

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const DISCLAIMER_RE = /(<p style="font-style: italic;">\s*)([\s\S]*?)(\s*<\/p>)/;

app.get('/api/homepage', async (req, res, next) => {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf8');
    const fmMatch = raw.match(FRONT_MATTER_RE);
    const data = fmMatch ? YAML.parse(fmMatch[1]) || {} : {};
    const discMatch = raw.match(DISCLAIMER_RE);
    res.json({
      title: data.title || '',
      subtitle: data.subtitle || '',
      disclaimer: discMatch ? discMatch[2].trim() : '',
    });
  } catch (e) {
    next(e);
  }
});

app.put('/api/homepage', async (req, res, next) => {
  try {
    const { title, subtitle, disclaimer } = req.body || {};
    let raw = await fs.readFile(INDEX_PATH, 'utf8');

    const fmMatch = raw.match(FRONT_MATTER_RE);
    if (fmMatch) {
      const data = YAML.parse(fmMatch[1]) || {};
      if (title !== undefined) data.title = title;
      if (subtitle !== undefined) data.subtitle = subtitle;
      const newFm = `---\n${YAML.stringify(data).trim()}\n---\n`;
      raw = raw.replace(FRONT_MATTER_RE, newFm);
    }

    if (typeof disclaimer === 'string' && DISCLAIMER_RE.test(raw)) {
      raw = raw.replace(DISCLAIMER_RE, (m, pre, _mid, post) => `${pre}${disclaimer.trim()}${post}`);
    }

    await fs.writeFile(INDEX_PATH, raw, 'utf8');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- site settings (_config.yml) ----------
// Edits go through yaml's Document API so existing comments/formatting in
// _config.yml are preserved for anything we don't explicitly touch.

app.get('/api/settings', async (req, res, next) => {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const doc = YAML.parseDocument(raw);
    const settings = {};
    for (const f of [...CONFIG_FIELDS, ...COLOR_FIELDS]) {
      const v = doc.get(f);
      settings[f] = v === undefined || v === null ? '' : v;
    }
    settings['round-avatar'] = doc.get('round-avatar') !== false;

    const navbar = doc.get('navbar-links', true);
    settings.navbarLinks = {};
    if (navbar && typeof navbar.items === 'object') {
      for (const pair of navbar.items) {
        const val = pair.value;
        if (val && typeof val.toJSON === 'function' && !Array.isArray(val.toJSON())) {
          const scalar = val.toJSON();
          if (typeof scalar === 'string') settings.navbarLinks[String(pair.key)] = scalar;
        }
      }
    }

    const social = doc.get('social-network-links', true);
    settings.socialLinks = {};
    if (social && typeof social.items === 'object') {
      for (const pair of social.items) {
        const val = pair.value;
        const scalar = val && typeof val.toJSON === 'function' ? val.toJSON() : val;
        settings.socialLinks[String(pair.key)] = scalar;
      }
    }

    res.json(settings);
  } catch (e) {
    next(e);
  }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const doc = YAML.parseDocument(raw);

    for (const f of CONFIG_FIELDS) {
      if (body[f] !== undefined && body[f] !== '') doc.set(f, body[f]);
    }
    for (const f of COLOR_FIELDS) {
      if (body[f] !== undefined && body[f] !== '') doc.set(f, body[f]);
    }
    if (body['round-avatar'] !== undefined) doc.set('round-avatar', !!body['round-avatar']);

    if (body.navbarLinks && typeof body.navbarLinks === 'object') {
      const entries = Object.entries(body.navbarLinks).filter(([label, target]) => label && target);
      if (entries.length) doc.set('navbar-links', Object.fromEntries(entries));
    }

    if (body.socialLinks && typeof body.socialLinks === 'object') {
      const entries = Object.entries(body.socialLinks).filter(([, v]) => v !== '' && v !== null && v !== undefined);
      doc.set('social-network-links', Object.fromEntries(entries));
    }

    await fs.writeFile(CONFIG_PATH, doc.toString(), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- image uploads ----------

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMG_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_IMAGE_EXT.has(ext)) return cb(httpError(400, 'Unsupported image type'));
      const base = slugify(path.basename(file.originalname, ext));
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_IMAGE_MIME.has(file.mimetype)),
});

app.post('/api/images', (req, res, next) => {
  fs.mkdir(IMG_DIR, { recursive: true })
    .then(() =>
      upload.single('image')(req, res, (err) => {
        if (err) return next(err.status ? err : httpError(400, err.message));
        if (!req.file) return next(httpError(400, 'No image uploaded, or unsupported file type'));
        res.status(201).json({ path: `/assets/img/${req.file.filename}` });
      })
    )
    .catch(next);
});

// ---------- error handling ----------

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Page builder running at http://127.0.0.1:${PORT}`);
  console.log(`Editing site files in: ${ROOT}`);
});
