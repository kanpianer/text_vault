import { useEffect, useLayoutEffect, useRef } from "react";
import { marked } from "marked";

const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF]/g;

function normalizeEditorNodes(root: HTMLElement | null) {
  if (!root) return;

  root.querySelectorAll("img").forEach((img) => {
    img.setAttribute("contenteditable", "false");
    img.setAttribute("draggable", "false");
    img.style.userSelect = "none";
    img.style.webkitUserSelect = "none";
  });

  root.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
}

function getBoundaryAdjacentImage(
  container: Node,
  offset: number,
  direction: "backward" | "forward",
  root: HTMLElement | null
) {
  const resolveCandidate = (candidate: Node | null): HTMLImageElement | null => {
    let current = candidate;
    while (current) {
      if (current.nodeName === "IMG") return current as HTMLImageElement;
      if (current.nodeType === Node.TEXT_NODE) {
        const meaningfulText = (current.textContent || "").replace(ZERO_WIDTH_CHARS, "");
        if (meaningfulText.length > 0) return null;
      }

      if (current.nodeType !== Node.ELEMENT_NODE || current.nodeName === "IMG") {
        return null;
      }

      current = direction === "backward"
        ? current.lastChild
        : current.firstChild;
    }

    return null;
  };

  const findFromAncestors = (start: Node): HTMLImageElement | null => {
    let current: Node | null = start;
    while (current && current !== root) {
      const sibling = direction === "backward" ? current.previousSibling : current.nextSibling;
      const resolved = resolveCandidate(sibling);
      if (resolved) return resolved;
      current = current.parentNode;
    }
    return null;
  };

  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent || "";
    const boundaryText = direction === "backward" ? text.slice(0, offset) : text.slice(offset);
    if (boundaryText.replace(ZERO_WIDTH_CHARS, "").length > 0) return null;

    const sibling = direction === "backward" ? container.previousSibling : container.nextSibling;
    return resolveCandidate(sibling) || findFromAncestors(container);
  }

  if (container.nodeType === Node.ELEMENT_NODE) {
    const children = container.childNodes;
    const childIndex = direction === "backward" ? offset - 1 : offset;
    if (childIndex >= 0 && childIndex < children.length) {
      return resolveCandidate(children[childIndex]);
    }
    return findFromAncestors(container);
  }

  return null;
}

function deleteImageWithUndo(image: HTMLImageElement) {
  const selection = window.getSelection();
  if (!selection) return false;

  const range = document.createRange();
  range.selectNode(image);
  selection.removeAllRanges();
  selection.addRange(range);

  return document.execCommand("delete");
}

export function Editor({ activeTabId, initialContent, onChange, onSelect, editorRef, readOnly }: any) {
  
  const previousTabId = useRef(activeTabId);
  const isFirstRender = useRef(true);

  useLayoutEffect(() => {
    if (!editorRef.current) return;

    if (activeTabId !== previousTabId.current || isFirstRender.current) {
      editorRef.current.innerHTML = initialContent || "<p><br></p>";
      normalizeEditorNodes(editorRef.current);
      previousTabId.current = activeTabId;
      isFirstRender.current = false;
    } else {
      // If we didn't switch tabs, only update if the editor doesn't have focus (e.g., from external sync).
      const hasFocus = document.activeElement === editorRef.current || editorRef.current.contains(document.activeElement);
      if (!hasFocus && editorRef.current.innerHTML !== initialContent) {
        editorRef.current.innerHTML = initialContent || "<p><br></p>";
        normalizeEditorNodes(editorRef.current);
      }
    }
  }, [activeTabId, initialContent]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    const handleBeforeInput = (e: InputEvent) => {
      if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        
        const range = sel.getRangeAt(0);
        let node: Node | null = range.startContainer;
        
        // Prevent breaking out of PRE blocks on mobile/desktop
        let curr: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
        while (curr && curr !== el) {
          if (curr.tagName === "PRE") {
            e.preventDefault();
            document.execCommand("insertText", false, "\n");
            onChange(el.innerHTML, el);
            return;
          }
          curr = curr.parentElement;
        }
        
        let block: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
        while (block && block !== el && window.getComputedStyle(block).display !== "block" && block.tagName !== "BLOCKQUOTE" && block.tagName !== "LI" && block.tagName !== "DIV" && block.tagName !== "P") {
          block = block.parentElement;
        }
        
        if (block && block !== el) {
          // Check for Quote
          if (block.tagName === "BLOCKQUOTE") {
            if ((block.textContent || "").trim() === "") {
              e.preventDefault();
              document.execCommand("formatBlock", false, "P");
              return;
            }
            // Non-empty quote: insert <br> to allow line breaks within the quote
            e.preventDefault();
            const br = document.createElement("br");
            range.insertNode(br);
            range.setStartAfter(br);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            onChange(el.innerHTML, el);
            return;
          }

          // Check for Task
          const checkbox = block.querySelector('input[type="checkbox"]');
          if (checkbox) {
            const rawText = block.textContent || "";
            const textContent = rawText.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
            if (textContent.trim() === "") {
              e.preventDefault();
              checkbox.remove();
              // If it becomes completely empty, ensure it can be focused
              if (block.innerHTML.trim() === "" || block.innerHTML === " " || block.innerHTML === "&nbsp;") {
                block.innerHTML = "<br>";
              }
              
              // Restore cursor inside the block
              const sel = window.getSelection();
              const r = document.createRange();
              r.selectNodeContents(block);
              r.collapse(true);
              sel?.removeAllRanges();
              sel?.addRange(r);
              
              onChange(el.innerHTML, el);
              return;
            } else {
              // Has content, hit enter. We want to create a new task.
              const currentBlock = block;
              setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;
                const newRange = sel.getRangeAt(0);
                let newNode: Node | null = newRange.startContainer;
                let newBlock: HTMLElement | null = newNode.nodeType === Node.TEXT_NODE ? newNode.parentElement : (newNode as HTMLElement);
                while (newBlock && newBlock !== el && window.getComputedStyle(newBlock).display !== "block" && newBlock.tagName !== "DIV" && newBlock.tagName !== "P") {
                  newBlock = newBlock.parentElement;
                }
                
                if (newBlock && newBlock !== currentBlock && newBlock !== el) {
                  if (!newBlock.querySelector('input[type="checkbox"]')) {
                    const newCheckbox = document.createElement('input');
                    newCheckbox.type = "checkbox";
                    newCheckbox.style.marginRight = "8px";
                    
                    if (newBlock.innerHTML === "<br>") {
                      newBlock.innerHTML = "";
                    }
                    
                    newBlock.insertBefore(newCheckbox, newBlock.firstChild);
                    const spaceNode = document.createTextNode(' ');
                    newBlock.insertBefore(spaceNode, newCheckbox.nextSibling);
                    
                    const r = document.createRange();
                    r.setStartAfter(spaceNode);
                    r.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(r);
                    
                    onChange(el.innerHTML, el);
                  }
                }
              }, 10); // slightly longer timeout for mobile stability
            }
          }
        }
      }
    };

    el.addEventListener("beforeinput", handleBeforeInput);
    return () => {
      el.removeEventListener("beforeinput", handleBeforeInput);
    };
  }, [onChange, editorRef]);

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain");
    let rtf = e.clipboardData.getData("text/html");
    
    // If there is HTML (e.g. copied from a website), we might want to just insert it directly, 
    // or if the user copied raw markdown, parse it.
    // The user specifically requested "Markdown text copied into the edit box will directly display the format of the text style"
    // This usually means if it is plain text containing markdown, parse it.
    
    if (text) {
      // If it looks like raw markdown, parse it using marked
      // To prevent parsing normal text unnecessarily, we can just run everything through marked. 
      // marked parses normal text into paragraphs, which is standard.
      let html = await marked.parse(text, { breaks: true });
      
      // Post-process the generated HTML to match our custom checkbox styling for tasks
      html = html.replace(/<input disabled="" type="checkbox">/gi, '<input type="checkbox" style="margin-right: 8px;">');
      html = html.replace(/<input checked="" disabled="" type="checkbox">/gi, '<input type="checkbox" checked style="margin-right: 8px;">');
      
      document.execCommand("insertHTML", false, html);
      normalizeEditorNodes(el);
    }
  };

  return (
    <div
      ref={editorRef}
      className="editor-body w-full h-full min-h-[500px] outline-none text-zinc-300 text-base md:text-lg leading-relaxed"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onInput={(e) => {
        normalizeEditorNodes(e.currentTarget);
        onChange(e.currentTarget.innerHTML, editorRef.current);
      }}
      onSelect={onSelect}
      onPaste={handlePaste}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "IMG") {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "IMG") {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Click on empty space below all content: create a new block at the end
        if (target === editorRef.current) {
          const sel = window.getSelection();
          const range = document.createRange();
          // Go to the very end of the editor
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
          // Insert a new paragraph
          document.execCommand("insertParagraph", false);
          onChange(editorRef.current.innerHTML, editorRef.current);
          return;
        }

        const anchor = target.closest("a[href]") as HTMLAnchorElement | null;

        if (anchor) {
          e.preventDefault();
          e.stopPropagation();
          window.open(anchor.href, "_blank", "noopener,noreferrer");
        }
      }}
      onTouchStart={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === "IMG") {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onTouchEnd={(e) => {
        // On mobile, clicking empty space below content creates a new block
        if (e.target === editorRef.current) {
          e.preventDefault();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
          document.execCommand("insertParagraph", false);
          onChange(editorRef.current.innerHTML, editorRef.current);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Backspace" || e.key === "Delete") {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (sel.isCollapsed) {
              const direction = e.key === "Backspace" ? "backward" : "forward";
              const imageToRemove = getBoundaryAdjacentImage(
                range.startContainer,
                range.startOffset,
                direction,
                editorRef.current
              );

              if (imageToRemove) {
                e.preventDefault();
                const deleted = deleteImageWithUndo(imageToRemove);
                if (!deleted) {
                  imageToRemove.remove();
                }
                normalizeEditorNodes(editorRef.current);
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              }
            }
          }
        }

        if (e.key === " ") {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const node = range.startContainer;
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent || "";
              const caretOffset = range.startOffset;
              const textBeforeCaret = text.substring(0, caretOffset);
              
              let block: HTMLElement | null = node.parentElement;
              while (block && block !== editorRef.current && window.getComputedStyle(block).display !== "block" && block.tagName !== "DIV" && block.tagName !== "P") {
                block = block.parentElement;
              }
              
              if (block && block !== editorRef.current) {
                let handled = false;
                
                if (textBeforeCaret === "#") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("formatBlock", false, "H1");
                  handled = true;
                } else if (textBeforeCaret === "##") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("formatBlock", false, "H2");
                  handled = true;
                } else if (textBeforeCaret === "###") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("formatBlock", false, "H3");
                  handled = true;
                } else if (textBeforeCaret === ">") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("formatBlock", false, "blockquote");
                  handled = true;
                } else if (textBeforeCaret === "-" || textBeforeCaret === "*") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("insertUnorderedList", false);
                  handled = true;
                } else if (textBeforeCaret === "1.") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("insertOrderedList", false);
                  handled = true;
                } else if (textBeforeCaret === "[]" || textBeforeCaret === "[ ]") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  
                  const checkbox = document.createElement('input');
                  checkbox.type = "checkbox";
                  checkbox.style.marginRight = "8px";
                  
                  const remainingText = text.substring(caretOffset);
                  block.innerHTML = "";
                  block.appendChild(checkbox);
                  const spaceNode = document.createTextNode("\u200B" + remainingText);
                  block.appendChild(spaceNode);
                  
                  const r = document.createRange();
                  r.setStart(spaceNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                  handled = true;
                } else if (textBeforeCaret === "->") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  block.style.textAlign = "center";
                  handled = true;
                } else if (textBeforeCaret === "    ") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("formatBlock", false, "PRE");
                  handled = true;
                } else if (textBeforeCaret === "```") {
                  e.preventDefault();
                  node.textContent = text.substring(caretOffset);
                  document.execCommand("formatBlock", false, "PRE");
                  handled = true;
                }
                
                if (handled) {
                  onChange(editorRef.current.innerHTML, editorRef.current);
                  return;
                }
              }
              
              let match;
              if ((match = textBeforeCaret.match(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const content = match[1];
                const startIndex = caretOffset - matchedStr.length;
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const bNode = document.createElement("b");
                bNode.textContent = content;
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(bNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, bNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else if ((match = textBeforeCaret.match(/(?:\*|_)([^*_]+)(?:\*|_)$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const content = match[1];
                const startIndex = caretOffset - matchedStr.length;
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const iNode = document.createElement("i");
                iNode.textContent = content;
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(iNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, iNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else if ((match = textBeforeCaret.match(/~~([^~]+)~~$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const content = match[1];
                const startIndex = caretOffset - matchedStr.length;
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const sNode = document.createElement("strike");
                sNode.textContent = content;
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(sNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, sNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else if ((match = textBeforeCaret.match(/<u>([^<]+)<\/u>$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const content = match[1];
                const startIndex = caretOffset - matchedStr.length;
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const uNode = document.createElement("u");
                uNode.textContent = content;
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(uNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, uNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else if ((match = textBeforeCaret.match(/`([^`]+)`$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const content = match[1];
                const startIndex = caretOffset - matchedStr.length;
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const codeNode = document.createElement("code");
                codeNode.className = "bg-zinc-800 text-red-400 px-1 py-0.5 rounded font-mono text-xs";
                codeNode.textContent = content;
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(codeNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, codeNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else if ((match = textBeforeCaret.match(/!\[([^\]]*)\]\(([^)]+)\)$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const alt = match[1];
                const url = match[2];
                const startIndex = caretOffset - matchedStr.length;
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const imgNode = document.createElement("img");
                imgNode.src = url;
                if (alt) imgNode.alt = alt;
                imgNode.className = "max-w-full rounded border border-zinc-800 my-2 block";
                imgNode.setAttribute("contenteditable", "false");
                imgNode.setAttribute("draggable", "false");
                imgNode.style.userSelect = "none";
                imgNode.style.webkitUserSelect = "none";
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(imgNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, imgNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else if ((match = textBeforeCaret.match(/(^|[^!])\[([^\]]+)\]\(([^)]+)\)$/))) {
                e.preventDefault();
                const matchedStr = match[0];
                const isStart = match[1] === "";
                const content = match[2];
                const url = match[3];
                const startIndex = caretOffset - matchedStr.length + (isStart ? 0 : 1);
                
                const beforeText = text.substring(0, startIndex);
                const afterText = text.substring(caretOffset);
                
                const aNode = document.createElement("a");
                aNode.href = url;
                aNode.textContent = content;
                aNode.className = "text-blue-400 underline cursor-pointer";
                aNode.target = "_blank";
                aNode.rel = "noopener noreferrer";
                
                node.textContent = beforeText;
                const parent = node.parentNode;
                if (parent) {
                  const nextSibling = node.nextSibling;
                  parent.insertBefore(aNode, nextSibling);
                  const textAfterNode = document.createTextNode("\u200B" + afterText);
                  parent.insertBefore(textAfterNode, aNode.nextSibling);
                  
                  const r = document.createRange();
                  r.setStart(textAfterNode, 1);
                  r.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(r);
                }
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              }
            }
          }
        }

        if (e.key === "Enter" || e.keyCode === 13) {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          
          const range = sel.getRangeAt(0);
          let node: Node | null = range.startContainer;
          
          // Prevent breaking out of PRE blocks on mobile/desktop
          let curr: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
          while (curr && curr !== editorRef.current) {
            if (curr.tagName === "PRE") {
              e.preventDefault();
              document.execCommand("insertText", false, "\n");
              onChange(editorRef.current.innerHTML, editorRef.current);
              return;
            }
            curr = curr.parentElement;
          }
          
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";
            const caretOffset = range.startOffset;
            const textBeforeCaret = text.substring(0, caretOffset);
            
            if (textBeforeCaret.trim() === "```" || textBeforeCaret === "    ") {
              e.preventDefault();
              let block: HTMLElement | null = node.parentElement;
              while (block && block !== editorRef.current && window.getComputedStyle(block).display !== "block") {
                block = block.parentElement;
              }
              if (block && block !== editorRef.current) {
                node.textContent = text.substring(caretOffset); // keep text after caret if any
                const r = document.createRange();
                r.selectNodeContents(block);
                r.collapse(false);
                sel.removeAllRanges();
                sel.addRange(r);
                document.execCommand("formatBlock", false, "PRE");
                
                // For a pre block, we might want a newline inserted so the user is ready to type code
                document.execCommand("insertHTML", false, "\n");
                
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              }
            }
            
            const match = textBeforeCaret.match(/^\|(.+)\|$/);
            if (match) {
              e.preventDefault();
              const cols = match[1].split('|').map(s => s.trim());
              
              let tableHTML = '<div class="overflow-x-auto w-full max-w-full my-4"><table border="1" class="border-collapse border border-zinc-700 w-full text-left">';
              
              tableHTML += '<tr>';
              cols.forEach(col => {
                tableHTML += `<th class="border border-zinc-700 p-2 bg-zinc-800/50">${col || '<br>'}</th>`;
              });
              tableHTML += '</tr>';
              
              tableHTML += '<tr>';
              cols.forEach(() => {
                tableHTML += `<td class="border border-zinc-700 p-2"><br></td>`;
              });
              tableHTML += '</tr>';
              tableHTML += '</table></div><p><br></p>';
              
              // We need to replace the current block with this table
              let block: HTMLElement | null = node.parentElement;
              while (block && block !== editorRef.current && window.getComputedStyle(block).display !== "block") {
                block = block.parentElement;
              }
              if (block && block !== editorRef.current) {
                // Remove text from node, as it's being converted
                node.textContent = text.substring(caretOffset); // keep text after caret if any
                
                // Select the block and insertHTML to replace it
                const r = document.createRange();
                r.selectNode(block);
                sel.removeAllRanges();
                sel.addRange(r);
                
                document.execCommand("insertHTML", false, tableHTML);
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              }
            }
          }
          
          let block: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
          while (block && block !== editorRef.current && window.getComputedStyle(block).display !== "block" && block.tagName !== "BLOCKQUOTE" && block.tagName !== "LI" && block.tagName !== "DIV" && block.tagName !== "P") {
            block = block.parentElement;
          }
          
          if (block && block !== editorRef.current) {
            // Check for Quote
            if (block.tagName === "BLOCKQUOTE") {
              if ((block.textContent || "").trim() === "") {
                e.preventDefault();
                // Break out of quote
                document.execCommand("formatBlock", false, "P");
                return;
              }
              // Non-empty quote: insert <br> to allow line breaks within the quote
              e.preventDefault();
              const br = document.createElement("br");
              range.insertNode(br);
              range.setStartAfter(br);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              onChange(editorRef.current.innerHTML, editorRef.current);
              return;
            }

            // Check for Task
            // In our implementation, a task might be a DIV or P containing an input type=checkbox
            const checkbox = block.querySelector('input[type="checkbox"]');
            if (checkbox) {
              const rawText = block.textContent || "";
              const textContent = rawText.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
              if (textContent.trim() === "") {
                e.preventDefault();
                checkbox.remove();
                // If it becomes completely empty, ensure it can be focused
                if (block.innerHTML.trim() === "" || block.innerHTML === " " || block.innerHTML === "&nbsp;") {
                  block.innerHTML = "<br>";
                }
                
                // Restore cursor inside the block
                const sel = window.getSelection();
                const r = document.createRange();
                r.selectNodeContents(block);
                r.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(r);
                
                onChange(editorRef.current.innerHTML, editorRef.current);
                return;
              } else {
                // Has content, hit enter. We want to create a new task.
                // We should let the default Enter happen, but in a microtask, if a new block was created, we insert a checkbox into it.
                const currentBlock = block;
                setTimeout(() => {
                  const sel = window.getSelection();
                  if (!sel || sel.rangeCount === 0) return;
                  const newRange = sel.getRangeAt(0);
                  let newNode: Node | null = newRange.startContainer;
                  let newBlock: HTMLElement | null = newNode.nodeType === Node.TEXT_NODE ? newNode.parentElement : (newNode as HTMLElement);
                  while (newBlock && newBlock !== editorRef.current && window.getComputedStyle(newBlock).display !== "block" && newBlock.tagName !== "DIV" && newBlock.tagName !== "P") {
                    newBlock = newBlock.parentElement;
                  }
                  
                  // If a new block was indeed created and it doesn't already have a checkbox
                  if (newBlock && newBlock !== currentBlock && newBlock !== editorRef.current) {
                    if (!newBlock.querySelector('input[type="checkbox"]')) {
                      // Insert the checkbox at the beginning of the new block
                      const newCheckbox = document.createElement('input');
                      newCheckbox.type = "checkbox";
                      newCheckbox.style.marginRight = "8px";
                      
                      // if new block has just <br>, remove it
                      if (newBlock.innerHTML === "<br>") {
                        newBlock.innerHTML = "";
                      }
                      
                      newBlock.insertBefore(newCheckbox, newBlock.firstChild);
                      const spaceNode = document.createTextNode(' ');
                      newBlock.insertBefore(spaceNode, newCheckbox.nextSibling);
                      
                      // Move cursor after the space
                      const r = document.createRange();
                      r.setStartAfter(spaceNode);
                      r.collapse(true);
                      sel.removeAllRanges();
                      sel.addRange(r);
                      
                      // manually trigger onChange since we mutated outside of normal events
                      onChange(editorRef.current.innerHTML, editorRef.current);
                    }
                  }
                }, 0);
              }
            }
          }
        }
      }}
    />
  );
}

