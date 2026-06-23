import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";
import { motion, AnimatePresence } from "motion/react";
import { TabContent, SaveStatus } from "./types";
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

  // Editing state (true = Edit Mode, false = Preview Mode)
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [cursorPosToRestore, setCursorPosToRestore] = useState<[number, number] | null>(null);

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
      setErrorText("Password must contain upper, lower, symbols, and digits (8-20 characters).");
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

  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && editorRef.current && cursorPosToRestore) {
      editorRef.current.setSelectionRange(cursorPosToRestore[0], cursorPosToRestore[1]);
      setCursorPosToRestore(null);
    }
  }, [isEditing, cursorPosToRestore]);

  // Active document characters count
  const activeTabContent = tabs.find((t) => t.id === activeTabId)?.text || "";
  const remainingChars = 10000 - activeTabContent.length;

  const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    if (text.length > 10000) return; // rigid limit enforcement

    const updated = tabs.map((tab) => {
      if (tab.id === activeTabId) {
        return { ...tab, text };
      }
      return tab;
    });
    setTabs(updated);
    setHasUnsavedChanges(true);
  };

  // Format Helper Button Actions
  const insertFormat = (type: string) => {
    const textarea = document.getElementById("editor-textarea") as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = activeTabContent.substring(start, end);

    let replacement = "";
    switch (type) {
      case "bold":
        replacement = `**${selectedText || "bold"}**`;
        break;
      case "italic":
        replacement = `*${selectedText || "italic"}*`;
        break;
      case "header":
        replacement = `# ${selectedText || "Header"}`;
        break;
      case "code":
        replacement = `\`${selectedText || "code"}\``;
        break;
      case "list":
        replacement = `- ${selectedText || "list item"}`;
        break;
      case "quote":
        replacement = `> ${selectedText || "blockquote"}`;
        break;
    }

    const newText = activeTabContent.substring(0, start) + replacement + activeTabContent.substring(end);
    if (newText.length > 10000) return;

    const updated = tabs.map((tab) => {
      if (tab.id === activeTabId) {
        return { ...tab, text: newText };
      }
      return tab;
    });
    setTabs(updated);
    setHasUnsavedChanges(true);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 50);
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
      setPwdModalError("Must carry upper, lower, symbols, and digits (8-20 characters).");
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
  function getTabDisplayTitle(text: string): string {
    const firstLine = text.split("\n")[0]?.trim() || "";
    if (!firstLine) return "Untitled";
    const cleanTitle = firstLine.replace(/^[#\s\*\-\>\d\.\(\)]+/, "").trim() || "Untitled";
    
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

  // --- Views Router ---

  // Loading indicator for async setups
  const loadingOverlay = (
    <AnimatePresence>
      {isDecrypting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center bg-black/95 z-50 pointer-events-none"
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
            <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4 text-center md:text-left text-lg md:text-xl font-mono tracking-wide w-full mb-2 md:mb-6">
              <span className="text-zinc-600 select-none break-all">{dynamicDomain}</span>
              <div className="relative flex flex-col items-center md:items-end">
                {!isHomeFocused && !searchName && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-zinc-600 lowercase tracking-wider text-lg md:text-xl mt-[2px]">
                    vault name<span className="inline-block w-2 h-5 bg-zinc-500 ml-1 animate-cursor-blink opacity-70"></span>
                  </div>
                )}
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchName}
                  onFocus={() => setIsHomeFocused(true)}
                  onBlur={() => setIsHomeFocused(false)}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                    if (val.length <= 10) {
                      setSearchName(val);
                      setSearchError("");
                    }
                  }}
                  className="bg-transparent border-b border-zinc-700 focus:border-zinc-300 outline-none w-44 text-center py-1 text-white text-lg md:text-xl lowercase tracking-wider"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGo();
                  }}
                />
                
                {searchName && (
                  <div className="hidden md:flex absolute -bottom-4 right-0 flex-col items-end gap-1 text-right text-xs text-zinc-500 font-mono pointer-events-auto transition-opacity duration-300 w-max max-w-[calc(100vw-4rem)] md:max-w-none" style={{ transform: "translateY(100%)" }}>
                    <div className="break-words">
                      Open <a href={`${dynamicDomain}${searchName.toLowerCase()}`} className="text-zinc-400 hover:text-zinc-300 underline underline-offset-2 tracking-wider lowercase">{(dynamicDomain.replace(/^https?:\/\//, '') + searchName).toLowerCase()}</a> Directly
                    </div>
                    {searchError && (
                      <div className="text-zinc-500 tracking-wider animate-fast-pulse">
                        {searchError}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <span
                onClick={handleGo}
                className="text-zinc-400 hover:text-white cursor-pointer select-none border-b border-transparent hover:border-white transition-all font-semibold px-2"
              >
                GO
              </span>
            </div>

            {searchName && (
              <div className="md:hidden mt-0 flex flex-col items-center text-center text-xs text-zinc-500 font-mono pointer-events-auto transition-opacity duration-300 gap-1 w-full relative">
                <div className="break-words px-4 w-full">
                  Open <a href={`${dynamicDomain}${searchName.toLowerCase()}`} className="text-zinc-400 hover:text-zinc-300 underline underline-offset-2 tracking-wider lowercase">{(dynamicDomain.replace(/^https?:\/\//, '') + searchName).toLowerCase()}</a> Directly
                </div>
                {searchError && (
                  <div className="text-zinc-500 tracking-wider animate-fast-pulse">
                    {searchError}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        <footer className="w-full max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 border-t border-zinc-900 pt-6">
          <span className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase text-center md:text-left select-none">
            Zero Knowledge Architecture // Secrets never transfer to server
          </span>
          <span className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase select-none text-center">
            PBKDF2-HMAC-SHA256 & AES-GCM local storage
          </span>
        </footer>

        {/* PASSWORD PROMPT MODAL */}
        <AnimatePresence>
          {vaultName && (
            <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-sm flex flex-col gap-6 relative"
              >
                <h3 className="text-zinc-100 font-mono tracking-wide text-lg text-center uppercase">
                  {isNewVault ? "Create Vault Password" : "Unlock Encrypted Text"}
                </h3>

                <div className="flex flex-col w-full">
                  <div className="w-full mb-6">
                    {isNewVault && (
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                        PASSWORD
                      </label>
                    )}
                    <div className="relative w-full flex items-center justify-center">
                      <input
                        ref={passwordInputRef}
                        autoFocus
                        type={showPasswordReveal ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full min-w-0 bg-transparent outline-none py-1 font-sans text-base md:text-sm tracking-[0.2em] text-center px-8"
                        style={{ WebkitTextSecurity: showPasswordReveal ? "none" : "disc" }}
                        placeholder="••••••••"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (isNewVault) handleCreateVault();
                            else handleUnlockVault();
                          }
                        }}
                      />
                      <span
                        onClick={() => setShowPasswordReveal(!showPasswordReveal)}
                        className="absolute right-0 text-[10px] font-mono text-zinc-500 hover:text-white cursor-pointer select-none"
                      >
                        {showPasswordReveal ? "HIDE" : "SHOW"}
                      </span>
                    </div>
                  </div>

                  {isNewVault && (
                    <div className="w-full mb-6">
                      <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                        REPEAT PASSWORD
                      </label>
                      <div className="relative w-full flex items-center justify-center">
                        <input
                          type={showPasswordReveal ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full min-w-0 bg-transparent outline-none py-1 font-sans text-base md:text-sm tracking-[0.2em] text-center px-8"
                          style={{ WebkitTextSecurity: showPasswordReveal ? "none" : "disc" }}
                          placeholder="••••••••"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCreateVault();
                          }}
                        />
                        <span
                          onClick={() => setShowPasswordReveal(!showPasswordReveal)}
                          className="absolute right-0 text-[10px] font-mono text-zinc-500 hover:text-white cursor-pointer select-none"
                        >
                          {showPasswordReveal ? "HIDE" : "SHOW"}
                        </span>
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
                      Between 8 to 20 characters limit<br />
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
            className="fixed inset-0 flex items-center justify-center bg-black/95 z-50 pointer-events-none"
          >
            <span className="font-mono text-sm tracking-widest text-[#ffffff] font-medium block uppercase animate-pulse">
              {saveStatus === "saving" ? "Saving..." : saveStatus === "pwd_changed" ? "Password Changed" : "Saved"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="sticky top-0 z-30 bg-[#0c0c0e] flex justify-center w-full">
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
                className="fixed inset-0 z-40 bg-black/95" 
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

      <main className="flex-1 flex flex-col bg-[#0c0c0e] px-4 md:px-8 py-6 max-w-4xl mx-auto w-full">
        {/* Navigation / Chrome mimic row */}
        <div className="flex flex-wrap justify-between items-center gap-4">
          {/* Draggable Chrome tabs reordered */}
          <div className="flex flex-wrap items-end gap-1 flex-1">
            {tabs.map((tab, idx) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => {
                    setActiveTabId(tab.id);
                  }}
                  className={`relative flex items-center gap-0 px-2 py-1.5 text-xs font-mono select-none cursor-pointer transition-colors ${
                    active
                      ? "bg-[#121215] text-white"
                      : "bg-transparent text-zinc-500 hover:text-zinc-300"
                  } ${draggingIndex === idx ? "opacity-30" : ""}`}
                >
                  <span className="tracking-wide text-zinc-100 block whitespace-nowrap" title={getTabDisplayTitle(tab.text)}>
                    {getTabDisplayTitle(tab.text)}
                  </span>

                  {tabs.length > 1 && (
                    <span
                      onClick={(e) => handleCloseTab(e, tab.id)}
                      className="text-[14px] text-zinc-500 hover:text-red-400 select-none px-1 ml-1 flex items-center justify-center transition-colors"
                    >
                      ×
                    </span>
                  )}
                </div>
              );
            })}

            {tabs.length < 10 && (
              <span
                onClick={handleAddTab}
                className="text-zinc-500 hover:text-white font-mono text-xs font-semibold px-2 cursor-pointer select-none pb-1"
              >
                + Tab
              </span>
            )}
          </div>

          {/* Desktop Visual editor toggles (Edit, Split, Preview) */}
        </div>

        {/* Markdown Toolbar formatting commands */}
        <div className="bg-[#0c0c0e] flex flex-wrap gap-4 font-mono text-[10px] text-zinc-500 select-none py-3">
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFormat("header")}
              className="hover:text-white hover:underline cursor-pointer tracking-wider"
            >
              Heading
            </span>
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFormat("bold")}
              className="hover:text-white hover:underline cursor-pointer tracking-wider"
            >
              Bold
            </span>
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFormat("italic")}
              className="hover:text-white hover:underline cursor-pointer tracking-wider"
            >
              Italic
            </span>
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFormat("code")}
              className="hover:text-white hover:underline cursor-pointer tracking-wider"
            >
              Code
            </span>
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFormat("list")}
              className="hover:text-white hover:underline cursor-pointer tracking-wider"
            >
              List
            </span>
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertFormat("quote")}
              className="hover:text-white hover:underline cursor-pointer tracking-wider"
            >
              Quote
            </span>
            <a
              onMouseDown={(e) => e.preventDefault()}
              href="https://markdownviewer.pages.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white hover:underline cursor-pointer tracking-wider lowercase"
            >
              more!
            </a>
          </div>

        {/* Content Box (Text Editor Area) */}
        <div className="flex-1 flex flex-col md:flex-row gap-0 mt-3 relative">
          {/* Edit Panel */}
          {isEditing && (
            <div className="flex-1 flex flex-col min-w-0 w-full">
              <textarea
                ref={editorRef}
                id="editor-textarea"
                autoFocus
                onBlur={() => setIsEditing(false)}
                value={activeTabContent}
                onChange={handleTextAreaChange}
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const target = e.target as HTMLTextAreaElement;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    const newText = activeTabContent.substring(0, start) + "  " + activeTabContent.substring(end);
                    updateTabContent(activeTabId, newText);
                    // Defer cursor update slightly so React can update value first
                    setTimeout(() => {
                      target.selectionStart = target.selectionEnd = start + 2;
                    }, 0);
                  }
                }}
                placeholder="Write your markdown content here..."
                className="flex-1 w-full min-h-[500px] bg-[#121215] p-4 font-mono text-base md:text-sm text-zinc-200 outline-none resize-none leading-relaxed break-all whitespace-pre-wrap"
              />
            </div>
          )}

          {/* Render Preview Panel */}
          {!isEditing && (
            <div
              onClick={() => {
                const selection = window.getSelection();
                if (selection && selection.toString().trim() !== "") {
                  const selectedText = selection.toString();
                  const idx = activeTabContent.indexOf(selectedText);
                  if (idx !== -1) {
                    setCursorPosToRestore([idx, idx + selectedText.length]);
                  }
                } else if (selection && selection.anchorNode && selection.anchorNode.nodeType === 3) {
                  const text = selection.anchorNode.textContent || "";
                  if (text) {
                    const charOffset = selection.anchorOffset;
                    const snippetStart = Math.max(0, charOffset - 15);
                    const snippetEnd = Math.min(text.length, charOffset + 15);
                    const snippet = text.substring(snippetStart, snippetEnd);
                    
                    const idx = activeTabContent.indexOf(snippet);
                    if (idx !== -1) {
                      const preciseCursor = idx + (charOffset - snippetStart);
                      setCursorPosToRestore([preciseCursor, preciseCursor]);
                    }
                  }
                }
                setIsEditing(true);
              }}
              className="flex-1 min-h-[500px] overflow-y-auto bg-[#121215] p-6 min-w-0 w-full cursor-text"
            >
              <div className="markdown-body">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                  rehypePlugins={[rehypeKatex, rehypeHighlight]}
                >
                  {activeTabContent}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Footer info bars & Word calculations */}
        <div className="flex justify-between items-center mt-3 pt-2 text-zinc-600 font-mono text-[10px] select-none">
          <span>Remaining: {remainingChars} characters limit</span>
          <span className="uppercase text-[9px] tracking-wider">
            E2E Secured // {tabs.length} Encryption Nodes
          </span>
        </div>
      </main>

      <footer className="px-6 py-4 text-center mt-6">
        <p className="font-mono text-[8px] text-zinc-700 uppercase tracking-widest select-none">
          Vault status active // Idle timer enabled // 120s security lock
        </p>
      </footer>

      {/* CHANGING ENCRYPT PASSWORD POPUP */}
      <AnimatePresence>
        {tabToClose && (
          <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50">
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
          <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm flex flex-col gap-6 relative"
            >
              <h3 className="text-zinc-100 font-mono tracking-wide text-lg text-center uppercase">
                Rotate Master Password
              </h3>

              <div className="flex flex-col w-full">
                <div className="w-full mb-6">
                  <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                    NEW PASSWORD
                  </label>
                  <div className="relative w-full flex items-center justify-center">
                    <input
                      type={showNewPasswordReveal ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full min-w-0 bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center px-8"
                      style={{ WebkitTextSecurity: showNewPasswordReveal ? "none" : "disc" }}
                      placeholder="••••••••"
                    />
                    <span
                      onClick={() => setShowNewPasswordReveal(!showNewPasswordReveal)}
                      className="absolute right-0 text-[10px] font-mono text-zinc-500 hover:text-white cursor-pointer select-none"
                    >
                      {showNewPasswordReveal ? "HIDE" : "SHOW"}
                    </span>
                  </div>
                </div>

                <div className="w-full mb-6">
                  <label className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest block mb-2 select-none text-center">
                    REPEAT PASSWORD
                  </label>
                  <div className="relative w-full flex items-center justify-center">
                    <input
                      type={showNewPasswordReveal ? "text" : "password"}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="w-full min-w-0 bg-transparent outline-none py-1 font-sans text-white text-base md:text-sm tracking-[0.2em] text-center px-8"
                      style={{ WebkitTextSecurity: showNewPasswordReveal ? "none" : "disc" }}
                      placeholder="••••••••"
                    />
                    <span
                      onClick={() => setShowNewPasswordReveal(!showNewPasswordReveal)}
                      className="absolute right-0 text-[10px] font-mono text-zinc-500 hover:text-white cursor-pointer select-none"
                    >
                      {showNewPasswordReveal ? "HIDE" : "SHOW"}
                    </span>
                  </div>
                </div>

                {pwdModalError && (
                  <p className="font-mono text-[10px] text-red-500 text-center tracking-widest mb-4 uppercase">
                    [!] {pwdModalError}
                  </p>
                )}

                <div className="text-[10px] text-zinc-600 font-mono text-center tracking-widest select-none mb-6">
                  Your current {tabs.length} tab contents will be decrypted and re-encrypted with this
                  new secure credential key block.
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
          <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm flex flex-col gap-6 relative"
            >
              <h3 className="font-mono tracking-wide text-lg text-red-500 uppercase text-center font-bold">
                !! Instant Destruction Alert !!
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
                      Abandon
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
                <div className="flex flex-col gap-6">
                  <p className="font-mono text-xs text-zinc-300 leading-relaxed text-center px-4">
                    Confirm identity. Type the vault name <span className="font-bold text-white uppercase">{vaultName}</span> below:
                  </p>

                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    className="bg-transparent border-b border-red-900/50 focus:border-red-500 outline-none py-1 font-mono text-white text-base md:text-sm tracking-wider text-center w-full uppercase"
                    placeholder="CONFIRM NAME"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && deleteConfirmName.toLowerCase() === vaultName.toLowerCase()) {
                        handleDeleteVault();
                      }
                    }}
                  />

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
