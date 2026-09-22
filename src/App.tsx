import type React from "react";
import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Link2Off, Search, Plus } from "lucide-react";
import { TabContent, SaveStatus } from "./types";
import {
  deriveKeyAndHash,
  encryptData,
  decryptData,
  generateSaltHex,
  validatePassword,
  sha256Client,
  generateRandomKeyHex,
  encryptDataWithRawKey,
  decryptDataWithRawKey,
  bufferToHex,
  generateShortShareId,
} from "./crypto";
import { shouldShowBackToTop } from "./toolbarPosition";

const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));



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

  // Document titles dropdown & search state
  const [showDocPopup, setShowDocPopup] = useState<boolean>(false);
  const [docSearchQuery, setDocSearchQuery] = useState<string>("");
  const [docCanScroll, setDocCanScroll] = useState<boolean>(false);
  const [docScrollProgress, setDocScrollProgress] = useState<number>(0);
  const [editorAreaWidth, setEditorAreaWidth] = useState<number>(0);
  const docHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docListRef = useRef<HTMLDivElement>(null);
  const docPopupRef = useRef<HTMLDivElement>(null);
  const docTriggerRef = useRef<HTMLDivElement>(null);
  const docSearchInputRef = useRef<HTMLInputElement>(null);
  const mainContainerRef = useRef<HTMLElement>(null);
  const [tabToClose, setTabToClose] = useState<string | null>(null);

  // Tab reordering state & refs (long-press drag)
  const [reorderingTabId, setReorderingTabId] = useState<string | null>(null);
  const reorderingTabIdRef = useRef<string | null>(null);
  const isDraggingJustFinishedRef = useRef<boolean>(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragMetricsRef = useRef<{ listTop: number; listBottom: number; rowHeight: number; paddingTop: number } | null>(null);
  const didReorderRef = useRef<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const currentDragIndexRef = useRef<number>(-1);

  const [autoLockTimeoutMs, setAutoLockTimeoutMs] = useState<number>(300000);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showTimerDropdown, setShowTimerDropdown] = useState<boolean>(false);
  const [showCountdown, setShowCountdown] = useState<boolean>(false);
  const timerHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerContainerRef = useRef<HTMLDivElement>(null);

  // Share Modal State
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [showUnshareConfirm, setShowUnshareConfirm] = useState<boolean>(false);
  const [isUnsharing, setIsUnsharing] = useState<boolean>(false);
  const [shareRequirePassword, setShareRequirePassword] = useState<boolean>(false);
  const [sharePassword, setSharePassword] = useState<string>("");
  const [shareConfirmPassword, setShareConfirmPassword] = useState<string>("");
  const [shareError, setShareError] = useState<string>("");
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string>("");
  const [isShareCopied, setIsShareCopied] = useState<boolean>(false);

  // Shared Document Viewer State
  const [sharedDocId, setSharedDocId] = useState<string>("");
  const [sharedLoading, setSharedLoading] = useState<boolean>(false);
  const [sharedDocNotFound, setSharedDocNotFound] = useState<boolean>(false);
  const [sharedDocHasPassword, setSharedDocHasPassword] = useState<boolean>(false);
  const [sharedDocSalts, setSharedDocSalts] = useState<{ salt_enc?: string; salt_auth?: string }>({});
  const [sharedPasswordInput, setSharedPasswordInput] = useState<string>("");
  const [sharedDocError, setSharedDocError] = useState<string>("");
  const [sharedIsDecrypting, setSharedIsDecrypting] = useState<boolean>(false);
  const [sharedDocContent, setSharedDocContent] = useState<{ title: string; text: string; createdAt?: string } | null>(null);
  const [isSharedDocCopied, setIsSharedDocCopied] = useState<boolean>(false);
  const sharedEditorRef = useRef<HTMLDivElement>(null);
  const sharedPasswordInputRef = useRef<HTMLInputElement>(null);

  const shouldHideEditorToc = showMenu || showChangePasswordModal || showDeleteModal || showExportModal || showShareModal || showUnshareConfirm || Boolean(tabToClose) || showTimerDropdown || showDocPopup;




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

      const shareMatch = path.match(/^share\/([a-zA-Z0-9_-]+)$/);
      if (shareMatch) {
        setSharedDocId(shareMatch[1]);
        setVaultName("");
        setIsVerified(false);
      } else if (/^[a-zA-Z0-9]{1,10}$/.test(path)) {
        setSharedDocId("");
        setVaultName(path);
      } else {
        setSharedDocId("");
        setVaultName("");
        setIsVerified(false);
      }
    };

    handleLocationChange();
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  // Shared doc fetching & auto-decrypt for unprotected
  useEffect(() => {
    if (!sharedDocId) {
      setSharedDocContent(null);
      setSharedDocNotFound(false);
      setSharedDocHasPassword(false);
      setSharedPasswordInput("");
      setSharedDocError("");
      return;
    }

    const fetchSharedDoc = async () => {
      setSharedLoading(true);
      setSharedDocNotFound(false);
      setSharedDocError("");
      setSharedDocContent(null);

      try {
        const resp = await fetch(`/api/share/${sharedDocId}`);
        if (!resp.ok) {
          setSharedDocNotFound(true);
          return;
        }

        const data = await resp.json();
        if (!data.exists) {
          setSharedDocNotFound(true);
          return;
        }

        if (data.hasPassword) {
          setSharedDocHasPassword(true);
          setSharedDocSalts({ salt_enc: data.salt_enc, salt_auth: data.salt_auth });
        } else {
          setSharedDocHasPassword(false);
          const hashKey = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
          const keyToUse = hashKey || data.key_unprotected;
          if (!keyToUse) {
            setSharedDocError("Decryption key missing. Unable to decrypt shared document.");
            return;
          }

          const decryptedStr = await decryptDataWithRawKey(data.encrypted_data, keyToUse);
          const parsed = JSON.parse(decryptedStr);
          setSharedDocContent(parsed);
        }
      } catch (err: any) {
        console.error("Error fetching shared document:", err);
        setSharedDocError("Failed to load or decrypt shared document.");
      } finally {
        setSharedLoading(false);
      }
    };

    fetchSharedDoc();
  }, [sharedDocId]);

  // Focus password input for shared document
  useEffect(() => {
    if (sharedDocId && sharedDocHasPassword && !sharedDocContent) {
      sharedPasswordInputRef.current?.focus();
    }
  }, [sharedDocId, sharedDocHasPassword, sharedDocContent]);


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
      setErrorText("Password must contain upper, lower, symbols, and digits (8-64 characters).");
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

      if (response.ok) {
        if (!silent) {
          setSaveStatus("saved");
          setTimeout(() => {
            setSaveStatus("idle");
          }, 300);
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
      const now = Date.now();
      if (now - lastActivityRef.current > 1000) {
        lastActivityRef.current = now;
      }
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
  const activeTabContent = useMemo(() => tabs.find((t) => t.id === activeTabId)?.text || "", [tabs, activeTabId]);
  const remainingChars = useMemo(() => TAB_MAX_CHARS - activeTabContent.length, [activeTabContent]);

  const vaultTotalChars = useMemo(() => tabs.reduce((sum, t) => sum + (t.text?.length || 0), 0), [tabs]);

  const vaultRemainingChars = useMemo(() => VAULT_MAX_CHARS - vaultTotalChars, [vaultTotalChars]);



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
    if (tabs.length >= 20) return;
    const newId = `tab-${Date.now()}`;
    const newTab: TabContent = {
      id: newId,
      text: `<h1><br></h1><p><br></p>`,
    };
    setTabs([newTab, ...tabs]);
    scrollPositionsRef.current[activeTabId] = window.scrollY;
    setActiveTabId(newId);
    setHasUnsavedChanges(true);
    if (docListRef.current) {
      docListRef.current.scrollTop = 0;
    }
  };

  // Close tab direct
  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (tabs.length <= 1) return;

    setShowDocPopup(false);
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

  const handleRenameSave = (tabId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setTabs(prev => prev.map(t => {
        if (t.id !== tabId) return t;
        let updatedText = t.text;
        if (/<h1[^>]*>[\s\S]*?<\/h1>/i.test(updatedText)) {
          updatedText = updatedText.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, `<h1>${trimmed}</h1>`);
        } else if (/(?:^|\n)\s*#\s+[^\r\n]+/.test(updatedText)) {
          updatedText = updatedText.replace(/(^|\n)\s*#\s+[^\r\n]+/, `$1# ${trimmed}`);
        } else {
          updatedText = `<h1>${trimmed}</h1>` + updatedText;
        }
        return { ...t, title: trimmed, text: updatedText };
      }));
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
      setPwdModalError("Must carry upper, lower, symbols, and digits (8-64 characters).");
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
      const JSZipModule = await import("jszip");
      const ZipClass = typeof JSZipModule === 'function' ? JSZipModule : (JSZipModule as any).default || JSZipModule;
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

  // Helper to resolve title safely without heavy DOMParser on every keystroke
  function getFirstLineTextFromHtml(html: string): string {
    if (!html) return "";
    // Fast path: inspect only the first 4000 characters without heavy DOMParser
    const slice = html.length > 4000 ? html.slice(0, 4000) : html;

    // First, try to match the first <h1> tag:
    const h1Match = slice.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const cleanH1 = h1Match[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
        .trim();
      if (cleanH1) return cleanH1;
    }

    // Second, match markdown # heading if present
    const mdH1Match = slice.match(/(?:^|\n)\s*#\s+([^\r\n]+)/);
    if (mdH1Match && mdH1Match[1].trim()) {
      return mdH1Match[1].trim();
    }

    // Third, fallback to first block element
    const blockMatch = slice.match(/<(?:h[1-6]|p|div|li|summary|blockquote)[^>]*>([\s\S]*?)<\/(?:h[1-6]|p|div|li|summary|blockquote)>/i);
    const target = blockMatch ? blockMatch[1] : slice;
    const clean = target
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
      .split(/[\r\n]+/)[0]?.trim() || "";
    if (clean) return clean;

    const fallback = slice
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
      .split(/[\r\n]+/)[0]?.trim() || "";
    return fallback;
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
    const rawTitle = customTitle || getFirstLineTextFromHtml(text) || "untitled";
    const cleanTitle = stripMarkdown(rawTitle) || "untitled";
    
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
    const firstLine = getFirstLineTextFromHtml(tab.text);
    if (firstLine) return stripMarkdown(firstLine);
    if (tab.title) return stripMarkdown(tab.title);
    return "untitled";
  }

  const effectiveActiveTabId = useMemo(() => {
    if (tabs.length === 0) return "";
    return tabs.some((t) => t.id === activeTabId) ? activeTabId : tabs[0].id;
  }, [tabs, activeTabId]);

  const activeTabRawTitle = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === effectiveActiveTabId) || tabs[0];
    return activeTab ? getTabRawTitle(activeTab) : "untitled";
  }, [tabs, effectiveActiveTabId]);

  const isCurrentTabShared = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === effectiveActiveTabId) || tabs[0];
    return Boolean(activeTab?.isShared || activeTab?.shareId);
  }, [tabs, effectiveActiveTabId]);

  // Filtered documents for popup search
  const filteredTabs = useMemo(() => {
    const q = docSearchQuery.trim().toLowerCase();
    if (!q) return tabs;
    return tabs.filter((t) => {
      const raw = getTabRawTitle(t).toLowerCase();
      const display = getTabDisplayTitle(t.text, t.title).toLowerCase();
      return raw.includes(q) || display.includes(q);
    });
  }, [tabs, docSearchQuery]);

  // Track mobile viewport
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(max-width: 767px)").matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  // Measure editor width to set popup width to editor width on mobile or 1/2 of editor width on desktop
  useEffect(() => {
    const updateWidth = () => {
      if (editorRef.current && editorRef.current.offsetWidth > 0) {
        setEditorAreaWidth(editorRef.current.offsetWidth);
      } else if (mainContainerRef.current) {
        const cs = window.getComputedStyle(mainContainerRef.current);
        const pl = parseFloat(cs.paddingLeft) || 0;
        const pr = parseFloat(cs.paddingRight) || 0;
        const w = mainContainerRef.current.clientWidth - pl - pr;
        if (w > 0) setEditorAreaWidth(w);
      }
    };

    updateWidth();
    const target = editorRef.current || mainContainerRef.current;
    if (!target) return;

    window.addEventListener("resize", updateWidth);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", updateWidth);
    }

    const ro = new ResizeObserver(() => {
      updateWidth();
    });
    ro.observe(target);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [isVerified]);

  const popupWidth = useMemo(() => {
    if (editorAreaWidth > 0) {
      return isMobile ? editorAreaWidth : Math.round(editorAreaWidth / 2);
    }
    return isMobile ? undefined : 416;
  }, [editorAreaWidth, isMobile]);

  // Hover handlers for Text_Vault/ trigger and popup
  const handleDocTriggerMouseEnter = () => {
    if (docHoverTimeoutRef.current) {
      clearTimeout(docHoverTimeoutRef.current);
      docHoverTimeoutRef.current = null;
    }
    setShowDocPopup(true);
  };

  const handleDocTriggerMouseLeave = () => {
    if (reorderingTabIdRef.current) return;
    docHoverTimeoutRef.current = setTimeout(() => {
      setShowDocPopup(false);
    }, 200);
  };

  const handleDocPopupMouseEnter = () => {
    if (docHoverTimeoutRef.current) {
      clearTimeout(docHoverTimeoutRef.current);
      docHoverTimeoutRef.current = null;
    }
  };

  const handleDocPopupMouseLeave = () => {
    if (reorderingTabIdRef.current) return;
    docHoverTimeoutRef.current = setTimeout(() => {
      setShowDocPopup(false);
    }, 200);
  };

  // Close popup when clicking outside
  useEffect(() => {
    if (!showDocPopup) return;
    const handleOutsideClick = (e: Event) => {
      if (reorderingTabIdRef.current) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (
        docPopupRef.current &&
        !docPopupRef.current.contains(target) &&
        docTriggerRef.current &&
        !docTriggerRef.current.contains(target)
      ) {
        setShowDocPopup(false);
      }
    };
    window.addEventListener("pointerdown", handleOutsideClick, true);
    window.addEventListener("touchstart", handleOutsideClick, true);
    window.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      window.removeEventListener("pointerdown", handleOutsideClick, true);
      window.removeEventListener("touchstart", handleOutsideClick, true);
      window.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [showDocPopup]);

  // Tab long-press reorder handlers
  const handleTabPointerDown = (e: React.PointerEvent, tabId: string) => {
    if (e.button !== 0 && e.button !== undefined) return;
    if (editingTabId || docSearchQuery.trim()) return;

    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      try {
        navigator.vibrate?.(25);
      } catch {
        // ignore
      }
      if (docListRef.current) {
        const listRect = docListRef.current.getBoundingClientRect();
        const firstItem = docListRef.current.querySelector("[data-tab-id]") as HTMLElement | null;
        const h = firstItem ? firstItem.getBoundingClientRect().height : 28;
        dragMetricsRef.current = {
          listTop: listRect.top,
          listBottom: listRect.bottom,
          rowHeight: h > 0 ? h : 28,
          paddingTop: 4,
        };
      }
      currentDragIndexRef.current = tabs.findIndex((t) => t.id === tabId);
      didReorderRef.current = false;
      reorderingTabIdRef.current = tabId;
      setReorderingTabId(tabId);
      longPressTimerRef.current = null;
    }, 250);
  };

  const handleTabPointerMove = (e: React.PointerEvent) => {
    if (longPressTimerRef.current && pointerStartPosRef.current) {
      const dx = e.clientX - pointerStartPosRef.current.x;
      const dy = e.clientY - pointerStartPosRef.current.y;
      if (Math.hypot(dx, dy) > 6) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTabPointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartPosRef.current = null;
  };

  // Global window listeners while dragging to reorder
  useEffect(() => {
    if (!reorderingTabId) return;

    const onGlobalPointerMove = (e: PointerEvent) => {
      const currentId = reorderingTabIdRef.current;
      const metrics = dragMetricsRef.current;
      if (!currentId || !docListRef.current || !metrics) return;

      // Autoscroll gently when dragging near edges
      if (e.clientY < metrics.listTop + 20) {
        docListRef.current.scrollTop -= 4;
      } else if (e.clientY > metrics.listBottom - 20) {
        docListRef.current.scrollTop += 4;
      }

      if (rafRef.current !== null) return;

      const clientY = e.clientY;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        if (!docListRef.current || !reorderingTabIdRef.current || !dragMetricsRef.current) return;
        const m = dragMetricsRef.current;
        const scrollOffset = docListRef.current.scrollTop;
        const relativeY = clientY - m.listTop + scrollOffset - m.paddingTop;
        const targetIndex = Math.max(0, Math.min(tabs.length - 1, Math.floor(relativeY / m.rowHeight)));

        if (targetIndex !== currentDragIndexRef.current && targetIndex >= 0) {
          currentDragIndexRef.current = targetIndex;
          setTabs((prevTabs) => {
            const fromIndex = prevTabs.findIndex((t) => t.id === currentId);
            if (fromIndex === -1 || fromIndex === targetIndex) return prevTabs;
            const newTabs = [...prevTabs];
            const [moved] = newTabs.splice(fromIndex, 1);
            newTabs.splice(targetIndex, 0, moved);
            return newTabs;
          });
          didReorderRef.current = true;
        }
      });
    };

    const onGlobalPointerUp = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (reorderingTabIdRef.current) {
        reorderingTabIdRef.current = null;
        setReorderingTabId(null);
        currentDragIndexRef.current = -1;
        dragMetricsRef.current = null;
        if (didReorderRef.current) {
          setHasUnsavedChanges(true);
          didReorderRef.current = false;
        }
        isDraggingJustFinishedRef.current = true;
        setTimeout(() => {
          isDraggingJustFinishedRef.current = false;
        }, 100);
      }
    };

    window.addEventListener("pointermove", onGlobalPointerMove, { passive: true });
    window.addEventListener("pointerup", onGlobalPointerUp);
    window.addEventListener("pointercancel", onGlobalPointerUp);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", onGlobalPointerUp);
      window.removeEventListener("pointercancel", onGlobalPointerUp);
    };
  }, [reorderingTabId, tabs.length]);

  // Timer hover handlers
  const handleTimerMouseEnter = () => {
    if (timerHoverTimeoutRef.current) {
      clearTimeout(timerHoverTimeoutRef.current);
      timerHoverTimeoutRef.current = null;
    }
    if (!showMenu) {
      setShowTimerDropdown(true);
    }
  };

  const handleTimerMouseLeave = () => {
    timerHoverTimeoutRef.current = setTimeout(() => {
      setShowTimerDropdown(false);
    }, 200);
  };

  const handleTimerPopupMouseEnter = () => {
    if (timerHoverTimeoutRef.current) {
      clearTimeout(timerHoverTimeoutRef.current);
      timerHoverTimeoutRef.current = null;
    }
  };

  const handleTimerPopupMouseLeave = () => {
    timerHoverTimeoutRef.current = setTimeout(() => {
      setShowTimerDropdown(false);
    }, 200);
  };

  // Close timer dropdown when clicking outside
  useEffect(() => {
    if (!showTimerDropdown) return;
    const handleOutsideClick = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        timerContainerRef.current &&
        !timerContainerRef.current.contains(target)
      ) {
        setShowTimerDropdown(false);
      }
    };
    window.addEventListener("pointerdown", handleOutsideClick, true);
    window.addEventListener("touchstart", handleOutsideClick, true);
    window.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      window.removeEventListener("pointerdown", handleOutsideClick, true);
      window.removeEventListener("touchstart", handleOutsideClick, true);
      window.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [showTimerDropdown]);

  // Focus search input when popup opens
  useEffect(() => {
    if (showDocPopup) {
      const t = setTimeout(() => {
        docSearchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(t);
    } else {
      setDocSearchQuery("");
    }
  }, [showDocPopup]);

  // Update scroll progress & overflow state
  const updateDocScrollState = useCallback(() => {
    const el = docListRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll > 1) {
      setDocCanScroll(true);
      const progress = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
      setDocScrollProgress(progress);
    } else {
      setDocCanScroll(false);
      setDocScrollProgress(0);
    }
  }, []);

  const handleDocListScroll = updateDocScrollState;

  useLayoutEffect(() => {
    if (showDocPopup) {
      updateDocScrollState();
      const raf = requestAnimationFrame(() => {
        updateDocScrollState();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [showDocPopup, filteredTabs, updateDocScrollState]);

  useEffect(() => {
    const el = docListRef.current;
    if (!el || !showDocPopup || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      updateDocScrollState();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showDocPopup, updateDocScrollState]);

  // Prevent background page from scrolling when scrolling inside popup
  useEffect(() => {
    const popupEl = docPopupRef.current;
    const listEl = docListRef.current;
    if (!popupEl || !showDocPopup) return;

    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();

      if (!listEl) {
        e.preventDefault();
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = listEl;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 0) {
        e.preventDefault();
        return;
      }

      const targetIsInsideList = listEl.contains(e.target as Node);
      if (!targetIsInsideList) {
        listEl.scrollTop += e.deltaY;
        e.preventDefault();
        return;
      }

      const isAtTop = scrollTop <= 0;
      const isAtBottom = scrollTop >= maxScroll - 0.5;

      if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
        e.preventDefault();
      }
    };

    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.stopPropagation();
      if (!listEl) {
        e.preventDefault();
        return;
      }
      const touchY = e.touches[0].clientY;
      const deltaY = touchStartY - touchY;
      const { scrollTop, scrollHeight, clientHeight } = listEl;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 0) {
        e.preventDefault();
        return;
      }

      const isAtTop = scrollTop <= 0;
      const isAtBottom = scrollTop >= maxScroll - 0.5;

      if ((isAtTop && deltaY < 0) || (isAtBottom && deltaY > 0)) {
        e.preventDefault();
      }
    };

    popupEl.addEventListener("wheel", handleWheel, { passive: false });
    popupEl.addEventListener("touchstart", handleTouchStart, { passive: true });
    popupEl.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      popupEl.removeEventListener("wheel", handleWheel);
      popupEl.removeEventListener("touchstart", handleTouchStart);
      popupEl.removeEventListener("touchmove", handleTouchMove);
    };
  }, [showDocPopup, filteredTabs]);


  const handleUnlockSharedDoc = async () => {
    if (!sharedPasswordInput) {
      setSharedDocError("Password is required.");
      return;
    }

    if (!sharedDocSalts.salt_enc || !sharedDocSalts.salt_auth) {
      setSharedDocError("Security parameters missing.");
      return;
    }

    setSharedIsDecrypting(true);
    setSharedDocError("");

    try {
      const { aesKey, authHash } = await deriveKeyAndHash(
        sharedPasswordInput,
        sharedDocSalts.salt_enc,
        sharedDocSalts.salt_auth
      );

      const resp = await fetch(`/api/share/${sharedDocId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth_hash: authHash }),
      });

      if (!resp.ok) {
        setSharedDocError("Incorrect password. Access denied.");
        return;
      }

      const data = await resp.json();
      const decryptedStr = await decryptData(data.encrypted_data, aesKey);
      const parsed = JSON.parse(decryptedStr);
      setSharedDocContent(parsed);
    } catch (err) {
      console.error("Failed to unlock shared document:", err);
      setSharedDocError("Decryption failed. Please check the password.");
    } finally {
      setSharedIsDecrypting(false);
    }
  };

  const handleCopySharedContent = async () => {
    if (!sharedDocContent) return;
    try {
      await navigator.clipboard.writeText(sharedDocContent.text);
      setIsSharedDocCopied(true);
      setTimeout(() => setIsSharedDocCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  };

  const handleExportSharedMd = () => {
    if (!sharedDocContent) return;
    try {
      let filename = (sharedDocContent.title || "document").replace(/[\\/:*?"<>|]/g, "_").trim();
      if (!filename.toLowerCase().endsWith(".md")) {
        filename += ".md";
      }
      const blob = new Blob([sharedDocContent.text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed", e);
    }
  };

  const handleGenerateShareLink = async () => {
    setShareError("");

    if (shareRequirePassword) {
      if (!sharePassword) {
        setShareError("Password is required when protection is enabled.");
        return;
      }
      if (sharePassword.length > 64) {
        setShareError("Password cannot exceed 64 characters.");
        return;
      }
      if (sharePassword !== shareConfirmPassword) {
        setShareError("Passwords do not match.");
        return;
      }
    }

    const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    if (!activeTab) {
      setShareError("No active document found to share.");
      return;
    }

    if (hasUnsavedChanges) {
      await performSaveAction({ silent: true });
    }

    setIsSharing(true);
    try {
      const rawTitle = getTabRawTitle(activeTab);
      const docPayload = JSON.stringify({
        title: rawTitle,
        text: activeTab.text,
        createdAt: new Date().toISOString(),
      });

      const shareId = generateShortShareId();
      const shareUrl = `${window.location.origin}/share/${shareId}`;

      let resp: Response;

      if (shareRequirePassword) {
        const sEnc = generateSaltHex();
        const sAuth = generateSaltHex();
        const { aesKey: dAesKey, authHash: dAuthHash } = await deriveKeyAndHash(sharePassword, sEnc, sAuth);
        const encryptedData = await encryptData(docPayload, dAesKey);
        const authHashDouble = await sha256Client(dAuthHash);

        resp = await fetch("/api/share/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: shareId,
            hasPassword: true,
            salt_enc: sEnc,
            salt_auth: sAuth,
            auth_hash_double: authHashDouble,
            encrypted_data: encryptedData,
          }),
        });
      } else {
        const rawKeyHex = generateRandomKeyHex();
        const encryptedData = await encryptDataWithRawKey(docPayload, rawKeyHex);

        resp = await fetch("/api/share/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: shareId,
            hasPassword: false,
            encrypted_data: encryptedData,
            key_unprotected: rawKeyHex,
          }),
        });
      }

      if (!resp.ok) {
        let errorMsg = `Server error (${resp.status})`;
        try {
          const d = await resp.json();
          if (d && (d.error || d.message)) {
            errorMsg = d.error || d.message;
          }
        } catch {
          if (resp.status === 404) {
            errorMsg = "API endpoint /api/share/create not found (404). Please ensure Cloudflare Worker is updated with the latest worker.js.";
          } else if (resp.status === 405) {
            errorMsg = "Method not allowed (405). The request reached static hosting instead of the API worker. Please update the Cloudflare Worker script.";
          } else {
            try {
              const text = await resp.text();
              if (text && text.length < 100 && !text.includes("<")) {
                errorMsg = text;
              }
            } catch {}
          }
        }
        setShareError(errorMsg);
        return;
      }

      // Mark the active tab as shared and record shareId
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, isShared: true, shareId, shareHasPassword: shareRequirePassword } : t))
      );
      setHasUnsavedChanges(true);

      setGeneratedShareUrl(shareUrl);
    } catch (err: any) {
      console.error("Failed to share document:", err);
      const msg = err?.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Network request failed")) {
        setShareError("Network request failed. Please check your connection or ensure backend API is running.");
      } else {
        setShareError(msg ? `Failed to share document: ${msg}` : "Failed to encrypt and share document.");
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!generatedShareUrl) return;
    try {
      await navigator.clipboard.writeText(generatedShareUrl);
      setIsShareCopied(true);
      setTimeout(() => setIsShareCopied(false), 2500);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  const handleConfirmUnshare = async () => {
    const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    const shareIdToDelete = activeTab?.shareId;

    setIsUnsharing(true);
    try {
      if (shareIdToDelete) {
        try {
          await fetch(`/api/share/${shareIdToDelete}/delete`, {
            method: "POST",
          });
        } catch (e) {
          console.error("Failed to delete share on server:", e);
        }
      }

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, isShared: false, shareId: undefined, shareHasPassword: undefined }
            : t
        )
      );
      setHasUnsavedChanges(true);
      setGeneratedShareUrl("");
      setShowUnshareConfirm(false);
      setShowShareModal(false);

      await performSaveAction({ silent: true });
    } catch (e) {
      console.error("Unshare failed", e);
    } finally {
      setIsUnsharing(false);
    }
  };

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
          className="fixed inset-0 flex items-center md:items-start justify-center md:pt-[28vh] bg-[#090a0b] z-50 pointer-events-none"
        >
          <span className="font-sans text-sm tracking-widest text-[#ffffff] font-medium block uppercase animate-pulse">
            Decrypting
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 0. SHARED DOCUMENT VIEW (URL: /share/:id)
  if (sharedDocId) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#090a0b] text-zinc-200 font-sans selection:bg-zinc-800">
        <header className="sticky top-0 z-30 bg-[#090a0b]/95 backdrop-blur w-full">
          <div className="w-full max-w-4xl px-4 md:px-8 py-3 flex justify-between items-center mx-auto">
            <div className="flex items-center gap-2 md:gap-3">
              <span
                onClick={() => navigateTo("")}
                className="font-sans text-sm md:text-base tracking-widest text-[#f4f4f5] font-semibold cursor-pointer hover:text-zinc-400 transition-colors select-none"
              >
                TEXT_VAULT
              </span>
              <span className="text-zinc-600 text-xs select-none">/</span>
              <span className="text-zinc-300 text-xs md:text-sm font-sans font-medium select-none truncate max-w-[180px] md:max-w-md">
                {sharedDocContent?.title || "Shared Doc"}
              </span>
            </div>

            <div className="flex items-center gap-2 md:gap-4">
              {sharedDocContent && (
                <span
                  onClick={handleCopySharedContent}
                  className="text-xs font-sans text-zinc-400 hover:text-white cursor-pointer select-none uppercase tracking-wider px-2 py-1 transition-colors"
                >
                  {isSharedDocCopied ? "Copied!" : "Copy"}
                </span>
              )}
              <span
                onClick={() => navigateTo("")}
                className="text-xs font-sans text-zinc-500 hover:text-white cursor-pointer select-none uppercase tracking-wider px-2 py-1 transition-colors"
              >
                Home
              </span>
            </div>
          </div>
        </header>

        {/* Content area: Loading / Not Found / Password Prompt / Rendered Doc */}
        <main className="flex-1 flex flex-col bg-[#090a0b] px-4 md:px-8 pt-6 pb-24 max-w-4xl mx-auto w-full">
          {sharedLoading ? (
            <div className="flex-1 flex items-center justify-center py-32">
              <span className="font-sans text-sm tracking-widest text-zinc-400 uppercase animate-pulse">
                Decrypting document...
              </span>
            </div>
          ) : sharedDocNotFound ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-32">
              <h2 className="text-xl font-bold tracking-wide uppercase text-zinc-300">
                Document Not Found
              </h2>
              <p className="text-xs text-zinc-500 max-w-sm">
                This document link might be invalid, expired, or removed.
              </p>
              <button
                onClick={() => navigateTo("")}
                className="mt-4 px-4 py-2 bg-zinc-900 border border-zinc-800 text-xs uppercase tracking-wider text-zinc-300 hover:text-white hover:border-zinc-600 rounded transition-all cursor-pointer"
              >
                Return Home
              </button>
            </div>
          ) : sharedDocHasPassword && !sharedDocContent ? (
            <div className="flex-1 flex flex-col items-center justify-center w-full max-w-md mx-auto py-24">
              <div className="w-full flex flex-col gap-6 items-center">
                <h2 className="text-zinc-100 font-sans tracking-wide text-lg md:text-xl text-center uppercase font-semibold">
                  Access Protected Document
                </h2>

                <div className="w-full">
                  <div className="relative grid items-center w-full max-w-xs mx-auto">
                    <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                      ••••••••
                    </span>
                    <span className="invisible whitespace-pre font-sans text-base md:text-sm tracking-[0.2em] py-1 pointer-events-none col-start-1 row-start-1">
                      {sharedPasswordInput ? '•'.repeat(sharedPasswordInput.length) : ''}
                    </span>
                    <input
                      ref={sharedPasswordInputRef}
                      autoFocus
                      type="password"
                      maxLength={64}
                      value={sharedPasswordInput}
                      onChange={(e) => setSharedPasswordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUnlockSharedDoc();
                      }}
                      className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-base md:text-lg tracking-[0.2em] text-center border-none"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                {sharedDocError && (
                  <p className="font-sans text-[10px] text-red-500 text-center tracking-widest uppercase">
                    [!] {sharedDocError}
                  </p>
                )}

                <div className="flex justify-center gap-8 items-center mt-2">
                  <span
                    onClick={() => navigateTo("")}
                    className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={handleUnlockSharedDoc}
                    className={`font-sans text-xs md:text-sm font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block ${sharedIsDecrypting ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    {sharedIsDecrypting ? "Decrypting..." : "Decrypt"}
                  </span>
                </div>
              </div>
            </div>
          ) : sharedDocContent ? (
            <div className="w-full flex flex-col flex-1">
              <div className="flex-1 flex flex-col relative min-h-[500px]">
                <Suspense fallback={<div className="text-zinc-600 font-sans text-sm py-16 text-center">Loading viewer...</div>}>
                  <Editor
                    editorRef={sharedEditorRef}
                    activeTabId="shared"
                    initialContent={sharedDocContent.text}
                    hideToc={false}
                    readOnly={true}
                  />
                </Suspense>
              </div>
            </div>
          ) : (
            sharedDocError && (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-32">
                <p className="text-xs text-red-400 max-w-sm">
                  {sharedDocError}
                </p>
                <button
                  onClick={() => navigateTo("")}
                  className="mt-2 px-4 py-2 bg-zinc-900 border border-zinc-800 text-xs uppercase tracking-wider text-zinc-300 hover:text-white rounded transition-all cursor-pointer"
                >
                  Return Home
                </button>
              </div>
            )
          )}
        </main>

        <footer className="w-full max-w-4xl mx-auto flex justify-center items-center py-6">
          <span className="font-sans text-[10px] md:text-[11px] text-zinc-600 tracking-widest uppercase text-center select-none">
            End To End Encrypted // <span onClick={() => navigateTo("")} className="text-white hover:text-zinc-300 cursor-pointer">Text_Vault</span>
          </span>
        </footer>
      </div>
    );
  }

  // 1 & 2. HOME SCREEN AND PASSWORD PROMPT
  if (!isVerified) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#090a0b] text-zinc-200 px-6 py-12 md:py-16 font-sans">
        <header className="flex justify-between items-center w-full max-w-6xl mx-auto">
          <span className="font-sans text-sm md:text-base tracking-widest text-[#f4f4f5] font-semibold select-none">TEXT_VAULT</span>
          <span className="font-sans text-[10px] md:text-xs text-zinc-600 tracking-wider">v0.1</span>
        </header>

        <main className="flex-1 flex flex-col justify-center items-center w-full max-w-4xl mx-auto my-12">
          <div className="w-full flex flex-col items-center">
            <h1 className="text-xl md:text-[2.35rem] font-sans text-zinc-500 font-bold tracking-wide mb-12 text-center select-none">
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
                <div className="absolute top-full left-0 right-0 mt-2 flex flex-col items-center text-center text-xs text-zinc-500 font-sans pointer-events-auto transition-opacity duration-300 gap-1 w-full">
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
          <span className="font-sans text-[9px] md:text-[11px] text-zinc-600 tracking-widest uppercase text-center select-none">
            Always encrypt data before transferring it to the server // <a href="https://github.com/kanpianer/text_vault" target="_blank" rel="noopener noreferrer" className="text-white hover:text-zinc-300">Github</a>
          </span>
        </footer>

        {/* PASSWORD PROMPT MODAL */}
        <AnimatePresence>
          {vaultName && !isDecrypting && (
            <div className="fixed inset-0 bg-[#090a0b] flex items-center md:items-start justify-center md:pt-[28vh] z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-4xl px-4 md:px-8 flex flex-col gap-6 relative"
              >
                <h3 className="text-zinc-100 font-sans tracking-wide text-lg md:text-xl text-center uppercase">
                  {isNewVault ? "Create Vault Password" : "UNLOCK THE VAULT"}
                </h3>

                <div className="flex flex-col w-full items-center">
                  <div className="w-full mb-6">
                    {isNewVault && (
                      <label className="font-sans text-[10px] md:text-xs text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
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
                          maxLength={64}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-base md:text-lg tracking-[0.2em] text-center"
                          placeholder="••••••••"
                          onClick={(e) => {
                            if (window.matchMedia("(max-width: 767px)").matches) {
                              const len = e.currentTarget.value.length;
                              e.currentTarget.setSelectionRange(len, len);
                            }
                          }}
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
                      <label className="font-sans text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
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
                            maxLength={64}
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
                    <p className="font-sans text-[10px] text-red-500 text-center tracking-widest mb-4 uppercase">
                      [!] {errorText}
                    </p>
                  )}

                  {isNewVault && (
                    <div className="text-zinc-500 font-sans text-[10px] text-center uppercase leading-relaxed tracking-widest select-none mb-6">
                      <span className="text-zinc-400 block mb-1 font-semibold">Strict requirements:</span>
                      Between 8 to 64 characters limit<br />
                      Uppercase and lowercase letters<br />
                      Special characters and numbers
                    </div>
                  )}

                  <div className="flex justify-center gap-12 items-center">
                    <span
                      onClick={() => navigateTo("")}
                      className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={isNewVault ? handleCreateVault : handleUnlockVault}
                      className="font-sans text-xs md:text-sm font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
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
      className="min-h-screen flex flex-col justify-between bg-[#090a0b] text-zinc-200 font-sans relative"
    >
      {/* Password Changed fullscreen overlay */}
      <AnimatePresence>
        {saveStatus === "pwd_changed" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center bg-[#090a0b] z-50 pointer-events-none"
          >
            <span className="font-sans text-sm tracking-widest text-[#ffffff] font-medium block uppercase animate-pulse">
              Password Changed
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sticky top-0 z-30 bg-[#090a0b] flex flex-col w-full">
        <header className="w-full">
        <div className="w-full max-w-4xl px-4 md:px-8 py-3 flex justify-between items-center mx-auto relative">
          {/* Mobile backdrop for Document Switcher to dismiss immediately on tap */}
          {showDocPopup && (
            <div
              className="fixed inset-0 z-40 md:hidden bg-transparent"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowDocPopup(false);
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowDocPopup(false);
              }}
            />
          )}

          <div className="flex items-center gap-3 min-w-0">
            <div
              ref={docTriggerRef}
              onMouseEnter={handleDocTriggerMouseEnter}
              onMouseLeave={handleDocTriggerMouseLeave}
              onClick={() => setShowDocPopup((prev) => !prev)}
              className="font-sans text-sm md:text-base tracking-widest font-semibold select-none flex items-center cursor-pointer group shrink-0 py-1 relative z-50"
            >
              <span className={`tracking-normal transition-colors duration-150 ${showDocPopup ? "text-white" : "text-zinc-500 group-hover:text-white"}`}>Text_Vault/</span>
              <span className={`lowercase transition-colors duration-150 ${showDocPopup ? "text-zinc-500" : "text-white group-hover:text-zinc-500"}`}>{vaultName}</span>
            </div>

            {tabs.length < 20 && (
              <button
                type="button"
                onClick={handleAddTab}
                title="New Document"
                className="text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors select-none shrink-0 p-1"
              >
                <Plus size={15} strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Document Switcher & Search Popup */}
          <AnimatePresence>
            {showDocPopup && (
              <motion.div
                ref={docPopupRef}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                onMouseEnter={handleDocPopupMouseEnter}
                onMouseLeave={handleDocPopupMouseLeave}
                style={{
                  width: isMobile ? (editorAreaWidth > 0 ? `${editorAreaWidth}px` : "calc(100vw - 32px)") : `${popupWidth}px`,
                  maxWidth: "calc(100vw - 32px)",
                }}
                className="absolute left-4 md:left-8 top-full mt-0 flex flex-col z-50 bg-[#090a0b] border border-zinc-800 rounded shadow-xl max-h-[75vh] overflow-hidden before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 before:content-['']"
              >
                {/* Search bar header */}
                <div className="flex items-center gap-2.5 px-3.5 py-2 border-b border-zinc-800 bg-[#090a0b] shrink-0">
                  <Search size={18} className="w-4 h-4 md:w-[18px] md:h-[18px] text-zinc-500 shrink-0" />
                  <input
                    ref={docSearchInputRef}
                    type="text"
                    value={docSearchQuery}
                    onChange={(e) => setDocSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        if (docSearchQuery) {
                          setDocSearchQuery("");
                        } else {
                          setShowDocPopup(false);
                        }
                      } else if (e.key === "Enter" && filteredTabs.length > 0) {
                        handleTabSwitch(filteredTabs[0].id);
                        setShowDocPopup(false);
                      }
                    }}
                    placeholder="search docs"
                    className="bg-transparent text-base md:text-lg text-zinc-200 placeholder-zinc-500 outline-none w-full font-sans"
                  />
                  {docSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setDocSearchQuery("")}
                      className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer shrink-0"
                    >
                      <X size={16} className="w-4 h-4 md:w-[18px] md:h-[18px]" />
                    </button>
                  )}
                </div>

                {/* Document list */}
                <div
                  ref={docListRef}
                  onScroll={handleDocListScroll}
                  className={`flex-1 overflow-y-auto min-h-0 py-1 overscroll-contain no-scrollbar ${
                    reorderingTabId ? "select-none cursor-grabbing" : ""
                  }`}
                >
                  {filteredTabs.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-zinc-500 font-sans">
                      No matching documents
                    </div>
                  ) : (
                    filteredTabs.map((tab) => {
                      const isActive = tab.id === effectiveActiveTabId;
                      const isEditing = editingTabId === tab.id;
                      const isReordering = reorderingTabId === tab.id;
                      return (
                        <motion.div
                          layout="position"
                          transition={{ duration: 0.12, ease: "easeOut" }}
                          key={tab.id}
                          data-tab-id={tab.id}
                          onPointerDown={(e) => handleTabPointerDown(e, tab.id)}
                          onPointerMove={handleTabPointerMove}
                          onPointerUp={handleTabPointerUp}
                          onPointerCancel={handleTabPointerUp}
                          onClick={() => {
                            if (isDraggingJustFinishedRef.current) return;
                            if (!isEditing) {
                              handleTabSwitch(tab.id);
                              setShowDocPopup(false);
                            }
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingTabId(tab.id);
                            setEditingTitle(getTabRawTitle(tab));
                          }}
                          className={`group flex items-center justify-between px-3.5 py-0.5 text-base md:text-lg font-sans transition-colors relative select-none ${
                            isReordering ? "cursor-grabbing" : "cursor-pointer"
                          }`}
                          style={{
                            touchAction: isReordering ? "none" : "auto",
                          }}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                            <span
                              className="w-[5.33px] h-[5.33px] rounded-full shrink-0 bg-white -translate-y-[1.5px]"
                              style={{
                                width: "5.33px",
                                height: "5.33px",
                                backgroundColor: "#ffffff",
                                opacity: isActive ? 1 : 0,
                                pointerEvents: "none",
                              }}
                            />
                            {isEditing ? (
                              <input
                                type="text"
                                autoFocus
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={() => handleRenameSave(tab.id)}
                                onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
                                onFocus={(e) => e.target.select()}
                                className="bg-transparent border-b border-zinc-400 text-white outline-none font-sans text-base md:text-lg py-0.5 flex-1"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className={`truncate select-none transition-colors text-base md:text-lg ${
                                  isActive
                                    ? "text-white font-medium"
                                    : isReordering
                                    ? "text-white font-medium"
                                    : "text-zinc-400 group-hover:text-white"
                                }`}
                                style={{
                                  color: isActive || isReordering ? "#ffffff" : undefined,
                                }}
                                title={getTabRawTitle(tab)}
                              >
                                {getTabRawTitle(tab)}
                              </span>
                            )}
                          </div>

                          {tabs.length > 1 && (
                            <button
                              type="button"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCloseTab(e, tab.id);
                              }}
                              title="Delete Doc"
                              className="text-zinc-600 hover:text-red-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer shrink-0"
                            >
                              <X size={16} strokeWidth={2} />
                            </button>
                          )}
                        </motion.div>
                      );
                    })
                  )}
                </div>

                {/* Bottom border & scroll progress indicator */}
                <div className="relative w-full h-[1px] bg-zinc-800 shrink-0">
                  {docCanScroll && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-[2px] h-[8px] bg-zinc-300 rounded-[1px] transition-[left] duration-75 pointer-events-none"
                      style={{
                        left: `calc(${docScrollProgress} * (100% - 2px))`,
                      }}
                    />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        {/* Global actions: Save word and Settings overlay */}
        <div className="flex items-center gap-4 md:gap-6">
          {/* Status indicator: UNSAVED / SAVING... / SAVED - Same distance to Timer as Timer to Save */}
          {((hasUnsavedChanges && saveStatus === "idle" && !autoSaveAnim) ||
            saveStatus === "saving" ||
            autoSaveAnim === "saving" ||
            saveStatus === "saved" ||
            autoSaveAnim === "saved") && (
            <div
              className={`flex items-center select-none shrink-0 transition-opacity duration-150 ${
                showMenu ? "opacity-0 pointer-events-none invisible" : ""
              }`}
            >
              {hasUnsavedChanges && saveStatus === "idle" && !autoSaveAnim && (
                <span className="font-sans text-[10px] md:text-xs text-zinc-500 animate-pulse tracking-wider leading-none">
                  [UNSAVED]
                </span>
              )}

              {(saveStatus === "saving" || autoSaveAnim === "saving") && (
                <span className="font-sans text-[10px] md:text-xs text-zinc-400 animate-pulse tracking-wider leading-none">
                  [SAVING...]
                </span>
              )}

              {(saveStatus === "saved" || autoSaveAnim === "saved") && (
                <span className="font-sans text-[10px] md:text-xs text-zinc-400 tracking-wider leading-none">
                  [SAVED]
                </span>
              )}
            </div>
          )}

          {/* Mobile backdrop for Timer Dropdown to dismiss immediately on tap */}
          {showTimerDropdown && (
            <div
              className="fixed inset-0 z-40 md:hidden bg-transparent"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowTimerDropdown(false);
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowTimerDropdown(false);
              }}
            />
          )}

          {/* Timer Dropdown */}
          <div 
            ref={timerContainerRef}
            onMouseEnter={handleTimerMouseEnter}
            onMouseLeave={handleTimerMouseLeave}
            className={`relative flex items-center transition-opacity duration-150 ${showMenu ? "opacity-0 pointer-events-none invisible" : ""}`}
          >
            <span
              onClick={() => {
                setShowTimerDropdown(!showTimerDropdown);
                setShowMenu(false);
              }}
              className={`font-sans text-xs md:text-sm uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer select-none leading-none block relative transition-colors duration-150 ${showTimerDropdown ? "z-50" : ""}`}
            >
              {showCountdown && timeLeft !== null ? formatTimeLeft(timeLeft) : "TIMER"}
            </span>

            <AnimatePresence>
              {showTimerDropdown && !showMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  onMouseEnter={handleTimerPopupMouseEnter}
                  onMouseLeave={handleTimerPopupMouseLeave}
                  className="absolute right-0 top-full mt-2 flex flex-col items-end gap-3 z-50 whitespace-nowrap bg-[#090a0b] border border-zinc-800 rounded shadow-xl py-2 px-4 before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 before:content-['']"
                >
                  {[5, 10, 15, 30].map(mins => (
                    <span
                      key={mins}
                      onClick={() => {
                        setAutoLockTimeoutMs(mins * 60000);
                        setShowCountdown(true);
                        setShowTimerDropdown(false);
                      }}
                      className="text-xs md:text-sm font-sans text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-1"
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
            className={`font-sans text-xs md:text-sm uppercase tracking-wider select-none font-medium transition-colors leading-none block ${
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
                className="fixed inset-0 z-40 bg-[#090a0b]" 
                onClick={() => setShowMenu(false)} 
              />
            )}
            <span
              onClick={() => {
                setShowMenu(!showMenu);
                setShowTimerDropdown(false);
              }}
              className="font-sans text-xs md:text-sm uppercase tracking-wider text-zinc-400 hover:text-white cursor-pointer select-none leading-none block relative z-50"
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
                    className="text-xs md:text-sm font-sans text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    Lock Vault
                  </span>
                  <span
                    onClick={() => {
                      setShowChangePasswordModal(true);
                      setPwdModalError("");
                      setShowMenu(false);
                    }}
                    className="text-xs md:text-sm font-sans text-zinc-500 hover:text-zinc-200 cursor-pointer uppercase tracking-wider transition-colors py-2"
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
                    className="text-xs md:text-sm font-sans text-zinc-500 hover:text-red-400 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    Delete Vault
                  </span>
                  <span
                    onClick={() => {
                      setShowExportModal(true);
                      setShowMenu(false);
                    }}
                    className="text-xs md:text-sm font-sans text-zinc-500 hover:text-yellow-500 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    EXPORT TO .MD
                  </span>
                  <span
                    onClick={() => {
                      const currentTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
                      if (currentTab?.shareId) {
                        setGeneratedShareUrl(`${window.location.origin}/share/${currentTab.shareId}`);
                        setShareRequirePassword(Boolean(currentTab.shareHasPassword));
                      } else {
                        setGeneratedShareUrl("");
                        setShareRequirePassword(false);
                      }
                      setShowShareModal(true);
                      setSharePassword("");
                      setShareConfirmPassword("");
                      setShareError("");
                      setIsShareCopied(false);
                      setShowMenu(false);
                    }}
                    className="text-xs md:text-sm font-sans text-zinc-500 hover:text-emerald-400 cursor-pointer uppercase tracking-wider transition-colors py-2"
                  >
                    {isCurrentTabShared ? "SHARED DOC" : "Share this doc"}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        </div>
      </header>
      </div>

      <main ref={mainContainerRef} className="flex-1 flex flex-col bg-[#090a0b] px-4 md:px-8 pt-0 pb-0 max-w-4xl mx-auto w-full">
        {/* Content Box (Unified Line-by-Line Edit & Preview Area) */}
        <div className="flex-1 flex flex-col relative pt-0 pb-24 min-h-[550px]"
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
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-zinc-600 font-sans text-sm py-16">Loading editor...</div>}>
            <Editor
              editorRef={editorRef}
              activeTabId={activeTabId}
              initialContent={activeTabContent}
              onChange={handleEditorInput}
              onActiveChange={setIsEditorFocused}
              hideToc={shouldHideEditorToc}
              readOnly={saveStatus === "saving" || saveStatus === "saved" || saveStatus === "pwd_changed"}
            />
          </Suspense>
        </div>
      </main>



      {/* DELETE TAB POPUP */}
      <AnimatePresence>
        {tabToClose && (() => {
          const docToDelete = tabs.find((t) => t.id === tabToClose);
          const docToDeleteTitle = docToDelete ? getTabRawTitle(docToDelete) : "untitled";
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 bg-[#090a0b] flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-50"
            >
              <div className="w-full max-w-sm flex flex-col items-center gap-6 relative">
                {/* Document name matching title window font size, vertically aligned with delete vault modal on desktop */}
                <span className="font-sans text-base md:text-lg text-zinc-200 font-medium tracking-wide text-center">
                  {docToDeleteTitle}
                </span>

                <p className="font-sans text-xs md:text-sm text-zinc-400 text-center leading-relaxed">
                  are you sure you want to delete this doc？
                </p>

                <div className="flex justify-center gap-12 items-center mt-2">
                  <span
                    onClick={() => setTabToClose(null)}
                    className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={confirmCloseTab}
                    className="font-sans text-xs md:text-sm font-semibold text-red-500 hover:text-red-400 transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                  >
                    Confirm
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      <AnimatePresence>
        {showChangePasswordModal && (
          <div className="fixed inset-0 bg-[#090a0b] flex items-center md:items-start justify-center md:pt-[28vh] z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl px-4 md:px-8 flex flex-col gap-6 relative"
            >
              <h3 className="text-zinc-100 font-sans tracking-wide text-lg text-center uppercase">
                Change Password
              </h3>

              <div className="flex flex-col w-full items-center">
                <div className="w-full">
                  <div className="w-full mb-6">
                    <label className="font-sans text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
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
                          maxLength={64}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="w-full mb-6">
                    <label className="font-sans text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
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
                          maxLength={64}
                          className="col-start-1 row-start-1 w-full h-full bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {pwdModalError && (
                  <p className="font-sans text-[10px] text-red-500 text-center tracking-widest mb-4 uppercase">
                    [!] {pwdModalError}
                  </p>
                )}

                <div className="text-[10px] text-zinc-600 font-sans text-center tracking-widest select-none mb-6 w-full max-w-4xl px-4 leading-normal">
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
                    className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={handleChangePassword}
                    className="font-sans text-xs md:text-sm font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
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
          <div className="fixed inset-0 bg-[#090a0b] flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl flex flex-col gap-6 relative"
            >
              <h3 className="font-sans tracking-wide text-lg text-yellow-500 uppercase text-center font-bold">
                Security Warning
              </h3>

              <div className="flex flex-col gap-6">
                <p className="font-sans text-xs text-zinc-300 leading-relaxed text-center px-4">
                  Exported text is unencrypted. Anyone with the zip file will be able to read its contents.
                </p>
                <div className="flex justify-center gap-12 items-center mt-2">
                  <span
                    onClick={() => setShowExportModal(false)}
                    className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                  >
                    Cancel
                  </span>
                  <span
                    onClick={handleExportMd}
                    className="font-sans text-xs md:text-sm font-semibold text-yellow-500 hover:text-yellow-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
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
          <div className="fixed inset-0 bg-[#090a0b] flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl flex flex-col gap-6 relative"
            >
              <h3 className="font-sans tracking-wide text-lg text-red-500 uppercase text-center font-bold">
                Instant Destruction Alert
              </h3>

              {deleteStep === 1 && (
                <div className="flex flex-col gap-6">
                  <p className="font-sans text-xs text-zinc-300 leading-relaxed text-center px-4">
                    Are you absolutely sure you want to delete this vault?
                  </p>
                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Keep Secure
                    </span>
                    <span
                      onClick={() => setDeleteStep(2)}
                      className="font-sans text-xs md:text-sm font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                    >
                      Authorize (1/3)
                    </span>
                  </div>
                </div>
              )}

              {deleteStep === 2 && (
                <div className="flex flex-col gap-6">
                  <p className="font-sans text-xs text-zinc-300 leading-relaxed text-center px-4">
                    All encrypted texts will be permanently wiped forever and cannot be undone
                  </p>
                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Aboard
                    </span>
                    <span
                      onClick={() => setDeleteStep(3)}
                      className="font-sans text-xs md:text-sm font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block"
                    >
                      Destroy (2/3)
                    </span>
                  </div>
                </div>
              )}

              {deleteStep === 3 && (
                <div className="flex flex-col gap-6 w-full items-center">
                  <p className="font-sans text-xs text-zinc-300 leading-relaxed text-center px-4">
                    Type the vault name below:
                  </p>

                  <div className="w-full flex justify-center px-4">
                    <div className="relative flex items-center justify-center w-full max-w-xs">
                      {!isDeleteConfirmFocused && !deleteConfirmName && (
                        <div className="absolute inset-y-0 w-full flex items-center justify-center pointer-events-none text-zinc-600 font-sans tracking-wider text-base md:text-sm">
                          <span className="inline-block w-[2px] h-4 md:h-5 bg-zinc-500 mr-[2px] animate-cursor-blink opacity-70"></span>CONFIRM NAME
                        </div>
                      )}
                      <input
                        type="text"
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        onFocus={() => setIsDeleteConfirmFocused(true)}
                        onBlur={() => setIsDeleteConfirmFocused(false)}
                        className="bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-wider text-center w-full uppercase"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && deleteConfirmName.toLowerCase() === vaultName.toLowerCase()) {
                            handleDeleteVault();
                          }
                        }}
                      />
                    </div>
                  </div>

                  {deleteError && (
                    <p className="font-sans text-xs text-red-500 tracking-wide text-center uppercase leading-normal">
                      [!] {deleteError}
                    </p>
                  )}

                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowDeleteModal(false)}
                      className="font-sans text-xs md:text-sm text-zinc-500 hover:text-white transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={handleDeleteVault}
                      className={`font-sans text-xs md:text-sm font-semibold uppercase tracking-wider px-2 block ${
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

      {/* SHARE THIS DOC MODAL */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 bg-[#090a0b] flex items-center md:items-start justify-center p-4 md:pt-[24vh] z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg flex flex-col gap-6 relative"
            >
              <h3 className="text-zinc-100 font-sans tracking-wide text-lg text-center uppercase font-semibold">
                {isCurrentTabShared ? "Shared Doc" : "Share This Doc"}
              </h3>

              {!generatedShareUrl ? (
                <div className="flex flex-col gap-6">
                  <p className="font-sans text-xs text-zinc-400 leading-relaxed text-center px-4">
                    Doc: <span className="text-zinc-200 font-medium">{activeTabRawTitle}</span>
                  </p>

                  <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
                    <label className="flex items-center justify-center gap-3 cursor-pointer select-none py-1">
                      <input
                        type="checkbox"
                        checked={shareRequirePassword}
                        onChange={(e) => {
                          setShareRequirePassword(e.target.checked);
                          setShareError("");
                        }}
                        className="w-4 h-4 rounded accent-zinc-200 cursor-pointer"
                      />
                      <span className="font-sans text-xs md:text-sm text-zinc-300">
                        Require access password
                      </span>
                    </label>

                    {shareRequirePassword ? (
                      <div className="flex flex-col gap-4 mt-2">
                        <div>
                          <label className="font-sans text-[10px] text-zinc-500 uppercase tracking-widest block mb-1 text-center select-none">
                            ACCESS PASSWORD
                          </label>
                          <input
                            type="password"
                            maxLength={64}
                            value={sharePassword}
                            onChange={(e) => setSharePassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2 text-center text-white text-sm font-sans tracking-widest outline-none focus:border-zinc-500 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="font-sans text-[10px] text-zinc-500 uppercase tracking-widest block mb-1 text-center select-none">
                            REPEAT PASSWORD
                          </label>
                          <input
                            type="password"
                            maxLength={64}
                            value={shareConfirmPassword}
                            onChange={(e) => setShareConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2 text-center text-white text-sm font-sans tracking-widest outline-none focus:border-zinc-500 transition-colors"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="font-sans text-[11px] text-zinc-500 text-center tracking-wide leading-relaxed">
                        Anyone with the link can view this document without a password.
                      </p>
                    )}

                    {shareError && (
                      <p className="font-sans text-[10px] text-red-500 text-center tracking-widest uppercase">
                        [!] {shareError}
                      </p>
                    )}
                  </div>

                  <div className="flex justify-center gap-12 items-center mt-2">
                    <span
                      onClick={() => setShowShareModal(false)}
                      className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                    >
                      Cancel
                    </span>
                    <span
                      onClick={handleGenerateShareLink}
                      className={`font-sans text-xs md:text-sm font-semibold text-zinc-200 hover:text-white hover:underline transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block ${isSharing ? "opacity-50 pointer-events-none" : ""}`}
                    >
                      {isSharing ? "Creating Link..." : "Create Share Link"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <p className="font-sans text-xs text-zinc-400 leading-relaxed text-center px-4">
                    {isCurrentTabShared ? "Share link for this doc:" : "Share link generated successfully:"}
                  </p>

                  <div className="w-full max-w-md mx-auto">
                    <div className="p-2.5 bg-zinc-900/80 border border-zinc-800 rounded flex items-center justify-between gap-2">
                      <input
                        type="text"
                        readOnly
                        value={generatedShareUrl}
                        onClick={(e) => e.currentTarget.select()}
                        className="bg-transparent font-mono text-xs text-zinc-300 w-full outline-none select-all px-1"
                      />
                      <button
                        onClick={handleCopyShareLink}
                        className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-sans uppercase tracking-wider rounded transition-colors flex-shrink-0 cursor-pointer"
                      >
                        {isShareCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>

                    {shareRequirePassword ? (
                      <p className="font-sans text-[11px] text-zinc-400 text-center leading-relaxed mt-3">
                        Remember to send the access password to your recipient.
                      </p>
                    ) : (
                      <p className="font-sans text-[11px] text-zinc-500 text-center leading-relaxed mt-3">
                        Anyone with this link can view this document.
                      </p>
                    )}
                  </div>

                  <div className="flex justify-center items-center gap-8 mt-2">
                    <span
                      onClick={() => setShowUnshareConfirm(true)}
                      className="font-sans text-xs text-red-500/80 hover:text-red-400 transition-colors cursor-pointer select-none uppercase tracking-wider px-2 py-1 flex items-center gap-1.5"
                    >
                      <Link2Off className="w-3.5 h-3.5" />
                      Unshare
                    </span>
                    <span
                      onClick={() => {
                        setShowShareModal(false);
                      }}
                      className="font-sans text-xs md:text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer select-none uppercase tracking-wider px-4 py-1"
                    >
                      Done
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CONFIRM UNSHARE POPUP */}
      <AnimatePresence>
        {showUnshareConfirm && (
          <div className="fixed inset-0 bg-[#090a0b]/90 backdrop-blur-sm flex items-center md:items-start justify-center p-4 md:pt-[28vh] z-[60]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm flex flex-col gap-6 relative"
            >
              <h3 className="text-zinc-100 font-sans tracking-wide text-lg text-center uppercase font-semibold">
                UNSHARE DOCUMENT
              </h3>

              <p className="font-sans text-xs text-zinc-400 text-center leading-relaxed">
                Are you sure you want to stop sharing this document? The link will become inaccessible immediately.
              </p>

              <div className="flex justify-center gap-12 items-center mt-2">
                <span
                  onClick={() => setShowUnshareConfirm(false)}
                  className="font-sans text-xs md:text-sm text-zinc-500 hover:text-zinc-100 transition-colors cursor-pointer select-none uppercase tracking-wider px-2"
                >
                  Cancel
                </span>
                <span
                  onClick={handleConfirmUnshare}
                  className={`font-sans text-xs md:text-sm font-semibold text-red-500 hover:text-red-400 transition-colors cursor-pointer select-none uppercase tracking-wider px-2 block ${
                    isUnsharing ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  {isUnsharing ? "Unsharing..." : "Confirm"}
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {loadingOverlay}
    </motion.div>
  );
}
