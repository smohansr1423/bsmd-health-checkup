/**
 * ProfileScreen — Displays and allows editing of senior citizen profile data.
 * Shows name, DOB, contact, emergency contact, medical history, assigned physician,
 * next appointment, and current checkup package.
 *
 * Accessibility: All interactive elements have accessibilityLabel, accessibilityHint,
 * and accessibilityRole. Dynamic text scaling to 200% supported without truncation
 * of critical information.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 10.4, 10.5, 12.3
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAccessibility } from '../../hooks/useAccessibility';
import { useAuthStore } from '../../stores/authStore';
import { useProfileStore } from '../../stores/profileStore';

// ─── ProfileScreen ───────────────────────────────────────────────────────────

export function ProfileScreen() {
  const { theme, getTextSize, minTouchTarget, announce } = useAccessibility();
  const user = useAuthStore((state) => state.user);
  const seniorId = user?.seniorId ?? '';

  const {
    profile,
    isLoading,
    isUpdating: isSaving,
    validationErrors,
    updateSuccess: saveSuccess,
    fetchProfile,
    updateProfile,
    clearUpdateStatus: clearStatus,
  } = useProfileStore();

  const [editMode, setEditMode] = useState(false);
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [address, setAddress] = useState('');
  const error = validationErrors.length > 0
    ? validationErrors.map(e => e.message).join('. ')
    : null;

  const bodySize = getTextSize('body');
  const headingSize = getTextSize('heading');

  // Fetch profile on mount
  useEffect(() => {
    if (seniorId) {
      fetchProfile(seniorId);
    }
  }, [seniorId, fetchProfile]);

  // Sync editable fields when profile loads
  useEffect(() => {
    if (profile) {
      setContactNumber(profile.contactNumber ?? '');
      setEmail(profile.email ?? '');
      setEmergencyContact(
        profile.emergencyContact
          ? `${profile.emergencyContact.name} (${profile.emergencyContact.phone})`
          : ''
      );
      setAddress(profile.address ?? '');
    }
  }, [profile]);

  // Announce save success
  useEffect(() => {
    if (saveSuccess) {
      announce('Profile updated successfully', 'polite');
      setEditMode(false);
      const timeout = setTimeout(() => clearStatus(), 3000);
      return () => clearTimeout(timeout);
    }
  }, [saveSuccess, announce, clearStatus]);

  // Announce errors
  useEffect(() => {
    if (error) {
      announce(`Error: ${error}`, 'assertive');
    }
  }, [error, announce]);

  const handleEdit = useCallback(() => {
    setEditMode(true);
    announce('Edit mode activated. You can now modify your contact information.', 'polite');
  }, [announce]);

  const handleCancel = useCallback(() => {
    setEditMode(false);
    if (profile) {
      setContactNumber(profile.contactNumber ?? '');
      setEmail(profile.email ?? '');
      setEmergencyContact(
        profile.emergencyContact
          ? `${profile.emergencyContact.name} (${profile.emergencyContact.phone})`
          : ''
      );
      setAddress(profile.address ?? '');
    }
    announce('Edit mode cancelled. Changes discarded.', 'polite');
  }, [profile, announce]);

  const handleSave = useCallback(async () => {
    Keyboard.dismiss();
    if (!seniorId) return;
    await updateProfile(seniorId, {
      contactNumber,
      email,
      address,
    });
  }, [seniorId, contactNumber, email, address, updateProfile]);

  // Loading state
  if (isLoading && !profile) {
    return (
      <View
        style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}
        accessibilityLabel="Loading profile"
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text
          style={[styles.loadingText, { fontSize: bodySize, color: theme.colors.text }]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          Loading profile…
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Profile information"
      >
        {/* Screen heading */}
        <Text
          style={[styles.heading, { fontSize: headingSize, color: theme.colors.text }]}
          accessibilityRole="header"
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          My Profile
        </Text>

        {/* Error banner */}
        {error && (
          <View
            style={[styles.errorBanner, { borderColor: theme.colors.error }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            accessibilityLabel={`Error: ${error}`}
          >
            <Text
              style={[styles.errorText, { fontSize: bodySize, color: theme.colors.error }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {error}
            </Text>
          </View>
        )}

        {/* Success banner */}
        {saveSuccess && (
          <View
            style={styles.successBanner}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel="Profile updated successfully"
          >
            <Text
              style={[styles.successText, { fontSize: bodySize, color: theme.colors.success }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Profile updated successfully.
            </Text>
          </View>
        )}

        {profile && (
          <>
            {/* Read-only fields */}
            <ProfileField
              label="Name"
              value={`${profile.firstName} ${profile.lastName}`}
              bodySize={bodySize}
              theme={theme}
            />
            <ProfileField
              label="Date of Birth"
              value={profile.dateOfBirth ?? 'N/A'}
              bodySize={bodySize}
              theme={theme}
            />
            <ProfileField
              label="Assigned Physician"
              value={profile.assignedPhysician?.name ?? 'N/A'}
              bodySize={bodySize}
              theme={theme}
            />
            <ProfileField
              label="Checkup Package"
              value={profile.checkupPackage?.name ?? 'N/A'}
              bodySize={bodySize}
              theme={theme}
            />

            {/* Editable fields */}
            {editMode ? (
              <>
                <EditableField
                  label="Contact Number"
                  value={contactNumber}
                  onChangeText={setContactNumber}
                  placeholder="Enter contact number"
                  keyboardType="phone-pad"
                  bodySize={bodySize}
                  theme={theme}
                  minTouchTarget={minTouchTarget}
                  disabled={isSaving}
                />
                <EditableField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter email address"
                  keyboardType="email-address"
                  bodySize={bodySize}
                  theme={theme}
                  minTouchTarget={minTouchTarget}
                  disabled={isSaving}
                />
                <EditableField
                  label="Emergency Contact"
                  value={emergencyContact}
                  onChangeText={setEmergencyContact}
                  placeholder="Enter emergency contact"
                  keyboardType="phone-pad"
                  bodySize={bodySize}
                  theme={theme}
                  minTouchTarget={minTouchTarget}
                  disabled={isSaving}
                />
                <EditableField
                  label="Address"
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Enter address"
                  keyboardType="default"
                  bodySize={bodySize}
                  theme={theme}
                  minTouchTarget={minTouchTarget}
                  disabled={isSaving}
                  multiline
                />

                {/* Save / Cancel buttons */}
                <View style={styles.buttonRow}>
                  <Pressable
                    style={[
                      styles.button,
                      styles.cancelButton,
                      { minHeight: minTouchTarget.height, minWidth: minTouchTarget.width },
                    ]}
                    onPress={handleCancel}
                    disabled={isSaving}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing"
                    accessibilityHint="Discards changes and exits edit mode"
                    accessibilityState={{ disabled: isSaving }}
                  >
                    <Text
                      style={[styles.cancelButtonText, { fontSize: bodySize, color: theme.colors.text }]}
                      allowFontScaling={true}
                      maxFontSizeMultiplier={2}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.button,
                      styles.saveButton,
                      { minHeight: minTouchTarget.height, minWidth: minTouchTarget.width, backgroundColor: theme.colors.primary },
                    ]}
                    onPress={handleSave}
                    disabled={isSaving}
                    accessibilityRole="button"
                    accessibilityLabel={isSaving ? 'Saving profile changes' : 'Save profile changes'}
                    accessibilityHint="Saves your updated contact information"
                    accessibilityState={{ disabled: isSaving, busy: isSaving }}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text
                        style={[styles.saveButtonText, { fontSize: bodySize }]}
                        allowFontScaling={true}
                        maxFontSizeMultiplier={2}
                      >
                        Save
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <ProfileField
                  label="Contact Number"
                  value={contactNumber || 'Not provided'}
                  bodySize={bodySize}
                  theme={theme}
                />
                <ProfileField
                  label="Email"
                  value={email || 'Not provided'}
                  bodySize={bodySize}
                  theme={theme}
                />
                <ProfileField
                  label="Emergency Contact"
                  value={emergencyContact || 'Not provided'}
                  bodySize={bodySize}
                  theme={theme}
                />
                <ProfileField
                  label="Address"
                  value={address || 'Not provided'}
                  bodySize={bodySize}
                  theme={theme}
                />

                {/* Edit button */}
                <Pressable
                  style={[
                    styles.editButton,
                    { minHeight: minTouchTarget.height, minWidth: minTouchTarget.width, backgroundColor: theme.colors.primary },
                  ]}
                  onPress={handleEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile"
                  accessibilityHint="Allows you to modify your contact information"
                >
                  <Text
                    style={[styles.editButtonText, { fontSize: bodySize }]}
                    allowFontScaling={true}
                    maxFontSizeMultiplier={2}
                  >
                    Edit Profile
                  </Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface ProfileFieldProps {
  label: string;
  value: string;
  bodySize: number;
  theme: ReturnType<typeof import('../../hooks/useAccessibility').useAccessibility>['theme'];
}

function ProfileField({ label, value, bodySize, theme }: ProfileFieldProps) {
  return (
    <View
      style={styles.fieldContainer}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="text"
    >
      <Text
        style={[styles.fieldLabel, { fontSize: bodySize - 2, color: theme.colors.textSecondary }]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {label}
      </Text>
      <Text
        style={[styles.fieldValue, { fontSize: bodySize, color: theme.colors.text }]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {value}
      </Text>
    </View>
  );
}

interface EditableFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType: 'default' | 'phone-pad' | 'email-address';
  bodySize: number;
  theme: ReturnType<typeof import('../../hooks/useAccessibility').useAccessibility>['theme'];
  minTouchTarget: { width: number; height: number };
  disabled: boolean;
  multiline?: boolean;
}

function EditableField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  bodySize,
  theme,
  minTouchTarget,
  disabled,
  multiline,
}: EditableFieldProps) {
  const nativeId = `profile-${label.toLowerCase().replace(/\s+/g, '-')}-label`;

  return (
    <View style={styles.fieldContainer}>
      <Text
        style={[styles.fieldLabel, { fontSize: bodySize - 2, color: theme.colors.textSecondary }]}
        nativeID={nativeId}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {label}
      </Text>
      <TextInput
        style={[
          styles.textInput,
          {
            fontSize: bodySize,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            minHeight: minTouchTarget.height,
          },
          multiline && styles.textInputMultiline,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textSecondary}
        keyboardType={keyboardType}
        editable={!disabled}
        multiline={multiline}
        accessibilityLabel={`${label} input`}
        accessibilityHint={`Enter your ${label.toLowerCase()}`}
        accessibilityLabelledBy={nativeId}
        accessibilityState={{ disabled }}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
  },
  heading: {
    fontWeight: '700',
    marginBottom: 24,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    textAlign: 'center',
  },
  successBanner: {
    padding: 12,
    marginBottom: 16,
  },
  successText: {
    textAlign: 'center',
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontWeight: '500',
    marginBottom: 4,
  },
  fieldValue: {
    fontWeight: '400',
  },
  textInput: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  editButton: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 24,
  },
  editButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cancelButton: {
    borderWidth: 1.5,
    borderColor: '#BDBDBD',
  },
  cancelButtonText: {
    fontWeight: '600',
  },
  saveButton: {
    // backgroundColor set dynamically
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
