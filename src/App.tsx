import { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react";
import "katex/dist/katex.min.css";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { TabContent, SaveStatus } from "./types";
import { Editor, normalizeEditorNodes } from "./Editor";
import {
  deriveKeyAndHash,
  encryptData,
  decryptData,
  generateSaltHex,
  validatePassword,
  sha256Client,
} from "./crypto";
import {
  calculateSelectionPosition,
  calculateEmptyLinePositionLeft,
  shouldShowBackToTop,
} from "./toolbarPosition";

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
  const scrollPositionsRef = useRef<Record<string, number>>({});

  const handleTabSwitch = (newTabId: string) => {
    if (newTabId === activeTabId) return;
    scrollPositionsRef.current[activeTabId] = window.scrollY;
    setActiveTabId(newTabId);
  };

  useLayoutEffect(() => {
    if (activeTabId) {
      window.scrollTo(0, scrollPositionsRef.current[activeTabId] || 0);
    }
  }, [activeTabId]);
  const pcSelectionToolbarScrollRef = useRef<HTMLDivElement>(null);
  const pcEmptyLineToolbarScrollRef = useRef<HTMLDivElement>(null);
  const mobileSelectionToolbarScrollRef = useRef<HTMLDivElement>(null);
  const mobileEmptyLineToolbarScrollRef = useRef<HTMLDivElement>(null);

  const pcSelectionToolbarContainerRef = useRef<HTMLDivElement>(null);
  const pcEmptyLineToolbarContainerRef = useRef<HTMLDivElement>(null);
  const [pcSelectionStyle, setPcSelectionStyle] = useState<React.CSSProperties>({});
  const [pcEmptyLineStyle, setPcEmptyLineStyle] = useState<React.CSSProperties>({});

  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
  const [isEditorFocused, setIsEditorFocused] = useState<boolean>(false);
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const backToTopRef = useRef<HTMLDivElement>(null);
  const [backToTopSize, setBackToTopSize] = useState<{ w: number; h: number }>({ w: 0, h: 30 });

  // Mobile keyboard offset: distance from visual-viewport bottom to window bottom
  const [keyboardOffset, setKeyboardOffset] = useState<number>(0);

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

  // Tick counter to trigger toolbar position recalculation on scroll / resize / IME
  const [toolbarTick, setToolbarTick] = useState<number>(0);
  const scheduleToolbarUpdate = useCallback(() => {
    requestAnimationFrame(() => setToolbarTick(t => t + 1));
  }, []);

  // Track mobile keyboard offset via visualViewport
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const updateOffset = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      // Only count as keyboard if offset is significant (> 80px)
      setKeyboardOffset(offset > 80 ? offset : 0);
    };
    updateOffset();
    vv.addEventListener('resize', updateOffset);
    vv.addEventListener('scroll', updateOffset);
    return () => {
      vv.removeEventListener('resize', updateOffset);
      vv.removeEventListener('scroll', updateOffset);
    };
  }, []);

  // Refactored: unified selection-toolbar position using last-line client rect
  useLayoutEffect(() => {
    const toolbar = pcSelectionToolbarContainerRef.current;
    if (!selectionRange || !editorRef.current?.parentElement || !toolbar) {
      return;
    }

    const parent = editorRef.current.parentElement;
    const toolbarRect = toolbar.getBoundingClientRect();
    const pos = calculateSelectionPosition(selectionRange, parent, toolbarRect.width);
    setPcSelectionStyle(pos);
  }, [selectionRange, toolbarTick, showLinkInput, showImageInput, showTableInput]);

  // Refactored: unified empty-line-toolbar position
  useLayoutEffect(() => {
    const toolbar = pcEmptyLineToolbarContainerRef.current;
    if (!emptyLineRect || !editorRef.current?.parentElement || !toolbar) {
      return;
    }

    const parent = editorRef.current.parentElement;
    const toolbarRect = toolbar.getBoundingClientRect();
    const pos = calculateEmptyLinePositionLeft(emptyLineRect, parent, toolbarRect.width);
    setPcEmptyLineStyle(pos);
  }, [emptyLineRect, toolbarTick, showLinkInput, showImageInput, showTableInput]);

  // Recalculate toolbar position on window resize, editor scroll, and IME composition
  useEffect(() => {
    const editorParent = editorRef.current?.parentElement;
    if (!editorParent) return;

    window.addEventListener('resize', scheduleToolbarUpdate, { passive: true });
    window.addEventListener('scroll', scheduleToolbarUpdate, { passive: true });
    editorParent.addEventListener('scroll', scheduleToolbarUpdate, { passive: true });

    // IME composition may change layout – listen on the editor itself
    const editor = editorRef.current;
    editor?.addEventListener('compositionstart', scheduleToolbarUpdate);
    editor?.addEventListener('compositionend', scheduleToolbarUpdate);

    // visualViewport resize (mobile keyboard / IME)
    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleToolbarUpdate);

    return () => {
      window.removeEventListener('resize', scheduleToolbarUpdate);
      window.removeEventListener('scroll', scheduleToolbarUpdate);
      editorParent.removeEventListener('scroll', scheduleToolbarUpdate);
      editor?.removeEventListener('compositionstart', scheduleToolbarUpdate);
      editor?.removeEventListener('compositionend', scheduleToolbarUpdate);
      vv?.removeEventListener('resize', scheduleToolbarUpdate);
    };
  }, [scheduleToolbarUpdate]);

  // Keep active cursor/selection visible in the visual viewport on mobile
  useEffect(() => {
    if (window.innerWidth >= 768) return;

    const handleSelectionChange = () => {
      // Small timeout to allow DOM/layout updates
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        
        if (!editorRef.current || !editorRef.current.contains(sel.focusNode)) return;
        
        const range = sel.getRangeAt(0);
        let cursorRect = range.getBoundingClientRect();
        
        if (cursorRect.height === 0 && cursorRect.width === 0) {
          let node = sel.focusNode;
          if (node?.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
          }
          if (node instanceof Element) {
            cursorRect = node.getBoundingClientRect();
          }
        }

        if (cursorRect.height === 0) return;

        const vv = window.visualViewport;
        if (!vv) return;

        // The toolbar height might be around 40-50px, plus some margin
        const toolbarHeight = 50; 
        const bottomThreshold = vv.height - toolbarHeight - 20; 
        
        // Calculate the absolute position within the visual viewport
        const cursorBottomInVv = cursorRect.bottom - vv.offsetTop;

        if (cursorBottomInVv > bottomThreshold) {
          const delta = cursorBottomInVv - bottomThreshold;
          window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
        }
      }, 50);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', handleSelectionChange);
    
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      vv?.removeEventListener('resize', handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const inEditor = editorRef.current?.contains(target);
      const inPcSelection = pcSelectionToolbarContainerRef.current?.contains(target);
      const inPcEmptyLine = pcEmptyLineToolbarContainerRef.current?.contains(target);
      
      if (!inEditor && !inPcSelection && !inPcEmptyLine) {
        setSelectionRect(null);
        setSelectionRange(null);
        setEmptyLineRect(null);
        setIsLineToolbarExpanded(false);
        
        if (showTableInput) setShowTableInput(false);
        if (showLinkInput) setShowLinkInput(false);
        if (showImageInput) setShowImageInput(false);
      } else if (showTableInput || showLinkInput || showImageInput) {
        if (!inPcSelection && !inPcEmptyLine) {
          if (showTableInput) setShowTableInput(false);
          if (showLinkInput) setShowLinkInput(false);
          if (showImageInput) setShowImageInput(false);
        }
      }
    };
    
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [showTableInput, showLinkInput, showImageInput]);

  // Back to top: track scroll depth, progress, and editor focus state
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setShowBackToTop(scrollTop > 300);
      setScrollProgress(docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Measure Back to top button dimensions for SVG border
  useEffect(() => {
    const el = backToTopRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBackToTopSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    setBackToTopSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, [showBackToTop]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onFocusIn = () => setIsEditorFocused(true);
    const onFocusOut = () => setIsEditorFocused(false);
    editor.addEventListener('focusin', onFocusIn);
    editor.addEventListener('focusout', onFocusOut);
    return () => {
      editor.removeEventListener('focusin', onFocusIn);
      editor.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const scrollToolbarRef = (ref: React.RefObject<HTMLDivElement | null>, direction: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (ref.current) {
      ref.current.scrollBy({ left: direction === 'left' ? -100 : 100, behavior: 'smooth' });
    }
  };

  // Tool lists configuration
  const selectionTools = [
    { label: "Text", type: "block", format: "p" },
    { label: "Bold", type: "inline", format: "bold" },
    { label: "Italic", type: "inline", format: "italic" },
    { label: "Strike", type: "inline", format: "strike" },
    { label: "Under", type: "inline", format: "underline" },
    { label: "Link", type: "link" },
    { label: "H1", type: "block", format: "h1" },
    { label: "H2", type: "block", format: "h2" },
    { label: "H3", type: "block", format: "h3" },
    { label: "List", type: "block", format: "list" },
    { label: "Quote", type: "block", format: "blockquote" },
    { label: "Code", type: "block", format: "pre" },
    { label: "Center", type: "block", format: "center" }
  ];

  const emptyLineTools = [
    { label: "Text", type: "block", format: "p" },
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
    { label: "Under", type: "inline", format: "underline" },
    { label: "Link", type: "link" },
    { label: "Center", type: "block", format: "center" }
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
  const [pwdModalError, setPwdModalError] = useState<string>("");

  // Delete Vault 3-Phase Modal state
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [deleteStep, setDeleteStep] = useState<number>(1);
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>("");
  const [deleteError, setDeleteError] = useState<string>("");
  const [isDeleteConfirmFocused, setIsDeleteConfirmFocused] = useState<boolean>(false);

  // Chrome Tabs drag and drop state
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Mobile touch long-press drag state
  const touchDragIndexRef = useRef<number | null>(null);
  const touchDragOverIndexRef = useRef<number | null>(null);
  const [touchDragIndex, setTouchDragIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  const [tabToClose, setTabToClose] = useState<string | null>(null);

  // Inactivity tracking
  const lastActivityRef = useRef<number>(Date.now());
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refs mirroring state for stable auto-save effect (prevents focus loss)
  const hasUnsavedRef = useRef(hasUnsavedChanges);
  const saveStatusRef = useRef(saveStatus);
  hasUnsavedRef.current = hasUnsavedChanges;
  saveStatusRef.current = saveStatus;

  const resetVaultAuthInputs = () => {
    setPassword("");
    setConfirmPassword("");
    setErrorText("");
  };

  // Focus password input when prompt is visible
  useEffect(() => {
    if (vaultName && !isVerified) {
      if (passwordInputRef.current) {
        passwordInputRef.current.focus();
      }
    }
  }, [vaultName, isVerified]);

  useEffect(() => {
    if (!isVerified) {
      resetVaultAuthInputs();
    }
  }, [vaultName, isVerified]);

  // Auto-scroll input into view on mobile when name input or password input is clicked/focused
  useEffect(() => {
    if (isVerified) return;

    let scrollTimeoutId: any;
    let lastVvHeight = window.visualViewport?.height || window.innerHeight;

    const scrollInputIntoView = (input: HTMLInputElement) => {
      const vv = window.visualViewport;
      if (!vv) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const rect = input.getBoundingClientRect();
      const vvTop = vv.offsetTop;
      const vvBottom = vvTop + vv.height;

      // Define a comfortable region: middle 50% of the visible viewport height
      const margin = vv.height * 0.25;
      const comfortableMin = vvTop + margin;
      const comfortableMax = vvBottom - margin;

      // Check if the input is outside this comfortable visual region
      if (rect.top < comfortableMin || rect.bottom > comfortableMax) {
        const absoluteTop = window.scrollY + rect.top;
        const inputCenterY = absoluteTop + rect.height / 2;
        
        // Use vv.height to calculate the target scroll without depending on vv.offsetTop which fluctuates during scrolling
        const targetScrollY = inputCenterY - (vv.height / 2);

        window.scrollTo({
          top: Math.max(0, targetScrollY),
          behavior: 'smooth'
        });
      }
    };

    const triggerScroll = () => {
      const activeElement = document.activeElement as HTMLInputElement;
      if (activeElement && (activeElement === searchInputRef.current || activeElement === passwordInputRef.current)) {
        clearTimeout(scrollTimeoutId);
        scrollTimeoutId = setTimeout(() => scrollInputIntoView(activeElement), 300);
      }
    };

    const handleFocus = () => {
      triggerScroll();
    };

    const handleResize = () => {
      const currentHeight = window.visualViewport?.height || window.innerHeight;
      // Only trigger if height changes significantly (e.g., keyboard pop) to prevent scroll loops
      if (Math.abs(currentHeight - lastVvHeight) > 100) {
        triggerScroll();
      }
      lastVvHeight = currentHeight;
    };

    const searchInput = searchInputRef.current;
    const passwordInput = passwordInputRef.current;

    if (searchInput) {
      searchInput.addEventListener("focus", handleFocus);
    }
    if (passwordInput) {
      passwordInput.addEventListener("focus", handleFocus);
    }

    window.visualViewport?.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(scrollTimeoutId);
      if (searchInput) {
        searchInput.removeEventListener("focus", handleFocus);
      }
      if (passwordInput) {
        passwordInput.removeEventListener("focus", handleFocus);
      }
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [isVerified, vaultName]);

  // Dynamic host determination
  useEffect(() => {
    setDynamicDomain(window.location.origin + "/");
  }, []);

  // Simple reactive Router hook
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.replace(/^\/|\/$/g, "");
      setSearchName("");
      setSearchError("");
      setIsHomeFocused(false);
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
    resetVaultAuthInputs();
    setTabs([]);
    setActiveTabId("");
    setIsVerified(false);
    setHasUnsavedChanges(false);
    setShowMenu(false);
  };

  // Navigates securely
  const navigateTo = (name: string) => {
    window.history.pushState(null, "", name ? `/${name}` : "/");
    window.dispatchEvent(new Event("popstate"));
  };

  // Home Screen GO option
  const handleGo = () => {
    if (!searchName) {
      setSearchError("Please input a vault name.");
      return;
    }
    if (!/^[a-zA-Z0-9]{1,10}$/.test(searchName)) {
      setSearchError("Vault name must be alphanumeric and up to 10 characters.");
      return;
    }

    setSearchError("");
    navigateTo(searchName);
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

    passwordInputRef.current?.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
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
  const performSaveAction = async (opts?: { silent?: boolean }): Promise<boolean> => {
    if (!aesKey || !authHash || !vaultName || tabs.length === 0) return false;
    const silent = opts?.silent ?? false;
    if (!silent) setSaveStatus("saving");
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
        if (!silent) {
          setSaveStatus("saved");
          setTimeout(() => {
            setSaveStatus("idle");
          }, 200);
        }
        setHasUnsavedChanges(false);
        return true;
      } else {
        if (!silent) {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 2000);
        }
        return false;
      }
    } catch (error) {
      console.error("Save failure", error);
      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, 300 - elapsed);
      if (waitTime > 0) {
        await new Promise((r) => setTimeout(r, waitTime));
      }
      if (!silent) {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }
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

  // Auto‑save 20s after document becomes UNSAVED — silent, keeps editor focus intact
  useEffect(() => {
    if (!isVerified) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    if (hasUnsavedChanges && saveStatus === "idle") {
      timer = setTimeout(() => {
        if (hasUnsavedRef.current && saveStatusRef.current === "idle") {
          performSaveAction({ silent: true });
        }
      }, 20000);
    }

    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [isVerified, hasUnsavedChanges, saveStatus]);

  // Inactivity tracking for auto-lock (5 minutes)
  useEffect(() => {
    if (!isVerified) return;

    lastActivityRef.current = Date.now();

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
    };

    // Capture ANY user interaction across the entire vault page, including
    // editor, tabs, nav bar, menus — so that "inactive" truly means no operation at all.
    const events: Array<keyof DocumentEventMap> = [
      "pointerdown",   // mouse click or touch
      "pointermove",   // mouse movement or touch drag
      "keydown",       // any keyboard press
      "wheel",         // mouse wheel / trackpad scroll
    ];
    events.forEach((event) => document.addEventListener(event, resetTimer, { capture: true }));

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed >= 300000) {
        clearInterval(checkInterval);
        handleAutoSaveAndLock();
      }
    }, 1000);

    return () => {
      events.forEach((event) => document.removeEventListener(event, resetTimer, { capture: true }));
      clearInterval(checkInterval);
    };
  }, [isVerified]);

  // Hotkey hook for Ctrl+S and prevent Backspace browser navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isVerified && hasUnsavedChanges && saveStatus !== "saving") {
          performSaveAction();
        }
      }
      // Prevent Backspace from triggering browser "go back" in preview mode
      if (e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName;
        const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
        if (!isInput) {
          e.preventDefault();
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
        } else {
          // Cursor is at editor level — find the first block-level child
          // so the toolbar sits right below the actual content line rather
          // than at the bottom of the full-height editor container.
          const firstBlock = editorRef.current?.querySelector<HTMLElement>(
            'p, h1, h2, h3, h4, h5, h6, div, blockquote, pre, li, ul, ol'
          );
          if (firstBlock) {
            setEmptyLineRect(firstBlock.getBoundingClientRect());
          } else if (editorRef.current) {
            setEmptyLineRect(editorRef.current!.getBoundingClientRect());
          }
          setSelectionRange(sel.getRangeAt(0));
          setIsLineToolbarExpanded(true);
          return;
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
       document.execCommand("insertHTML", false, '\u200B<input type="checkbox" style="margin-right: 8px;">\u200B');
       // Place cursor after the checkbox zero-width space
       const el = editorRef.current;
       if (!el) return;
       requestAnimationFrame(() => {
         const sel2 = window.getSelection();
         if (!sel2) return;
         const checkbox = el.querySelector('input[type="checkbox"]');
         if (!checkbox) return;
         // Find the zero-width text node after the checkbox
         const afterNode = checkbox.nextSibling;
         if (afterNode && afterNode.nodeType === Node.TEXT_NODE) {
           const r = document.createRange();
           r.setStartAfter(afterNode);
           r.collapse(true);
           sel2.removeAllRanges();
           sel2.addRange(r);
         }
       });
    } else if (tag === "list") {
       document.execCommand("insertUnorderedList", false);
    } else if (tag === "center") {
       if (sel && sel.rangeCount > 0) {
         let node = sel.getRangeAt(0).startContainer as HTMLElement;
         if (node.nodeType === Node.TEXT_NODE) node = node.parentElement as HTMLElement;
         let block = node;
         while (block && block.id !== "editor-body" && !block.className?.includes("editor-body")) {
           const display = window.getComputedStyle(block).display;
           if (display === "block" || display === "list-item" || block.tagName === "DIV" || block.tagName === "P" || block.tagName.match(/^H[1-6]$/)) {
             break;
           }
           if (!block.parentElement) break;
           block = block.parentElement;
         }
         if (block && block.id !== "editor-body" && !block.className?.includes("editor-body")) {
           if (block.style.textAlign === "center") {
             block.style.textAlign = "";
           } else {
             block.style.textAlign = "center";
           }
         }
       }
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
    const el = editorRef.current;
    if (!el) return;

    // Prepare URL
    let finalUrl = url.trim();
    if (!finalUrl || finalUrl === "https://") return;
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = "https://" + finalUrl;
    }

    // Temporarily enable editing (editor loses focus when toolbar input gains it)
    const prevEditable = el.contentEditable;
    el.contentEditable = "true";
    el.focus({ preventScroll: true });

    // Restore the saved selection
    if (selectionRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(selectionRange);
    }

    // Apply link command
    document.execCommand("createLink", false, finalUrl);

    // Normalize: add target="_blank" rel="noopener noreferrer" to the new anchor
    normalizeEditorNodes(el);

    // Restore contentEditable to its previous state
    el.contentEditable = prevEditable;

    // Sync state
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: el.innerHTML } : t));
    setHasUnsavedChanges(true);
    setShowLinkInput(false);
    setLinkValue("");
  };

  const handleImageSubmit = (url: string) => {
    const el = editorRef.current;
    if (!el) return;

    // Validate URL: only allow http(s) and data URIs
    let finalUrl = url.trim();
    if (!finalUrl || finalUrl === "https://") return;
    if (!/^(https?:\/\/|data:)/i.test(finalUrl)) {
      finalUrl = "https://" + finalUrl;
    }

    // Build img HTML with a unique identifier for post-insert tracking
    const uid = "img-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const imgHtml =
      `<img src="${finalUrl}" data-img-uid="${uid}" ` +
      `style="max-width:100%;height:auto;display:block;margin:0.5rem 0;" ` +
      `contenteditable="false" draggable="false" />`;

    // Temporarily enable editing
    const prevEditable = el.contentEditable;
    el.contentEditable = "true";
    el.focus({ preventScroll: true });

    // Restore cursor position
    if (selectionRange) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(selectionRange);
    }

    // Insert image
    document.execCommand("insertHTML", false, imgHtml);

    // Normalize (ensures contenteditable / draggable are set correctly)
    normalizeEditorNodes(el);

    // Attach load/error handlers to the newly inserted image
    const img = el.querySelector(`img[data-img-uid="${uid}"]`) as HTMLImageElement | null;
    if (img) {
      img.removeAttribute("data-img-uid");
      img.onerror = () => {
        const fallback = document.createElement("div");
        fallback.textContent = "[ Image failed to load ]";
        fallback.style.cssText =
          "max-width:100%;height:40px;display:flex;align-items:center;justify-content:center;" +
          "background:#27272a;color:#71717a;font-family:monospace;font-size:12px;" +
          "margin:0.5rem 0;padding:0 1rem;border-radius:4px;";
        img.replaceWith(fallback);
      };
      img.onload = () => {
        img.style.display = "block";
      };
    }

    // Restore contentEditable
    el.contentEditable = prevEditable;

    // Sync state
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: el.innerHTML } : t));
    setHasUnsavedChanges(true);
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
      text: ``,
    };
    setTabs([...tabs, newTab]);
    scrollPositionsRef.current[activeTabId] = window.scrollY;
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
    } else {
      scrollPositionsRef.current[activeTabId] = window.scrollY;
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

  // Mobile touch long-press drag handlers
  const handleTouchStart = (e: React.TouchEvent, index: number) => {
    if (editingTabId !== null) return;
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      touchDragIndexRef.current = index;
      touchDragOverIndexRef.current = index;
      setTouchDragIndex(index);
    }, 400);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchDragIndexRef.current === null) {
      // Cancel long-press if moved too far before timer fires
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
      if (dx > 8 || dy > 8) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
      return;
    }
    e.preventDefault();

    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!targetEl || !tabsContainerRef.current) return;

    // Find the tab element under the touch
    const tabEl = targetEl.closest('[data-tab-index]') as HTMLElement | null;
    if (!tabEl) return;

    const targetIndex = parseInt(tabEl.getAttribute('data-tab-index') || '', 10);
    if (isNaN(targetIndex)) return;

    if (targetIndex !== touchDragIndexRef.current && targetIndex !== touchDragOverIndexRef.current) {
      const from = touchDragIndexRef.current!;
      const updated = [...tabs];
      const item = updated.splice(from, 1)[0];
      updated.splice(targetIndex, 0, item);

      touchDragIndexRef.current = targetIndex;
      touchDragOverIndexRef.current = targetIndex;
      setTabs(updated);
      setHasUnsavedChanges(true);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchDragIndexRef.current = null;
    touchDragOverIndexRef.current = null;
    setTouchDragIndex(null);
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
  function getFirstLineTextFromHtml(html: string): string {
    if (!html) return "";
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const body = doc.body;
      if (!body) return "";

      // Look through top-level nodes for the first block with text or inline text
      for (let i = 0; i < body.childNodes.length; i++) {
        const node = body.childNodes[i];
        const text = node.textContent || "";
        // In case the node itself has multiple lines (e.g. text node with \n), we only want the first line of it.
        const firstLineOfNode = text.split(/[\r\n]+/)[0]?.trim() || "";
        if (firstLineOfNode) {
          const clean = firstLineOfNode.replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim();
          if (clean) {
            return clean;
          }
        }
      }

      const textContent = body.textContent || "";
      const lines = textContent.split(/[\r\n]+/).map(l => l.replace(/[\u200B\u200C\u200D\uFEFF]/g, "").trim()).filter(Boolean);
      return lines[0] || "";
    } catch (e) {
      const cleanHtml = html.replace(/<[^>]+>/g, " ");
      const lines = cleanHtml.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
      return lines[0] || "";
    }
  }

  function stripMarkdown(text: string): string {
    if (!text) return "";
    let clean = text;

    // Remove zero-width spaces that might be used for cursor position/empty nodes
    clean = clean.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

    // 1. Strip leading headers, list bullets, blockquotes, task items, numbers, etc.
    clean = clean.replace(/^[#\s\*\-\>\d\.\(\)\[\]xX]+/, "");

    // 2. Strip images: ![alt](url) -> alt
    clean = clean.replace(/!\[(.*?)\]\(.*?\)/g, "$1");

    // 3. Strip links: [text](url) -> text
    clean = clean.replace(/\[(.*?)\]\(.*?\)/g, "$1");

    // 4. Strip inline code: `code` -> code
    clean = clean.replace(/`(.*?)`/g, "$1");

    // 5. Strip bold/italic: ***text***, **text**, *text*, ___text___, __text__, _text_
    clean = clean.replace(/[\*_]{1,3}(.*?)[\*_]{1,3}/g, "$1");

    // 6. Strip strikethrough: ~~text~~ -> text
    clean = clean.replace(/~~(.*?)~~/g, "$1");

    // 7. Strip any residual HTML tags
    clean = clean.replace(/<[^>]+>/g, "");

    return clean.trim();
  }

  function getTabDisplayTitle(text: string, customTitle?: string): string {
    const rawTitle = customTitle || getFirstLineTextFromHtml(text) || "Untitled";
    const cleanTitle = stripMarkdown(rawTitle) || "Untitled";
    
    let visualLength = 0;
    let result = "";
    for (let i = 0; i < cleanTitle.length; i++) {
      const char = cleanTitle[i];
      visualLength += char.charCodeAt(0) > 255 ? 2 : 1;
      if (visualLength > 14) {
        return result + "..";
      }
      result += char;
    }
    return result;
  }

  function getTabRawTitle(tab: TabContent): string {
    if (tab.title) return stripMarkdown(tab.title) || "Untitled";
    const firstLine = getFirstLineTextFromHtml(tab.text);
    if (!firstLine) return "Untitled";
    return stripMarkdown(firstLine) || "Untitled";
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
          transition={{ duration: 0.12, ease: "easeOut" }}
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
          <span className="font-mono text-sm md:text-base tracking-widest text-[#f4f4f5] font-semibold select-none">TEXT_VAULT</span>
          <span className="font-mono text-[10px] md:text-xs text-zinc-600 tracking-wider">v0.1</span>
        </header>

        <main className="flex-1 flex flex-col justify-center items-center w-full max-w-4xl mx-auto my-12">
          <div className="w-full flex flex-col items-center">
            <h1 className="text-xl md:text-[2.35rem] font-mono text-zinc-500 font-bold tracking-wide mb-12 text-center select-none">
              End To End Encrypted Text
            </h1>

            {/* Prefix & Alphanumeric Input Center Row */}
            <div className="flex flex-col items-center justify-center gap-6 text-center w-full mb-20 relative">
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
                  className="bg-transparent outline-none text-center py-1 text-white text-lg md:text-[1.65rem] tracking-wider w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGo();
                  }}
                />
              </div>

              <div className="flex justify-center items-center w-full">
                <span
                  onClick={handleGo}
                  className="text-base md:text-lg text-zinc-400 hover:text-white cursor-pointer select-none border-b border-transparent hover:border-white transition-all font-semibold px-2 py-1"
                >
                  OPEN
                </span>
              </div>

              {searchName && (
                <div className="absolute top-full left-0 right-0 mt-2 flex flex-col items-center text-center text-xs text-zinc-500 font-mono pointer-events-auto transition-opacity duration-300 gap-1 w-full">
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
          <span className="font-mono text-[9px] md:text-[11px] text-zinc-600 tracking-widest uppercase text-center select-none">
            Always encrypt data before transferring it to the server // <a href="https://github.com/kanpianer/text_vault" target="_blank" rel="noopener noreferrer" className="text-white hover:text-zinc-300">Github</a>
          </span>
        </footer>

        {/* PASSWORD PROMPT MODAL */}
        <AnimatePresence>
          {vaultName && !isDecrypting && (
            <div className="fixed inset-0 bg-[#0c0c0e] flex items-center justify-center z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-4xl px-4 md:px-8 flex flex-col gap-6 relative"
              >
                <h3 className="text-zinc-100 font-mono tracking-wide text-lg md:text-xl text-center uppercase">
                  {isNewVault ? "Create Vault Password" : "UNLOCK THE VAULT"}
                </h3>

                <div className="flex flex-col w-full items-center">
                  <div className="w-full mb-6">
                    {isNewVault && (
                      <label className="font-mono text-[10px] md:text-xs text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                        PASSWORD
                      </label>
                    )}
                    <div className="w-full flex justify-center items-center">
                      <div className="relative grid items-center">
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          ••••••••
                        </span>
                        <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                          {password ? '•'.repeat(password.length) : ''}
                        </span>
                        <input
                          ref={passwordInputRef}
                          autoFocus
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          maxLength={18}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-base md:text-lg tracking-[0.2em] text-center"
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
                          {confirmPassword ? '•'.repeat(confirmPassword.length) : ''}
                          </span>
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            maxLength={18}
                            className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-base md:text-sm tracking-[0.2em] text-center"
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
                      className="font-mono text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={isNewVault ? handleCreateVault : handleUnlockVault}
                      className="font-mono text-xs md:text-sm font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="min-h-screen flex flex-col justify-between bg-[#0b0c0e] text-zinc-200 font-sans relative"
    >
      {/* Password Changed fullscreen overlay */}
      <AnimatePresence>
        {saveStatus === "pwd_changed" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-[#0c0c0e] z-50 pointer-events-none"
          >
            <span className="font-mono text-sm tracking-widest text-[#ffffff] font-medium block uppercase animate-pulse">
              Password Changed
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sticky top-0 z-30 bg-[#0c0c0e] flex flex-col w-full touch-none">
        <header className="w-full">
        <div className="w-full max-w-4xl px-4 md:px-8 py-4 flex justify-between items-center mx-auto">
          <div className="flex items-center gap-4">
            <span
              onClick={() => { handleLock(); navigateTo(""); }}
              className="font-mono text-sm md:text-base tracking-widest font-semibold select-none flex items-center cursor-pointer group"
            >
              <span className="text-zinc-500 tracking-normal group-hover:text-white transition-colors">Text_Vault/</span><span className="lowercase text-white group-hover:text-zinc-500 transition-colors">{vaultName}</span>
            </span>
            {/* Status indicator: UNSAVED / SAVING... / SAVED */}
            {hasUnsavedChanges && saveStatus === "idle" && (
              <span className="font-mono text-[10px] md:text-xs text-zinc-500 animate-pulse tracking-wide select-none">
                [UNSAVED]
              </span>
            )}
            {saveStatus === "saving" && (
              <span className="font-mono text-[10px] md:text-xs text-zinc-400 animate-pulse tracking-wide select-none">
                [SAVING...]
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="font-mono text-[10px] md:text-xs text-zinc-400 tracking-wide select-none">
                [SAVED]
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
            className={`font-mono text-xs md:text-sm uppercase tracking-wider select-none font-medium transition-colors leading-none block ${
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
              className="font-mono text-xs md:text-sm uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer select-none leading-none block relative z-50"
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
                    className="text-xs md:text-sm font-mono text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    Lock Vault
                  </span>
                  <span
                    onClick={() => {
                      setShowChangePasswordModal(true);
                      setPwdModalError("");
                      setShowMenu(false);
                    }}
                    className="text-xs md:text-sm font-mono text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-2"
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
                    className="text-xs md:text-sm font-mono text-zinc-500 hover:text-red-400 cursor-pointer uppercase tracking-wider transition-colors py-2"
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
          <div ref={tabsContainerRef} className="flex flex-wrap items-end gap-0 flex-1">
            {tabs.map((tab, idx) => {
              const active = tab.id === activeTabId;
              const isEditing = editingTabId === tab.id;
              const isTouchDragging = touchDragIndex === idx;
              return (
                <div
                  key={tab.id}
                  data-tab-index={idx}
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onTouchStart={(e) => handleTouchStart(e, idx)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  onClick={() => {
                    handleTabSwitch(tab.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingTabId(tab.id);
                    setEditingTitle(getTabRawTitle(tab));
                  }}
                  className={`relative flex items-center pl-0 pr-1.5 pt-1.5 pb-1 text-sm md:text-base font-mono select-none cursor-pointer transition-opacity ${
                    active
                      ? "text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  } ${draggingIndex === idx ? "opacity-30" : ""} ${isTouchDragging ? "opacity-30" : ""}`}
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
                        className="bg-transparent border-b border-zinc-500 text-white outline-none font-mono text-sm pb-0.5 max-w-[120px]"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span 
                        className={`tracking-wide text-zinc-100 block whitespace-nowrap border-b ${active ? "border-zinc-300" : "border-transparent"}`} 
                        title={getTabRawTitle(tab)}
                      >
                        {getTabDisplayTitle(tab.text, tab.title)}
                      </span>
                    )}

                    {tabs.length > 1 && (
                      <span
                        onClick={(e) => handleCloseTab(e, tab.id)}
                        className="text-zinc-500 hover:text-red-400 select-none pl-0 ml-0.5 flex items-center justify-center transition-colors"
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
                className="relative flex items-center px-1.5 pt-1.5 pb-1 text-sm font-mono select-none cursor-pointer text-zinc-500 hover:text-white transition-colors"
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
        <div className="flex-1 flex flex-col relative pt-1 md:pt-2 pb-24 min-h-[550px]"
        >
          <Editor
            editorRef={editorRef}
            activeTabId={activeTabId}
            initialContent={activeTabContent}
            onChange={handleEditorInput}
            onSelect={handleEditorSelect}
            readOnly={saveStatus === "saving" || saveStatus === "saved" || saveStatus === "pwd_changed"}
          />

          {/* PC Mode selection toolbar */}
          {saveStatus === "idle" && selectionRect && editorRef.current?.parentElement && (() => {
            const isMobileKeyboard = window.innerWidth < 768 && keyboardOffset > 0;
            return (
            <div 
              ref={pcSelectionToolbarContainerRef}
              className="flex z-50 mt-1 shadow-2xl"
              style={isMobileKeyboard ? {
                position: 'fixed',
                bottom: keyboardOffset + 'px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
              } : {
                position: 'absolute',
                top: pcSelectionStyle.top,
                left: pcSelectionStyle.left,
                visibility: pcSelectionStyle.visibility || 'hidden'
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
                        e.preventDefault();
                        e.stopPropagation();
                        handleLinkSubmit(linkValue || "https://");
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
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
                        e.preventDefault();
                        e.stopPropagation();
                        handleImageSubmit(imageValue || "https://");
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
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
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <label className="flex items-center h-full cursor-text">
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
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleTableSubmit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowTableInput(false);
                          }
                        }}
                        className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                      />
                    </div>
                    <span className="w-[2ch]"></span>
                  </label>
                  <label className="flex items-center h-full cursor-text flex-1">
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
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleTableSubmit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowTableInput(false);
                          }
                        }}
                        className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                      />
                    </div>
                    <div className="flex-1"></div>
                  </label>
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
            )
            })()}

          {/* PC Mode local empty-line toolbar */}
          {saveStatus === "idle" && emptyLineRect && !selectionRect && editorRef.current?.parentElement && (() => {
            const isMobileKeyboard = window.innerWidth < 768 && keyboardOffset > 0;
            return (
            <div 
              ref={pcEmptyLineToolbarContainerRef}
              className="flex z-50 mt-1 shadow-2xl transition-all duration-300 ease-in-out"
              style={isMobileKeyboard ? {
                position: 'fixed',
                bottom: keyboardOffset + 'px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
              } : {
                position: 'absolute',
                top: pcEmptyLineStyle.top,
                left: pcEmptyLineStyle.left,
                visibility: pcEmptyLineStyle.visibility || 'hidden'
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
                        e.preventDefault();
                        e.stopPropagation();
                        handleLinkSubmit(linkValue || "https://");
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
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
                        e.preventDefault();
                        e.stopPropagation();
                        handleImageSubmit(imageValue || "https://");
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
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
                <div className="flex items-center gap-1 font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] px-2 select-none border border-zinc-800 rounded w-full max-w-[400px] my-1 animate-fade-in">
                  <label className="flex items-center h-full cursor-text">
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
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleTableSubmit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowTableInput(false);
                          }
                        }}
                        className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                      />
                    </div>
                    <span className="w-[2ch]"></span>
                  </label>
                  <label className="flex items-center h-full cursor-text flex-1">
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
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleTableSubmit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowTableInput(false);
                          }
                        }}
                        className="bg-transparent outline-none border-none text-zinc-200 w-[3ch] pl-1 font-mono text-xs h-full"
                      />
                    </div>
                    <div className="flex-1"></div>
                  </label>
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
            )
            })()}
        </div>
      </main>



      {/* DELETE TAB POPUP */}
      <AnimatePresence>
        {tabToClose && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 bg-[#0c0c0e] flex items-center justify-center p-4 z-50"
          >
            <div className="w-full max-w-sm flex flex-col gap-6 relative">
              <h3 className="text-zinc-100 font-mono tracking-wide text-lg text-center uppercase">
                DELETE TAB
              </h3>

              <p className="font-mono text-xs text-zinc-400 text-center leading-relaxed">
                Are you sure you want to delete this tab?
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
            </div>
          </motion.div>
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
                          {newPassword ? '•'.repeat(newPassword.length) : ''}
                        </span>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          maxLength={18}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center"
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
                          {confirmNewPassword ? '•'.repeat(confirmNewPassword.length) : ''}
                        </span>
                        <input
                          type="password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          maxLength={18}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center"
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
                  Your current vault will be re-encrypted with this new password
                </div>

                <div className="flex justify-center gap-12 items-center">
                  <span
                    onClick={() => {
                      setNewPassword("");
                      setConfirmNewPassword("");
                      setPwdModalError("");
                      setShowChangePasswordModal(false);
                    }}
                    className="font-mono text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={handleChangePassword}
                    className="font-mono text-xs md:text-sm font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
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
                    Are you absolutely sure you want to delete this vault?
                  </p>
                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-mono text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Keep Secure
                    </span>
                    <span
                      onClick={() => setDeleteStep(2)}
                      className="font-mono text-xs md:text-sm font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                    >
                      Authorize (1/3)
                    </span>
                  </div>
                </div>
              )}

              {deleteStep === 2 && (
                <div className="flex flex-col gap-6">
                  <p className="font-mono text-xs text-zinc-300 leading-relaxed text-center px-4">
                    All encrypted texts will be permanently wiped forever and cannot be undone
                  </p>
                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-mono text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Aboard
                    </span>
                    <span
                      onClick={() => setDeleteStep(3)}
                      className="font-mono text-xs md:text-sm font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
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
                      className="font-mono text-xs md:text-sm text-zinc-500 hover:text-white transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={handleDeleteVault}
                      className={`font-mono text-xs md:text-sm font-semibold uppercase tracking-wider px-2 block ${
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
      {/* Back to top button */}
      {shouldShowBackToTop({
        showBackToTop,
        isEditorFocused,
        selectionVisible: !!selectionRect,
        emptyLineVisible: !!emptyLineRect,
        saveStatusIdle: saveStatus === "idle",
      }) && (() => {
        const r = 4; // matches Tailwind 'rounded'
        const { w, h } = backToTopSize;
        // SVG path: starts at top-center, goes clockwise all the way around
        const pathD = w > 0 ? [
          `M ${w / 2},0.5`,
          `H ${w - r - 0.5}`,
          `A ${r},${r} 0 0,1 ${w - 0.5},${r + 0.5}`,
          `V ${h - r - 0.5}`,
          `A ${r},${r} 0 0,1 ${w - r - 0.5},${h - 0.5}`,
          `H ${r + 0.5}`,
          `A ${r},${r} 0 0,1 ${0.5},${h - r - 0.5}`,
          `V ${r + 0.5}`,
          `A ${r},${r} 0 0,1 ${r + 0.5},${0.5}`,
          `H ${w / 2}`,
        ].join(' ') : '';
        // Perimeter = 2*(w-2r) + 2*(h-2r) + 2π*r
        const perimeter = w > 0 ? 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r : 0;
        const dashOffset = perimeter * (1 - scrollProgress);
        return (
          <div
            ref={backToTopRef}
            style={{
              position: 'fixed',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9998,
              pointerEvents: 'auto',
            }}
            className="flex items-center font-mono text-xs text-zinc-500 bg-[#121215] h-[30px] select-none rounded shadow-2xl px-2 my-1"
          >
            {/* SVG progress border */}
            {w > 0 && (
              <svg
                width={w}
                height={h}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
              >
                {/* Track */}
                <path d={pathD} fill="none" stroke="#27272a" strokeWidth={1} />
                {/* Progress */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="#71717a"
                  strokeWidth={1}
                  strokeDasharray={perimeter}
                  strokeDashoffset={dashOffset}
                  style={{ transition: 'stroke-dashoffset 0.15s linear' }}
                />
              </svg>
            )}
            <span
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="font-mono text-xs text-zinc-500 hover:text-white hover:underline cursor-pointer select-none"
            >
              [ Back to top ]
            </span>
          </div>
        );
      })()}
      {loadingOverlay}
    </motion.div>
  );
}
