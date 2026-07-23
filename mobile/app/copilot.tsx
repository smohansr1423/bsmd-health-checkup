/**
 * API Copilot screen — mock offline AI assistant.
 * Simulates an API documentation helper with pre-canned responses.
 * Runs entirely offline, no LLM or network calls.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { COLORS, SPACING, FONT } from '../src/theme';
import { storage, CopilotMessage } from '../src/services/storage';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Mock response engine — pattern matches user input to canned answers. */
function generateResponse(input: string): string {
  const lower = input.toLowerCase();

  if (lower.includes('blood pressure') || lower.includes('bp')) {
    return 'The Health Checkup API accepts systolic and diastolic values in mmHg. Normal range: systolic 90-120, diastolic 60-80. Values above 140/90 are flagged as high (stage 2).';
  }
  if (lower.includes('heart rate') || lower.includes('bpm')) {
    return 'Heart rate is measured in beats per minute (bpm). The assessment flags >100 bpm as tachycardia and <50 bpm as bradycardia. Apple Watch provides resting heart rate via HealthKit.';
  }
  if (lower.includes('glucose') || lower.includes('diabetes') || lower.includes('sugar')) {
    return 'Fasting glucose is measured in mg/dL. Normal: <100, Pre-diabetic: 100-125, Diabetic: ≥126. HealthKit can read glucose from paired CGM devices.';
  }
  if (lower.includes('bmi') || lower.includes('weight') || lower.includes('height')) {
    return 'BMI = weight(kg) / height(m)². Categories: <18.5 Underweight, 18.5-24.9 Normal, 25-29.9 Overweight, ≥30 Obese. Weight and height sync from Apple Health.';
  }
  if (lower.includes('calorie') || lower.includes('energy')) {
    return 'Calories are split into Active (exercise) and Resting (basal metabolic rate). Apple Watch tracks both via ActiveEnergyBurned and BasalEnergyBurned HealthKit types.';
  }
  if (lower.includes('cortisol') || lower.includes('stress')) {
    return 'Cortisol cannot be directly measured by Apple Watch. The app uses a self-reported 4-level scale (Low/Normal/Elevated/High) as a proxy for perceived stress.';
  }
  if (lower.includes('healthkit') || lower.includes('apple watch') || lower.includes('watch')) {
    return 'HealthKit integration reads: HeartRate, BloodPressureSystolic/Diastolic, Weight, Height, BloodGlucose, ActiveEnergyBurned, BasalEnergyBurned, and StepCount. Requires iOS and user permission.';
  }
  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('rest')) {
    return 'This demo runs fully offline — no REST API backend exists. The "API Copilot" simulates answering documentation questions about the health assessment logic and HealthKit integration.';
  }
  if (lower.includes('offline') || lower.includes('data') || lower.includes('storage')) {
    return 'All data is stored locally using AsyncStorage. Records persist across app restarts. No data leaves the device. Storage keys: health-suite:checkups, health-suite:calorie-logs, health-suite:copilot-history.';
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return 'Hello! I\'m the Health Suite API Copilot. Ask me about blood pressure thresholds, heart rate, glucose levels, BMI calculation, calorie tracking, HealthKit integration, or how the offline storage works.';
  }
  if (lower.includes('help')) {
    return 'I can answer questions about:\n• Blood pressure / heart rate assessment\n• Glucose & BMI thresholds\n• Calorie & step tracking\n• Cortisol/stress monitoring\n• Apple Watch / HealthKit integration\n• Offline data storage\n\nJust type your question!';
  }

  return 'I can help with questions about the Health Suite APIs: blood pressure, heart rate, glucose, BMI, calories, cortisol, HealthKit integration, and offline storage. Try asking about one of these topics!';
}

export default function CopilotScreen() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const history = await storage.getCopilotHistory();
    if (history.length === 0) {
      // Show welcome message
      const welcome: CopilotMessage = {
        id: uid(),
        role: 'assistant',
        content:
          'Welcome to API Copilot! I\'m an offline assistant that answers questions about the Health Suite system — assessment logic, HealthKit integration, data storage, and more. Type "help" to see topics.',
        timestamp: new Date().toISOString(),
      };
      setMessages([welcome]);
      storage.saveCopilotMessage(welcome);
    } else {
      setMessages(history);
    }
  }

  function sendMessage() {
    const text = input.trim();
    if (!text) return;

    const userMsg: CopilotMessage = {
      id: uid(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    const assistantMsg: CopilotMessage = {
      id: uid(),
      role: 'assistant',
      content: generateResponse(text),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    storage.saveCopilotMessage(userMsg);
    storage.saveCopilotMessage(assistantMsg);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.title}>API Copilot</Text>
        <TouchableOpacity
          onPress={() => {
            storage.clearCopilotHistory();
            setMessages([]);
            loadHistory();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.clearBtn}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                msg.role === 'user' ? styles.userText : styles.assistantText,
              ]}
            >
              {msg.content}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about the Health Suite API..."
          placeholderTextColor={COLORS.textMuted}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
          accessibilityLabel="Message input"
        />
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={sendMessage}
          disabled={!input.trim()}
          accessibilityLabel="Send message"
          accessibilityRole="button"
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  title: { fontSize: FONT.heading, fontWeight: '700', color: COLORS.text },
  clearBtn: { color: COLORS.high, fontSize: FONT.small },
  chatArea: { flex: 1 },
  chatContent: { padding: SPACING.md, paddingBottom: SPACING.lg },
  bubble: {
    maxWidth: '85%',
    padding: SPACING.md,
    borderRadius: 16,
    marginBottom: SPACING.sm,
  },
  userBubble: {
    backgroundColor: '#1d4ed8',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: COLORS.card,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  bubbleText: { fontSize: FONT.regular, lineHeight: 22 },
  userText: { color: COLORS.white },
  assistantText: { color: COLORS.text },
  inputRow: {
    flexDirection: 'row',
    padding: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    backgroundColor: COLORS.card,
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.text,
    fontSize: FONT.regular,
  },
  sendBtn: {
    backgroundColor: COLORS.active,
    paddingHorizontal: SPACING.lg,
    borderRadius: 20,
    justifyContent: 'center',
  },
  sendBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: FONT.regular },
});
