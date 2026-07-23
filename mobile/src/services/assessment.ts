/**
 * Pure, local health-assessment logic — ported from the desktop demo.
 * No network, no backend. Simplified thresholds for demo purposes only.
 * NOT medical advice.
 */

export interface Finding {
  label: string;
  level: 'good' | 'watch' | 'high';
  metric: string;
  value?: number;
}

export interface AssessmentResult {
  overall: { level: string; label: string };
  findings: Finding[];
  recommendations: string[];
}

export interface Vitals {
  systolic: number;
  diastolic: number;
  heartRate: number;
  glucose: number;
  weight: number;
  height: number;
}

export function assessBloodPressure(systolic: number, diastolic: number): Finding {
  if (systolic >= 180 || diastolic >= 120) {
    return { label: 'Hypertensive crisis', level: 'high', metric: 'Blood pressure' };
  }
  if (systolic >= 140 || diastolic >= 90) {
    return { label: 'High (stage 2)', level: 'high', metric: 'Blood pressure' };
  }
  if (systolic >= 130 || diastolic >= 80) {
    return { label: 'Elevated (stage 1)', level: 'watch', metric: 'Blood pressure' };
  }
  if (systolic < 90 || diastolic < 60) {
    return { label: 'Low', level: 'watch', metric: 'Blood pressure' };
  }
  return { label: 'Normal', level: 'good', metric: 'Blood pressure' };
}

export function assessHeartRate(bpm: number): Finding {
  if (bpm > 100) {
    return { label: 'Elevated (tachycardia)', level: 'watch', metric: 'Heart rate' };
  }
  if (bpm < 50) {
    return { label: 'Low (bradycardia)', level: 'watch', metric: 'Heart rate' };
  }
  return { label: 'Normal', level: 'good', metric: 'Heart rate' };
}

export function assessGlucose(mgdl: number): Finding {
  if (mgdl >= 126) {
    return { label: 'Diabetic range', level: 'high', metric: 'Fasting glucose' };
  }
  if (mgdl >= 100) {
    return { label: 'Pre-diabetic range', level: 'watch', metric: 'Fasting glucose' };
  }
  if (mgdl < 70) {
    return { label: 'Low', level: 'watch', metric: 'Fasting glucose' };
  }
  return { label: 'Normal', level: 'good', metric: 'Fasting glucose' };
}

export function assessBmi(weightKg: number, heightCm: number): Finding {
  const meters = heightCm / 100;
  const bmi = meters > 0 ? weightKg / (meters * meters) : 0;
  const rounded = Math.round(bmi * 10) / 10;
  let label = 'Normal';
  let level: 'good' | 'watch' | 'high' = 'good';
  if (bmi >= 30) {
    label = 'Obese';
    level = 'high';
  } else if (bmi >= 25) {
    label = 'Overweight';
    level = 'watch';
  } else if (bmi < 18.5) {
    label = 'Underweight';
    level = 'watch';
  }
  return { label, level, metric: 'BMI', value: rounded };
}

const LEVEL_SCORE: Record<string, number> = { good: 0, watch: 1, high: 2 };

function overallStatus(findings: Finding[]): { level: string; label: string } {
  const worst = findings.reduce(
    (max, f) => Math.max(max, LEVEL_SCORE[f.level] ?? 0),
    0,
  );
  if (worst >= 2) return { level: 'high', label: 'Attention needed' };
  if (worst === 1) return { level: 'watch', label: 'Monitor' };
  return { level: 'good', label: 'Healthy' };
}

function buildRecommendations(findings: Finding[]): string[] {
  const tips: string[] = [];
  for (const f of findings) {
    if (f.level === 'good') continue;
    switch (f.metric) {
      case 'Blood pressure':
        tips.push('Reduce salt intake and recheck blood pressure with a clinician.');
        break;
      case 'Heart rate':
        tips.push('Discuss the resting heart rate reading with a physician.');
        break;
      case 'Fasting glucose':
        tips.push('Review diet and screen for diabetes with a fasting blood test.');
        break;
      case 'BMI':
        tips.push('Consider a nutrition and light-activity plan appropriate for seniors.');
        break;
    }
  }
  if (tips.length === 0) {
    tips.push('All key readings are within normal ranges. Keep up regular checkups.');
  }
  return tips;
}

/** Run the full assessment for one set of vitals. */
export function assess(vitals: Vitals): AssessmentResult {
  const findings: Finding[] = [
    assessBloodPressure(vitals.systolic, vitals.diastolic),
    assessHeartRate(vitals.heartRate),
    assessGlucose(vitals.glucose),
    assessBmi(vitals.weight, vitals.height),
  ];
  return {
    overall: overallStatus(findings),
    findings,
    recommendations: buildRecommendations(findings),
  };
}
