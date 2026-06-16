import { useEffect } from "react";
import { fixMojibakeText } from "../utils/mojibake";

function fixDom(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const next = fixMojibakeText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }
  root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach(el => {
    ["placeholder", "title", "aria-label"].forEach(attr => {
      const current = el.getAttribute(attr);
      const next = fixMojibakeText(current);
      if (next !== current) el.setAttribute(attr, next);
    });
  });
}

export default function MojibakeFixer() {
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return undefined;
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fixDom();
      });
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList:true, subtree:true, characterData:true });
    return () => observer.disconnect();
  }, []);
  return null;
}
