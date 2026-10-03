// Presentation only: the server's MIME extraction and order parser are unchanged.
const decoder=(bytes,charset='utf-8')=>{try{return new TextDecoder(charset).decode(bytes);}catch{return new TextDecoder().decode(bytes);}};
const bytes=value=>Uint8Array.from(value,c=>c.charCodeAt(0));
function decode(value,encoding,charset){
 try{
  if(encoding==='base64')return decoder(bytes(atob(value.replace(/\s/g,''))),charset);
  if(encoding==='quoted-printable')return decoder(bytes(value.replace(/=\r?\n/g,'').replace(/=([A-F\d]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))),charset);
 }catch{}
 return value;
}
function header(value=''){
 return value.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,(_,charset,kind,body)=>decode(kind.toUpperCase()==='Q'?body.replace(/_/g,' '):body,kind.toUpperCase()==='Q'?'quoted-printable':'base64',charset));
}
function part(raw){
 const index=raw.search(/\r?\n\r?\n/),heads=index<0?'':raw.slice(0,index),body=index<0?raw:raw.slice(index).replace(/^\r?\n\r?\n/,'');
 const headers={};heads.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/).forEach(line=>{const i=line.indexOf(':');if(i>0)headers[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();});
 return {headers,body};
}
function bodyText(raw,depth=0){
 if(depth>8)return '';
 const {headers,body}=part(raw),type=headers['content-type']||'text/plain';
 if(/attachment/i.test(headers['content-disposition']||''))return '';
 const boundary=type.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
 if(/^multipart\//i.test(type)&&boundary){
  const children=body.split(`--${boundary[1]||boundary[2]}`).slice(1).filter(value=>!value.startsWith('--'));
  const plain=children.filter(value=>/^text\/plain/i.test(part(value.replace(/^\r?\n/,'')).headers['content-type']||''));
  return (plain.length?plain:children).map(value=>bodyText(value.replace(/^\r?\n/,''),depth+1)).filter(Boolean).join('\n\n');
 }
 if(!/^text\//i.test(type))return '';
 const charset=type.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1]||'utf-8';
 const text=decode(body,(headers['content-transfer-encoding']||'').toLowerCase(),charset);
 // Never render the sender's HTML, remote images or scripts in the app.
 return (/text\/html/i.test(type)?text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<(?:br\s*\/?|\/p|\/div|\/tr)>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"'):text).trim();
}
export function inboxOriginalView(raw='',isEmail=true){
 if(!isEmail)return {body:raw};
 const {headers}=part(raw);
 return {from:header(headers.from),to:header(headers.to),subject:header(headers.subject),date:headers.date||'',body:bodyText(raw)};
}
