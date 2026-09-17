import React from 'react';

// Render only a small presentation subset. All content remains escaped React text.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i) => part.startsWith('**')
    ? <strong key={i}>{part.slice(2,-2)}</strong> : part.startsWith('`')
      ? <code key={i}>{part.slice(1,-1)}</code> : part);
}
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s=>s.trim());
const divider = line => line.includes('|') && cells(line).every(c=>/^:?-{3,}:?$/.test(c));

export default function IntelligenceAnswer({content}) {
  const lines = String(content || '').split('\n'), blocks = [];
  for (let i=0; i<lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (i+1<lines.length && line.includes('|') && divider(lines[i+1])) {
      const header = cells(line), rows = []; i+=2;
      while (i<lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      blocks.push(<div className="intelligence-table-scroll" key={i} tabIndex={0} role="region" aria-label="Resultados de la consulta"><table><thead><tr>{header.map((v,j)=><th key={j} scope="col">{inline(v)}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}>{header.map((_,c)=><td key={c}>{inline(row[c] || '—')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) { blocks.push(<h3 key={i}>{inline(heading[1])}</h3>); i++; continue; }
    const list = line.match(/^(?:[-*]|\d+[.)])\s+/);
    if (list) {
      const numbered = /^\d/.test(line), items = [], pattern = numbered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      while (i<lines.length && pattern.test(lines[i].trim())) items.push(lines[i++].trim().replace(pattern,''));
      const Tag = numbered ? 'ol' : 'ul';
      blocks.push(<Tag key={i}>{items.map((v,j)=><li key={j}>{inline(v)}</li>)}</Tag>); continue;
    }
    blocks.push(<p key={i}>{inline(line)}</p>); i++;
  }
  return <div className="intelligence-rich-answer">{blocks}</div>;
}
