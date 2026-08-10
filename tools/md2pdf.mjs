// 제출용 마크다운 → PDF. 의존성 0건 — 렌더는 이미 깔려 있는 Chrome의 --print-to-pdf에 맡긴다.
//   node tools/md2pdf.mjs docs/submission/ai-tech-doc.md
// 결과: 같은 경로에 .pdf (중간 산출 .print.html은 지운다. --keep-html로 남길 수 있다)
//
// ponytail: 이 저장소의 제출 문서가 쓰는 문법만 처리한다 — 제목·표·코드펜스·인용·목록
// (체크박스 포함)·강조·인라인코드·링크. 이미지·각주·HTML 블록은 안 쓰므로 다루지 않는다.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
].find(p => existsSync(p));

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 인라인: 코드 스팬을 먼저 뽑아 자리표시자로 치환한다 — 코드 안의 *·_가 강조로 먹히지 않게.
function inline(src) {
  const code = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => code[i]);
}

const cells = row => row.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  const flushList = (buf, ordered) => {
    // buf: [{depth, text, check}] — depth 0/1만 나온다 (더 깊은 중첩은 이 문서군에 없다)
    let html = ordered ? '<ol>' : '<ul>', open = false;
    for (const it of buf) {
      if (it.depth > 0 && !open) { html += '<ul class="sub">'; open = true; }
      else if (it.depth === 0 && open) { html += '</ul>'; open = false; }
      const box = it.check === null ? ''
        : `<span class="box">${it.check ? '&#10003;' : '&#9633;'}</span> `;
      html += `<li${it.check !== null ? ' class="task"' : ''}>${box}${it.text}</li>`;
    }
    if (open) html += '</ul>';
    out.push(html + (ordered ? '</ol>' : '</ul>'));
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {                                   // 코드 펜스
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {                              // 제목
      const n = line.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(line.slice(n + 1).trim())}</h${n}>`);
      i++;
      continue;
    }

    if (/^(---|===)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (/^\|/.test(line) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {   // 표
      const head = cells(line);
      i += 2;
      const body = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) body.push(cells(lines[i]));
      out.push('<table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    if (/^>\s?/.test(line)) {                                  // 인용 (연속 줄 = 한 덩어리)
      const buf = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ''));
      // 빈 줄로 나뉜 문단은 유지, 이어지는 줄은 합친다
      const paras = buf.join('\n').split(/\n\s*\n/).map(p => `<p>${inline(p.replace(/\n/g, ' '))}</p>`);
      out.push(`<blockquote>${paras.join('')}</blockquote>`);
      continue;
    }

    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {                                                  // 목록
      const ordered = /\d/.test(li[2]);
      const buf = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m && /\d/.test(m[2]) === ordered) {
          let text = m[3], check = null;
          const cb = text.match(/^\[([ xX])\]\s+(.*)$/);
          if (cb) { check = cb[1].toLowerCase() === 'x'; text = cb[2]; }
          buf.push({ depth: m[1].length >= 2 ? 1 : 0, text: inline(text), check });
          i++;
        } else if (/^\s+\S/.test(lines[i] || '') && buf.length) {
          buf[buf.length - 1].text += ' ' + inline(lines[i].trim());   // 항목의 이어지는 줄
          i++;
        } else break;
      }
      flushList(buf, ordered);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const buf = [];                                            // 문단
    for (; i < lines.length && lines[i].trim()
      && !/^(#{1,6}\s|```|>|\||\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) buf.push(lines[i].trim());
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 16mm; }
* { box-sizing: border-box; }
body {
  margin: 0; color: #1a1a1a; background: #fff;
  font-family: "Pretendard", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
  font-size: 10pt; line-height: 1.72; word-break: keep-all; overflow-wrap: anywhere;
}
h1 { font-size: 20pt; line-height: 1.35; margin: 0 0 14pt; padding-bottom: 8pt;
     border-bottom: 2.5pt solid #1a1a1a; letter-spacing: -.02em; }
h2 { font-size: 14pt; margin: 22pt 0 8pt; padding-top: 8pt; border-top: .8pt solid #d0d0d0;
     letter-spacing: -.01em; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 15pt 0 6pt; color: #000; break-after: avoid; }
h4 { font-size: 10.5pt; margin: 12pt 0 5pt; color: #333; break-after: avoid; }
h1 + *, h2 + *, h3 + *, h4 + * { break-before: avoid; }
p { margin: 0 0 7pt; }
strong { font-weight: 700; }
a { color: #1a1a1a; text-decoration: none; border-bottom: .5pt solid #999; }
code { font-family: "Consolas", "D2Coding", monospace; font-size: .87em;
       background: #f2f2f2; padding: .5pt 2.5pt; border-radius: 2pt; }
pre { background: #f7f7f7; border: .5pt solid #ddd; border-left: 2.5pt solid #888;
      padding: 8pt 10pt; margin: 8pt 0 10pt; overflow: hidden; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8pt; line-height: 1.5;
           white-space: pre-wrap; }
blockquote { margin: 8pt 0 10pt; padding: 7pt 11pt; background: #f7f7f7;
             border-left: 2.5pt solid #bbb; break-inside: avoid; }
blockquote p { margin: 0 0 4pt; } blockquote p:last-child { margin: 0; }
ul, ol { margin: 0 0 8pt; padding-left: 17pt; }
li { margin-bottom: 3pt; }
ul.sub { margin: 3pt 0 0; padding-left: 15pt; }
li.task { list-style: none; margin-left: -14pt; }
.box { font-family: monospace; }
/* 표는 행 단위로 쪼개지게 둔다 — 통째로 avoid하면 긴 표가 페이지 하나를 통으로 비운다 */
table { width: 100%; border-collapse: collapse; margin: 8pt 0 11pt;
        font-size: 8.6pt; line-height: 1.5; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
th, td { border: .5pt solid #ccc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #efefef; font-weight: 700; white-space: nowrap; }
tbody tr:nth-child(even) { background: #fafafa; }
td code { font-size: .85em; }
hr { border: 0; border-top: .5pt solid #ddd; margin: 12pt 0; }
`;

const src = process.argv[2];
if (!src) { console.error('usage: node tools/md2pdf.mjs <file.md> [--keep-html]'); process.exit(1); }
if (!CHROME) { console.error('Chrome을 찾지 못했다 — CHROME 경로 목록을 확인할 것'); process.exit(1); }

const mdPath = resolve(src);
const htmlPath = mdPath.replace(/\.md$/, '.print.html');
const pdfPath = mdPath.replace(/\.md$/, '.pdf');
const md = readFileSync(mdPath, 'utf8');
const title = (md.match(/^#\s+(.*)$/m) || [, basename(mdPath)])[1].replace(/`/g, '');

writeFileSync(htmlPath,
  `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
  + `<title>${esc(title)}</title><style>${CSS}</style></head><body>\n${mdToHtml(md)}\n</body></html>`,
  'utf8');

execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'inherit' });

if (!process.argv.includes('--keep-html')) unlinkSync(htmlPath);
console.log(`→ ${pdfPath}`);
