/**
 * Calorie & Cortisol screen.
 * Pulls today's calorie/step data from Apple Watch via HealthKit.
 * User can manually add cortisol stress level (not measurable by Watch).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { COLORS, SPACING, FONT } from '../src/theme';
import { healthKit } from '../src/services/healthkit';
import { storage, CalorieLog } from '../src/services/storage';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

type CortisolLevel = 'low' | 'normal' | 'elevated' | 'high';

const CORTISOL_OPTIONS: { value: CortisolLevel; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: COLORS.active },
  { value: 'normal', label: 'Normal', color: COLORS.good },
  { value: 'elevated', label: 'Elevated', color: COLORS.watch },
  { value: 'high', label: 'High', color: COLORS.high },
];

export default function CortisolScreen() {
  const [activeCalories, setActiveCalories] = useState<number>(0);
  const [restingCalories, setRestingCalories] = useState<number>(0);
  const [steps, setSteps] = useState<number>(0);
  const [cortisolLevel, setCortisolLevel] = useState<CortisolLevel>('normal');
  const [logs, setLogs] = useState<CalorieLog[]>([]);
  const [healthKitReady, setHealthKitReady] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadLogs();
    initAndSync();
  }, []);

  async function initAndSync() {
    const ok = await healthKit.initialize();
    setHealthKitReady(ok);
    if (ok) syncFromWatch();
  }

  async function loadLogs() {
    const data = await storage.getCalorieLogs();
    setLogs(data);
  }

  const syncFromWatch = useCallback(async () => {
    if (!healthKit.isAvailable) return;
    setSyncing(true);
    try {
      const vitals = await healthKit.getAllVitals();
      if (vitals.activeCalories !== undefined) setActiveCalories(vitals.activeCalories);
      if (vitals.restingCalories !== undefined) setRestingCalories(vitals.restingCalories);
      if (vitals.steps !== undefined) setSteps(vitals.steps);
    } catch {
      // Silently fail — user can still enter manually
    } finally {
      setSyncing(false);
    }
  }, []);

  function saveLog() {
    const total = activeCalories + restingCalories;
    const log: CalorieLog = {
      id: uid(),
      date: new Date().toLocaleDateString(),
      activeCalories,
      restingCalories,
      totalCalories: total,
      steps,
      cortisolLevel,
      timestamp: new Date().toISOString(),
    };
    storage.saveCalorieLog(log).then(loadLogs);
    Alert.alert('Saved', `Logged ${total} total calories and cortisol level: ${cortisolLevel}`);
  }

  function getCortisolAdvice(level: CortisolLevel): string {
    switch (level) {
      case 'low':
        return 'Low cortisol may indicate adrenal fatigue. Rest well and eat balanced meals.';
      case 'normal':
        return 'Cortisol within healthy range. Keep up your routine.';
      case 'elevated':
        return 'Mildly elevated stress. Try deep breathing, a walk, or reducing caffeine.';
      case 'high':
        return 'High cortisol can affect health long-term. Consider meditation, sleep hygiene, and speaking with a doctor.';
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Calorie &amp; Cortisol</Text>
      <Text style={styles.subtitle}>
        Track energy expenditure from Apple Watch and log perceived stress.
      </Text>

      {/* Sync button */}
      <TouchableOpacity
        style={[styles.syncBtn, !healthKitReady && styles.syncBtnDisabled]}
        onPress={() => {
          if (!healthKitReady) {
            Alert.alert(
              'HealthKit Unavailable',
              Platform.OS === 'ios'
                ? 'Check Apple Health permissions.'
                : 'Apple HealthKit is only available on iOS.',
            );
            return;
          }
          syncFromWatch();
        }}
        disabled={syncing}
        accessibilityLabel="Sync calories from Apple Watch"
        accessibilityRole="button"
      >
        <Text style={styles.syncBtnText}>
          {syncing ? 'Syncing...' : '⌚ Sync from Apple Watch'}
        </Text>
      </TouchableOpacity>

      {/* Today's stats */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Today's Energy</Text>
        <View style={styles.statsRow}>
          <StatBox label="Active" value={`${activeCalories}`} unit="kcal" color={COLORS.active} />
          <StatBox label="Resting" value={`${restingCalories}`} unit="kcal" color={COLORS.textMuted} />
          <StatBox label="Total" value={`${activeCalories + restingCalories}`} unit="kcal" color={COLORS.good} />
        </View>
        <View style={styles.statsRow}>
          <StatBox label="Steps" value={`${steps.toLocaleString()}`} unit="" color={COLORS.activeLight} />
        </View>
      </View>

      {/* Cortisol self-assessment */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Perceived Stress (Cortisol Proxy)</Text>
        <Text style={styles.hint}>
          Apple Watch cannot measure cortisol directly. Select your perceived stress level:
        </Text>
        <View style={styles.cortisolRow}>
          {CORTISOL_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.cortisolBtn,
                cortisolLevel === opt.value && { backgroundColor: opt.color, borderColor: opt.color },
              ]}
              onPress={() => setCortisolLevel(opt.value)}
              accessibilityLabel={`Set cortisol level to ${opt.label}`}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.cortisolBtnText,
                  cortisolLevel === opt.value && { color: COLORS.bg },
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.advice}>{getCortisolAdvice(cortisolLevel)}</Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={saveLog} accessibilityRole="button">
          <Text style={styles.primaryBtnText}>Save Today's Log</Text>
        </TouchableOpacity>
      </View>

      {/* History */}
      {logs.length > 0 && (
        <View style={styles.card}>
          <View style={styles.historyHeader}>
            <Text style={styles.cardTitle}>Recent Logs</Text>
            <TouchableOpacity
              onPress={() => storage.clearCalorieLogs().then(loadLogs)}
              accessibilityRole="button"
            >
              <Text style={styles.deleteAll}>Clear</Text>
            </TouchableOpacity>
          </View>
          {logs.slice(0, 7).map((log) => (
            <View key={log.id} style={styles.logRow}>
              <Text style={styles.logDate}>{log.date}</Text>
              <Text style={styles.logCal}>{log.totalCalories} kcal</Text>
              <Text style={styles.logSteps}>{log.steps.toLocaleString()} steps</Text>
              <View
                style={[
                  styles.logDot,
                  {
                    backgroundColor:
                      CORTISOL_OPTIONS.find((o) => o.value === log.cortisolLevel)?.color ??
                      COLORS.textMuted,
                  },
                ]}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function StatBox({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statUnit}>{unit}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.md, paddingBottom: 80 },
  title: { fontSize: FONT.title, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.xs },
  subtitle: { fontSize: FONT.small, color: COLORS.textMuted, marginBottom: SPACING.lg },
  syncBtn: {
    backgroundColor: '#1d4ed8',
    padding: SPACING.md,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: COLORS.white, fontSize: FONT.regular, fontWeight: '600' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  cardTitle: { fontSize: FONT.heading, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  statsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  statBox: { flex: 1, alignItems: 'center', padding: SPACING.sm },
  statValue: { fontSize: 28, fontWeight: '700' },
  statUnit: { fontSize: FONT.caption, color: COLORS.textMuted },
  statLabel: { fontSize: FONT.caption, color: COLORS.textMuted, marginTop: SPACING.xs },
  hint: { fontSize: FONT.small, color: COLORS.textMuted, marginBottom: SPACING.md },
  cortisolRow: { flexDirection: 'row', gap: SPACING.xs, marginBottom: SPACING.md },
  cortisolBtn: {
    flex: 1,
    padding: SPACING.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: 'center',
  },
  cortisolBtnText: { color: COLORS.text, fontSize: FONT.caption, fontWeight: '600' },
  advice: { fontSize: FONT.small, color: COLORS.activeLight, marginBottom: SPACING.md, fontStyle: 'italic' },
  primaryBtn: {
    backgroundColor: COLORS.active,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: FONT.regular },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deleteAll: { color: COLORS.high, fontSize: FONT.small },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.cardBorder,
    gap: SPACING.sm,
  },
  logDate: { color: COLORS.textMuted, fontSize: FONT.small, width: 80 },
  logCal: { color: COLORS.text, fontSize: FONT.small, flex: 1 },
  logSteps: { color: COLORS.textMuted, fontSize: FONT.small },
  logDot: { width: 10, height: 10, borderRadius: 5 },
});
