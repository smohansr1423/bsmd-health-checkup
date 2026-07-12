/**
 * Manual mock for @react-native-community/netinfo
 * Used by Jest when running mobile-app tests.
 */

const NetInfo = {
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    type: 'wifi',
  }),
  addEventListener: jest.fn(() => jest.fn()),
};

export default NetInfo;
export type NetInfoState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string;
};
