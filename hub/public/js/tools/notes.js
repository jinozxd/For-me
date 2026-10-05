// Tiện ích Ghi chú: Markdown, checklist, thư mục, thẻ, tìm kiếm không dấu, file đính kèm.

import { randomId } from '../crypto.js';
import { isInlineImage } from '../files.js';
import { renderMarkdown, taskStats, toggleTask } from '../markdown.js';
import { clear, confirmBox, fold, formatBytes, formatTime, h, toast } from '../ui.js';

const TYPE = 'note';
const SAVE_DELAY = 600;
const NO_FOLDER = '\u0000none';

export default {
  id: 'notes',
  name: 'Ghi chú',
  icon: '📝',
  mount,
};

function blankNote() {
  const now = Date.now();
  return { type: TYPE, title: '', body: '', folder: '', tags: [], pinned: false, attachments: [], createdAt: now, updatedAt: now };
}

function isEmpty(n) {
  return !n.title.trim() && !n.body.trim() && !n.attachments?.length;
}

function parseTags(s) {
  return [...new Set(s.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];
}

function mount(root, { store, files }) {
  const state = { openId: null, query: '', folder: '', tag: '', preview: false };
  let saveTimer = null;
  let draft = null; // bản đang sửa (chưa chắc đã lưu)

  const search = h('input', { type: 'search', placeholder: 'Tìm (không cần dấu)…', class: 'search' });
  const folderSel = h('select', { class: 'folder-filter', 'aria-label': 'Lọc theo thư mục' });
  const tagBar = h('div', { class: 'tag-bar' });
  const list = h('ul', { class: 'note-list' });
  const editorEl = h('section', { class: 'note-editor' });
  const folderList = h('datalist', { id: 'folder-options' });
  const layout = h(
    'div',
    { class: 'notes' },
    h(
      'aside',
      { class: 'notes-side' },
      h('div', { class: 'row' }, search, h('button', { class: 'btn primary', onclick: () => createNote() }, '+ Mới')),
      folderSel,
      tagBar,
      list,
    ),
    editorEl,
    folderList,
  );
  root.append(layout);

  search.addEventListener('input', () => {
    state.query = search.value;
    renderList();
  });
  folderSel.addEventListener('change', () => {
    state.folder = folderSel.value;
    renderList();
  });

  const off = store.on(({ ids, conflict }) => {
    if (!ids.length) return; // chỉ là đổi trạng thái đồng bộ
    if (conflict && conflict.id === state.openId && draft) {
      // Bản đang mở vừa bị máy khác sửa: chuyển sang bản sao, mang theo cả phần vừa gõ chưa kịp lưu.
      state.openId = conflict.copyId;
      draft.conflictOf = conflict.id;
      flush().then(() => {
        renderEditor();
        renderSidebar();
      });
      toast('Ghi chú này vừa được sửa ở máy khác. Phần cậu đang gõ được giữ trong bản "xung đột".');
      return;
    }
    renderSidebar();
    // Bản đang mở vừa đổi từ máy khác: nạp lại nếu ở máy này không có gì đang gõ dở.
    if (state.openId && ids.includes(state.openId) && !saveTimer && !store.outbox.has(state.openId)) {
      const fresh = store.get(state.openId);
      if (!fresh) closeEditor();
      else if (JSON.stringify(fresh) !== JSON.stringify(draft) && !editorEl.contains(document.activeElement)) {
        draft = structuredClone(fresh);
        renderEditor();
      }
    }
  });

  function notes() {
    return store.list(TYPE);
  }

  function renderSidebar() {
    const all = notes();
    const folders = [...new Set(all.map((n) => n.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    clear(
      folderSel,
      h('option', { value: '' }, 'Tất cả thư mục'),
      folders.map((f) => h('option', { value: f }, f)),
      h('option', { value: NO_FOLDER }, '(Không thư mục)'),
    );
    folderSel.value = state.folder;
    if (folderSel.value !== state.folder) state.folder = folderSel.value = '';
    clear(folderList, folders.map((f) => h('option', { value: f })));

    const tags = [...new Set(all.flatMap((n) => n.tags ?? []))].sort((a, b) => a.localeCompare(b, 'vi'));
    if (state.tag && !tags.includes(state.tag)) state.tag = '';
    clear(
      tagBar,
      tags.map((t) =>
        h(
          'button',
          {
            class: `chip${state.tag === t ? ' active' : ''}`,
            onclick: () => {
              state.tag = state.tag === t ? '' : t;
              renderSidebar();
            },
          },
          `#${t}`,
        ),
      ),
    );
    renderList();
  }

  function filtered() {
    const words = fold(state.query).split(/\s+/).filter(Boolean);
    return notes()
      .filter((n) => {
        if (state.folder === NO_FOLDER && n.folder) return false;
        if (state.folder && state.folder !== NO_FOLDER && n.folder !== state.folder && !n.folder?.startsWith(`${state.folder}/`)) return false;
        if (state.tag && !n.tags?.includes(state.tag)) return false;
        if (!words.length) return true;
        const hay = fold([n.title, n.body, n.folder, ...(n.tags ?? []), ...(n.attachments ?? []).map((a) => a.name)].join(' '));
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  }

  function renderList() {
    const items = filtered();
    if (!items.length) {
      clear(list, h('li', { class: 'empty muted' }, notes().length ? 'Không có ghi chú nào khớp.' : 'Chưa có ghi chú nào. Bấm "+ Mới".'));
      return;
    }
    clear(
      list,
      items.map((n) => {
        const tasks = taskStats(n.body);
        const snippet = n.body
          .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '')
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[#*>`~|]/g, ' ')
          .replace(/^\s*[-+]\s+/gm, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 90);
        return h(
          'li',
          {
            class: `note-item${n.id === state.openId ? ' active' : ''}`,
            tabindex: '0',
            onclick: () => openNote(n.id),
            onkeydown: (e) => e.key === 'Enter' && openNote(n.id),
          },
          h(
            'div',
            { class: 'note-item-title' },
            n.pinned ? h('span', { class: 'pin', title: 'Đã ghim' }, '📌 ') : null,
            n.conflictOf ? h('span', { class: 'badge warn', title: 'Bản sao do sửa cùng lúc trên hai máy' }, 'xung đột') : null,
            n.title.trim() || 'Không tiêu đề',
          ),
          snippet ? h('div', { class: 'note-item-snippet muted' }, snippet) : null,
          h(
            'div',
            { class: 'note-item-meta muted small' },
            [
              n.folder ? `📁 ${n.folder}` : null,
              tasks.total ? `☑ ${tasks.done}/${tasks.total}` : null,
              n.attachments?.length ? `📎 ${n.attachments.length}` : null,
              (n.tags ?? []).map((t) => `#${t}`).join(' ') || null,
              formatTime(n.updatedAt),
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        );
      }),
    );
  }

  async function createNote() {
    await flush();
    const id = randomId();
    const n = blankNote();
    if (state.folder && state.folder !== NO_FOLDER) n.folder = state.folder;
    if (state.tag) n.tags = [state.tag];
    state.openId = id;
    draft = n;
    state.preview = false;
    renderEditor();
    layout.classList.add('editing');
    editorEl.querySelector('.note-title')?.focus();
  }

  async function openNote(id) {
    if (id === state.openId) {
      layout.classList.add('editing');
      return;
    }
    await flush();
    const n = store.get(id);
    if (!n) return;
    state.openId = id;
    draft = structuredClone(n);
    draft.attachments ??= [];
    draft.tags ??= [];
    state.preview = !!n.body.trim();
    renderEditor();
    renderList();
    layout.classList.add('editing');
  }

  async function closeEditor() {
    await flush();
    state.openId = null;
    draft = null;
    layout.classList.remove('editing');
    renderEditor();
    renderList();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    statusEl().textContent = 'Đang lưu…';
    saveTimer = setTimeout(flush, SAVE_DELAY);
  }

  // Ghi bản nháp xuống kho (kho tự mã hoá và đồng bộ). Ghi chú rỗng thì không lưu.
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!state.openId || !draft) return;
    const id = state.openId;
    const saved = store.get(id);
    if (isEmpty(draft)) {
      if (saved) await store.remove(id);
      return;
    }
    if (saved && JSON.stringify(saved) === JSON.stringify(draft)) return;
    draft.updatedAt = Date.now();
    await store.put(id, structuredClone(draft));
    const el = statusEl();
    if (el) el.textContent = `Đã lưu ${formatTime(draft.updatedAt)}`;
  }

  function statusEl() {
    return editorEl.querySelector('.save-status') ?? { textContent: '' };
  }

  function renderEditor() {
    if (!state.openId || !draft) {
      clear(editorEl, h('div', { class: 'empty-editor muted' }, h('p', {}, 'Chọn một ghi chú hoặc bấm "+ Mới".')));
      return;
    }
    const n = draft;
    const title = h('input', { class: 'note-title', placeholder: 'Tiêu đề', value: n.title });
    title.addEventListener('input', () => {
      n.title = title.value;
      scheduleSave();
    });
    const folder = h('input', { placeholder: 'Thư mục, vd: Học/Toán', value: n.folder, list: 'folder-options' });
    folder.addEventListener('input', () => {
      n.folder = folder.value.trim().replace(/\/+$/, '');
      scheduleSave();
    });
    const tags = h('input', { placeholder: 'Thẻ, cách nhau dấu phẩy', value: n.tags.join(', ') });
    tags.addEventListener('input', () => {
      n.tags = parseTags(tags.value);
      scheduleSave();
    });

    const body = h('textarea', { class: 'note-body', placeholder: 'Viết gì đó… (hỗ trợ Markdown, "- [ ] việc" để tạo checklist)' });
    body.value = n.body;
    body.addEventListener('input', () => {
      n.body = body.value;
      scheduleSave();
    });
    const preview = h('div', { class: 'note-preview md' });
    const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
    fileInput.addEventListener('change', () => {
      const picked = [...fileInput.files];
      fileInput.value = '';
      attach(picked);
    });

    const modeBtn = h('button', { class: 'btn', onclick: () => setMode(!state.preview) });
    function setMode(p) {
      state.preview = p;
      modeBtn.textContent = p ? '✏️ Sửa' : '👁 Xem';
      body.hidden = p;
      tools.hidden = p;
      preview.hidden = !p;
      if (p) renderPreview(preview, body);
      else body.focus();
    }

    const insert = (before, after = '', linePrefix = false) => () => {
      if (state.preview) setMode(false);
      const { selectionStart: s, selectionEnd: e, value } = body;
      if (linePrefix) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        body.setRangeText(before, lineStart, lineStart, 'end');
      } else {
        body.setRangeText(before + value.slice(s, e) + after, s, e, 'end');
      }
      body.dispatchEvent(new Event('input'));
      body.focus();
    };
    const tools = h(
      'div',
      { class: 'editor-tools' },
      h('button', { class: 'btn small', title: 'Việc cần làm', onclick: insert('- [ ] ', '', true) }, '☐ Việc'),
      h('button', { class: 'btn small', title: 'Danh sách', onclick: insert('- ', '', true) }, '• Ý'),
      h('button', { class: 'btn small', title: 'Tiêu đề', onclick: insert('## ', '', true) }, 'H'),
      h('button', { class: 'btn small', title: 'Đậm', onclick: insert('**', '**') }, h('strong', {}, 'B')),
      h('button', { class: 'btn small', title: 'Nghiêng', onclick: insert('*', '*') }, h('em', {}, 'I')),
      h('button', { class: 'btn small', title: 'Đính kèm file', onclick: () => fileInput.click() }, '📎 File'),
    );

    const pinBtn = h(
      'button',
      {
        class: `btn${n.pinned ? ' active' : ''}`,
        title: 'Ghim lên đầu',
        onclick: () => {
          n.pinned = !n.pinned;
          pinBtn.classList.toggle('active', n.pinned);
          scheduleSave();
        },
      },
      '📌',
    );

    clear(
      editorEl,
      h(
        'div',
        { class: 'editor-top' },
        h('button', { class: 'btn back', onclick: () => closeEditor(), 'aria-label': 'Quay lại danh sách' }, '←'),
        title,
        pinBtn,
        modeBtn,
        h('button', { class: 'btn danger', title: 'Xoá ghi chú', onclick: () => deleteNote() }, '🗑'),
      ),
      n.conflictOf
        ? h(
            'p',
            { class: 'notice warn' },
            'Bản này được tách ra vì ghi chú bị sửa cùng lúc trên hai máy. So với bản gốc, giữ phần cần thiết rồi xoá bản thừa.',
          )
        : null,
      h('div', { class: 'editor-meta' }, folder, tags),
      tools,
      body,
      preview,
      fileInput,
      h('div', { class: 'attachments' }, renderAttachments(body)),
      h('div', { class: 'save-status muted small' }, store.get(state.openId) ? `Đã lưu ${formatTime(n.updatedAt)}` : 'Chưa lưu'),
    );
    setMode(state.preview);

    // Thả file vào ô soạn thảo để đính kèm.
    body.addEventListener('dragover', (e) => e.preventDefault());
    body.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      attach([...e.dataTransfer.files]);
    });
    body.addEventListener('paste', (e) => {
      const pasted = [...(e.clipboardData?.files ?? [])];
      if (pasted.length) {
        e.preventDefault();
        attach(pasted);
      }
    });
  }

  function renderPreview(preview, body) {
    preview.innerHTML = renderMarkdown(draft.body) || '<p class="muted">(Trống)</p>';
    for (const box of preview.querySelectorAll('input[type=checkbox][data-line]')) {
      box.addEventListener('change', () => {
        draft.body = toggleTask(draft.body, Number(box.dataset.line));
        body.value = draft.body;
        box.closest('li')?.classList.toggle('done', box.checked);
        scheduleSave();
      });
    }
    for (const img of preview.querySelectorAll('img[data-att]')) {
      const att = draft.attachments.find((a) => a.id === img.dataset.att);
      if (!att || !isInlineImage(att)) {
        img.replaceWith(h('span', { class: 'muted' }, `[ảnh không có: ${img.alt}]`));
        continue;
      }
      files
        .url(att)
        .then((url) => (img.src = url))
        .catch(() => img.replaceWith(h('span', { class: 'muted' }, `[không tải được ảnh: ${att.name}]`)));
    }
    for (const a of preview.querySelectorAll('a[data-att]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const att = draft.attachments.find((x) => x.id === a.dataset.att);
        if (att) files.download(att).catch((err) => toast(err.message, 'error'));
      });
    }
  }

  function renderAttachments(body) {
    if (!draft.attachments.length) return [];
    return [
      h('div', { class: 'muted small' }, 'File đính kèm'),
      h(
        'ul',
        { class: 'att-list' },
        draft.attachments.map((att) =>
          h(
            'li',
            {},
            h('span', { class: 'att-name' }, `📎 ${att.name}`),
            h('span', { class: 'muted small' }, formatBytes(att.size)),
            h('button', { class: 'btn small', onclick: () => files.download(att).catch((e) => toast(e.message, 'error')) }, 'Tải về'),
            h('button', { class: 'btn small', onclick: () => insertAttachment(att, body) }, 'Chèn'),
            h('button', { class: 'btn small danger', onclick: () => removeAttachment(att) }, 'Xoá'),
          ),
        ),
      ),
    ];
  }

  function insertAttachment(att, body) {
    if (state.preview) {
      state.preview = false;
      renderEditor();
      body = editorEl.querySelector('.note-body');
    }
    const md = isInlineImage(att) ? `![${att.name}](att:${att.id})` : `[📎 ${att.name}](att:${att.id})`;
    const pos = body.selectionEnd ?? body.value.length;
    body.setRangeText(`${pos && body.value[pos - 1] !== '\n' ? '\n' : ''}${md}\n`, pos, pos, 'end');
    body.dispatchEvent(new Event('input'));
  }

  async function attach(list) {
    const id = state.openId;
    for (const file of list) {
      toast(`Đang mã hoá và tải lên "${file.name}"…`);
      try {
        const att = await files.upload(file);
        if (state.openId !== id) return;
        draft.attachments.push(att);
        await flush();
        renderEditor();
        insertAttachment(att, editorEl.querySelector('.note-body'));
        toast(`Đã đính kèm "${file.name}"`);
      } catch (e) {
        toast(e.message, 'error');
      }
    }
  }

  async function removeAttachment(att) {
    if (!(await confirmBox(`Xoá file "${att.name}"? Chỗ đã chèn file này trong ghi chú sẽ không hiện nữa.`, 'Xoá'))) return;
    try {
      await files.remove(att.id);
    } catch (e) {
      return toast(e.message, 'error');
    }
    draft.attachments = draft.attachments.filter((a) => a.id !== att.id);
    await flush();
    renderEditor();
  }

  async function deleteNote() {
    const n = draft;
    if (!(await confirmBox(`Xoá ghi chú "${n.title.trim() || 'Không tiêu đề'}"${n.attachments.length ? ` và ${n.attachments.length} file đính kèm` : ''}?`, 'Xoá'))) return;
    const id = state.openId;
    clearTimeout(saveTimer);
    saveTimer = null;
    for (const att of n.attachments) await files.remove(att.id).catch(() => {});
    if (store.get(id)) await store.remove(id);
    state.openId = null;
    draft = null;
    layout.classList.remove('editing');
    renderEditor();
    renderSidebar();
  }

  renderSidebar();
  renderEditor();

  return () => {
    flush();
    off();
  };
}
