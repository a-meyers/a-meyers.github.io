const content = document.getElementById('content');
const toastEl = document.getElementById('toast');
let toastTimer = null;

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = 'toast' + (isError ? ' error' : '');
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- image field (upload + path text input + preview) ----------

function wireImageField(root, inputSelector, uploadBtnSelector, fileInputSelector, previewSelector) {
  const input = root.querySelector(inputSelector);
  const uploadBtn = root.querySelector(uploadBtnSelector);
  const fileInput = root.querySelector(fileInputSelector);
  const preview = root.querySelector(previewSelector);

  function updatePreview() {
    if (input.value) {
      preview.src = input.value;
      preview.classList.add('show');
    } else {
      preview.classList.remove('show');
    }
  }
  updatePreview();
  input.addEventListener('input', updatePreview);

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/images', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      input.value = data.path;
      updatePreview();
      toast('Image uploaded');
    } catch (e) {
      toast(e.message, true);
    } finally {
      fileInput.value = '';
    }
  });
}

function imageFieldHtml({ id, label, value }) {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="image-field">
        <input type="text" id="${id}" value="${escapeHtml(value || '')}" placeholder="/assets/img/example.jpg" />
        <button type="button" id="${id}-upload-btn">Upload…</button>
        <input type="file" id="${id}-file" accept="image/*" hidden />
      </div>
      <img id="${id}-preview" class="image-preview" alt="" />
    </div>`;
}

function wireImageFieldById(id) {
  wireImageField(document, `#${id}`, `#${id}-upload-btn`, `#${id}-file`, `#${id}-preview`);
}

// ---------- Quill helper ----------

function makeEditor(mountSelector, initialHtml) {
  const quill = new Quill(mountSelector, {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic', 'underline', 'link'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'code-block'],
        ['image'],
        ['clean'],
      ],
    },
  });
  if (initialHtml) quill.clipboard.dangerouslyPasteHTML(initialHtml);
  return quill;
}

// ---------- navigation ----------

const VIEWS = {
  posts: renderPostsList,
  pages: renderPagesList,
  homepage: renderHomepage,
  settings: renderSettings,
};

document.getElementById('nav-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-view]');
  if (!li) return;
  document.querySelectorAll('#nav-list li').forEach((n) => n.classList.remove('active'));
  li.classList.add('active');
  VIEWS[li.dataset.view]();
});

// ---------- Posts ----------

async function renderPostsList() {
  content.innerHTML = `
    <div class="toolbar">
      <h2>Blog Posts</h2>
      <button class="primary" id="new-post-btn">+ New Post</button>
    </div>
    <div id="posts-list"></div>
  `;
  document.getElementById('new-post-btn').addEventListener('click', () => renderPostEditor(null));

  try {
    const posts = await api('GET', '/api/posts');
    const listEl = document.getElementById('posts-list');
    if (!posts.length) {
      listEl.innerHTML = `<div class="empty-state">No posts yet. Click "New Post" to write your first one.</div>`;
      return;
    }
    const rows = posts.map((p) => `
      <tr data-filename="${escapeHtml(p.filename)}">
        <td>${escapeHtml(p.title || '(untitled)')}</td>
        <td class="muted">${escapeHtml(p.date)}</td>
        <td class="muted">${(p.tags || []).map(escapeHtml).join(', ')}</td>
      </tr>`).join('');
    listEl.innerHTML = `
      <table class="list-table">
        <thead><tr><th>Title</th><th>Date</th><th>Tags</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    listEl.querySelectorAll('tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => renderPostEditor(tr.dataset.filename));
    });
  } catch (e) {
    toast(e.message, true);
  }
}

async function renderPostEditor(filename) {
  const isNew = !filename;
  let post = { data: {}, bodyHtml: '' };
  if (!isNew) {
    try {
      post = await api('GET', `/api/posts/${encodeURIComponent(filename)}`);
    } catch (e) {
      toast(e.message, true);
      return renderPostsList();
    }
  }
  const d = post.data || {};

  content.innerHTML = `
    <span class="back-link" id="back-link">&larr; Back to posts</span>
    <h2>${isNew ? 'New Post' : 'Edit Post'}</h2>
    <div class="field-row">
      <div class="field">
        <label>Title</label>
        <input type="text" id="p-title" value="${escapeHtml(d.title)}" />
      </div>
      <div class="field">
        <label>Date</label>
        <input type="date" id="p-date" value="${isNew ? new Date().toISOString().slice(0, 10) : (filename || '').slice(0, 10)}" ${isNew ? '' : 'disabled'} />
      </div>
    </div>
    <div class="field">
      <label>Subtitle</label>
      <input type="text" id="p-subtitle" value="${escapeHtml(d.subtitle)}" />
    </div>
    <div class="field">
      <label>Tags (comma separated)</label>
      <input type="text" id="p-tags" value="${escapeHtml((d.tags || []).join(', '))}" />
    </div>
    ${imageFieldHtml({ id: 'p-cover', label: 'Cover image', value: d['cover-img'] })}
    ${imageFieldHtml({ id: 'p-thumb', label: 'Thumbnail image (optional, feed list only)', value: d['thumbnail-img'] })}
    <div class="checkbox-field">
      <input type="checkbox" id="p-comments" ${d.comments === false ? '' : 'checked'} />
      <label for="p-comments">Allow comments on this post</label>
    </div>
    <div class="field">
      <label>Content</label>
      <div class="editor-wrap"><div id="p-editor" class="editor-body"></div></div>
    </div>
    <div class="form-actions">
      ${isNew ? '' : '<button class="danger" id="delete-btn">Delete</button>'}
      <div class="spacer"></div>
      <button class="primary" id="save-btn">${isNew ? 'Create Post' : 'Save Changes'}</button>
    </div>
  `;

  document.getElementById('back-link').addEventListener('click', renderPostsList);
  wireImageFieldById('p-cover');
  wireImageFieldById('p-thumb');
  const quill = makeEditor('#p-editor', post.bodyHtml);

  document.getElementById('save-btn').addEventListener('click', async () => {
    const payload = {
      title: document.getElementById('p-title').value.trim(),
      date: document.getElementById('p-date').value,
      subtitle: document.getElementById('p-subtitle').value.trim(),
      tags: document.getElementById('p-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      coverImg: document.getElementById('p-cover').value.trim(),
      thumbnailImg: document.getElementById('p-thumb').value.trim(),
      comments: document.getElementById('p-comments').checked,
      bodyHtml: quill.root.innerHTML,
    };
    if (!payload.title) return toast('Title is required', true);
    try {
      if (isNew) {
        const res = await api('POST', '/api/posts', payload);
        toast('Post created');
        renderPostEditor(res.filename);
      } else {
        await api('PUT', `/api/posts/${encodeURIComponent(filename)}`, payload);
        toast('Post saved');
      }
    } catch (e) {
      toast(e.message, true);
    }
  });

  if (!isNew) {
    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm(`Delete "${d.title}"? This cannot be undone from the builder (the file is still recoverable via git history if you haven't committed the deletion).`)) return;
      try {
        await api('DELETE', `/api/posts/${encodeURIComponent(filename)}`);
        toast('Post deleted');
        renderPostsList();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }
}

// ---------- Static pages ----------

async function renderPagesList() {
  content.innerHTML = `<h2>Static Pages</h2><div id="pages-list"></div>`;
  try {
    const pages = await api('GET', '/api/pages');
    const rows = pages.map((p) => `
      <tr data-id="${escapeHtml(p.id)}">
        <td>${escapeHtml(p.label)}</td>
        <td class="muted">${escapeHtml(p.file)}</td>
      </tr>`).join('');
    document.getElementById('pages-list').innerHTML = `
      <table class="list-table">
        <thead><tr><th>Page</th><th>File</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    document.querySelectorAll('#pages-list tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => renderPageEditor(tr.dataset.id));
    });
  } catch (e) {
    toast(e.message, true);
  }
}

async function renderPageEditor(id) {
  let page;
  try {
    page = await api('GET', `/api/pages/${encodeURIComponent(id)}`);
  } catch (e) {
    toast(e.message, true);
    return renderPagesList();
  }
  const d = page.data || {};

  content.innerHTML = `
    <span class="back-link" id="back-link">&larr; Back to pages</span>
    <h2>${escapeHtml(page.label)}</h2>
    <div class="field">
      <label>Title</label>
      <input type="text" id="pg-title" value="${escapeHtml(d.title)}" />
    </div>
    <div class="field">
      <label>Subtitle</label>
      <input type="text" id="pg-subtitle" value="${escapeHtml(d.subtitle)}" />
    </div>
    ${imageFieldHtml({ id: 'pg-bigimg', label: 'Cover image (optional)', value: d.bigimg })}
    <div class="field">
      <label>Content</label>
      <div class="editor-wrap"><div id="pg-editor" class="editor-body"></div></div>
    </div>
    <div class="form-actions">
      <div class="spacer"></div>
      <button class="primary" id="save-btn">Save Changes</button>
    </div>
  `;

  document.getElementById('back-link').addEventListener('click', renderPagesList);
  wireImageFieldById('pg-bigimg');
  const quill = makeEditor('#pg-editor', page.bodyHtml);

  document.getElementById('save-btn').addEventListener('click', async () => {
    try {
      await api('PUT', `/api/pages/${encodeURIComponent(id)}`, {
        title: document.getElementById('pg-title').value.trim(),
        subtitle: document.getElementById('pg-subtitle').value.trim(),
        bigimg: document.getElementById('pg-bigimg').value.trim(),
        bodyHtml: quill.root.innerHTML,
      });
      toast('Page saved');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// ---------- Homepage intro ----------

async function renderHomepage() {
  let home;
  try {
    home = await api('GET', '/api/homepage');
  } catch (e) {
    toast(e.message, true);
    return;
  }
  content.innerHTML = `
    <h2>Homepage Intro</h2>
    <p class="muted">This edits the title, subtitle, and italic disclaimer text at the top of your homepage. The blog post listing below it is generated automatically and isn't edited here.</p>
    <div class="field">
      <label>Title</label>
      <input type="text" id="h-title" value="${escapeHtml(home.title)}" />
    </div>
    <div class="field">
      <label>Subtitle</label>
      <input type="text" id="h-subtitle" value="${escapeHtml(home.subtitle)}" />
    </div>
    <div class="field">
      <label>Disclaimer text</label>
      <textarea id="h-disclaimer" rows="4">${escapeHtml(home.disclaimer)}</textarea>
    </div>
    <div class="form-actions">
      <div class="spacer"></div>
      <button class="primary" id="save-btn">Save Changes</button>
    </div>
  `;
  document.getElementById('save-btn').addEventListener('click', async () => {
    try {
      await api('PUT', '/api/homepage', {
        title: document.getElementById('h-title').value.trim(),
        subtitle: document.getElementById('h-subtitle').value.trim(),
        disclaimer: document.getElementById('h-disclaimer').value.trim(),
      });
      toast('Homepage saved');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// ---------- Settings ----------

const COLOR_FIELD_LABELS = {
  'page-col': 'Page background',
  'text-col': 'Text',
  'link-col': 'Links',
  'hover-col': 'Link hover',
  'navbar-col': 'Navbar background',
  'navbar-text-col': 'Navbar text',
  'navbar-border-col': 'Navbar border',
  'footer-col': 'Footer background',
  'footer-text-col': 'Footer text',
  'footer-link-col': 'Footer links',
  'footer-hover-col': 'Footer link hover',
};

const SOCIAL_NETWORK_OPTIONS = [
  'email', 'linkedin', 'github', 'twitter', 'youtube', 'instagram',
  'mastodon', 'bluesky', 'reddit', 'discord', 'patreon', 'rss',
];

function kvRowsHtml(pairs, { keyPlaceholder, valuePlaceholder, keyIsSelect }) {
  return pairs.map(([k, v], i) => `
    <div class="kv-row" data-idx="${i}">
      ${keyIsSelect
        ? `<select class="kv-key">${SOCIAL_NETWORK_OPTIONS.map((o) => `<option value="${o}" ${o === k ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<input class="kv-key" type="text" placeholder="${keyPlaceholder}" value="${escapeHtml(k)}" />`}
      <input class="kv-value" type="text" placeholder="${valuePlaceholder}" value="${escapeHtml(v)}" />
      <button type="button" class="kv-remove danger">Remove</button>
    </div>`).join('');
}

function wireKvEditor(containerId, addBtnId, { keyPlaceholder, valuePlaceholder, keyIsSelect }) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('kv-remove')) {
      e.target.closest('.kv-row').remove();
    }
  });
  document.getElementById(addBtnId).addEventListener('click', () => {
    const row = el(`<div class="kv-row">
      ${keyIsSelect
        ? `<select class="kv-key">${SOCIAL_NETWORK_OPTIONS.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>`
        : `<input class="kv-key" type="text" placeholder="${keyPlaceholder}" />`}
      <input class="kv-value" type="text" placeholder="${valuePlaceholder}" />
      <button type="button" class="kv-remove danger">Remove</button>
    </div>`);
    container.appendChild(row);
  });
}

function readKvEditor(containerId) {
  const out = {};
  document.querySelectorAll(`#${containerId} .kv-row`).forEach((row) => {
    const k = row.querySelector('.kv-key').value.trim();
    const v = row.querySelector('.kv-value').value.trim();
    if (k && v) out[k] = v;
  });
  return out;
}

async function renderSettings() {
  let s;
  try {
    s = await api('GET', '/api/settings');
  } catch (e) {
    toast(e.message, true);
    return;
  }

  content.innerHTML = `
    <h2>Site Design &amp; Settings</h2>

    <div class="settings-section">
      <h3>General</h3>
      <div class="field-row">
        <div class="field"><label>Site title</label><input type="text" id="s-title" value="${escapeHtml(s.title)}" /></div>
        <div class="field"><label>Author</label><input type="text" id="s-author" value="${escapeHtml(s.author)}" /></div>
      </div>
      ${imageFieldHtml({ id: 's-avatar', label: 'Avatar image', value: s.avatar })}
      <div class="checkbox-field">
        <input type="checkbox" id="s-round-avatar" ${s['round-avatar'] ? 'checked' : ''} />
        <label for="s-round-avatar">Round avatar</label>
      </div>
      <div class="field"><label>RSS description</label><input type="text" id="s-rss" value="${escapeHtml(s['rss-description'])}" /></div>
      <div class="field"><label>Google Analytics tag ID</label><input type="text" id="s-gtag" value="${escapeHtml(s.gtag)}" /></div>
    </div>

    <div class="settings-section">
      <h3>Colors</h3>
      <div class="color-grid">
        ${Object.entries(COLOR_FIELD_LABELS).map(([key, label]) => `
          <div class="color-field">
            <input type="color" id="c-${key}" value="${/^#[0-9a-fA-F]{6}$/.test(s[key]) ? s[key] : '#ffffff'}" />
            <span>${label}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <h3>Navigation bar links</h3>
      <p class="muted">Label shown in the navbar, and the page it links to (e.g. "aboutme" or a full URL).</p>
      <div id="navbar-kv">${kvRowsHtml(Object.entries(s.navbarLinks || {}), { keyPlaceholder: 'Label', valuePlaceholder: 'Target (e.g. aboutme)' })}</div>
      <button type="button" id="navbar-add">+ Add link</button>
    </div>

    <div class="settings-section">
      <h3>Social links (footer)</h3>
      <div id="social-kv">${kvRowsHtml(Object.entries(s.socialLinks || {}), { keyPlaceholder: 'Network', valuePlaceholder: 'Username / value', keyIsSelect: true })}</div>
      <button type="button" id="social-add">+ Add social link</button>
    </div>

    <div class="form-actions">
      <div class="spacer"></div>
      <button class="primary" id="save-btn">Save Settings</button>
    </div>
  `;

  wireImageFieldById('s-avatar');
  wireKvEditor('navbar-kv', 'navbar-add', { keyPlaceholder: 'Label', valuePlaceholder: 'Target (e.g. aboutme)' });
  wireKvEditor('social-kv', 'social-add', { keyPlaceholder: 'Network', valuePlaceholder: 'Username / value', keyIsSelect: true });

  document.getElementById('save-btn').addEventListener('click', async () => {
    const payload = {
      title: document.getElementById('s-title').value.trim(),
      author: document.getElementById('s-author').value.trim(),
      avatar: document.getElementById('s-avatar').value.trim(),
      'round-avatar': document.getElementById('s-round-avatar').checked,
      'rss-description': document.getElementById('s-rss').value.trim(),
      gtag: document.getElementById('s-gtag').value.trim(),
      navbarLinks: readKvEditor('navbar-kv'),
      socialLinks: readKvEditor('social-kv'),
    };
    for (const key of Object.keys(COLOR_FIELD_LABELS)) {
      payload[key] = document.getElementById(`c-${key}`).value;
    }
    try {
      await api('PUT', '/api/settings', payload);
      toast('Settings saved');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// ---------- init ----------

renderPostsList();
