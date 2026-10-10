import { useMemo } from 'react';

export function markdownHtml(content: string): string {
  const escaped = content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return escaped.split('\n').map(line => {
    const inline = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const header = /^(#{1,6})\s+(.*)/.exec(inline);
    if (header) return `<h${header[1].length}>${header[2]}</h${header[1].length}>`;
    if (/^[-*]\s/.test(inline)) return `<p>• ${inline.slice(2)}</p>`;
    return `<p>${inline || '<br>'}</p>`;
  }).join('');
}
/** Parse in an inert template; copy only formatting nodes and text. No URL or event
 * attributes, image/media nodes, styles, scripts or embedded documents can reach the DOM. */
export function sanitizeHtml(html: string): string {
  const source = document.createElement('template'); source.innerHTML = html;
  const output = document.createElement('template');
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BLOCKQUOTE', 'HR']);
  const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'LINK', 'META', 'BASE']);
  const copy = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent ?? '')); return; }
    if (!(node instanceof Element) || blocked.has(node.tagName)) return;
    const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : parent;
    if (target !== parent) parent.appendChild(target);
    node.childNodes.forEach(child => copy(child, target));
  };
  source.content.childNodes.forEach(node => copy(node, output.content));
  return output.innerHTML;
}
export function SafeText({ content, mode }: { content: string; mode?: string }) {
  const safe = useMemo(() => sanitizeHtml(mode === 'html' ? content : markdownHtml(content)), [content, mode]);
  return <div className="original-text" dangerouslySetInnerHTML={{ __html: safe }} />;
}
