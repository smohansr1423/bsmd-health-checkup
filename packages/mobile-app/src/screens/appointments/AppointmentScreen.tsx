/**
 * AppointmentScreen — Displays appointments sorted by date with a visual timeline
 * separating upcoming from past appointments.
 *
 * Features:
 * - Fetches appointments from Backend API
 * - Visual timeline separating upcoming from past appointments
 * - Displays date/time, physician name, package name, status for each appointment
 * - On tap, displays full details: location, preparation instructions, associated tests
 * - Shows empty state with prompt to contact provider when no appointments
 * - Offline banner when serving cached data
 * - Pull-to-refresh support
 * - Auto-refresh on network reconnection
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 12.3
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuthStore } from '../../stores/authStore';
import {
  useAppointmentStore,
  AppointmentItem,
  AppointmentStatus,
} from '../../stores/appointmentStore';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useAccessibility } from '../../hooks/useAccessibility';
import { OfflineBanner } from '../../components/OfflineBanner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimelineSection {
  title: string;
  data: AppointmentItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format an ISO date string to a user-friendly date/time string.
 */
function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get a display-friendly label for appointment status.
 */
function getStatusLabel(status: AppointmentStatus): string {
  const labels: Record<AppointmentStatus, string> = {
    scheduled: 'Scheduled',
    checked_in: 'Checked In',
    in_progress: 'In Progress',
    completed: 'Completed',
    missed: 'Missed',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

/**
 * Get status color for visual indication.
 */
function getStatusColor(status: AppointmentStatus): string {
  switch (status) {
    case 'scheduled':
      return '#1565C0'; // Blue
    case 'checked_in':
    case 'in_progress':
      return '#E65100'; // Amber/orange
    case 'completed':
      return '#1B5E20'; // Green
    case 'missed':
    case 'cancelled':
      return '#B71C1C'; // Red
    default:
      return '#424242';
  }
}

// ─── AppointmentCard Component ───────────────────────────────────────────────

interface AppointmentCardProps {
  appointment: AppointmentItem;
  onPress: (appointment: AppointmentItem) => void;
  getTextSize: (variant: 'body' | 'heading' | 'caption') => number;
  minTouchTarget: { width: number; height: number };
}

function AppointmentCard({
  appointment,
  onPress,
  getTextSize,
  minTouchTarget,
}: AppointmentCardProps): React.ReactElement {
  const statusColor = getStatusColor(appointment.status);
  const statusLabel = getStatusLabel(appointment.status);

  return (
    <Pressable
      style={[styles.card, { minHeight: minTouchTarget.height }]}
      onPress={() => onPress(appointment)}
      accessibilityRole="button"
      accessibilityLabel={`Appointment on ${formatDateTime(appointment.scheduledDate)} with ${appointment.physicianName} for ${appointment.packageName}, status ${statusLabel}`}
      accessibilityHint="Tap to view full appointment details"
    >
      <View style={styles.cardHeader}>
        <Text
          style={[styles.dateText, { fontSize: getTextSize('body') }]}
          allowFontScaling={true}
          maxFontSizeMultiplier={2}
        >
          {formatDateTime(appointment.scheduledDate)}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text
            style={[styles.statusText, { fontSize: getTextSize('caption') }]}
            allowFontScaling={true}
            maxFontSizeMultiplier={2}
          >
            {statusLabel}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.physicianText, { fontSize: getTextSize('body') }]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {appointment.physicianName}
      </Text>
      <Text
        style={[styles.packageText, { fontSize: getTextSize('caption') }]}
        allowFontScaling={true}
        maxFontSizeMultiplier={2}
      >
        {appointment.packageName}
      </Text>
    </Pressable>
  );
}

// ─── AppointmentDetailModal Component ────────────────────────────────────────

interface AppointmentDetailModalProps {
  appointment: AppointmentItem | null;
  visible: boolean;
  onClose: () => void;
  getTextSize: (variant: 'body' | 'heading' | 'caption') => number;
  minTouchTarget: { width: number; height: number };
}

function AppointmentDetailModal({
  appointment,
  visible,
  onClose,
  getTextSize,
  minTouchTarget,
}: AppointmentDetailModalProps): React.ReactElement {
  if (!appointment) {
    return <></>;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessible
      accessibilityViewIsModal
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text
            style={[styles.modalTitle, { fontSize: getTextSize('heading') }]}
            accessibilityRole="header"
          >
            Appointment Details
          </Text>
          <Pressable
            onPress={onClose}
            style={[
              styles.closeButton,
              { minWidth: minTouchTarget.width, minHeight: minTouchTarget.height },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close appointment details"
          >
            <Text style={[styles.closeButtonText, { fontSize: getTextSize('body') }]}>
              Close
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.modalContent}
          contentContainerStyle={styles.modalContentContainer}
        >
          {/* Date and Time */}
          <View style={styles.detailSection}>
            <Text
              style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Date & Time
            </Text>
            <Text
              style={[styles.detailValue, { fontSize: getTextSize('body') }]}
              accessibilityLabel={`Date and time: ${formatDateTime(appointment.scheduledDate)}`}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {formatDateTime(appointment.scheduledDate)}
            </Text>
          </View>

          {/* Physician */}
          <View style={styles.detailSection}>
            <Text
              style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Physician
            </Text>
            <Text
              style={[styles.detailValue, { fontSize: getTextSize('body') }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {appointment.physicianName}
            </Text>
          </View>

          {/* Package */}
          <View style={styles.detailSection}>
            <Text
              style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Checkup Package
            </Text>
            <Text
              style={[styles.detailValue, { fontSize: getTextSize('body') }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              {appointment.packageName}
            </Text>
          </View>

          {/* Status */}
          <View style={styles.detailSection}>
            <Text
              style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
              allowFontScaling={true}
              maxFontSizeMultiplier={2}
            >
              Status
            </Text>
            <View style={styles.detailStatusRow}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(appointment.status) },
                ]}
              >
                <Text
                  style={[styles.statusText, { fontSize: getTextSize('caption') }]}
                  allowFontScaling={true}
                  maxFontSizeMultiplier={2}
                >
                  {getStatusLabel(appointment.status)}
                </Text>
              </View>
            </View>
          </View>

          {/* Location */}
          {appointment.location && (
            <View style={styles.detailSection}>
              <Text
                style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                Location
              </Text>
              <Text
                style={[styles.detailValue, { fontSize: getTextSize('body') }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                {appointment.location}
              </Text>
            </View>
          )}

          {/* Preparation Instructions */}
          {appointment.preparationInstructions && (
            <View style={styles.detailSection}>
              <Text
                style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                Preparation Instructions
              </Text>
              <Text
                style={[styles.detailValue, { fontSize: getTextSize('body') }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                {appointment.preparationInstructions}
              </Text>
            </View>
          )}

          {/* Associated Tests */}
          {appointment.associatedTests && appointment.associatedTests.length > 0 && (
            <View style={styles.detailSection}>
              <Text
                style={[styles.detailLabel, { fontSize: getTextSize('caption') }]}
                allowFontScaling={true}
                maxFontSizeMultiplier={2}
              >
                Associated Tests
              </Text>
              {appointment.associatedTests.map((test, index) => (
                <Text
                  key={index}
                  style={[styles.testItem, { fontSize: getTextSize('body') }]}
                  accessibilityLabel={`Test ${index + 1}: ${test}`}
                  allowFontScaling={true}
                  maxFontSizeMultiplier={2}
                >
                  • {test}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── SectionHeader Component ─────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  getTextSize: (variant: 'body' | 'heading' | 'caption') => number;
}

function SectionHeader({ title, getTextSize }: SectionHeaderProps): React.ReactElement {
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <View style={styles.timelineDot} />
      <Text style={[styles.sectionTitle, { fontSize: getTextSize('heading') }]}>
        {title}
      </Text>
    </View>
  );
}

// ─── EmptyState Component ────────────────────────────────────────────────────

interface EmptyStateProps {
  getTextSize: (variant: 'body' | 'heading' | 'caption') => number;
}

function EmptyState({ getTextSize }: EmptyStateProps): React.ReactElement {
  return (
    <View style={styles.emptyContainer} accessibilityRole="text">
      <Text
        style={[styles.emptyTitle, { fontSize: getTextSize('body') }]}
        accessibilityLabel="No scheduled appointments"
      >
        No scheduled appointments
      </Text>
      <Text
        style={[styles.emptySubtitle, { fontSize: getTextSize('caption') }]}
        accessibilityLabel="Please contact your healthcare provider to schedule an appointment"
      >
        Please contact your healthcare provider to schedule an appointment.
      </Text>
    </View>
  );
}

// ─── AppointmentScreen ───────────────────────────────────────────────────────

export function AppointmentScreen(): React.ReactElement {
  const { getTextSize, theme, minTouchTarget } = useAccessibility();
  const { isOffline, onReconnect } = useNetworkStatus();

  const user = useAuthStore((state) => state.user);
  const seniorId = user?.seniorId ?? '';

  const {
    appointments,
    isLoading,
    isOffline: isServingCached,
    fetchAppointments,
    getUpcomingAppointments,
    getPastAppointments,
  } = useAppointmentStore();

  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentItem | null>(
    null,
  );

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(() => {
    if (!seniorId) return;
    fetchAppointments(seniorId).catch(() => {
      // Errors handled by the store
    });
  }, [seniorId, fetchAppointments]);

  // Initial fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when network reconnects
  useEffect(() => {
    onReconnect(() => {
      fetchData();
    });
  }, [onReconnect, fetchData]);

  // ─── Sections ──────────────────────────────────────────────────────────────

  const upcomingAppointments = useMemo(() => getUpcomingAppointments(), [appointments]);
  const pastAppointments = useMemo(() => getPastAppointments(), [appointments]);

  // Build flat list data with section headers
  const listData = useMemo(() => {
    const items: Array<{ type: 'header'; title: string } | { type: 'item'; appointment: AppointmentItem }> = [];

    if (upcomingAppointments.length > 0) {
      items.push({ type: 'header', title: 'Upcoming Appointments' });
      upcomingAppointments.forEach((appointment) => {
        items.push({ type: 'item', appointment });
      });
    }

    if (pastAppointments.length > 0) {
      items.push({ type: 'header', title: 'Past Appointments' });
      pastAppointments.forEach((appointment) => {
        items.push({ type: 'item', appointment });
      });
    }

    return items;
  }, [upcomingAppointments, pastAppointments]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleAppointmentPress = useCallback((appointment: AppointmentItem) => {
    setSelectedAppointment(appointment);
    setDetailVisible(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailVisible(false);
    setSelectedAppointment(null);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // ─── Render Item ───────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item }: { item: (typeof listData)[number] }) => {
      if (item.type === 'header') {
        return <SectionHeader title={item.title} getTextSize={getTextSize} />;
      }
      return (
        <View style={styles.timelineItemRow}>
          <View style={styles.timelineLine} />
          <AppointmentCard
            appointment={item.appointment}
            onPress={handleAppointmentPress}
            getTextSize={getTextSize}
            minTouchTarget={minTouchTarget}
          />
        </View>
      );
    },
    [getTextSize, minTouchTarget, handleAppointmentPress],
  );

  const keyExtractor = useCallback(
    (item: (typeof listData)[number], index: number) => {
      if (item.type === 'header') return `header-${item.title}-${index}`;
      return `appointment-${item.appointment.id}`;
    },
    [],
  );

  // ─── Empty State ───────────────────────────────────────────────────────────

  const renderEmptyState = useCallback(() => {
    if (isLoading) return null;
    return <EmptyState getTextSize={getTextSize} />;
  }, [isLoading, getTextSize]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <OfflineBanner
        isOffline={isOffline || isServingCached}
        hasCachedData={appointments.length > 0}
      />
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            accessibilityLabel="Pull to refresh appointments"
          />
        }
        accessibilityRole="list"
        accessibilityLabel="Appointments list"
      />
      <AppointmentDetailModal
        appointment={selectedAppointment}
        visible={detailVisible}
        onClose={handleCloseDetail}
        getTextSize={getTextSize}
        minTouchTarget={minTouchTarget}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
  },
  // ─── Timeline styles ───────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1565C0',
    marginRight: 12,
  },
  sectionTitle: {
    fontWeight: '700',
    color: '#212121',
  },
  timelineItemRow: {
    flexDirection: 'row',
    paddingLeft: 5,
  },
  timelineLine: {
    width: 2,
    backgroundColor: '#BDBDBD',
    marginRight: 16,
  },
  // ─── Card styles ───────────────────────────────────────────────────
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateText: {
    fontWeight: '600',
    color: '#212121',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  physicianText: {
    color: '#212121',
    marginBottom: 4,
  },
  packageText: {
    color: '#424242',
  },
  // ─── Empty state styles ────────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontWeight: '600',
    color: '#424242',
    textAlign: 'center',
    marginBottom: 12,
  },
  emptySubtitle: {
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  // ─── Modal styles ─────────────────────────────────────────────────
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontWeight: '700',
    color: '#212121',
    flex: 1,
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
  },
  closeButtonText: {
    color: '#1565C0',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
  },
  modalContentContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 4,
  },
  detailValue: {
    color: '#212121',
    fontWeight: '400',
  },
  detailStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  testItem: {
    color: '#212121',
    marginTop: 4,
    paddingLeft: 4,
  },
});

export default AppointmentScreen;
