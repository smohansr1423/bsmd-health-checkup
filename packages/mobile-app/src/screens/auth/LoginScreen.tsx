/**
 * LoginScreen — Email/password authentication screen.
 * Integrates with the auth store for login and uses the accessibility engine
 * for WCAG-compliant touch targets, text sizes, and screen reader announcements.
 *
 * Requirements: 1.1, 10.1, 10.2, 10.4
 */
import React, { useCallback, useRef, useState } from 'react';
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

// ─── Validation Helpers ──────────────────────────────────────────────────────

function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email is required';
  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) return 'Please enter a valid email address';
  return null;
}

function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LoginScreen() {
  const { theme, minTouchTarget, getTextSize, announce } = useAccessibility();
  const login = useAuthStore((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const passwordInputRef = useRef<TextInput>(null);

  const bodySize = getTextSize('body');
  const headingSize = getTextSize('heading');

  const handleSubmit = useCallback(async () => {
    Keyboard.dismiss();

    // Clear previous errors
    setEmailError(null);
    setPasswordError(null);
    setAuthError(null);

    // Validate fields
    const emailErr = validateEmail(email);
    const passwordErr = validatePassword(password);

    if (emailErr || passwordErr) {
      setEmailError(emailErr);
      setPasswordError(passwordErr);

      // Announce validation errors to screen readers
      const errorMessages = [emailErr, passwordErr].filter(Boolean).join('. ');
      announce(errorMessages, 'assertive');
      return;
    }

    setIsLoading(true);

    try {
      await login(email.trim(), password);
      // On success, the auth gate in RootStackNavigator automatically
      // navigates to the main tab navigator when isAuthenticated becomes true.
    } catch (error: unknown) {
      let message = 'Login failed. Please check your credentials and try again.';

      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { data?: { message?: string }; status?: number } };
        if (axiosError.response?.data?.message) {
          message = axiosError.response.data.message;
        } else if (axiosError.response?.status === 401) {
          message = 'Invalid email or password.';
        } else if (axiosError.response?.status === 429) {
          message = 'Too many login attempts. Please try again later.';
        }
      } else if (error && typeof error === 'object' && 'message' in error) {
        const genericError = error as { message: string };
        if (genericError.message.includes('Network Error') || genericError.message.includes('timeout')) {
          message = 'Unable to connect. Please check your internet connection.';
        }
      }

      setAuthError(message);
      // Announce error to screen readers
      announce(message, 'assertive');
    } finally {
      setIsLoading(false);
    }
  }, [email, password, login, announce]);

  // ─── Dynamic Styles ──────────────────────────────────────────────────────

  const dynamicStyles = StyleSheet.create({
    heading: {
      fontSize: headingSize,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: theme.spacing.lg,
      textAlign: 'center',
    },
    label: {
      fontSize: bodySize,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    input: {
      fontSize: bodySize,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.borderWidth.medium,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      minHeight: minTouchTarget.height,
    },
    inputError: {
      borderColor: theme.colors.error,
      borderWidth: theme.borderWidth.thick,
    },
    errorText: {
      fontSize: bodySize - 2,
      color: theme.colors.error,
      marginTop: theme.spacing.xs,
    },
    authErrorContainer: {
      backgroundColor: theme.colors.statusCriticalBg,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
      borderWidth: theme.borderWidth.thin,
      borderColor: theme.colors.error,
    },
    authErrorText: {
      fontSize: bodySize,
      color: theme.colors.statusCriticalText,
      textAlign: 'center',
    },
    submitButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.md,
      minWidth: minTouchTarget.width,
      minHeight: minTouchTarget.height,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.lg,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      fontSize: bodySize,
      fontWeight: 'bold',
      color: '#FFFFFF',
    },
  });

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContainer}>
          {/* Screen heading */}
          <Text
            style={dynamicStyles.heading}
            accessibilityRole="header"
            accessibilityLabel="Login to BSMD Health App"
          >
            Login
          </Text>

          {/* Backend auth error */}
          {authError && (
            <View
              style={dynamicStyles.authErrorContainer}
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={`Error: ${authError}`}
            >
              <Text style={dynamicStyles.authErrorText}>{authError}</Text>
            </View>
          )}

          {/* Email field */}
          <View style={styles.fieldContainer}>
            <Text
              style={dynamicStyles.label}
              nativeID="email-label"
              accessibilityRole="text"
            >
              Email
            </Text>
            <TextInput
              style={[
                dynamicStyles.input,
                emailError ? dynamicStyles.inputError : null,
              ]}
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (emailError) setEmailError(null);
              }}
              placeholder="Enter your email address"
              placeholderTextColor={theme.colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              editable={!isLoading}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              accessibilityLabel="Email address input"
              accessibilityHint="Enter your registered email address"
              accessibilityLabelledBy="email-label"
              accessibilityState={{ disabled: isLoading }}
            />
            {emailError && (
              <Text
                style={dynamicStyles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Email error: ${emailError}`}
              >
                {emailError}
              </Text>
            )}
          </View>

          {/* Password field */}
          <View style={styles.fieldContainer}>
            <Text
              style={dynamicStyles.label}
              nativeID="password-label"
              accessibilityRole="text"
            >
              Password
            </Text>
            <TextInput
              ref={passwordInputRef}
              style={[
                dynamicStyles.input,
                passwordError ? dynamicStyles.inputError : null,
              ]}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (passwordError) setPasswordError(null);
              }}
              placeholder="Enter your password"
              placeholderTextColor={theme.colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              editable={!isLoading}
              onSubmitEditing={handleSubmit}
              accessibilityLabel="Password input"
              accessibilityHint="Enter your account password"
              accessibilityLabelledBy="password-label"
              accessibilityState={{ disabled: isLoading }}
            />
            {passwordError && (
              <Text
                style={dynamicStyles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Password error: ${passwordError}`}
              >
                {passwordError}
              </Text>
            )}
          </View>

          {/* Submit button */}
          <Pressable
            style={[
              dynamicStyles.submitButton,
              isLoading && dynamicStyles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={isLoading ? 'Logging in, please wait' : 'Log in'}
            accessibilityHint="Tap to log in with your email and password"
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={dynamicStyles.submitButtonText}>Log In</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Static Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  fieldContainer: {
    marginBottom: 16,
  },
});
