import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Textarea, Text } from "@cypher-asi/zui";
import { ImagePlus, X, ExternalLink, LogOut } from "lucide-react";
import { ImageCropModal } from "../ImageCropModal";
import { DeleteAccountConfirmModal } from "./DeleteAccountConfirmModal";
import { uploadFile } from "../../api/upload";
import { useProfile, useProfileStore, type UserProfileData } from "../../stores/profile-store";
import { useAuthStore } from "../../stores/auth-store";
import { useLogout } from "../../stores/use-logout";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "../OrgSettingsPanel/OrgSettingsPanel.module.css";

interface Props {
  onClose?: () => void;
}

type TextField = "name" | "bio" | "website" | "location";

export function SettingsProfile({ onClose }: Props) {
  const navigate = useNavigate();
  const { profile, updateProfile } = useProfile();
  const { isNativeApp } = useAuraCapabilities();
  const logout = useLogout();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Ensure bio/website/location are loaded even if the Profile app was
  // never opened (init is idempotent).
  useEffect(() => {
    useProfileStore.getState().init();
  }, []);

  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [website, setWebsite] = useState(profile.website);
  const [location, setLocation] = useState(profile.location);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImageSrc, setRawImageSrc] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep local fields in sync when the network profile resolves.
  useEffect(() => { setName(profile.name); }, [profile.name]);
  useEffect(() => { setBio(profile.bio); }, [profile.bio]);
  useEffect(() => { setWebsite(profile.website); }, [profile.website]);
  useEffect(() => { setLocation(profile.location); }, [profile.location]);

  useEffect(() => {
    return () => {
      if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    };
  }, [rawImageSrc]);

  const handleTextChange = useCallback((field: TextField, value: string) => {
    setMessage("");
    if (field === "name") setName(value);
    else if (field === "bio") setBio(value);
    else if (field === "website") setWebsite(value);
    else setLocation(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (field === "name" && !value.trim()) return;
    debounceRef.current = setTimeout(() => {
      const patch: Partial<UserProfileData> =
        field === "name" ? { name: value.trim() } : { [field]: value.trim() };
      updateProfile(patch);
      setMessage("Saved");
    }, 500);
  }, [updateProfile]);

  const handleCropConfirm = useCallback(async (dataUrl: string) => {
    setCropOpen(false);
    setSaving(true);
    setMessage("");
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const url = await uploadFile(blob, "avatar.png", blob.type || "image/png");
      updateProfile({ avatarUrl: url });
      setMessage("Saved");
    } catch {
      setMessage("Failed to upload avatar");
    } finally {
      setSaving(false);
    }
  }, [updateProfile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    const objectUrl = URL.createObjectURL(file);
    setRawImageSrc(objectUrl);
    setCropOpen(true);
    e.target.value = "";
  }, [rawImageSrc]);

  const handleAvatarClick = useCallback(() => {
    if (rawImageSrc) {
      setCropOpen(true);
    } else if (profile.avatarUrl) {
      setRawImageSrc(profile.avatarUrl);
      setCropOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  }, [rawImageSrc, profile.avatarUrl]);

  const handleAvatarRemove = useCallback(() => {
    updateProfile({ avatarUrl: "" });
    if (rawImageSrc) URL.revokeObjectURL(rawImageSrc);
    setRawImageSrc("");
  }, [updateProfile, rawImageSrc]);

  const handleChangeImage = useCallback(() => {
    setCropOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleViewProfile = useCallback(() => {
    onClose?.();
    navigate("/profile");
  }, [onClose, navigate]);

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      // On success the auth store clears the session (user -> null), which
      // routes the app back to login and unmounts this panel with it — no
      // manual close/navigate needed here.
      await deleteAccount();
    } catch {
      setDeleteError("Couldn't delete your account. Please try again.");
      setDeleting(false);
    }
  }, [deleteAccount]);

  return (
    <>
      <h2 className={styles.sectionTitle}>You</h2>

      <div className={styles.profileLinkRow}>
        <Button
          variant="ghost"
          size="sm"
          icon={<ExternalLink size={14} />}
          onClick={handleViewProfile}
        >
          View full profile
        </Button>
      </div>

      <div className={styles.settingsGroupLabel}>Profile</div>
      <div className={styles.settingsGroup}>
        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Avatar</span>
            <span className={styles.rowDescription}>
              The picture shown on your profile and activity
            </span>
          </div>
          <div className={styles.rowControl}>
            <button
              type="button"
              className={styles.avatarUpload}
              onClick={handleAvatarClick}
              aria-label="Upload avatar"
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className={styles.avatarImg} />
              ) : (
                <ImagePlus size={20} className={styles.avatarPlaceholder} />
              )}
              {profile.avatarUrl && (
                <span
                  className={styles.avatarRemove}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAvatarRemove();
                  }}
                >
                  <X size={12} />
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={handleFileSelect}
            />
          </div>
        </div>

        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Name</span>
            <span className={styles.rowDescription}>Your display name</span>
          </div>
          <div className={styles.rowControl}>
            <Input
              size="sm"
              value={name}
              onChange={(e) => handleTextChange("name", e.target.value)}
              placeholder="Your name"
              className={styles.inputWidth200}
            />
          </div>
        </div>

        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Handle</span>
            <span className={styles.rowDescription}>Your unique identifier</span>
          </div>
          <div className={styles.rowControl}>
            <Input
              size="sm"
              value={profile.handle}
              disabled
              placeholder="@handle"
              className={styles.inputWidth200}
            />
          </div>
        </div>

        <div className={`${styles.settingsRow} ${styles.settingsRowFull}`}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Bio</span>
            <span className={styles.rowDescription}>A short description about you</span>
          </div>
          <Textarea
            value={bio}
            onChange={(e) => handleTextChange("bio", e.target.value)}
            placeholder="Tell us about yourself..."
            rows={3}
            className={styles.fullWidthControl}
          />
        </div>

        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Website</span>
            <span className={styles.rowDescription}>A link to your site</span>
          </div>
          <div className={styles.rowControl}>
            <Input
              size="sm"
              value={website}
              onChange={(e) => handleTextChange("website", e.target.value)}
              placeholder="https://example.com"
              className={styles.inputWidth200}
            />
          </div>
        </div>

        <div className={styles.settingsRow}>
          <div className={styles.rowInfo}>
            <span className={styles.rowLabel}>Location</span>
            <span className={styles.rowDescription}>Where you are based</span>
          </div>
          <div className={styles.rowControl}>
            <Input
              size="sm"
              value={location}
              onChange={(e) => handleTextChange("location", e.target.value)}
              placeholder="City, Country"
              className={styles.inputWidth200}
            />
          </div>
        </div>
      </div>
      {(saving || message) && (
        <Text variant="muted" size="sm" className={styles.topMarginSm}>
          {saving ? "Saving..." : message}
        </Text>
      )}

      {/*
        Account deletion is required in-app on iOS (App Store Guideline
        5.1.1(v)). Gated to the native app only — credit purchases are
        likewise native-gated, and web/desktop users manage their account
        elsewhere. `isNativeApp` is true only inside the Capacitor shell.
      */}
      {isNativeApp && (
        <>
          <div className={styles.settingsGroupLabel}>Account</div>
          <div className={styles.settingsGroup}>
            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Log out</span>
                <span className={styles.rowDescription}>
                  Sign out of AURA on this device
                </span>
              </div>
              <div className={styles.rowControl}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<LogOut size={14} />}
                  onClick={() => {
                    void logout();
                  }}
                >
                  Log Out
                </Button>
              </div>
            </div>
            <div className={styles.settingsRow}>
              <div className={styles.rowInfo}>
                <span className={styles.rowLabel}>Delete account</span>
                <span className={styles.rowDescription}>
                  Permanently delete your account and sign out
                </span>
              </div>
              <div className={styles.rowControl}>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                >
                  Delete Account
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <DeleteAccountConfirmModal
        isOpen={deleteOpen}
        onClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        onConfirm={handleDeleteAccount}
        deleting={deleting}
        error={deleteError}
      />

      <ImageCropModal
        isOpen={cropOpen}
        imageSrc={rawImageSrc}
        cropShape="round"
        outputSize={256}
        onConfirm={handleCropConfirm}
        onClose={() => setCropOpen(false)}
        onChangeImage={handleChangeImage}
      />
    </>
  );
}
