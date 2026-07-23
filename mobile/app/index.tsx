/**
 * Health Checkup screen — main tab.
 * Allows manual entry of vitals or auto-fill from Apple Watch via HealthKit.
 * Runs assessment locally and saves results offline.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { COLORS, SPACING, FONT } from '../src/theme';
import { healthKit } from '../src/services/healthkit';
import { assess, AssessmentResult } from '../src/services/assessment';
import { storage, CheckupRecord } from '../src/services/storage';

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function HealthCheckupScreen() {
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [glucose, setGlucose] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');

  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [records, setRecords] = useState<CheckupRecord[]>([]);
  const [healthKitReady, setHealthKitReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadRecords();
    initHealthKit();
  }, []);

  async function initHealthKit() {
    const ok = await healthKit.initialize();
    setHealthKitReady(ok);
  }

  async function loadRecords() {
    const data = await storage.getCheckups();
    setRecords(data);
  }

  const fillFromWatch = useCallback(async () => {
    if (!healthKitReady) {
      Alert.alert(
        'HealthKit Unavailable',
        Platform.OS === 'ios'
          ? 'Could not connect to Apple Health. Check permissions in Settings > Health.'
          : 'Apple HealthKit is only available on iOS devices.',
      );
      return;
    }
    setLoading(true);
    try {
      const vitals = await healthKit.getAllVitals();
      if (vitals.heartRate) setHeartRate(String(vitals.heartRate));
      if (vitals.systolic) setSystolic(String(vitals.systolic));
      if (vitals.diastolic) setDiastolic(String(vitals.diastolic));
      if (vitals.weight) setWeight(String(vitals.weight));
      if (vitals.height) setHeight(String(vitals.height));
      if (vitals.glucose) setGlucose(String(vitals.glucose));
      Alert.alert('Synced', 'Vitals pulled from Apple Health / Watch.');
    } catch {
      Alert.alert('Error', 'Failed to read HealthKit data.');
    } finally {
      setLoading(false);
    }
  }, [healthKitReady]);

  function runAssessment() {
    const v = {
      systolic: Number(systolic),
      diastolic: Number(diastolic),
      heartRate: Number(heartRate),
      glucose: Number(glucose),
      weight: Number(weight),
      height: Number(height),
    };
    if (!name.trim() || !age || Object.values(v).some((n) => isNaN(n) || n <= 0)) {
      Alert.alert('Missing data', 'Please fill in all fields before assessing.');
      return;
    }
    const assessment = assess(v);
    setResult(assessment);

    const record: CheckupRecord = {
      id: uid(),
      name: name.trim(),
      age: Number(age),
      ...v,
      overall: assessment.overall,
      findings: assessment.findings,
      recommendations: assessment.recommendations,
      timestamp: new Date().toISOString(),
    };
    storage.saveCheckup(record).then(loadRecords);
  }

  function clearForm() {
    setName('');
    setAge('');
    setSystolic('');
    setDiastolic('');
    setHeartRate('');
    setGlucose('');
    setWeight('');
    setHeight('');
    setResult(null);
  }

  function levelColor(level: string): string {
    if (level === 'good') return COLORS.good;
    if (level === 'watch') return COLORS.watch;
    return COLORS.high;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Senior Health Checkup</Text>
      <Text style={styles.subtitle}>
        Enter vitals or sync from Apple Watch. Runs fully offline.
      </Text>

      {/* Apple Watch sync button */}
      <TouchableOpacity
        style={[styles.syncBtn, !healthKitReady && styles.syncBtnDisabled]}
        onPress={fillFromWatch}
        disabled={loading}
        accessibilityLabel="Sync vitals from Apple Watch"
        accessibilityRole="button"
      >
        <Text style={styles.syncBtnText}>
          {loading ? 'Syncing...' : '⌚ Fill from Apple Watch'}
        </Text>
      </TouchableOpacity>

      {/* Input form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New Checkup</Text>
        <View style={styles.row}>
          <Input label="Full name" value={name} onChangeText={setName} flex={2} />
          <Input label="Age" value={age} onChangeText={setAge} keyboardType="numeric" />
        </View>
        <View style={styles.row}>
          <Input label="Systolic BP" value={systolic} onChangeText={setSystolic} keyboardType="numeric" />
          <Input label="Diastolic BP" value={diastolic} onChangeText={setDiastolic} keyboardType="numeric" />
        </View>
        <View style={styles.row}>
          <Input label="Heart rate (bpm)" value={heartRate} onChangeText={setHeartRate} keyboardType="numeric" />
          <Input label="Glucose (mg/dL)" value={glucose} onChangeText={setGlucose} keyboardType="numeric" />
        </View>
        <View style={styles.row}>
          <Input label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" />
          <Input label="Height (cm)" value={height} onChangeText={setHeight} keyboardType="numeric" />
        </View>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.primaryBtn} onPress={runAssessment} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>Assess &amp; Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={clearForm} accessibilityRole="button">
            <Text style={styles.secondaryBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Result */}
      {result && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Assessment Result</Text>
          <View style={[styles.badge, { backgroundColor: levelColor(result.overall.level) }]}>
            <Text style={styles.badgeText}>{result.overall.label}</Text>
          </View>
          {result.findings.map((f, i) => (
            <View key={i} style={styles.findingRow}>
              <View style={[styles.dot, { backgroundColor: levelColor(f.level) }]} />
              <Text style={styles.findingText}>
                {f.metric}: {f.label}
                {f.value !== undefined ? ` (${f.value})` : ''}
              </Text>
            </View>
          ))}
          <Text style={styles.recTitle}>Recommendations</Text>
          {result.recommendations.map((r, i) => (
            <Text key={i} style={styles.recText}>• {r}</Text>
          ))}
        </View>
      )}

      {/* Saved records */}
      {records.length > 0 && (
        <View style={styles.card}>
          <View style={styles.historyHeader}>
            <Text style={styles.cardTitle}>Saved Checkups</Text>
            <TouchableOpacity
              onPress={() => {
                storage.clearCheckups().then(loadRecords);
                setResult(null);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.deleteAll}>Delete all</Text>
            </TouchableOpacity>
          </View>
          {records.slice(0, 10).map((rec) => (
            <View key={rec.id} style={styles.recordRow}>
              <View style={[styles.dot, { backgroundColor: levelColor(rec.overall.level) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.recordName}>{rec.name}, {rec.age}</Text>
                <Text style={styles.recordDate}>
                  {new Date(rec.timestamp).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[styles.recordStatus, { color: levelColor(rec.overall.level) }]}>
                {rec.overall.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Input({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
  flex = 1,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'numeric';
  flex?: number;
}) {
  return (
    <View style={[styles.inputWrap, { flex }]}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel={label}
      />
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
  row: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  inputWrap: { flex: 1 },
  inputLabel: { fontSize: FONT.caption, color: COLORS.textMuted, marginBottom: SPACING.xs },
  input: {
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    padding: SPACING.sm,
    color: COLORS.text,
    fontSize: FONT.regular,
  },
  btnRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  primaryBtn: {
    flex: 1,
    backgroundColor: COLORS.active,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.bg, fontWeight: '700', fontSize: FONT.regular },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: COLORS.textMuted, fontSize: FONT.regular },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 20,
    marginBottom: SPACING.md,
  },
  badgeText: { color: COLORS.bg, fontWeight: '700', fontSize: FONT.small },
  findingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.xs },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: SPACING.sm },
  findingText: { color: COLORS.text, fontSize: FONT.regular },
  recTitle: { fontSize: FONT.regular, fontWeight: '600', color: COLORS.text, marginTop: SPACING.md, marginBottom: SPACING.xs },
  recText: { color: COLORS.textMuted, fontSize: FONT.small, marginBottom: SPACING.xs },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deleteAll: { color: COLORS.high, fontSize: FONT.small },
  recordRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  recordName: { color: COLORS.text, fontSize: FONT.regular },
  recordDate: { color: COLORS.textMuted, fontSize: FONT.caption },
  recordStatus: { fontSize: FONT.small, fontWeight: '600' },
});
