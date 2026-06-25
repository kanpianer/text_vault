import { useEffect, useRef } from "react";
import { marked } from "marked";

export function Editor({ activeTabId, initialContent, onChange, onSelect, editorRef }: any) {
  
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== initialContent) {
      editorRef.current.innerHTML = initialContent || "<p><br></p>";
    }
  }, [activeTabId, initialContent]);

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
    }
  };

  return (
    <div
      ref={editorRef}
      className="editor-body w-full h-full min-h-[500px] outline-none text-zinc-300 text-sm md:text-base leading-relaxed"
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => {
        onChange(e.currentTarget.innerHTML, editorRef.current);
      }}
      onSelect={onSelect}
      onPaste={handlePaste}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          
          const range = sel.getRangeAt(0);
          let node: Node | null = range.startContainer;
          
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
            }

            // Check for Task
            // In our implementation, a task might be a DIV or P containing an input type=checkbox
            const checkbox = block.querySelector('input[type="checkbox"]');
            if (checkbox) {
              const textContent = block.textContent || "";
              if (textContent.trim() === "") {
                e.preventDefault();
                checkbox.remove();
                // If it becomes completely empty, ensure it can be focused
                if (block.innerHTML.trim() === "") {
                  block.innerHTML = "<br>";
                }
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

