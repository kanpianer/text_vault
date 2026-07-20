import { useState, useEffect, useRef, useLayoutEffect } from "react";
import "katex/dist/katex.min.css";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import JSZip from "jszip";
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
import { shouldShowBackToTop } from "./toolbarPosition";



// Character limits

const VAULT_MAX_CHARS = 1_000_000;

const TAB_MAX_CHARS = 100_000;



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

  const [isEditorFocused, setIsEditorFocused] = useState<boolean>(false);

  // Back to top: track scroll depth, progress, and editor focus state
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0;
      document.documentElement.style.setProperty('--scroll-progress', progress.toString());
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // isEditorFocused now driven by Editor's onActiveChange callback

  // Save State Transition
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const [autoSaveAnim, setAutoSaveAnim] = useState<"saving" | "saved" | null>(null);





  // Sandwich settings menu
  const [showMenu, setShowMenu] = useState<boolean>(false);

  // Change Password Modal state
  const [showChangePasswordModal, setShowChangePasswordModal] = useState<boolean>(false);
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>("");
  const [pwdModalError, setPwdModalError] = useState<string>("");

  // Export Modal state
  const [showExportModal, setShowExportModal] = useState<boolean>(false);

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

  const [autoLockTimeoutMs, setAutoLockTimeoutMs] = useState<number>(300000);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showTimerDropdown, setShowTimerDropdown] = useState<boolean>(false);
  const [showCountdown, setShowCountdown] = useState<boolean>(false);



  const shouldHideEditorToc = showMenu || showChangePasswordModal || showDeleteModal || showExportModal || Boolean(tabToClose) || showTimerDropdown;



  // Inactivity tracking
  const lastActivityRef = useRef<number>(Date.now());
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refs mirroring state for stable auto-save effect (prevents focus loss)

  const hasUnsavedRef = useRef(hasUnsavedChanges);

  const saveStatusRef = useRef(saveStatus);

  const tabsRef = useRef(tabs);

  hasUnsavedRef.current = hasUnsavedChanges;

  saveStatusRef.current = saveStatus;

  tabsRef.current = tabs;

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
    if (!aesKey || !authHash || !vaultName || tabsRef.current.length === 0) return false;

    const silent = opts?.silent ?? false;

    if (!silent) setSaveStatus("saving");

    const startTime = Date.now();

    try {

      const jsonStr = JSON.stringify({ tabs: tabsRef.current });
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
      timer = setTimeout(async () => {

        if (hasUnsavedRef.current && saveStatusRef.current === "idle") {

          setAutoSaveAnim("saving");

          await performSaveAction({ silent: true });

          setAutoSaveAnim("saved");

          setTimeout(() => setAutoSaveAnim(null), 200);

        }

      }, 20000);
    }

    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [isVerified, hasUnsavedChanges, saveStatus]);

  // Inactivity tracking for auto-lock
  useEffect(() => {
    if (!isVerified) return;

    lastActivityRef.current = Date.now();
    setTimeLeft(autoLockTimeoutMs);

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
      const remaining = autoLockTimeoutMs - elapsed;

      if (remaining <= 0) {
        clearInterval(checkInterval);
        handleAutoSaveAndLock();
      } else {
        setTimeLeft(remaining);
      }
    }, 1000);

    return () => {
      events.forEach((event) => document.removeEventListener(event, resetTimer, { capture: true }));
      clearInterval(checkInterval);
    };
  }, [isVerified, autoLockTimeoutMs]);

  const formatTimeLeft = (ms: number) => {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

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
  const remainingChars = TAB_MAX_CHARS - activeTabContent.length;

  const vaultTotalChars = tabs.reduce((sum, t) => sum + (t.text?.length || 0), 0);

  const vaultRemainingChars = VAULT_MAX_CHARS - vaultTotalChars;



  const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Left as stub for backward-compatibility / fallback if needed, but we handle line editing directly
  };

  const handleEditorInput = (html: string, currentTarget: HTMLElement | null) => {
    const newText = html;

    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, text: newText } : t));

    setHasUnsavedChanges(true);

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

  const handleExportMd = async () => {
    setIsLoading(true);
    try {
      const ZipClass = typeof JSZip === 'function' ? JSZip : (JSZip as any).default || JSZip;
      const zip = new ZipClass();
      
      let count = 0;
      tabs.forEach((tab) => {
        let rawTitle = getTabRawTitle(tab) || `untitled_${tab.id}`;
        if (rawTitle.length > 50) {
          rawTitle = rawTitle.substring(0, 50).trim();
        }
        // Sanitize filename to prevent slashes from creating directories or other invalid characters
        let filename = rawTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!filename) filename = `untitled_${tab.id}`;
        
        if (!filename.toLowerCase().endsWith('.md')) {
          filename += '.md';
        }
        zip.file(filename, tab.text || "");
        count++;
      });
      
      if (count === 0) {
        zip.file("empty_vault.md", "The vault is empty.");
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${vaultName || "vault"}_export.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Export failed:", err);
      alert("Export failed: " + (err.message || String(err)));
    } finally {
      setIsLoading(false);
      setShowExportModal(false);
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
      if (visualLength > 9) {
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
          className="fixed inset-0 flex items-center md:items-start justify-center md:pt-[28vh] bg-[#0c0c0e] z-50 pointer-events-none"

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
            <div className="fixed inset-0 bg-[#0c0c0e] flex items-center md:items-start justify-center md:pt-[28vh] z-50">
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
              onClick={async () => {
                if (hasUnsavedChanges) {
                  await performSaveAction();
                }
                handleLock();
                navigateTo("");
              }}
              className="font-mono text-sm md:text-base tracking-widest font-semibold select-none flex items-center cursor-pointer group"
            >
              <span className="text-zinc-500 tracking-normal group-hover:text-white transition-colors">Text_Vault/</span><span className="lowercase text-white group-hover:text-zinc-500 transition-colors">{vaultName}</span>
            </span>
            {/* Status indicator: UNSAVED / SAVING... / SAVED */}

            {hasUnsavedChanges && saveStatus === "idle" && !autoSaveAnim && (

              <span className="font-mono text-[10px] md:text-xs text-zinc-500 animate-pulse tracking-wide select-none">

                [UNSAVED]

              </span>

            )}

            {(saveStatus === "saving" || autoSaveAnim === "saving") && (

              <span className="font-mono text-[10px] md:text-xs text-zinc-400 animate-pulse tracking-wide select-none">

                [SAVING...]

              </span>

            )}

            {(saveStatus === "saved" || autoSaveAnim === "saved") && (

              <span className="font-mono text-[10px] md:text-xs text-zinc-400 tracking-wide select-none">

                [SAVED]

              </span>

            )}
          </div>

        {/* Global actions: Save word and Settings overlay */}
        <div className="flex items-center gap-6">
          {/* Timer Dropdown */}
          <div className="relative flex items-center">
            {showTimerDropdown && (
              <div 
                className="fixed inset-0 z-40 bg-transparent" 
                onClick={() => setShowTimerDropdown(false)} 
              />
            )}
            <span
              onClick={() => {
                setShowTimerDropdown(!showTimerDropdown);
                setShowMenu(false);
              }}
              className="font-mono text-xs md:text-sm uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer select-none leading-none block relative z-50 min-w-[50px] text-right"
            >
              {showCountdown && timeLeft !== null ? formatTimeLeft(timeLeft) : "TIMER"}
            </span>

            <AnimatePresence>
              {showTimerDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="absolute right-0 top-full mt-4 flex flex-col items-end gap-3 z-50 whitespace-nowrap bg-[#0c0c0e] border border-zinc-800 rounded shadow-xl py-2 px-4"
                >
                  {[5, 10, 15, 30].map(mins => (
                    <span
                      key={mins}
                      onClick={() => {
                        setAutoLockTimeoutMs(mins * 60000);
                        setShowCountdown(true);
                        setShowTimerDropdown(false);
                      }}
                      className="text-xs md:text-sm font-mono text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-1"
                    >
                      {mins} MIN
                    </span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
              onClick={() => {
                setShowMenu(!showMenu);
                setShowTimerDropdown(false);
              }}
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
                  <span
                    onClick={() => {
                      setShowExportModal(true);
                      setShowMenu(false);
                    }}
                    className="text-xs md:text-sm font-mono text-zinc-500 hover:text-yellow-500 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    EXPORT TO .MD
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
                    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
                  }}
                  className={`relative flex items-center pl-0 pr-1.5 pt-1.5 pb-1 text-sm md:text-base font-sans select-none cursor-pointer transition-opacity ${
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
                        className="bg-transparent border-b border-zinc-500 text-white outline-none font-sans text-sm pb-0.5 max-w-[120px]"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span 
                        className="tracking-wide text-zinc-100 block whitespace-nowrap select-text" 
                        title={getTabRawTitle(tab)}
                      >
                        <span className={`pb-px border-b ${active ? "border-zinc-300" : "border-transparent"}`}>{getTabDisplayTitle(tab.text, tab.title)}</span>
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
          onClick={(e) => {
            if (e.target === e.currentTarget && editorRef.current) {
              const el = editorRef.current;
              const lastChild = el.lastElementChild;
              const isLastEmptyP = lastChild && lastChild.tagName === "P" && (!lastChild.textContent || lastChild.textContent.trim() === "");
              
              if (!isLastEmptyP && el.contentEditable === "true") {
                const p = document.createElement("p");
                p.appendChild(document.createElement("br"));
                el.appendChild(p);
                
                requestAnimationFrame(() => {
                  const r = document.createRange();
                  r.selectNodeContents(p);
                  r.collapse(false);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(r);
                  el.focus();
                });
              } else if (el.contentEditable === "true") {
                el.focus();
                if (lastChild) {
                  const r = document.createRange();
                  r.selectNodeContents(lastChild);
                  r.collapse(false);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(r);
                }
              }
            }
          }}
        >
          <Editor

            editorRef={editorRef}

            activeTabId={activeTabId}

            initialContent={activeTabContent}

            onChange={handleEditorInput}

            onActiveChange={setIsEditorFocused}

            hideToc={shouldHideEditorToc}

            readOnly={saveStatus === "saving" || saveStatus === "saved" || saveStatus === "pwd_changed"}
          />
        </div>
      </main>



      {/* DELETE TAB POPUP */}
      <AnimatePresence>
        {tabToClose && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 bg-[#0c0c0e] flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-50"
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
          <div className="fixed inset-0 bg-[#0c0c0e] flex items-center md:items-start justify-center md:pt-[28vh] z-50">
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
        {showExportModal && (
          <div className="fixed inset-0 bg-[#0c0c0e] flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl flex flex-col gap-6 relative"
            >
              <h3 className="font-mono tracking-wide text-lg text-yellow-500 uppercase text-center font-bold">
                Security Warning
              </h3>

              <div className="flex flex-col gap-6">
                <p className="font-mono text-xs text-zinc-300 leading-relaxed text-center px-4">
                  Exported text is unencrypted. Anyone with the zip file will be able to read its contents.
                </p>
                <div className="flex justify-center gap-12 items-center mt-2">
                  <span
                    onClick={() => setShowExportModal(false)}
                    className="font-mono text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={handleExportMd}
                    className="font-mono text-xs md:text-sm font-semibold text-yellow-500 hover:text-yellow-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                  >
                    Confirm Export
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 bg-[#0c0c0e] flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-50">
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
      {loadingOverlay}
    </motion.div>
  );
}
