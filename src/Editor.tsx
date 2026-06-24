import { useEffect, useRef } from "react";

export function Editor({ activeTabId, initialContent, onChange, onSelect, editorRef }: any) {
  
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== initialContent) {
      editorRef.current.innerHTML = initialContent || "<p><br></p>";
    }
  }, [activeTabId, initialContent]);

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
      onKeyDown={(e) => {
        // Just let default work
      }}
    />
  );
}
