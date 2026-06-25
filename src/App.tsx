import { useState, useEffect, useRef, useLayoutEffect } from "react";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { TabContent, SaveStatus } from "./types";
import { Editor } from "./Editor";
import {
  deriveKeyAndHash,
  encryptData,
  decryptData,
  generateSaltHex,
  validatePassword,
  sha256Client,
} from "./crypto";

export default function App() {
  // Navigation & Router
  const [vaultName, setVaultName] = useState<string>("");
  const [searchName, setSearchName] = useState<string>("");
  const [searchError, setSearchError] = useState<string>("");
  const [isHomeFocused, setIsHomeFocused] = useState<boolean>(false);

  // Domain Prefix logic
  const [dynamicDomain, setDynamicDomain] = useState<string>("https://example.com/");

  // Loading & State variables
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [isVerified, setIsVerified] = useState<boolean>(false);
  const [isNewVault, setIsNewVault] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showPasswordReveal, setShowPasswordReveal] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");

  // Vault credentials & data held in React memory
  const [saltEnc, setSaltEnc] = useState<string>("");
  const [saltAuth, setSaltAuth] = useState<string>("");
  const [aesKey, setAesKey] = useState<CryptoKey | null>(null);
  const [authHash, setAuthHash] = useState<string>("");
  const [tabs, setTabs] = useState<TabContent[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");

  const editorRef = useRef<HTMLDivElement>(null);
  const pcSelectionToolbarScrollRef = useRef<HTMLDivElement>(null);
  const pcEmptyLineToolbarScrollRef = useRef<HTMLDivElement>(null);
  const mobileSelectionToolbarScrollRef = useRef<HTMLDivElement>(null);
  const mobileEmptyLineToolbarScrollRef = useRef<HTMLDivElement>(null);

  const pcSelectionToolbarContainerRef = useRef<HTMLDivElement>(null);
  const pcEmptyLineToolbarContainerRef = useRef<HTMLDivElement>(null);
  const [pcSelectionStyle, setPcSelectionStyle] = useState<React.CSSProperties>({});
  const [pcEmptyLineStyle, setPcEmptyLineStyle] = useState<React.CSSProperties>({});

  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [selectionRange, setSelectionRange] = useState<Range | null>(null);
  const [emptyLineRect, setEmptyLineRect] = useState<DOMRect | null>(null);
  const [isLineToolbarExpanded, setIsLineToolbarExpanded] = useState<boolean>(false);
  const [showLinkInput, setShowLinkInput] = useState<boolean>(false);
  const [showImageInput, setShowImageInput] = useState<boolean>(false);
  const [showTableInput, setShowTableInput] = useState<boolean>(false);
  const [linkValue, setLinkValue] = useState<string>("");
  const [imageValue, setImageValue] = useState<string>("");
  const [tableRowValue, setTableRowValue] = useState<string>("");
  const [tableColValue, setTableColValue] = useState<string>("");
  const [isTableRowFocused, setIsTableRowFocused] = useState<boolean>(false);
  const [isTableColFocused, setIsTableColFocused] = useState<boolean>(false);
  const [viewportBottom, setViewportBottom] = useState(0);

  useEffect(() => {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    const updateViewport = () => {
      // Calculate how much the visual viewport is offset from the bottom of the window
      const bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
      setViewportBottom(Math.max(0, bottomOffset));
    };
    vv.addEventListener('resize', updateViewport);
    vv.addEventListener('scroll', updateViewport);
    updateViewport();
    return () => {
      vv.removeEventListener('resize', updateViewport);
      vv.removeEventListener('scroll', updateViewport);
    };
  }, []);

  useLayoutEffect(() => {
    if (selectionRect && editorRef.current?.parentElement && pcSelectionToolbarContainerRef.current) {
      const parent = editorRef.current.parentElement.getBoundingClientRect();
      const toolbar = pcSelectionToolbarContainerRef.current.getBoundingClientRect();
      const desiredLeft = selectionRect.left - parent.left;
      
      if (desiredLeft + toolbar.width > parent.width) {
        setPcSelectionStyle({
          top: selectionRect.bottom - parent.top,
          left: '50%',
          transform: 'translateX(-50%)',
          visibility: 'visible'
        });
      } else {
        setPcSelectionStyle({
          top: selectionRect.bottom - parent.top,
          left: desiredLeft,
          transform: 'none',
          visibility: 'visible'
        });
      }
    }
  }, [selectionRect, showLinkInput, showImageInput, showTableInput]);

  useLayoutEffect(() => {
    if (emptyLineRect && editorRef.current?.parentElement && pcEmptyLineToolbarContainerRef.current) {
      const parent = editorRef.current.parentElement.getBoundingClientRect();
      const toolbar = pcEmptyLineToolbarContainerRef.current.getBoundingClientRect();
      const desiredLeft = emptyLineRect.left - parent.left;
      
      if (desiredLeft + toolbar.width > parent.width) {
        setPcEmptyLineStyle({
          top: emptyLineRect.bottom - parent.top,
          left: '50%',
          transform: 'translateX(-50%)',
          visibility: 'visible'
        });
      } else {
        setPcEmptyLineStyle({
          top: emptyLineRect.bottom - parent.top,
          left: desiredLeft,
          transform: 'none',
          visibility: 'visible'
        });
      }
    }
  }, [emptyLineRect, showLinkInput, showImageInput, showTableInput]);

  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (showTableInput || showLinkInput || showImageInput) {
        const target = e.target as HTMLElement;
        const inPcSelection = pcSelectionToolbarContainerRef.current?.contains(target);
        const inPcEmptyLine = pcEmptyLineToolbarContainerRef.current?.contains(target);
        const inMobileToolbar = target.closest('[data-mobile-toolbar="true"]');
        
        if (!inPcSelection && !inPcEmptyLine && !inMobileToolbar) {
          if (showTableInput) setShowTableInput(false);
          if (showLinkInput) setShowLinkInput(false);
          if (showImageInput) setShowImageInput(false);
        }
      }
    };
    
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [showTableInput, showLinkInput, showImageInput]);

  const scrollToolbarRef = (ref: React.RefObject<HTMLDivElement | null>, direction: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (ref.current) {
      ref.current.scrollBy({ left: direction === 'left' ? -100 : 100, behavior: 'smooth' });
    }
  };

  // Tool lists configuration
  const selectionTools = [
    { label: "Bold", type: "inline", format: "bold" },
    { label: "Italic", type: "inline", format: "italic" },
    { label: "Strike", type: "inline", format: "strike" },
    { label: "Underline", type: "inline", format: "underline" },
    { label: "Link", type: "link" },
    { label: "H1", type: "block", format: "h1" },
    { label: "H2", type: "block", format: "h2" },
    { label: "H3", type: "block", format: "h3" },
    { label: "Task", type: "block", format: "task" },
    { label: "List", type: "block", format: "list" },
    { label: "Quote", type: "block", format: "blockquote" },
    { label: "Code", type: "block", format: "pre" }
  ];

  const emptyLineTools = [
    { label: "H1", type: "block", format: "h1" },
    { label: "H2", type: "block", format: "h2" },
    { label: "H3", type: "block", format: "h3" },
    { label: "Task", type: "block", format: "task" },
    { label: "List", type: "block", format: "list" },
    { label: "Quote", type: "block", format: "blockquote" },
    { label: "Table", type: "block", format: "table" },
    { label: "Image", type: "block", format: "image" },
    { label: "Code", type: "block", format: "pre" },
    { label: "Bold", type: "inline", format: "bold" },
    { label: "Italic", type: "inline", format: "italic" },
    { label: "Strike", type: "inline", format: "strike" },
    { label: "Underline", type: "inline", format: "underline" },
    { label: "Link", type: "link" }
  ];

  const handleToolClick = (tool: { label: string, type: string, format?: string }) => {
    if (tool.type === "inline" && tool.format) {
      applySelectionFormat(tool.format);
    } else if (tool.type === "block" && tool.format) {
      applyFormatBlock(tool.format);
    } else if (tool.type === "link") {
      setShowLinkInput(true);
    }
  };

  // Save State Transition
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // Sandwich settings menu
  const [showMenu, setShowMenu] = useState<boolean>(false);

  // Change Password Modal state
  const [showChangePasswordModal, setShowChangePasswordModal] = useState<boolean>(false);
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>("");
  const [showNewPasswordReveal, setShowNewPasswordReveal] = useState<boolean>(false);
  const [pwdModalError, setPwdModalError] = useState<string>("");

  // Delete Vault 3-Phase Modal state
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [deleteStep, setDeleteStep] = useState<number>(1);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>("");
  const [deleteError, setDeleteError] = useState<string>("");
  const [isDeleteConfirmFocused, setIsDeleteConfirmFocused] = useState<boolean>(false);

  // Chrome Tabs drag and drop state
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const [tabToClose, setTabToClose] = useState<string | null>(null);

  // Inactivity tracking
  const lastActivityRef = useRef<number>(Date.now());
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus password input when prompt is visible
  useEffect(() => {
    if (vaultName && !isVerified && !isLoading) {
      // Small timeout to ensure DOM is ready
      setTimeout(() => {
        if (passwordInputRef.current) {
          passwordInputRef.current.focus();
        }
      }, 50);
    }
  }, [vaultName, isVerified, isLoading]);

  // Dynamic host determination
  useEffect(() => {
    setDynamicDomain(window.location.origin + "/");
  }, []);

  // Simple reactive Router hook
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.replace(/^\/|\/$/g, "");
      if (/^[a-zA-Z0-9]{1,10}$/.test(path)) {
        setVaultName(path);
      } else {
        setVaultName("");
        setIsVerified(false);
      }
    };

    handleLocationChange();
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  // Fetch Vault state on navigation
  useEffect(() => {
    if (!vaultName) return;

    const fetchVaultSalts = async () => {
      setIsLoading(true);
      setErrorText("");
      try {
        const response = await fetch(`/api/vault/${vaultName}/salts`);
        const data = await response.json();
        if (data.exists) {
          setIsNewVault(false);
          setSaltEnc(data.salt_enc || "");
          setSaltAuth(data.salt_auth || "");
        } else {
          setIsNewVault(true);
          setSaltEnc("");
          setSaltAuth("");
        }
      } catch (err) {
        console.error(err);
        setErrorText("Failed to access cloud vaults. Check connection.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchVaultSalts();
  }, [vaultName]);

  // Lock function - Purge secret keys out of memory
  const handleLock = () => {
    setAesKey(null);
    setAuthHash("");
    setPassword("");
    setConfirmPassword("");
    setTabs([]);
    setActiveTabId("");
    setIsVerified(false);
    setHasUnsavedChanges(false);
    setShowMenu(false);
    setErrorText("");
  };

  // Navigates securely
  const navigateTo = (name: string) => {
    window.history.pushState(null, "", name ? `/${name}` : "/");
    window.dispatchEvent(new Event("popstate"));
  };

  // Home Screen GO option
  const handleGo = async () => {
    if (!searchName) {
      setSearchError("Please input a vault name.");
      return;
    }
    if (!/^[a-zA-Z0-9]{1,10}$/.test(searchName)) {
      setSearchError("Vault name must be alphanumeric and up to 10 characters.");
      return;
    }

    setSearchError("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/vault/${searchName}/check`);
      const data = await response.json();
      if (data.exists) {
        setSearchError(`Vault '${searchName}' already exists`);
      } else {
        navigateTo(searchName);
      }
    } catch (err) {
      console.error(err);
      setSearchError("Backend network error. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Create new Vault cryptographically
  const handleCreateVault = async () => {
    if (!password || !confirmPassword) {
      setErrorText("Passwords are required.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorText("Passwords do not match.");
      return;
    }
    if (!validatePassword(password)) {
      setErrorText("Password must contain upper, lower, symbols, and digits (8-18 characters).");
      return;
    }

    setIsLoading(true);
    setErrorText("");
    try {
      const sEnc = generateSaltHex();
      const sAuth = generateSaltHex();

      const { aesKey: dAesKey, authHash: dAuthHash } = await deriveKeyAndHash(password, sEnc, sAuth);

      const defaultTabs: TabContent[] = [
        {
          id: "tab-1",
          text: `# Tab 1\n# Welcome to ${vaultName}\nThis is a zero-knowledge end-to-end encrypted markdown node. Only your local password can decrypt it. Start authoring here.`,
        },
      ];

      const encryptedPayload = await encryptData(JSON.stringify({ tabs: defaultTabs }), dAesKey);
      const authHashDouble = await sha256Client(dAuthHash);

      const resp = await fetch(`/api/vault/${vaultName}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salt_enc: sEnc,
          salt_auth: sAuth,
          auth_hash_double: authHashDouble,
          encrypted_data: encryptedPayload,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        setErrorText(data.error || "Failed to create cloud vault storage.");
        return;
      }

      // Success
      setSaltEnc(sEnc);
      setSaltAuth(sAuth);
      setAesKey(dAesKey);
      setAuthHash(dAuthHash);
      setTabs(defaultTabs);
      setActiveTabId("tab-1");
      setIsVerified(true);
      setIsNewVault(false);
      setHasUnsavedChanges(false);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error(err);
      setErrorText("Error setting up browser client crypto keys.");
    } finally {
      setIsLoading(false);
    }
  };

  // Unlock Vault decryption
  const handleUnlockVault = async () => {
    if (!password) {
      setErrorText("Password is required.");
      return;
    }

    setIsLoading(true);
    setIsDecrypting(true);
    setErrorText("");
    const startTime = Date.now();
    try {
      // Derive credential bits
      const { aesKey: dAesKey, authHash: dAuthHash } = await deriveKeyAndHash(
        password,
        saltEnc,
        saltAuth
      );

      const resp = await fetch(`/api/vault/${vaultName}/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_hash: dAuthHash }),
      });

      if (!resp.ok) {
        setErrorText("Incorrect password or access compromised.");
        return;
      }

      const data = await resp.json();
      const decryptedString = await decryptData(data.encrypted_data, dAesKey);
      const parsed = JSON.parse(decryptedString);

      if (parsed && Array.isArray(parsed.tabs)) {
        setAesKey(dAesKey);
        setAuthHash(dAuthHash);
        setTabs(parsed.tabs);
        setActiveTabId(parsed.tabs[0]?.id || "");
        setIsVerified(true);
        setHasUnsavedChanges(false);
        setPassword("");
      } else {
        setErrorText("Corrupted decrypter output. Unable to verify format.");
      }
    } catch (err) {
      console.error(err);
      setErrorText("Decryption failure. Verification keys mismatched.");
    } finally {
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, 300 - elapsed);
      if (waitTime > 0) {
        await new Promise((r) => setTimeout(r, waitTime));
      }
      setIsDecrypting(false);
      setIsLoading(false);
    }
  };

  // Save text payload - used by Ctrl+S, manual button, and Auto-save
  const performSaveAction = async (): Promise<boolean> => {
    if (!aesKey || !authHash || !vaultName || tabs.length === 0) return false;
    setSaveStatus("saving");
    const startTime = Date.now();
    try {
      const jsonStr = JSON.stringify({ tabs });
      const encryptedStr = await encryptData(jsonStr, aesKey);

      const response = await fetch(`/api/vault/${vaultName}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_hash: authHash,
          encrypted_data: encryptedStr,
        }),
      });

      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, 200 - elapsed);
      if (waitTime > 0) {
        await new Promise((r) => setTimeout(r, waitTime));
      }

      if (response.ok) {
        setSaveStatus("saved");
        setHasUnsavedChanges(false);
        setTimeout(() => {
          setSaveStatus("idle");
        }, 200);
        return true;
      } else {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2000);
        return false;
      }
    } catch (error) {
      console.error("Save failure", error);
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, 300 - elapsed);
      if (waitTime > 0) {
        await new Promise((r) => setTimeout(r, waitTime));
      }
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return false;
    }
  };

  // Auto save and immediate security lock triggers on inactivity
  const handleAutoSaveAndLock = async () => {
    if (hasUnsavedChanges) {
      await performSaveAction();
    }
    handleLock();
  };

  // Inactivity tracking trigger
  useEffect(() => {
    if (!isVerified) return;

    lastActivityRef.current = Date.now();

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, resetTimer));

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      
      if (elapsed >= 30000 && elapsed < 120000) {
        if (hasUnsavedChanges && saveStatus !== "saving" && saveStatus !== "saved") {
          performSaveAction();
        }
      }

      if (elapsed >= 120000) {
        clearInterval(checkInterval);
        handleAutoSaveAndLock();
      }
    }, 1000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, resetTimer));
      clearInterval(checkInterval);
    };
  }, [isVerified, hasUnsavedChanges, tabs, activeTabId, aesKey, authHash, saveStatus]);

  // Hotkey hook for Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isVerified && hasUnsavedChanges && saveStatus !== "saving") {
          performSaveAction();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVerified, hasUnsavedChanges, saveStatus, tabs, aesKey, authHash]);

  // Active document characters count
  const activeTabContent = tabs.find((t) => t.id === activeTabId)?.text || "";
  const remainingChars = 10000 - activeTabContent.length;

  const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Left as stub for backward-compatibility / fallback if needed, but we handle line editing directly
  };

  const handleEditorInput = (html: string, currentTarget: HTMLElement | null) => {
    let changed = false;

    const sel = window.getSelection();
    if (sel && sel.isCollapsed) {
       const node = sel.anchorNode;
       if (node && node.textContent === "/") {
          let block: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
          while (block && block !== currentTarget && window.getComputedStyle(block).display !== "block") {
             block = block.parentElement;
          }
          if (block) {
             setEmptyLineRect(block.getBoundingClientRect());
             setIsLineToolbarExpanded(true);
          }
       } else if (node && node.textContent?.trim() === "") {
          setIsLineToolbarExpanded(false);
       }
    }

    // Apply simple auto-formats
    if (/(?:^|<br>|<p>|<div[^>]*>)#\s(.*?)$/.test(html)) {
      html = html.replace(/(?:^|<br>|<p>|<div[^>]*>)#\s(.*?)$/, "<h1>$1</h1>");
      changed = true;
    }
    
    if (/\*\*(.*?)\*\*/.test(html)) {
       html = html.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
       changed = true;
    }
    if (/~~(.*?)~~/.test(html)) {
       html = html.replace(/~~(.*?)~~/g, "<del>$1</del>");
       changed = true;
    }
    if (/__(.*?)__/.test(html)) {
       html = html.replace(/__(.*?)__/g, "<u>$1</u>");
       changed = true;
    }
    
    if (changed && currentTarget) {
       currentTarget.innerHTML = html;
       const range = document.createRange();
       range.selectNodeContents(currentTarget);
       range.collapse(false);
       const sel = window.getSelection();
       sel?.removeAllRanges();
       sel?.addRange(range);
    }

    const newText = html;
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: newText } : t));
    setHasUnsavedChanges(true);
  };

  const handleEditorSelect = () => {
    setShowLinkInput(false);
    setShowImageInput(false);
    setShowTableInput(false);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setSelectionRect(null);
      setSelectionRange(null);
      setEmptyLineRect(null);
      setIsLineToolbarExpanded(false);
      return;
    }

    if (!sel.isCollapsed && sel.toString().trim() !== "") {
      const range = sel.getRangeAt(0);
      setSelectionRect(range.getBoundingClientRect());
      setSelectionRange(range);
      setEmptyLineRect(null);
      setIsLineToolbarExpanded(false);
    } else {
      setSelectionRect(null);
      setSelectionRange(null);
      let node = sel.anchorNode;
      if (node) {
        let block: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
        while (block && block !== editorRef.current && window.getComputedStyle(block).display !== "block") {
           block = block.parentElement;
        }
        if (block && block !== editorRef.current) {
           if ((block.textContent || "").trim() === "") {
              setEmptyLineRect(block.getBoundingClientRect());
              setSelectionRange(sel.getRangeAt(0));
              setIsLineToolbarExpanded(true);
              return;
           }
        } else if (block === editorRef.current) {
           if ((editorRef.current?.textContent || "").trim() === "") {
              setEmptyLineRect(editorRef.current!.getBoundingClientRect());
              setSelectionRange(sel.getRangeAt(0));
              setIsLineToolbarExpanded(true);
              return;
           }
        }
      }
      setEmptyLineRect(null);
      setSelectionRange(null);
      setIsLineToolbarExpanded(false);
    }
  };

  const applyCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: editorRef.current!.innerHTML } : t));
      setHasUnsavedChanges(true);
    }
  };

  const applyFormatBlock = (tag: string) => {
    const sel = window.getSelection();
    if (sel && sel.anchorNode && sel.anchorNode.textContent === "/") {
       sel.anchorNode.textContent = "";
    }
    
    if (tag === "task") {
       document.execCommand("insertHTML", false, '<input type="checkbox" style="margin-right: 8px;"> ');
    } else if (tag === "list") {
       document.execCommand("insertUnorderedList", false);
    } else if (tag === "table") {
       setShowTableInput(true);
       return;
    } else if (tag === "image") {
       setShowImageInput(true);
       return;
    } else {
       document.execCommand("formatBlock", false, tag);
    }
    
    if (editorRef.current) {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: editorRef.current!.innerHTML } : t));
      setHasUnsavedChanges(true);
    }
  };

  const applySelectionFormat = (type: string) => {
    if (type === "bold") applyCommand("bold");
    if (type === "italic") applyCommand("italic");
    if (type === "strike") applyCommand("strikeThrough");
    if (type === "underline") applyCommand("underline");
  };

  const handleLinkSubmit = (url: string) => {
    if (selectionRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(selectionRange);
    }
    applyCommand("createLink", url);
    setShowLinkInput(false);
    setLinkValue("");
  };

  const handleImageSubmit = (url: string) => {
    if (selectionRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(selectionRange);
    }
    applyCommand("insertImage", url);
    setShowImageInput(false);
    setImageValue("");
  };

  const handleTableSubmit = () => {
    let rows = parseInt(tableRowValue) || 1;
    let cols = parseInt(tableColValue) || 1;
    if (rows < 1) rows = 1;
    if (rows > 30) rows = 30;
    if (cols < 1) cols = 1;
    if (cols > 30) cols = 30;

    if (selectionRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(selectionRange);
    }

    let tableClasses = "border-collapse border border-zinc-700 my-2 text-left bg-transparent ";
    let headerClasses = "p-2 border border-zinc-700 bg-zinc-800/50 min-w-[120px] align-top ";
    let cellClasses = "p-2 border border-zinc-700 min-w-[120px] align-top ";
    
    if (cols <= 3) {
      // Few columns: avoid being overly wide (not w-full), let it size to content but give min width
      tableClasses += "w-auto min-w-[40%] table-auto";
    } else if (cols <= 5) {
      // Medium columns: w-full looks good and distributes evenly
      tableClasses += "w-full table-fixed";
    } else {
      // Many columns: allow horizontal scroll, avoid narrow columns
      tableClasses += "w-max table-auto";
    }

    let tableHTML = `<div class="overflow-x-auto w-full max-w-full my-4"><table border="1" class="${tableClasses}">`;
    for (let r = 0; r < rows; r++) {
      tableHTML += '<tr>';
      for (let c = 0; c < cols; c++) {
        if (r === 0) {
          tableHTML += `<th class="${headerClasses}"><br></th>`;
        } else {
          tableHTML += `<td class="${cellClasses}"><br></td>`;
        }
      }
      tableHTML += '</tr>';
    }
    tableHTML += '</table></div><p><br></p>';

    document.execCommand("insertHTML", false, tableHTML);
    
    if (editorRef.current) {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: editorRef.current!.innerHTML } : t));
    }

    setShowTableInput(false);
    setTableRowValue("");
    setTableColValue("");
  };

  // Add new tab node
  const handleAddTab = () => {
    if (tabs.length >= 10) return;
    const newId = `tab-${Date.now()}`;
    const newTab: TabContent = {
      id: newId,
      text: `Untitled\nStart writing tab contents...`,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
    setHasUnsavedChanges(true);
  };

  // Close tab direct
  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (tabs.length <= 1) return;

    setTabToClose(id);
  };

  const confirmCloseTab = () => {
    if (!tabToClose) return;

    const remaining = tabs.filter((t) => t.id !== tabToClose);
    setTabs(remaining);
    if (activeTabId === tabToClose) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
    setHasUnsavedChanges(true);
    setTabToClose(null);
  };

  // Chrome Tabs drag reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, hoverIndex: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex === hoverIndex) return;

    const updated = [...tabs];
    const item = updated.splice(draggingIndex, 1)[0];
    updated.splice(hoverIndex, 0, item);

    setDraggingIndex(hoverIndex);
    setTabs(updated);
    setHasUnsavedChanges(true);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
  };

  const handleRenameSave = (tabId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title: trimmed } : t));
      setHasUnsavedChanges(true);
    }
    setEditingTabId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSave(tabId);
    } else if (e.key === "Escape") {
      setEditingTabId(null);
    }
  };

  // Change Password logic
  const handleChangePassword = async () => {
    if (!newPassword || !confirmNewPassword) {
      setPwdModalError("All password inputs are required.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwdModalError("Passwords do not match.");
      return;
    }
    if (!validatePassword(newPassword)) {
      setPwdModalError("Must carry upper, lower, symbols, and digits (8-18 characters).");
      return;
    }

    setIsLoading(true);
    setPwdModalError("");
    try {
      const sEnc = generateSaltHex();
      const sAuth = generateSaltHex();

      const { aesKey: dAesKey, authHash: dAuthHash } = await deriveKeyAndHash(newPassword, sEnc, sAuth);

      // Re-encrypt values inside current active local state using the new key
      const payloadString = JSON.stringify({ tabs });
      const encryptedPayload = await encryptData(payloadString, dAesKey);
      const authHashDouble = await sha256Client(dAuthHash);

      // Update backend using old credentials proof to authorize write key change
      const resp = await fetch(`/api/vault/${vaultName}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_hash: authHash, // verification check passes
          encrypted_data: encryptedPayload,
          salt_enc: sEnc,
          salt_auth: sAuth,
          auth_hash_double: authHashDouble,
        }),
      });

      if (!resp.ok) {
        const rData = await resp.json();
        setPwdModalError(rData.error || "Failed to update security credentials.");
        return;
      }

      // Success setup
      setSaltEnc(sEnc);
      setSaltAuth(sAuth);
      setAesKey(dAesKey);
      setAuthHash(dAuthHash);
      setHasUnsavedChanges(false);

      // Reset fields
      setNewPassword("");
      setConfirmNewPassword("");
      setShowChangePasswordModal(false);

      // Flash "Saved" success notification
      setSaveStatus("pwd_changed");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error(err);
      setPwdModalError("Cryptographic calculation failed inside browser.");
    } finally {
      setIsLoading(false);
    }
  };

  // Secure Delete Vault logic
  const handleDeleteVault = async () => {
    if (deleteConfirmName.toLowerCase() !== vaultName.toLowerCase()) {
      setDeleteError("Confirmation name does not match the active vault name.");
      return;
    }

    setIsLoading(true);
    setDeleteError("");
    try {
      const resp = await fetch(`/api/vault/${vaultName}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_hash: authHash }), // verified credentials check
      });

      if (!resp.ok) {
        setDeleteError("Permission denied. Deletion failed on database records.");
        return;
      }

      // Complete purge and return home
      setShowDeleteModal(false);
      handleLock();
      navigateTo("");
    } catch (err) {
      console.error(err);
      setDeleteError("Backend network error during deletion request.");
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to resolve title safely
  function getTabDisplayTitle(text: string, customTitle?: string): string {
    const rawTitle = customTitle || text.split("\n")[0]?.trim() || "";
    if (!rawTitle) return "Untitled";
    const cleanTitle = customTitle ? rawTitle : (rawTitle.replace(/^[#\s\*\-\>\d\.\(\)]+/, "").trim() || "Untitled");
    
    let visualLength = 0;
    let result = "";
    for (let i = 0; i < cleanTitle.length; i++) {
      const char = cleanTitle[i];
      visualLength += char.charCodeAt(0) > 255 ? 2 : 1;
      if (visualLength > 12) {
        return result + "..";
      }
      result += char;
    }
    return result;
  }

  function getTabRawTitle(tab: TabContent): string {
    if (tab.title) return tab.title;
    const firstLine = tab.text.split("\n")[0]?.trim() || "";
    if (!firstLine) return "Untitled";
    return firstLine.replace(/^[#\s\*\-\>\d\.\(\)]+/, "").trim() || "Untitled";
  }

  // --- Views Router ---

  // Loading indicator for async setups
  const loadingOverlay = (
    <AnimatePresence>
      {isDecrypting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center bg-[#0c0c0e] z-50 pointer-events-none"
        >
          <span className="font-mono text-sm tracking-widest text-[#ffffff] font-medium block uppercase animate-pulse">
            Decrypting
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 1 & 2. HOME SCREEN AND PASSWORD PROMPT
  if (!isVerified) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#0b0c0e] text-zinc-200 px-6 py-12 md:py-16 font-sans">
        <header className="flex justify-between items-center w-full max-w-6xl mx-auto">
          <span className="font-mono text-sm tracking-widest text-[#f4f4f5] font-semibold select-none">TEXT_VAULT</span>
          <span className="font-mono text-[10px] text-zinc-600 tracking-wider">v0.1</span>
        </header>

        <main className="flex-1 flex flex-col justify-center items-center w-full max-w-4xl mx-auto my-12">
          <div className="w-full flex flex-col items-center">
            <h1 className="text-xl md:text-2xl font-mono text-zinc-500 font-bold tracking-wide mb-12 text-center select-none">
              End To End Encrypted Text
            </h1>

            {/* Prefix & Alphanumeric Input Center Row */}
            <div className="flex flex-col items-center justify-center gap-6 text-center w-full mb-20 relative">
              <span className="text-zinc-600 select-none text-center line-clamp-2 overflow-hidden break-all leading-tight max-w-[320px]">
                {dynamicDomain}
              </span>
              
              <div className="relative flex flex-col items-center justify-center flex-shrink-0 w-[14ch]">
                {!isHomeFocused && !searchName && (
                  <div className="absolute inset-y-0 w-full flex items-center justify-center pointer-events-none text-zinc-600 tracking-wider text-lg md:text-xl mt-[2px]">
                    <span className="inline-block w-[2px] h-5 md:h-6 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>Vault Name
                  </div>
                )}
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchName}
                  maxLength={9}
                  onFocus={() => setIsHomeFocused(true)}
                  onBlur={() => setIsHomeFocused(false)}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                    if (val.length <= 9) {
                      setSearchName(val);
                      setSearchError("");
                    }
                  }}
                  className="bg-transparent outline-none text-center py-1 text-white text-lg md:text-xl tracking-wider w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGo();
                  }}
                />
              </div>

              <div className="flex justify-center items-center w-full">
                <span
                  onClick={handleGo}
                  className="text-zinc-400 hover:text-white cursor-pointer select-none border-b border-transparent hover:border-white transition-all font-semibold px-2 py-1"
                >
                  GO
                </span>
              </div>

              {searchName && (
                <div className="absolute top-full left-0 right-0 mt-2 flex flex-col items-center text-center text-xs text-zinc-500 font-mono pointer-events-auto transition-opacity duration-300 gap-1 w-full">
                  <div className="break-words px-4 w-full max-w-[320px]">
                    Open <a href={`${dynamicDomain}${searchName.toLowerCase()}`} className="text-zinc-400 hover:text-zinc-300 underline underline-offset-2 tracking-wider lowercase">{(dynamicDomain.replace(/^https?:\/\//, '') + searchName).toLowerCase()}</a> Directly
                  </div>
                  {searchError && (
                    <div className="text-zinc-500 tracking-wider animate-fast-pulse mt-1">
                      {searchError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>

        <footer className="w-full max-w-6xl mx-auto flex justify-center items-center gap-4">
          <span className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase text-center select-none">
            Zero Knowledge Architecture // Secrets never transfer to server
          </span>
        </footer>

        {/* PASSWORD PROMPT MODAL */}
        <AnimatePresence>
          {vaultName && (
            <div className="fixed inset-0 bg-[#0c0c0e] flex items-center justify-center z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-4xl px-4 md:px-8 flex flex-col gap-6 relative"
              >
                <h3 className="text-zinc-100 font-mono tracking-wide text-lg text-center uppercase">
                  {isNewVault ? "Create Vault Password" : "Unlock Encrypted Text"}
                </h3>

                <div className="flex flex-col w-full items-center">
                  <div className="w-full mb-6">
                    {isNewVault && (
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                        PASSWORD
                      </label>
                    )}
                    <div className="w-full flex justify-center items-center">
                      <div className="relative grid items-center">
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          ••••••••
                        </span>
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          {password ? (showPasswordReveal ? password : '•'.repeat(password.length)) : ''}
                        </span>
                        <input
                          ref={passwordInputRef}
                          autoFocus
                          type={showPasswordReveal ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          maxLength={18}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-base md:text-sm tracking-[0.2em] text-center"
                          style={{ ["WebkitTextSecurity" as any]: showPasswordReveal ? "none" : "disc" }}
                          placeholder="••••••••"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              if (isNewVault) handleCreateVault();
                              else handleUnlockVault();
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {isNewVault && (
                    <div className="w-full mb-6">
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                        REPEAT PASSWORD
                      </label>
                      <div className="w-full flex justify-center items-center">
                        <div className="relative grid items-center">
                          <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                            ••••••••
                          </span>
                          <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                            {confirmPassword ? (showPasswordReveal ? confirmPassword : '•'.repeat(confirmPassword.length)) : ''}
                          </span>
                          <input
                            type={showPasswordReveal ? "text" : "password"}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            maxLength={18}
                            className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-base md:text-sm tracking-[0.2em] text-center"
                            style={{ ["WebkitTextSecurity" as any]: showPasswordReveal ? "none" : "disc" }}
                            placeholder="••••••••"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCreateVault();
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {errorText && (
                    <p className="font-mono text-[10px] text-red-500 text-center tracking-widest mb-4 uppercase">
                      [!] {errorText}
                    </p>
                  )}

                  {isNewVault && (
                    <div className="text-zinc-500 font-mono text-[10px] text-center uppercase leading-relaxed tracking-widest select-none mb-6">
                      <span className="text-zinc-400 block mb-1 font-semibold">Strict requirements:</span>
                      Between 8 to 18 characters limit<br />
                      Uppercase and lowercase letters<br />
                      Special characters and numbers
                    </div>
                  )}

                  <div className="flex justify-center gap-12 items-center">
                    <span
                      onClick={() => navigateTo("")}
                      className="font-mono text-xs text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={isNewVault ? handleCreateVault : handleUnlockVault}
                      className="font-mono text-xs font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                    >
                      {isNewVault ? "Initialize" : "Decrypt"}
                    </span>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {loadingOverlay}
      </div>
    );
  }



  // 3. SECURE TEXT EDITOR VIEW (TAB VIEW ENVIRONMENT)
  return (
    <div className="min-h-screen flex flex-col justify-between bg-[#0b0c0e] text-zinc-200 font-sans relative">
      {/* Visual saving animation overlay */}
      <AnimatePresence>
        {(saveStatus === "saving" || saveStatus === "saved" || saveStatus === "pwd_changed") && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-[#0c0c0e] z-50 pointer-events-none"
          >
            <span className="font-mono text-sm tracking-widest text-[#ffffff] font-medium block uppercase animate-pulse">
              {saveStatus === "saving" ? "Saving..." : saveStatus === "pwd_changed" ? "Password Changed" : "Saved"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sticky top-0 z-30 bg-[#0c0c0e] flex flex-col w-full">
        <header className="w-full">
        <div className="w-full max-w-4xl px-4 md:px-8 py-4 flex justify-between items-center mx-auto">
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm tracking-widest text-[#ffffff] font-semibold select-none flex items-center">
              <span className="text-zinc-500 tracking-normal">Text_Vault/</span><span className="lowercase">{vaultName}</span>
            </span>
            {hasUnsavedChanges && (
              <span className="font-mono text-[10px] text-zinc-500 animate-pulse tracking-wide select-none">
                [UNSAVED]
              </span>
            )}
          </div>

        {/* Global actions: Save word and Settings overlay */}
        <div className="flex items-center gap-6">
          <span
            onClick={() => {
              if (hasUnsavedChanges && saveStatus !== "saving") {
                performSaveAction();
              }
            }}
            className={`font-mono text-xs uppercase tracking-wider select-none font-medium transition-colors leading-none block ${
              hasUnsavedChanges && saveStatus !== "saving"
                ? "text-zinc-200 hover:text-white hover:underline cursor-pointer"
                : "text-zinc-600 cursor-not-allowed"
            }`}
          >
            Save
          </span>

          <div className="relative flex items-center">
            {/* Menu Backdrop */}
            {showMenu && (
              <div 
                className="fixed inset-0 z-40 bg-[#0c0c0e]" 
                onClick={() => setShowMenu(false)} 
              />
            )}
            <span
              onClick={() => setShowMenu(!showMenu)}
              className="font-mono text-xs uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer select-none leading-none block relative z-50"
            >
              Menu
            </span>

            {/* Sandwich dropdown */}
            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute right-0 top-full mt-4 flex flex-col items-end gap-3 z-50 whitespace-nowrap"
                >
                  <span
                    onClick={() => {
                      handleLock();
                    }}
                    className="text-xs font-mono text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    Lock Vault
                  </span>
                  <span
                    onClick={() => {
                      setShowChangePasswordModal(true);
                      setPwdModalError("");
                      setShowMenu(false);
                    }}
                    className="text-xs font-mono text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    Change Password
                  </span>
                  <span
                    onClick={() => {
                      setShowDeleteModal(true);
                      setDeleteStep(1);
                      setDeleteConfirmName("");
                      setDeleteError("");
                      setShowMenu(false);
                    }}
                    className="text-xs font-mono text-zinc-500 hover:text-red-400 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    Delete Vault
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        </div>
      </header>

      {/* Navigation / Chrome mimic row */}
      <div className="w-full max-w-4xl px-4 md:px-8 pb-1 pt-1 flex flex-wrap justify-between items-center gap-4 mx-auto bg-[#0c0c0e]">
          {/* Draggable Chrome tabs reordered */}
          <div className="flex flex-wrap items-end gap-0.5 flex-1">
            {tabs.map((tab, idx) => {
              const active = tab.id === activeTabId;
              const isEditing = editingTabId === tab.id;
              return (
                <div
                  key={tab.id}
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => {
                    setActiveTabId(tab.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingTabId(tab.id);
                    setEditingTitle(getTabRawTitle(tab));
                  }}
                  className={`relative flex items-center pl-0 pr-3 pt-1.5 pb-1 text-xs font-mono select-none cursor-pointer transition-colors ${
                    active
                      ? "text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  } ${draggingIndex === idx ? "opacity-30" : ""}`}
                >
                  <div className="flex items-center gap-0.5 pb-0.5">
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameSave(tab.id)}
                        onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
                        onFocus={(e) => e.target.select()}
                        className="bg-transparent border-b border-zinc-500 text-white outline-none font-mono text-xs pb-0.5 max-w-[120px]"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span 
                        className={`tracking-wide text-zinc-100 block whitespace-nowrap pb-0.5 border-b ${active ? "border-white" : "border-transparent"}`} 
                        title={getTabRawTitle(tab)}
                      >
                        {getTabDisplayTitle(tab.text, tab.title)}
                      </span>
                    )}

                    {tabs.length > 1 && (
                      <span
                        onClick={(e) => handleCloseTab(e, tab.id)}
                        className="text-zinc-500 hover:text-red-400 select-none pl-1 ml-1 flex items-center justify-center transition-colors"
                      >
                        <X size={10} strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {tabs.length < 10 && (
              <div
                onClick={handleAddTab}
                className="relative flex items-center px-1.5 pt-1.5 pb-1 text-xs font-mono select-none cursor-pointer text-zinc-500 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-0.5 pb-0.5">
                  <span className="tracking-wide font-semibold">
                    + Tab
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Visual editor toggles (Edit, Split, Preview) */}
        </div>
      </div>

      <main className="flex-1 flex flex-col bg-[#0c0c0e] px-4 md:px-8 pt-0 pb-0 max-w-4xl mx-auto w-full">
        {/* Content Box (Unified Line-by-Line Edit & Preview Area) */}
        <div className="flex-1 flex flex-col relative pt-1 md:pt-2 pb-24 min-h-[550px]">
          <Editor
            editorRef={editorRef}
            activeTabId={activeTabId}
            initialContent={activeTabContent}
            onChange={handleEditorInput}
            onSelect={handleEditorSelect}
          />

          {/* PC Mode selection toolbar */}
          {selectionRect && editorRef.current?.parentElement && (
            <div 
              ref={pcSelectionToolbarContainerRef}
              className="hidden md:flex absolute z-50 mt-1 shadow-2xl"
              style={{
                top: pcSelectionStyle.top ?? (selectionRect.bottom - editorRef.current.parentElement.getBoundingClientRect().top), 
                left: pcSelectionStyle.left ?? (selectionRect.left - editorRef.current.parentElement.getBoundingClientRect().left),
                transform: pcSelectionStyle.transform || 'none',
                visibility: pcSelectionStyle.visibility as any || 'hidden'
              }}
            >
              {showLinkInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={linkValue}
                    placeholder="https://"
                    onChange={(e) => setLinkValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleLinkSubmit(linkValue || "https://");
                      } else if (e.key === "Escape") {
                        setShowLinkInput(false);
                      }
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span 
                    className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1"
                    onClick={() => handleLinkSubmit(linkValue || "https://")}
                  >
                    OK
                  </span>
                </div>
              ) : showImageInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={imageValue}
                    placeholder="Image Address"
                    onChange={(e) => setImageValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleImageSubmit(imageValue || "https://");
                      } else if (e.key === "Escape") {
                        setShowImageInput(false);
                      }
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span 
                    className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1"
                    onClick={() => handleImageSubmit(imageValue || "https://")}
                  >
                    OK
                  </span>
                </div>
              ) : showTableInput ? (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <span>[Row:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableRowFocused && !tableRowValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      autoFocus
                      value={tableRowValue}
                      onFocus={() => setIsTableRowFocused(true)}
                      onBlur={() => setIsTableRowFocused(false)}
                      onChange={(e) => setTableRowValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>Column:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableColFocused && !tableColValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      value={tableColValue}
                      onFocus={() => setIsTableColFocused(true)}
                      onBlur={() => setIsTableColFocused(false)}
                      onChange={(e) => setTableColValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleTableSubmit()}>OK</span>
                </div>
              ) : (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] select-none border border-zinc-800 rounded max-w-[calc(100vw-2rem)] md:max-w-4xl my-1 animate-fade-in">
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(pcSelectionToolbarScrollRef, 'left', e)}>[</span>
                  <div ref={pcSelectionToolbarScrollRef} className="flex items-center gap-3 overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap">
                    {selectionTools.map((tool) => (
                      <button
                        key={tool.label}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleToolClick(tool)}
                        className="hover:text-white hover:underline cursor-pointer"
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(pcSelectionToolbarScrollRef, 'right', e)}>]</span>
                </div>
              )}
            </div>
          )}

          {/* PC Mode local empty-line toolbar */}
          {emptyLineRect && !selectionRect && editorRef.current?.parentElement && (
            <div 
              ref={pcEmptyLineToolbarContainerRef}
              className="hidden md:flex absolute z-50 mt-1 shadow-2xl transition-all duration-300 ease-in-out"
              style={{ 
                top: pcEmptyLineStyle.top ?? (emptyLineRect.bottom - editorRef.current.parentElement.getBoundingClientRect().top), 
                left: pcEmptyLineStyle.left ?? (emptyLineRect.left - editorRef.current.parentElement.getBoundingClientRect().left),
                transform: pcEmptyLineStyle.transform || 'none',
                visibility: pcEmptyLineStyle.visibility as any || 'hidden'
              }}
            >
              {showLinkInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={linkValue}
                    placeholder="https://"
                    onChange={(e) => setLinkValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleLinkSubmit(linkValue || "https://");
                      } else if (e.key === "Escape") {
                        setShowLinkInput(false);
                      }
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span 
                    className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1"
                    onClick={() => handleLinkSubmit(linkValue || "https://")}
                  >
                    OK
                  </span>
                </div>
              ) : showImageInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={imageValue}
                    placeholder="Image Address"
                    onChange={(e) => setImageValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleImageSubmit(imageValue || "https://");
                      } else if (e.key === "Escape") {
                        setShowImageInput(false);
                      }
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span 
                    className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1"
                    onClick={() => handleImageSubmit(imageValue || "https://")}
                  >
                    OK
                  </span>
                </div>
              ) : showTableInput ? (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <span>[Row:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableRowFocused && !tableRowValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      autoFocus
                      value={tableRowValue}
                      onFocus={() => setIsTableRowFocused(true)}
                      onBlur={() => setIsTableRowFocused(false)}
                      onChange={(e) => setTableRowValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>Column:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableColFocused && !tableColValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      value={tableColValue}
                      onFocus={() => setIsTableColFocused(true)}
                      onBlur={() => setIsTableColFocused(false)}
                      onChange={(e) => setTableColValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleTableSubmit()}>OK</span>
                </div>
              ) : (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] select-none border border-zinc-800 rounded max-w-[calc(100vw-2rem)] md:max-w-4xl my-1 animate-fade-in">
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(pcEmptyLineToolbarScrollRef, 'left', e)}>[</span>
                  <div ref={pcEmptyLineToolbarScrollRef} className="flex items-center overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap gap-3">
                    {emptyLineTools.map((tool) => (
                      <button
                        key={tool.label}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToolClick(tool);
                          if (tool.format !== "image" && tool.type !== "link" && tool.format !== "table") {
                            setEmptyLineRect(null);
                          }
                        }}
                        className="hover:text-white hover:underline cursor-pointer"
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(pcEmptyLineToolbarScrollRef, 'right', e)}>]</span>
                </div>
              )}
            </div>
          )}
        </div>

                {/* Mobile bottom-sticky adaptive toolbar */}
        <div data-mobile-toolbar="true" className="fixed left-0 right-0 z-40 bg-transparent md:hidden flex justify-center pointer-events-none pb-4" style={{ bottom: viewportBottom }}>
          <div className="w-full flex flex-col items-center justify-end px-4">
            {selectionRect ? (
              showLinkInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={linkValue}
                    placeholder="https://"
                    onChange={(e) => setLinkValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLinkSubmit(linkValue || "https://");
                      else if (e.key === "Escape") setShowLinkInput(false);
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleLinkSubmit(linkValue || "https://")}>OK</span>
                </div>
              ) : showImageInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={imageValue}
                    placeholder="Image Address"
                    onChange={(e) => setImageValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleImageSubmit(imageValue || "https://");
                      else if (e.key === "Escape") setShowImageInput(false);
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleImageSubmit(imageValue || "https://")}>OK</span>
                </div>
              ) : showTableInput ? (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span>[Row:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableRowFocused && !tableRowValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      autoFocus
                      value={tableRowValue}
                      onFocus={() => setIsTableRowFocused(true)}
                      onBlur={() => setIsTableRowFocused(false)}
                      onChange={(e) => setTableRowValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>Column:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableColFocused && !tableColValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      value={tableColValue}
                      onFocus={() => setIsTableColFocused(true)}
                      onBlur={() => setIsTableColFocused(false)}
                      onChange={(e) => setTableColValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleTableSubmit()}>OK</span>
                </div>
              ) : (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(mobileSelectionToolbarScrollRef, 'left', e)}>[</span>
                  <div ref={mobileSelectionToolbarScrollRef} className="flex items-center gap-3 overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap flex-1">
                    {selectionTools.map((tool) => (
                      <button
                        key={tool.label}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToolClick(tool);
                        }}
                        className="hover:text-white hover:underline cursor-pointer flex-shrink-0"
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(mobileSelectionToolbarScrollRef, 'right', e)}>]</span>
                </div>
              )
            ) : emptyLineRect ? (
              showLinkInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={linkValue}
                    placeholder="https://"
                    onChange={(e) => setLinkValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleLinkSubmit(linkValue || "https://");
                      else if (e.key === "Escape") setShowLinkInput(false);
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleLinkSubmit(linkValue || "https://")}>OK</span>
                </div>
              ) : showImageInput ? (
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span>[</span>
                  <input
                    type="text"
                    autoFocus
                    value={imageValue}
                    placeholder="Image Address"
                    onChange={(e) => setImageValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleImageSubmit(imageValue || "https://");
                      else if (e.key === "Escape") setShowImageInput(false);
                    }}
                    className="bg-transparent outline-none border-none text-zinc-200 w-full pl-1 placeholder-zinc-600 font-mono text-xs h-full"
                  />
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleImageSubmit(imageValue || "https://")}>OK</span>
                </div>
              ) : showTableInput ? (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span>[Row:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableRowFocused && !tableRowValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      autoFocus
                      value={tableRowValue}
                      onFocus={() => setIsTableRowFocused(true)}
                      onBlur={() => setIsTableRowFocused(false)}
                      onChange={(e) => setTableRowValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>Column:</span>
                  <div className="relative flex items-center h-full">
                    {!isTableColFocused && !tableColValue && (
                      <div className="absolute inset-y-0 flex items-center pointer-events-none text-zinc-600">
                        <span className="inline-block w-[2px] h-3 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>
                      </div>
                    )}
                    <input
                      type="text"
                      value={tableColValue}
                      onFocus={() => setIsTableColFocused(true)}
                      onBlur={() => setIsTableColFocused(false)}
                      onChange={(e) => setTableColValue(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleTableSubmit();
                        else if (e.key === "Escape") setShowTableInput(false);
                      }}
                      className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                    />
                  </div>
                  <span className="w-[2ch]"></span>
                  <span>]</span>
                  <span className="cursor-pointer hover:text-white font-bold text-zinc-300 ml-1" onClick={() => handleTableSubmit()}>OK</span>
                </div>
              ) : (
                <div className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] select-none border border-zinc-800 rounded w-full max-w-[calc(100vw-2rem)] shadow-2xl animate-fade-in pointer-events-auto">
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(mobileEmptyLineToolbarScrollRef, 'left', e)}>[</span>
                  <div ref={mobileEmptyLineToolbarScrollRef} className="flex items-center gap-3 overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap flex-1">
                    {emptyLineTools.map((tool) => (
                      <button
                        key={tool.label}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToolClick(tool);
                          if (tool.format !== "image" && tool.type !== "link" && tool.format !== "table") {
                            setEmptyLineRect(null);
                          }
                        }}
                        className="hover:text-white hover:underline cursor-pointer flex-shrink-0"
                      >
                        {tool.label}
                      </button>
                    ))}
                  </div>
                  <span className="px-2 font-bold cursor-pointer hover:text-white" onMouseDown={(e) => scrollToolbarRef(mobileEmptyLineToolbarScrollRef, 'right', e)}>]</span>
                </div>
              )
            ) : null}
          </div>
        </div>

      </main>



      {/* CHANGING ENCRYPT PASSWORD POPUP */}
      <AnimatePresence>
        {tabToClose && (
          <div className="fixed inset-0 bg-[#0c0c0e] flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm flex flex-col gap-6 relative"
            >
              <h3 className="text-zinc-100 font-mono tracking-wide text-lg text-center uppercase">
                Close Tab
              </h3>

              <p className="font-mono text-xs text-zinc-400 text-center leading-relaxed">
                Are you sure you want to close this tab?
              </p>

              <div className="flex justify-center gap-12 items-center mt-2">
                <span
                  onClick={() => setTabToClose(null)}
                  className="font-mono text-xs text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                >
                  Cancel
                </span>
                <span
                  onClick={confirmCloseTab}
                  className="font-mono text-xs font-semibold text-red-500 hover:text-red-400 transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                >
                  Confirm
                </span>
              </div>
            </motion.div>
          </div>
        )}

        {showChangePasswordModal && (
          <div className="fixed inset-0 bg-[#0c0c0e] flex items-center justify-center z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl px-4 md:px-8 flex flex-col gap-6 relative"
            >
              <h3 className="text-zinc-100 font-mono tracking-wide text-lg text-center uppercase">
                Change Password
              </h3>

              <div className="flex flex-col w-full items-center">
                <div className="w-full">
                  <div className="w-full mb-6">
                    <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                      NEW PASSWORD
                    </label>
                    <div className="w-full flex justify-center items-center">
                      <div className="relative grid items-center">
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          ••••••••
                        </span>
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          {newPassword ? (showNewPasswordReveal ? newPassword : '•'.repeat(newPassword.length)) : ''}
                        </span>
                        <input
                          type={showNewPasswordReveal ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          maxLength={18}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center"
                          style={{ ["WebkitTextSecurity" as any]: showNewPasswordReveal ? "none" : "disc" }}
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="w-full mb-6">
                    <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                      REPEAT PASSWORD
                    </label>
                    <div className="w-full flex justify-center items-center">
                      <div className="relative grid items-center">
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          ••••••••
                        </span>
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          {confirmNewPassword ? (showNewPasswordReveal ? confirmNewPassword : '•'.repeat(confirmNewPassword.length)) : ''}
                        </span>
                        <input
                          type={showNewPasswordReveal ? "text" : "password"}
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          maxLength={18}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center"
                          style={{ ["WebkitTextSecurity" as any]: showNewPasswordReveal ? "none" : "disc" }}
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {pwdModalError && (
                  <p className="font-mono text-[10px] text-red-500 text-center tracking-widest mb-4 uppercase">
                    [!] {pwdModalError}
                  </p>
                )}

                <div className="text-[10px] text-zinc-600 font-mono text-center tracking-widest select-none mb-6 w-full max-w-4xl px-4 leading-normal">
                  Your current two tab contents will be re-encrypted with this new password
                </div>

                <div className="flex justify-center gap-12 items-center">
                  <span
                    onClick={() => {
                      setNewPassword("");
                      setConfirmNewPassword("");
                      setPwdModalError("");
                      setShowChangePasswordModal(false);
                    }}
                    className="font-mono text-xs text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={handleChangePassword}
                    className="font-mono text-xs font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                  >
                    Confirm
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3-PHASE DESTRUCTION POPUP CONFIRM */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 bg-[#0c0c0e] flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl flex flex-col gap-6 relative"
            >
              <h3 className="font-mono tracking-wide text-lg text-red-500 uppercase text-center font-bold">
                Instant Destruction Alert
              </h3>

              {deleteStep === 1 && (
                <div className="flex flex-col gap-6">
                  <p className="font-mono text-xs text-zinc-300 leading-relaxed text-center px-4">
                    Are you absolutely sure you want to delete this vault? Once initiated, this process is completely permanent and irreversible.
                  </p>
                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-mono text-xs text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Keep Secure
                    </span>
                    <span
                      onClick={() => setDeleteStep(2)}
                      className="font-mono text-xs font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                    >
                      Authorize (1/3)
                    </span>
                  </div>
                </div>
              )}

              {deleteStep === 2 && (
                <div className="flex flex-col gap-6">
                  <p className="font-mono text-xs text-zinc-300 leading-relaxed text-center px-4">
                    All {tabs.length} tab pages containing your private E2E encrypted plaintext will be wiped forever from the cloud. This cannot be undone!
                  </p>
                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-mono text-xs text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Aboard
                    </span>
                    <span
                      onClick={() => setDeleteStep(3)}
                      className="font-mono text-xs font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                    >
                      Destroy (2/3)
                    </span>
                  </div>
                </div>
              )}

              {deleteStep === 3 && (
                <div className="flex flex-col gap-6 w-full items-center">
                  <p className="font-mono text-xs text-zinc-300 leading-relaxed text-center px-4">
                    Type the vault name below:
                  </p>

                  <div className="w-full flex justify-center px-4">
                    <div className="relative flex items-center justify-center w-full max-w-xs">
                      {!isDeleteConfirmFocused && !deleteConfirmName && (
                        <div className="absolute inset-y-0 w-full flex items-center justify-center pointer-events-none text-zinc-600 font-mono tracking-wider text-base md:text-sm">
                          <span className="inline-block w-[2px] h-4 md:h-5 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>CONFIRM NAME
                        </div>
                      )}
                      <input
                        type="text"
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        onFocus={() => setIsDeleteConfirmFocused(true)}
                        onBlur={() => setIsDeleteConfirmFocused(false)}
                        className="bg-transparent outline-none py-1 font-mono text-white text-base md:text-sm tracking-wider text-center w-full uppercase"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && deleteConfirmName.toLowerCase() === vaultName.toLowerCase()) {
                            handleDeleteVault();
                          }
                        }}
                      />
                    </div>
                  </div>

                  {deleteError && (
                    <p className="font-mono text-xs text-red-500 tracking-wide text-center uppercase leading-normal">
                      [!] {deleteError}
                    </p>
                  )}

                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-mono text-xs text-zinc-500 hover:text-white transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={handleDeleteVault}
                      className={`font-mono text-xs font-semibold uppercase tracking-wider px-2 block ${
                        deleteConfirmName.toLowerCase() === vaultName.toLowerCase()
                          ? "text-red-500 hover:text-red-400 hover:underline cursor-pointer transition-colors"
                          : "text-zinc-600 cursor-not-allowed"
                      }`}
                    >
                      Wipe Vault (3/3)
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {loadingOverlay}
    </div>
  );
}
