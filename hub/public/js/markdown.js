// Markdown tối giản, an toàn: mọi chữ người dùng gõ đều được escape trước,
// chỉ các thẻ do file này tự sinh mới thành HTML. Không dùng thư viện ngoài.
//
// Hỗ trợ: # tiêu đề, **đậm**, *nghiêng*, ~~gạch~~, `code`, ```khối code```,
// - danh sách, 1. danh sách số, - [ ] việc cần làm, > trích dẫn, ---,
// [chữ](https://...), link trần, ![ảnh](att:ID) và [file](att:ID) cho file đính kèm.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const ATT_ID = '[A-Za-z0-9_-]{8,64}';
const TASK_RE = /^(\s*[-*+]\s+)\[([ xX])\](.*)$/;

function safeUrl(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  if (new RegExp(`^att:${ATT_ID}$`).test(url)) return url;
  return null;
}

function inline(text) {
  const tokens = [];
  const stash = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = text.replace(/\u0000/g, '');

  s = s.replace(/`([^`]+)`/g, (_, c) => stash(`<code>${esc(c)}</code>`));
  s = s.replace(new RegExp(`!\\[([^\\]]*)\\]\\(att:(${ATT_ID})\\)`, 'g'), (_, alt, id) =>
    stash(`<img class="att-img" data-att="${id}" alt="${esc(alt)}">`),
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url);
    if (!u) return m;
    if (u.startsWith('att:')) return stash(`<a href="#" class="att-link" data-att="${u.slice(4)}">${esc(label)}</a>`);
    return stash(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
  });
  s = s.replace(/https?:\/\/[^\s<>"'`]+/g, (url) => {
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    const clean = trail ? url.slice(0, -trail.length) : url;
    return stash(`<a href="${esc(clean)}" target="_blank" rel="noopener noreferrer">${esc(clean)}</a>`) + trail;
  });

  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`;
    para = [];
  };
  const openList = (type) => {
    flushPara();
    if (list !== type) {
      closeList();
      html += `<${type}>`;
      list = type;
    }
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const block = () => {
    flushPara();
    closeList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^\s*```/.test(line)) {
      block();
      const buf = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i]);
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
    } else if (!line.trim()) {
      block();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      block();
      const n = m[1].length;
      html += `<h${n}>${inline(m[2])}</h${n}>`;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      block();
      html += '<hr>';
    } else if ((m = line.match(TASK_RE))) {
      openList('ul');
      const done = m[2] !== ' ';
      html += `<li class="task${done ? ' done' : ''}"><label><input type="checkbox" data-line="${i}"${done ? ' checked' : ''}> <span>${inline(m[3].trim())}</span></label></li>`;
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      openList('ul');
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      openList('ol');
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      block();
      html += `<blockquote>${inline(m[1])}</blockquote>`;
    } else {
      closeList();
      para.push(line);
    }
  }
  block();
  return html;
}

// Bấm ô vuông trong chế độ xem thì đổi [ ] <-> [x] ở đúng dòng đó trong nguồn.
export function toggleTask(src, lineIndex) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const m = lines[lineIndex]?.match(TASK_RE);
  if (!m) return src;
  lines[lineIndex] = `${m[1]}[${m[2] === ' ' ? 'x' : ' '}]${m[3]}`;
  return lines.join('\n');
}

export function taskStats(src) {
  let total = 0;
  let done = 0;
  for (const line of String(src ?? '').split('\n')) {
    const m = line.match(TASK_RE);
    if (m) {
      total++;
      if (m[2] !== ' ') done++;
    }
  }
  return { total, done };
}
