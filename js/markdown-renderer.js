(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(value) {
    const codeSpans = [];
    let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
      const token = `\u0000${codeSpans.length}\u0000`;
      codeSpans.push(`<code>${code}</code>`);
      return token;
    });

    html = html
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '<strong>$1$2</strong>')
      .replace(/\*(.+?)\*|_(.+?)_/g, '<em>$1$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');

    return html.replace(/\u0000(\d+)\u0000/g, (_, index) => codeSpans[Number(index)]);
  }

  function isFence(line) {
    return /^\s{0,3}(```+|~~~+)/.test(line);
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index++;
        continue;
      }

      const fence = line.match(/^\s{0,3}(```+|~~~+)\s*([a-zA-Z0-9_-]*)\s*$/);
      if (fence) {
        const codeLines = [];
        const marker = fence[1][0];
        const markerLength = fence[1].length;
        index++;
        while (index < lines.length && !new RegExp(`^\\s{0,3}${marker}{${markerLength},}\\s*$`).test(lines[index])) {
          codeLines.push(lines[index++]);
        }
        if (index < lines.length) index++;
        const language = fence[2] ? ` class="language-${fence[2]}"` : '';
        blocks.push(`<pre><code${language}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        index++;
        continue;
      }

      if (/^\s{0,3}((\*[\s]*){3,}|(-[\s]*){3,}|(_[\s]*){3,})$/.test(line)) {
        blocks.push('<hr>');
        index++;
        continue;
      }

      if (/^\s{0,3}>/.test(line)) {
        const quoteLines = [];
        while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
          quoteLines.push(lines[index++].replace(/^\s{0,3}>\s?/, ''));
        }
        blocks.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
        continue;
      }

      const listMatch = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
      if (listMatch) {
        const ordered = /^\d/.test(listMatch[1]);
        const tag = ordered ? 'ol' : 'ul';
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
          if (!item || /^\d/.test(item[1]) !== ordered) break;
          const task = item[2].match(/^\[([ xX])\]\s+(.*)$/);
          if (task) {
            const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
            items.push(`<li><input type="checkbox" disabled${checked}> ${renderInline(task[2])}</li>`);
          } else {
            items.push(`<li>${renderInline(item[2])}</li>`);
          }
          index++;
        }
        blocks.push(`<${tag}>${items.join('')}</${tag}>`);
        continue;
      }

      if (line.includes('|') && index + 1 < lines.length
        && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
        const headings = splitTableRow(line);
        const alignments = splitTableRow(lines[index + 1]).map(cell => (
          cell.startsWith(':') && cell.endsWith(':') ? 'center'
            : cell.endsWith(':') ? 'right'
              : cell.startsWith(':') ? 'left' : ''
        ));
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          rows.push(splitTableRow(lines[index++]));
        }
        const header = headings.map((cell, cellIndex) => (
          `<th${alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]}"` : ''}>${renderInline(cell)}</th>`
        )).join('');
        const body = rows.map(row => `<tr>${headings.map((_, cellIndex) => (
          `<td${alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]}"` : ''}>${renderInline(row[cellIndex] || '')}</td>`
        )).join('')}</tr>`).join('');
        blocks.push(`<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`);
        continue;
      }

      if (/^\s{0,3}<(https?:\/\/[^>]+)>$/.test(line)) {
        const url = line.trim().slice(1, -1);
        blocks.push(`<p><a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(url)}</a></p>`);
        index++;
        continue;
      }

      const paragraph = [line.trim()];
      index++;
      while (index < lines.length && lines[index].trim()
        && !/^\s{0,3}(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/.test(lines[index])
        && !isFence(lines[index])
        && !(lines[index].includes('|') && index + 1 < lines.length
          && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]))
        && !/^\s{0,3}((\*[\s]*){3,}|(-[\s]*){3,}|(_[\s]*){3,})$/.test(lines[index])) {
        paragraph.push(lines[index++].trim());
      }
      blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    }

    return blocks.join('\n');
  }

  global.FelisOSMarkdown = Object.freeze({ render: renderMarkdown });
}(typeof window !== 'undefined' ? window : globalThis));
